#!/usr/bin/env bash
# voice-asr-test TUI 一键启动器
#
# 干啥:
#   1. 把 server (uvicorn :8501) 拉到 background,日志写 /tmp/voice-server.log
#   2. 等 /health 通(server 启动)+ warmup 完成(模型 hot)
#   3. 进入 TUI 全屏(./tui.py)— terminal 被 textual 接管
#   4. TUI 退出(Q 或 Ctrl+C)时 trap 把 server 也关掉
#
# 用法:
#   ./start-tui.sh                                     # 用 server.py 默认 model
#   MLX_QWEN_MODEL=Qwen/Qwen3-ASR-1.7B ./start-tui.sh  # 切大 ASR
#   OLLAMA_MODEL=gpt-oss:20b LLM_PROVIDER=ollama ./start-tui.sh
#   LLM_PROVIDER=dashscope ./start-tui.sh             # 云 LLM (qwen3.7-max)
#   LLM_PROVIDER=ablework ./start-tui.sh              # ablework 主干 agent
#   TTS_PROVIDER=dashscope MLX_TTS_VOICE=Maia ./start-tui.sh   # 云 TTS,可选 Maia/Cherry/Chelsie 等
#   ASR_PROVIDER=dashscope ./start-tui.sh             # 云 ASR (paraformer-realtime-v2),保留 partials
#   ASR_PROVIDER=dashscope TTS_PROVIDER=dashscope LLM_PROVIDER=ablework ./start-tui.sh   # 全云配置
#   WARMUP=0 ./start-tui.sh                            # 跳过启动 warm(快但首次 chat 慢)
#
# 如果你想顺便也开浏览器 UI(vite :5173),用 ./start.sh 而不是这个。
# 这个脚本只服务 TUI 一个 client。

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load env file(s) if present. .env.local takes precedence over .env
# (matches Next.js/Vite convention). We parse line-by-line instead of
# ``set -a; source`` because zsh's ``.`` doesn't search the cwd for
# relative paths and ``set -a`` semantics differ subtly across shells.
# This loop is portable bash/zsh and handles ``export FOO=bar`` too.
for f in .env .env.local; do
  if [ -f "$f" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line#export }"
      case "$line" in ''|\#*) continue ;; esac
      case "$line" in *=*) ;; *) continue ;; esac
      k="${line%%=*}"
      v="${line#*=}"
      export "$k"="$v"
    done < "$f"
  fi
done

LOG_FILE="${VOICE_SERVER_LOG:-/tmp/voice-server.log}"

if [ -t 1 ]; then
  C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''
fi
log()  { printf "%s[start-tui]%s %s\n" "$C_OK"   "$C_OFF" "$*"; }
warn() { printf "%s[start-tui]%s %s\n" "$C_WARN" "$C_OFF" "$*" >&2; }
err()  { printf "%s[start-tui]%s %s\n" "$C_ERR"  "$C_OFF" "$*" >&2; }

# ── 前置检查 ────────────────────────────────────────────────────────
[ -d ".venv" ] || { err ".venv 不存在 — 见 start.sh 顶部说明先建 venv"; exit 1; }
[ -f "tui.py" ] || { err "tui.py 不在当前目录"; exit 1; }
[ -f "server.py" ] || { err "server.py 不在当前目录"; exit 1; }

_provider="${LLM_PROVIDER:-mlx}"
if [ "$_provider" = "ollama" ]; then
  if ! curl -fsS --max-time 2 "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
    warn "ollama 没在 ${OLLAMA_URL:-:11434} 响应 — LLM 部分会报错(或改用 LLM_PROVIDER=mlx)"
  fi
elif [ "$_provider" = "dashscope" ]; then
  if [ -z "${DASHSCOPE_API_KEY:-}" ]; then
    err "LLM_PROVIDER=dashscope 但 DASHSCOPE_API_KEY 没设。先 export DASHSCOPE_API_KEY=sk-...,或改 LLM_PROVIDER=mlx。"
    exit 1
  fi
elif [ "$_provider" = "ablework" ]; then
  if [ -z "${ABLEWORK_TOKEN:-${TOKEN:-}}" ]; then
    err "LLM_PROVIDER=ablework 但 TOKEN/ABLEWORK_TOKEN 没设。在 .env.local 里加 TOKEN=ey...,或改 LLM_PROVIDER=mlx。"
    exit 1
  fi
fi

# ── 清理占用 :8501 的旧进程 ─────────────────────────────────────────
pids=$(lsof -ti :8501 2>/dev/null || true)
if [ -n "$pids" ]; then
  warn "kill 占用 :8501 的旧进程 PID:$pids"
  kill $pids 2>/dev/null || true
  sleep 0.5
fi

# ── 启动 server (background) ─────────────────────────────────────────
log "启动 server (log → $LOG_FILE)…"
# 用 nohup-style 重定向:server stdout/stderr 全进 log file,不污染 TUI
.venv/bin/uvicorn server:app \
  --host 127.0.0.1 --port 8501 --log-level info \
  >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Trap:无论怎么退出(Q / Ctrl+C / TUI crash),都尝试干净关 server
cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    # uvicorn 一般 1s 内会退;别等太久
    for _ in 1 2 3 4 5; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── 等 server ready (health + warmup) ────────────────────────────────
log "等 /health…"
ok=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 http://127.0.0.1:8501/health >/dev/null 2>&1; then
    ok=1; break
  fi
  # server 提前挂?
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    err "server 在启动阶段挂了 — 看 $LOG_FILE 末尾:"
    tail -20 "$LOG_FILE" >&2
    exit 1
  fi
  sleep 0.5
done
[ "$ok" = 1 ] || { err "20s 内 /health 没通"; tail -20 "$LOG_FILE" >&2; exit 1; }

# 默认 WARMUP=1,等 "warmup done" 出现再进 TUI(避免首次 chat 卡在 graph 编译)
if [ "${WARMUP:-1}" != "0" ]; then
  log "等模型 warmup(默认 ~5s,首次跑 + 下载会更久)…"
  warmed=0
  for _ in $(seq 1 240); do  # 最多等 2 min
    if grep -q "warmup done" "$LOG_FILE" 2>/dev/null; then
      warmed=1; break
    fi
    if grep -q "warmup failed" "$LOG_FILE" 2>/dev/null; then
      warn "warmup failed — 看 $LOG_FILE;继续进 TUI(首次请求会慢)"
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      err "warmup 阶段 server 挂了 — 看 $LOG_FILE 末尾:"
      tail -20 "$LOG_FILE" >&2
      exit 1
    fi
    sleep 0.5
  done
  [ "$warmed" = 1 ] && log "warmup done · 模型 hot"
fi

# ── 启 TUI(foreground,替换当前 shell)──────────────────────────────
log "进入 TUI(Q 退出会自动关 server)"
sleep 0.3  # 让上面这行 log 被看到
# exec 让 textual 完全接管 stdin/stdout;但 exec 后 trap 不再生效,
# 所以用普通 call,后面再 cleanup
.venv/bin/python tui.py
status=$?

if [ "$status" -ne 0 ]; then
  warn "TUI 退出码 $status — 看 $LOG_FILE 末尾:"
  tail -20 "$LOG_FILE" >&2
fi

log "关 server (PID $SERVER_PID)…"
# trap 的 cleanup 会在 EXIT 时跑
exit "$status"
