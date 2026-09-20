#!/usr/bin/env bash
# 服务器一键更新：拉代码 → 装依赖 → 构建（后端 / 管理后台 / 官网）→ 重启服务 → 校验 nginx
#
# 用法（在项目根目录执行）：
#   bash update.sh              全量更新（默认）
#   bash update.sh --no-deps    跳过 npm install，只构建
#   bash update.sh --no-db      跳过数据库迁移检查（迁移由服务启动自愈，此项仅跳过 CLI 迁移与日志校验）
#   bash update.sh --no-nginx   不重载 nginx
#   bash update.sh --web        只构建 C 端官网（改官网文案/样式时用，最快）
#   bash update.sh --admin      只构建管理后台
#
# 可用环境变量覆盖：
#   PM2_APP=mpay              pm2 进程名
#   MEM_MIN_MB=800            构建前可用内存告警阈值（低于此值会警告并等待 10s）
#   MEM_SKIP_WAIT=1           跳过低内存时的 10s 等待
#   资源/数据库快照同时写入 storage/update.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 构建必须用 devDependencies（nest / vite / prisma 都在 dev 里）。
# 若当前 shell 带着 NODE_ENV=production（例如为查库 source 过 .env），
# npm 会按 --omit=dev 安装，并把已装的 dev 依赖整批删掉 → 构建时报 "nest: command not found"。
unset NODE_ENV

PM2_APP="${PM2_APP:-mpay}"
DO_DEPS=1
DO_DB=1
DO_NGINX=1
ONLY=""

