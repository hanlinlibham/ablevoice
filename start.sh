#!/usr/bin/env bash
# voice-asr-test 启动器 — 一键拉起 server (:8501) + vite UI (:5173)
#
# 用法:
#   ./start.sh                                  # 用 server.py 默认 model
#   MLX_QWEN_MODEL=Qwen/Qwen3-ASR-1.7B ./start.sh
#   OLLAMA_MODEL=gpt-oss:20b ./start.sh
#   KEEP_AUDIO=1 ./start.sh                     # 保留上传的录音 wav
#
# Env 变量(都 forward 给子进程,server.py 自己消费):
#   MLX_QWEN_MODEL   ASR 模型 ID,默认 Qwen/Qwen3-ASR-0.6B
#   MLX_TTS_MODEL    TTS 模型 ID,默认 mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit
#   LLM_PROVIDER     mlx (默认,常驻 mlx-lm) 或 ollama
#   MLX_LLM_MODEL    MLX LLM ID,默认 mlx-community/Qwen3-4B-Instruct-2507-4bit
#   OLLAMA_MODEL     ollama 模型名(LLM_PROVIDER=ollama 时),默认 qwen3.5:35b
#   OLLAMA_URL       默认 http://127.0.0.1:11434
#   KEEP_AUDIO       1 保留上传录音,0 转写完就删
#   SYSTEM_PROMPT    覆盖 LLM system 提示
#
# 退出:Ctrl+C 一次,两个子进程都会被干净关掉。

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load env file(s). .env.local overrides .env. Parsed line-by-line to
# be portable across bash/zsh (zsh's `.` doesn't search cwd, and
# `set -a` semantics differ — line-by-line export is the safe form).
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

# ── 颜色(只在 tty 输出时启用)──────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'
  C_SRV=$'\033[0;36m'; C_UI=$'\033[0;35m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_SRV=''; C_UI=''; C_OFF=''
fi
log()  { printf "%s[start]%s %s\n" "$C_OK"   "$C_OFF" "$*"; }
warn() { printf "%s[start]%s %s\n" "$C_WARN" "$C_OFF" "$*" >&2; }
err()  { printf "%s[start]%s %s\n" "$C_ERR"  "$C_OFF" "$*" >&2; }

# ── 前置检查 ────────────────────────────────────────────────────────
[ -d ".venv" ] || {
  err ".venv 不存在 — 先建好 Python venv:"
  err "  python3 -m venv .venv && .venv/bin/pip install -U pip"
  err "  .venv/bin/pip install fastapi uvicorn httpx mlx-qwen3-asr mlx-audio"
  exit 1
}
[ -f "server.py" ] || { err "server.py 不在当前目录"; exit 1; }
[ -d "demo-ui" ]   || { err "demo-ui/ 不存在"; exit 1; }
if [ ! -d "demo-ui/node_modules" ]; then
  warn "demo-ui/node_modules 不存在,跑 npm install…"
  (cd demo-ui && npm install) || { err "npm install 失败"; exit 1; }
fi

# Ollama 只在 LLM_PROVIDER=ollama 时是必需的 — MLX 模式不需要 ollama
if [ "${LLM_PROVIDER:-mlx}" = "ollama" ]; then
  if ! curl -fsS --max-time 2 "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
    warn "ollama 没在 ${OLLAMA_URL:-:11434} 响应 — chat / ws 的 LLM 部分会失败"
    warn "  开另一个 terminal 跑:ollama serve  (或改用 LLM_PROVIDER=mlx)"
  fi
fi

# ── 清理占用端口的旧进程 ────────────────────────────────────────────
for port in 8501 5173; do
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    warn "kill 占用 :$port 的旧进程 PID:$pids"
    kill $pids 2>/dev/null || true
  fi
done
sleep 0.5

# ── 启动 ────────────────────────────────────────────────────────────
_provider="${LLM_PROVIDER:-mlx}"
if [ "$_provider" = "mlx" ]; then
  _llm_show="${MLX_LLM_MODEL:-Qwen3-4B-Instruct-2507-4bit (默认)}"
else
  _llm_show="ollama:${OLLAMA_MODEL:-qwen3.5:35b (默认)}"
fi
log "ASR=${MLX_QWEN_MODEL:-Qwen/Qwen3-ASR-0.6B (默认)} · TTS=${MLX_TTS_MODEL:-Qwen3-TTS-1.7B-8bit (默认)} · LLM=$_llm_show · KEEP_AUDIO=${KEEP_AUDIO:-0}"

PIDS=()
cleanup() {
  echo
  log "shutting down…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  # 顺便清掉孙进程(uvicorn 的 worker、vite 的 esbuild 之类的)
  for port in 8501 5173; do
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  log "bye"
  exit 0
}
trap cleanup INT TERM

# Server — uvicorn 不开 --reload(reload 会重新 load 模型,很慢)
(
  .venv/bin/uvicorn server:app \
    --host 127.0.0.1 --port 8501 --log-level info 2>&1 \
    | while IFS= read -r line; do printf "%s[srv]%s %s\n" "$C_SRV" "$C_OFF" "$line"; done
) &
PIDS+=($!)

# Vite
(
  cd demo-ui && npm run dev 2>&1 \
    | while IFS= read -r line; do printf "%s[ui] %s %s\n" "$C_UI"  "$C_OFF" "$line"; done
) &
PIDS+=($!)

# ── 等待就绪 ────────────────────────────────────────────────────────
log "等待 server (:8501) 与 UI (:5173) 起来…"
srv_ok=0; ui_ok=0
for _ in $(seq 1 60); do
  [ "$srv_ok" = 1 ] || curl -fsS --max-time 1 http://127.0.0.1:8501/health >/dev/null 2>&1 && srv_ok=1
  [ "$ui_ok"  = 1 ] || curl -fsS --max-time 1 http://127.0.0.1:5173/       >/dev/null 2>&1 && ui_ok=1
  [ "$srv_ok" = 1 ] && [ "$ui_ok" = 1 ] && break
  sleep 0.5
done
echo
if [ "$srv_ok" = 1 ] && [ "$ui_ok" = 1 ]; then
  log "↳ UI:     http://127.0.0.1:5173/"
  log "↳ Server: http://127.0.0.1:8501/health"
  log "↳ TUI:    在另一个 terminal 跑  ./tui.py"
  log "Ctrl+C 退出"
else
  warn "30s 内没有就绪 — 看上面日志(Ctrl+C 退出)"
fi
echo

# Block until any child dies (or SIGINT triggers cleanup)
wait -n 2>/dev/null || wait
cleanup
