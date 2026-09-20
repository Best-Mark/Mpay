#!/usr/bin/env bash
# 服务器一键更新：拉代码 → 装依赖 → 构建（后端 / 管理后台 / 官网）→ 重启服务 → 校验 nginx
#
# 用法（在项目根目录执行）：
#   bash update.sh              全量更新（默认）
#   bash update.sh --no-deps    跳过 npm install，只构建
#   bash update.sh --no-db      跳过数据库迁移（确认本次无 schema/迁移变更时用）
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

# ---------- 3. 数据库迁移（必须在重启前，且失败绝不重启） ----------
if [ "$ONLY" = "web" ] || [ "$ONLY" = "admin" ]; then
  log "跳过数据库迁移（本次只构建前端）"
elif [ "$DO_DB" = "0" ]; then
  warn "跳过数据库迁移（--no-db）：确认本次无迁移变更，否则新代码会缺表/缺列"
else
  log "执行数据库迁移：prisma migrate deploy（幂等，只跑未应用的迁移）"
  npm run prisma:deploy ||
    fail "数据库迁移失败，已中止重启。请先看上方报错修复，再重跑 bash update.sh"
fi

# ---------- 4. 重启服务 ----------
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    log "重启服务：pm2 restart $PM2_APP"
    pm2 restart "$PM2_APP" --update-env
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
