#!/usr/bin/env bash
# voice-asr-test 桌面 app 启动器 — server (:8501) + Tauri 窗口
#
# 一键拉起两个进程:
#   1. uvicorn server:app 在 127.0.0.1:8501(后台)
#   2. cd demo-ui && npm run tauri:dev(前台,带原生窗口 + 托盘)
#
# Ctrl+C 一次 → 两个都干净关。Tauri dev 会自启动 Vite(:5173),
# Vite 把 /api 代理给 :8501。
#
# Env 跟 ./start.sh 一致(MLX_QWEN_MODEL / LLM_PROVIDER / ...)。

set -eu

# ── 切到脚本所在目录(允许在任何位置调用)──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 加载 .env(若有)── 跟 start.sh 同一份 portable 写法
for f in .env .env.local; do
  if [ -f "$f" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line#export }"
      case "$line" in ''|\#*) continue ;; esac
      case "$line" in *=*) ;; *) continue ;; esac
      k="${line%%=*}"; v="${line#*=}"
      export "$k"="$v"
    done < "$f"
  fi
done

# ── 颜色 ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'
  C_SRV=$'\033[0;36m'; C_TAURI=$'\033[0;35m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_SRV=''; C_TAURI=''; C_OFF=''
fi
log()   { printf "%s[desktop]%s %s\n" "$C_OK"   "$C_OFF" "$*"; }
warn()  { printf "%s[desktop]%s %s\n" "$C_WARN" "$C_OFF" "$*" >&2; }
err()   { printf "%s[desktop]%s %s\n" "$C_ERR"  "$C_OFF" "$*" >&2; }

# ── 前置检查 ────────────────────────────────────────────────────────
[ -d ".venv" ] || { err ".venv 不存在 — 见 start.sh 顶部说明先建 venv"; exit 1; }
[ -f "server.py" ] || { err "server.py 不在当前目录"; exit 1; }
[ -d "demo-ui" ]   || { err "demo-ui/ 不存在"; exit 1; }
[ -d "demo-ui/src-tauri" ] || { err "demo-ui/src-tauri 不存在 — 跑过 'npx tauri init' 吗?"; exit 1; }
if [ ! -d "demo-ui/node_modules" ]; then
  warn "demo-ui/node_modules 不存在,跑 npm install…"
  (cd demo-ui && npm install) || { err "npm install 失败"; exit 1; }
fi

# ── 清理占用端口的旧进程(server :8501,vite :5173)─────────────────
for port in 8501 5173; do
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    warn "kill 占用 :$port 的旧进程 PID:$pids"
    kill $pids 2>/dev/null || true
  fi
done
sleep 0.5

# ── 启动 server(后台) ─────────────────────────────────────────────
log "起 server (uvicorn :8501)…"
SERVER_LOG="/tmp/voice-asr-server.log"
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8501 --log-level info \
  > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
log "  ${C_SRV}server${C_OFF} PID=$SERVER_PID,log → $SERVER_LOG"

# ── 等 server 起来(health check 200)── timeout 30s
log "等 server 就绪…"
deadline=$((SECONDS + 30))
until curl -fsS --max-time 1 http://127.0.0.1:8501/health > /dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    err "server 30s 内没起来 — 看 $SERVER_LOG"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    err "server 进程已挂 — tail 一下 $SERVER_LOG:"
    tail -20 "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 0.3
done
log "  ${C_SRV}server${C_OFF} ✓ 就绪"

# ── 干净退出 hook ───────────────────────────────────────────────────
cleanup() {
  log "收到退出信号,清理子进程…"
  if [ -n "${TAURI_PID:-}" ] && kill -0 "$TAURI_PID" 2>/dev/null; then
    kill "$TAURI_PID" 2>/dev/null || true
  fi
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # 兜底:残留 :5173 vite 进程
  pids=$(lsof -ti ":5173" 2>/dev/null || true)
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  log "已退出。"
}
trap cleanup INT TERM EXIT

# ── 启动 Tauri dev(前台,会自己启动 Vite)──────────────────────────
log "起 ${C_TAURI}Tauri dev${C_OFF}(会自启动 vite :5173 + 编 Rust)…"
log "  首次约 1 min;后续秒开。窗口 + 系统托盘出现表示就绪。"
log "  ⌘⇧Space 是全局 hotkey — 任何 app 下按下都能触发录音。"
cd demo-ui
exec npm run tauri:dev