usage() {
  sed -n '2,12p' "$0"
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --no-deps) DO_DEPS=0 ;;
    --no-db) DO_DB=0 ;;
    --no-nginx) DO_NGINX=0 ;;
    --web) ONLY="web" ;;
    --admin) ONLY="admin" ;;
    -h | --help) usage ;;
    *) echo "[update] 未知参数：$arg（用 -h 查看用法）" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[update]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[update]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31m[update]\033[0m %s\n' "$*" >&2; exit 1; }

# 防止两个更新任务并发跑（同一台机器只保留一份锁）
if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/mpay-update.lock
  flock -n 9 || fail "已有更新任务在运行，请稍后再试"
fi

command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js"
command -v npm >/dev/null 2>&1 || fail "未找到 npm"
command -v git >/dev/null 2>&1 || fail "未找到 git"

# ---------- 资源快照工具 ----------
# 小内存机器上"跑一阵就卡死"最难的是事后无据可查：重启会清空现场。
# 这里每次更新前后各记录一次内存/swap/负载与 MySQL 连接水位，落到 storage/update.log，
# 事后能区分是"构建压死"还是"服务长跑泄漏/连接打满"。
LOG_FILE="$ROOT/storage/update.log"
mkdir -p "$ROOT/storage"

env_val() {
  local key="$1" v
  [ -f .env ] || return 0
  v=$(sed -n "s/^[[:space:]]*${key}=//p" .env | tail -n 1)
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  printf '%s' "$v"
}

mem_avail_mb() { awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo; }

mem_report() {
  local total avail swap_total swap_used load
  total=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  avail=$(mem_avail_mb)
  swap_total=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  swap_used=$(( swap_total - $(awk '/SwapFree/ {printf "%d", $2/1024}' /proc/meminfo) ))
  load=$(cut -d' ' -f1-3 /proc/loadavg)
  printf '  内存：可用 %sMB / 共 %sMB ｜ swap：已用 %sMB / 共 %sMB ｜ 负载：%s\n' \
    "$avail" "$total" "$swap_used" "$swap_total" "$load"
}

# MySQL 连接水位：Max_used_connections 是历史峰值，连接打满会造成 API 全线超时，
# 而静态页面与宝塔面板仍正常——正是"网站能开、后台登不上"的典型特征。
db_report() {
  local host port user pass name out args=()
  if ! command -v mysql >/dev/null 2>&1; then
    printf '  MySQL：未安装 mysql 客户端，跳过\n'
    return 0
  fi
  host=$(env_val DB_HOST); user=$(env_val DB_USER); pass=$(env_val DB_PASSWORD)
  port=$(env_val DB_PORT); name=$(env_val DB_NAME)
  if [ -z "$host" ] || [ -z "$user" ]; then
    printf '  MySQL：.env 未配置 DB_HOST/DB_USER，跳过\n'
    return 0
  fi
  args=(-h "$host" -P "${port:-3306}" -u "$user" -N -B)
  [ -n "$pass" ] && args+=("-p${pass}")
  out=$(mysql "${args[@]}" -e \
    "SHOW VARIABLES LIKE 'max_connections'; \
     SHOW STATUS LIKE 'Threads_connected'; \
     SHOW STATUS LIKE 'Max_used_connections'; \
     SHOW STATUS LIKE 'Aborted_connects';" 2>&1 |
    grep -v 'Using a password') || out='(查询失败)'
  printf '  MySQL(%s)：%s\n' "$name" "$(printf '%s' "$out" | tr '\n\t' ';=' | sed 's/;;*/; /g')"
}

snapshot() {
  {
    printf '[%s] %s ｜ %s\n' "$(date '+%F %T')" "$1" "$(git --no-pager log --oneline -1)"
    mem_report
    db_report
    printf '\n'
  } | tee -a "$LOG_FILE" || true
}

# ---------- 1. 同步代码 ----------
log "同步代码：git pull --ff-only"
git pull --ff-only ||
  fail "git pull 失败：服务器存在本地改动或分支分叉，请先执行 git status 手动处理"

install_deps() {
  local dir="$1" name="$2"
  [ "$DO_DEPS" = "1" ] || return 0
  log "安装依赖：$name"
  (cd "$dir" && npm install --include=dev --no-audit --no-fund)
}

build_dir() {
  local dir="$1" name="$2"
  install_deps "$dir" "$name"
  log "构建：$name"
  (cd "$dir" && npm run build)
}

# ---------- 2. 构建前资源体检 ----------
log "资源体检（构建前，同时写入 storage/update.log）"
snapshot "构建前"
MEM_MIN_MB="${MEM_MIN_MB:-800}"
if [ "$(mem_avail_mb)" -lt "$MEM_MIN_MB" ]; then
  warn "可用内存不足 ${MEM_MIN_MB}MB：nest + vite 构建峰值可达 1~2GB，小内存机器有被压到无响应的风险"
  warn "建议先确认 swap 生效（swapon --show），或改用 bash update.sh --web / --admin 分步构建"
  if [ "${MEM_SKIP_WAIT:-0}" != "1" ]; then
    log "10 秒后继续（Ctrl+C 可中止；也可设 MEM_SKIP_WAIT=1 跳过等待）"
    sleep 10
  fi
fi

# ---------- 3. 构建 ----------
if [ "$ONLY" = "web" ]; then
  build_dir web "C 端官网"
elif [ "$ONLY" = "admin" ]; then
  build_dir admin "管理后台"
else
  install_deps . "后端"
  log "生成 Prisma Client（schema 有变更时必须，幂等）"
  npm run prisma:generate
  log "构建：后端"
  npm run build
  build_dir admin "管理后台"
  build_dir web "C 端官网"
fi

# ---------- 4. 数据库迁移 ----------
# 迁移不由本脚本执行：服务启动时 schema-init（src/common/prisma/schema-init.ts，
# SCHEMA_AUTO_INIT 默认开启）会自动应用 prisma/migrations 下未执行的迁移，
# 连接串由 .env 的 DB_HOST/DB_USER/DB_NAME 等分项组装（安装向导会把整串 DATABASE_URL 注释掉），
# 因此 prisma CLI 在多数部署下拿不到 DATABASE_URL，不能作为迁移入口。
# 仅当 .env 配置了整串 DATABASE_URL 时才额外用 CLI 跑一次，且失败也不阻断（启动自愈兜底）。
if [ "$ONLY" = "web" ] || [ "$ONLY" = "admin" ] || [ "$DO_DB" = "0" ]; then
  log "跳过数据库迁移（只构建前端 / --no-db）：迁移在重启时由服务自愈应用"
elif grep -Eq '^[[:space:]]*DATABASE_URL=.+' .env 2>/dev/null; then
  log "检测到整串 DATABASE_URL，执行 prisma migrate deploy（失败不阻断）"
  npm run prisma:deploy || warn "CLI 迁移未成功，将由服务重启时的自愈机制应用"
else
  log "未配置整串 DATABASE_URL（分项 DB_* 模式）：迁移交由服务重启时自愈应用"
fi

# ---------- 5. 重启服务 ----------
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    log "重启服务：pm2 restart $PM2_APP"
    pm2 restart "$PM2_APP" --update-env
    # 迁移在进程启动阶段执行，稍等后从日志确认结果
    if [ "$DO_DB" = "1" ] && [ "$ONLY" != "web" ] && [ "$ONLY" != "admin" ]; then
      log "等待启动自愈执行迁移（8s）"
      sleep 8
      pm2 logs "$PM2_APP" --lines 500 --nostream 2>/dev/null |
        grep -E "已应用数据库迁移|数据库结构已是最新|数据库连接正常|数据库连接失败|自愈失败" ||
        warn "日志中未匹配到迁移结果，请手动执行：pm2 logs $PM2_APP"
    fi
  else
    warn "pm2 中未找到进程 $PM2_APP（首次部署请先 pm2 start），已跳过重启"
  fi
else
  warn "未安装 pm2，已跳过重启（需手动重启后端进程）"
fi

# ---------- 6. 重载 nginx ----------
if [ "$DO_NGINX" = "1" ] && command -v nginx >/dev/null 2>&1; then
  log "校验并重载 nginx"
  nginx -t && nginx -s reload
fi

log "资源体检（更新后）"
snapshot "更新后"
log "更新完成：$(git --no-pager log --oneline -1)"
cat <<EOF

快照日志：$LOG_FILE

验证清单：
  官网             https://mpay.7zan.com/
  管理后台         https://mpay.7zan.com/admin/
  SDK 下载         https://mpay.7zan.com/sdk/pay-sdk-all.zip
  官网文案修改     直接编辑 web/dist/site.content.json，刷新即生效
EOF
