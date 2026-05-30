# Issue: formalize four voice runtime modes

**Status**: proposed
**Date**: 2026-05-30
**Owner**: ablevoice probe owner

## Background

The project already has working local provider primitives for ASR, LLM, and
TTS, plus a cloud path through DashScope and ablework. The next step is to make
the runtime modes explicit instead of relying on ad hoc provider env
combinations.

We want four user-facing modes:

1. local ASR + local TTS
2. local ASR + local TTS + local LLM
3. local ASR + local TTS + local agent
4. full online mode

The important distinction is that mode 2 is a local chat assistant, while mode
3 is a local agent. A local agent needs a runtime loop, tools, permission gates,
and task/action events; it is not just `LLM_PROVIDER=mlx`.

## Current state

| Mode | Current support | Judgment |
|---|---|---|
| 1. ASR + TTS | Provider primitives exist, but no explicit no-chat mode | Feasible; needs a `VOICE_MODE=asr_tts` path that stops after transcript/optional speakback |
| 2. ASR + TTS + LLM | Mostly implemented via `ASR_PROVIDER=mlx LLM_PROVIDER=mlx TTS_PROVIDER=mlx` | Feasible today, with polish/intent caveats |
| 3. ASR + TTS + agent | Online ablework agent exists; local agent runtime does not | Feasible, but requires new local agent runtime |
| 4. Full online | Existing cloud preset covers DashScope + ablework | Feasible with credentials/network |

## Target mode contract

### Mode 1: `VOICE_MODE=asr_tts`

Purpose: dictation, microphone/ASR/TTS testing, and lightweight command
feedback without invoking chat or agent logic.

Target config:

```bash
VOICE_MODE=asr_tts \
ASR_PROVIDER=mlx \
TTS_PROVIDER=mlx \
POLISH_ENABLED=0 \
INTENT_ENABLED=0
```

Behavior:

- Record audio and emit transcript.
- Do not call `polish_text`.
- Do not run workspace intent classification.
- Do not spawn the chat pipeline.
- Emit a direct TTS readback/acknowledgement through the existing
  `audio_chunk` + `chat_done` client path, without invoking LLM token
  streaming.

Acceptance criteria:

- `voice/ws.py` finalizes ASR and returns without `_spawn_chat(...)`.
- `/health` exposes `voice_mode=asr_tts`.
- Integration test verifies transcript event occurs, no LLM token events are
  emitted, and the direct TTS readback can be played by the existing client
  audio path.

### Mode 2: `VOICE_MODE=chat`

Purpose: fully local conversational assistant.

Target config:

```bash
VOICE_MODE=chat \
ASR_PROVIDER=mlx \
LLM_PROVIDER=mlx \
TTS_PROVIDER=mlx \
POLISH_PROVIDER=mlx
```

Behavior:

- ASR runs through MLX.
- Chat LLM runs through `MlxLlm`.
- TTS runs through MLX one-shot per sentence.
- Polish is either local MLX or disabled.
- Intent classification must not silently require DashScope in a "pure local"
  preset.

Acceptance criteria:

- One command starts the local chat loop with no network-backed providers.
- `/health` reports `asr=mlx`, `llm=mlx`, `tts=mlx`, and either
  `polish=mlx` or `polish=off`.
- Integration test exercises `/chat` and `/ws` under the local stack.

### Mode 3: `VOICE_MODE=agent`

Purpose: local voice-driven agent that can reason, inspect local context, and
take bounded actions.

Target config:

```bash
VOICE_MODE=agent \
ASR_PROVIDER=mlx \
LLM_PROVIDER=mlx_agent \
TTS_PROVIDER=mlx \
POLISH_PROVIDER=mlx \
VOICE_AGENT_PERMISSION=default
```

Required new pieces:

- `LocalAgentRuntime` behind the current chat/WS path.
- Agent event stream normalized into existing client events:
  `status`, `token`, `tool_start`, `tool_result`, `action_required`,
  `audio_chunk`, `done`, `error`.
- Small initial tool set:
  - `ask_user`
  - `write_todos`
  - `read_file`
  - `glob`
  - `grep`
  - `current_workspace_status`
