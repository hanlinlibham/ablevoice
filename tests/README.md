# tests/ — voice-asr-test 测试规约

## 两层

```
tests/
├── unit/             # 纯函数,跑得快(< 1s),无 server / 无网络 / 无 mlx 模型
│   ├── test_audio.py     — 句切 / md strip / WAV pack / RMS / silence trim
│   ├── test_config.py    — env 解析 + validator + provider dispatch
│   └── test_db.py        — SQLite CRUD(用 tmp_path)
├── integration/      # 真 server + 真模型 + 真 backend,有 ``integration`` marker
│   └── test_voice_loop.py — /health /transcribe /tts /chat (SSE) /ws (full)
├── fixtures/
│   └── test_zh*.wav      — 录制好的中文测试音频(16kHz mono int16)
└── conftest.py       — live_server session-scoped fixture(起 uvicorn)
```

## 跑法

```bash
# 默认 — 只跑 unit,offline,几秒钟
pytest

# 带 integration(真 server,需要 .env.local 里 cred,需要本地有 cache 的模型)
pytest tests/integration
# 或
pytest -m integration

# 全跑
pytest tests/unit tests/integration
```

CI 跑 unit;integration 是开发机手跑(模型 cache + cred 在 .env.local)。

## 啥时候写什么

| 改动类型 | 必须加测试? | 加到哪 |
|---|---|---|
| `voice/audio.py` 新 pure function 或 regex 改动 | **是** | `tests/unit/test_audio.py` |
| `voice/config.py` 新 env / validator 规则 | **是** | `tests/unit/test_config.py` |
| `voice/db.py` schema migration / 新 query | **是** | `tests/unit/test_db.py` |
| 新 provider 加进 `voice/providers/` | **是** | 加 unit 测它的 model_id / config 读取;integration 测先靠现有 `test_health` |
| `voice/chat.py` pipeline 改动(句切顺序、cancellation) | **是** | integration 验回路,如果纯逻辑可加 unit mock |
| `voice/ws.py` 新事件类型 | **是** | integration 加一个 test_ws_<new_event> |
| 改 README / docstring | 否 | — |
| Vite UI / TUI | 没测 | 手测 |

## 设计约束

1. **unit 测试不准 import mlx / mlx_audio / mlx_qwen3_asr 等大依赖**。这些模型加载几 GB,unit 套件要保持秒级。如果一个函数无法不 import mlx 就测,它属于 provider,移到 integration。

2. **integration 测试不 mock backend**。我们用 ablework / dashscope 真接口测真路径 — mock 容易跟现网 protocol 走偏(参见 daily_record 里 qwen3-tts-flash vs instruct-flash 的事故)。代价是 integration 跑需要网 + cred,所以不在默认 suite。

3. **新增 unit 测试约束**:
   - 不开网,不写真 SQLite(用 tmp_path)
   - 不依赖时钟顺序(用 fixed timestamp string)
   - 一个 test 一个断言重点 — assert 多就拆 case

4. **integration 测试 ASR 输出**:LLM 非确定,不要 assert exact string;断言 token 数量、event 顺序、关键 keyword(像 "财报")。assertion 写得宽,避免每个模型版本都来打补丁。

5. **fixture 音频**(`test_zh*.wav`)是 16kHz mono int16 — 跟 `/ws` 协议格式一致,直接喂。换 fixture 时保持 sr 不变。

## 已知缺口

- 没测 `voice/providers/asr.py` 的 `DashscopeRealtimeAsr` 协议 — 它的失败模式(WS 中断 / task-failed)只有 integration 看得到,目前 integration 测的是默认 mlx path。要测云 ASR,在 conftest 加另一个 fixture 起 `ASR_PROVIDER=dashscope` 的 server。
- 没测 chat history 跨 turn 的语义(只测了 reset)。
- 没测 TUI(`tui.py`)— 它是 textual,要装 textual 测试 harness,不值得。
