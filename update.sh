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
# 可用环境变量覆盖：PM2_APP=mpay（pm2 进程名）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

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

# ---------- 1. 同步代码 ----------
log "同步代码：git pull --ff-only"
git pull --ff-only ||
  fail "git pull 失败：服务器存在本地改动或分支分叉，请先执行 git status 手动处理"

install_deps() {
  local dir="$1" name="$2"
  [ "$DO_DEPS" = "1" ] || return 0
  log "安装依赖：$name"
  (cd "$dir" && npm install --no-audit --no-fund)
}

build_dir() {
  local dir="$1" name="$2"
  install_deps "$dir" "$name"
  log "构建：$name"
  (cd "$dir" && npm run build)
}

# ---------- 2. 构建 ----------
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

# ---------- 3. 数据库迁移 ----------
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

# ---------- 4. 重启服务 ----------
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    log "重启服务：pm2 restart $PM2_APP"
    pm2 restart "$PM2_APP" --update-env
    # 迁移在进程启动阶段执行，稍等后从日志确认结果
    if [ "$DO_DB" = "1" ] && [ "$ONLY" != "web" ] && [ "$ONLY" != "admin" ]; then
      log "等待启动自愈执行迁移（8s）"
      sleep 8
      pm2 logs "$PM2_APP" --lines 60 --nostream 2>/dev/null |
        grep -E "已应用数据库迁移|数据库连接正常|数据库连接失败|迁移失败" ||
        warn "日志中未匹配到迁移结果，请手动执行：pm2 logs $PM2_APP"
    fi
  else
    warn "pm2 中未找到进程 $PM2_APP（首次部署请先 pm2 start），已跳过重启"
  fi
else
  warn "未安装 pm2，已跳过重启（需手动重启后端进程）"
fi

# ---------- 5. 重载 nginx ----------
if [ "$DO_NGINX" = "1" ] && command -v nginx >/dev/null 2>&1; then
  log "校验并重载 nginx"
  nginx -t && nginx -s reload
fi

log "更新完成：$(git --no-pager log --oneline -1)"
cat <<'EOF'

验证清单：
  官网             https://mpay.7zan.com/
  管理后台         https://mpay.7zan.com/admin/
  SDK 下载         https://mpay.7zan.com/sdk/pay-sdk-all.zip
  官网文案修改     直接编辑 web/dist/site.content.json，刷新即生效
EOF