- Tool policy gate that filters visible tools and hard-denies disallowed calls.
- Permission modes:
  - `default`: ask before writes/shell/destructive actions
  - `plan`: no writes, no shell
  - `bypass`: local dev only
- Local persistence option:
  - in-memory by default
  - SQLite checkpointer/store later if useful

Non-goals for the first local-agent slice:

- Do not port ablework `/chat/sync`.
- Do not port worker dispatch/scatter-gather.
- Do not require MCP.
- Do not require Postgres.
- Do not implement OS hotkey or notification center here.

Acceptance criteria:

- `LLM_PROVIDER=mlx_agent` is a valid provider or `VOICE_MODE=agent` routes to
  a local runtime before the plain chat LLM provider.
- A local agent turn can read a local file and summarize it by voice.
- Write/shell requests are blocked or require confirmation.
- The TTS path speaks status/final answer without reading raw tool JSON.

### Mode 4: `VOICE_MODE=online`

Purpose: highest-quality or backend-integrated path using cloud ASR/TTS and
ablework/dashscope LLM.

Target config:

```bash
VOICE_MODE=online \
ASR_PROVIDER=dashscope \
LLM_PROVIDER=ablework \
TTS_PROVIDER=dashscope
```

Behavior:

- DashScope ASR/TTS use configured credentials.
- `LLM_PROVIDER=ablework` streams from ablework `/api/chat`.
- This remains the path for cloud RAG/tools/workspace operations until local
  agent mode is implemented.

Acceptance criteria:

- Existing `cloud` preset maps cleanly to `VOICE_MODE=online`.
- Missing credentials produce clear startup errors.
- Integration test can be run with `.env.local` credentials.

## Implementation slices

1. Add `VOICE_MODE` config and preset labels.
   - Valid values: `asr_tts`, `chat`, `agent`, `online`.
   - Keep provider envs as lower-level knobs.
   - Fix doc/config drift between README, `.env.example`, `voice/config.py`,
     and `start-tui.sh`.

2. Implement mode 1 as a small control-flow branch.
   - In `voice/ws.py`, stop after transcript/polish-disabled path when
     `VOICE_MODE=asr_tts`.
   - In `/chat`, reject or no-op if mode is `asr_tts`.

3. Make pure-local chat actually pure.
   - Ensure local preset sets polish to `mlx` or `off`.
   - Disable or localize intent classification for pure-local mode.
   - Add unit tests for config validation.

4. Add local agent runtime lite.
   - Introduce an adapter boundary similar to ablework's runtime adapter, but
     much smaller.
   - Start with read-only local tools and a hard tool policy.
   - Route agent events into the existing TTS/chat event pipeline.

5. Add mode matrix verification.
   - Unit tests for config/preset validation.
   - Integration tests parameterized by mode where practical.
   - Keep online integration opt-in because it requires credentials/network.

## File references

- `voice/config.py`: provider defaults, validation, presets.
- `voice/providers/base.py`: ASR/LLM/TTS provider factories.
- `voice/providers/llm.py`: `MlxLlm`, `AbleworkLlm`, `DashscopeLlm`,
  `OllamaLlm`.
- `voice/ws.py`: ASR finalization, polish, intent, chat spawn.
- `voice/chat.py`: token stream + sentence-to-TTS pipeline.
- `voice/polish/llm.py`: local/cloud polish provider dispatch.
- `voice/intents/llm.py`: currently DashScope-only intent classifier.
- `start-tui.sh`, `start.sh`, `.env.example`, `README.md`: user-facing mode
  docs and startup checks.

## Risks and decisions

- Local agent mode should borrow ablework's runtime-adapter shape, not the full
  backend stack. Copying worker dispatch, Postgres persistence, or full MCP
  loading would make this probe too heavy.
- `mlx_agent` may need a structured action loop if the chosen MLX model does
  not reliably emit native tool calls.
- Voice confirmation UX matters before enabling write/shell tools. Default
  should be read-only plus explicit confirmation for side effects.
- A "pure local" claim is invalid if polish or intent silently falls back to
  DashScope.

## Verification so far

- Static source review confirms modes 1, 2, and 4 are mostly configuration and
  control-flow work.
- Static source review confirms mode 3 needs a new local agent runtime.
- Unit suite currently passes: `238 passed in 0.83s`.
