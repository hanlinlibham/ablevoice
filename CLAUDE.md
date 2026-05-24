# voice-asr-test — local voice client probe for ablework

> 一次性 demo + probe 沙箱,**不是** ablework 主仓的一部分,跟
> `/Users/jameslee/ablemind/able-alilab/` 平级独立目录。这里是用来验证
> "本地 ASR + 桌面客户端" 思路的最小可跑版,跑通了再决定怎么 integrate
> 回 ablework。

## 这个项目在干什么

ablework 要做语音助手:用户按 hotkey 说话 → 转写 → backend agent 干活
→ 完成时通知用户。整体设计是 **local-first thin client + cloud agent**:
本地只是 I/O + buffer,真正的 agent / state / memory 在 cloud backend。

这个目录(voice-asr-test)聚焦的是 **入口层** — 把"用户说的话"
变成"可发给 agent 的文本"。其余 chunks(hotkey / 完成通知 / autonomous
mode middleware / ContextCandidateProvider)在 ablework 主仓另行推进,
本目录**不涉及**它们。

## 架构

```
[ Browser :5173 (Vite UI)         ]
  ↓ press-and-hold mic button
  ↓ MediaRecorder webm/opus blob
  ↓ POST /api/transcribe (proxy → :8501)
  ↓
[ Python :8501 (FastAPI server)   ]
  ↓ tempfile → mlx-qwen3-asr Session
  ↓ insert into SQLite
  ↓ return {id, text, ms, audio_bytes, peak_level, created_at}
  ↓
[ Browser displays transcript + persists via SQLite read on next load ]
```

- **ASR**: Qwen3-ASR-0.6B (~1.2GB fp16) via `mlx-qwen3-asr` (Apple MLX).
  Warm RTF ~0.2 on M3 Max (5× realtime).
- **UI**: Vite + React + Tailwind v4. ai-elements 风格的 minimal 组件
  (Conversation / Message / StatusPill) — **没走** `npx ai-elements add`
  CLI shadcn 拷入流程(那要 components.json + tailwind config 一堆 setup),
  保持 demo 轻。升级到真 registry 时只需 swap component import,不动业务
  逻辑。
- **持久化**: SQLite `transcripts.db`,所有转写永久存(包括空文本 — 帮
  diagnose mic 静默问题)。Audio 默认**不存**(隐私 + 体积),想留就
  `KEEP_AUDIO=1` 启动。

## 目录布局

```
~/voice-asr-test/
├── .venv/                       # Python venv (mlx-* + fastapi + pytest)
├── server.py                    # FastAPI entry — lifespan + warmup + 挂路由
├── tui.py                       # textual TUI 客户端
├── start.sh / start-tui.sh      # 一键启动
├── transcripts.db               # SQLite,启动时 voice.db.init() 自动建表
├── recordings/                  # opt-in audio store (only if KEEP_AUDIO=1)
├── .env.local                   # cred (TOKEN, DASHSCOPE_API_KEY) — gitignored
├── voice/                       # 服务端核心包 — Tier B 拆分后的模块
│   ├── config.py                #   所有 env → 单例 Settings + validation
│   ├── runtime.py               #   单线程 MLX executor + 共享 httpx
│   ├── db.py                    #   SQLite CRUD
│   ├── audio.py                 #   WAV pack / 句切 / markdown strip
│   ├── chat.py                  #   chat pipeline + conversation store
│   ├── ws.py                    #   /ws handler (WsSession 类 + handler dispatch)
│   ├── http.py                  #   REST 路由
│   └── providers/               #   ASR/LLM/TTS Protocol + 各 provider class
├── scripts/                     # 辅助工具
│   ├── mic-check.py             #   独立 mic 诊断
│   └── smoke_voice_loop.py      #   端到端 smoke(curl-friendly)
├── tests/                       # pytest 套件 — 见 tests/README.md
│   ├── unit/                    #   纯函数,< 1s
│   ├── integration/             #   真 server,~40s,需 cred
│   ├── fixtures/                #   测试音频(原根目录 test_zh*.wav)
│   └── conftest.py              #   live_server session fixture
├── pytest.ini                   # pytest 配置 + integration marker
└── demo-ui/                     # Vite + React UI on :5173
    ├── src/App.tsx              # 单文件 UI + useVoiceWS hook
    ├── public/pcm-worklet.js    # AudioWorklet processor
    └── vite.config.ts           # /api proxy → :8501
```

## 启动 / 重启

**ASR server**(在新 terminal):
```bash
cd ~/voice-asr-test
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8501 --log-level info
# 想留 audio 文件:KEEP_AUDIO=1 .venv/bin/uvicorn ...
# 想换 1.7B 模型:MLX_QWEN_MODEL=Qwen/Qwen3-ASR-1.7B .venv/bin/uvicorn ...
```

**UI**(另一个 terminal):
```bash
cd ~/voice-asr-test/demo-ui
npm run dev
# → http://127.0.0.1:5173
```

首次访问浏览器会问麦克风权限,允许即可。macOS 还要去 系统设置 → 隐私 →
麦克风 → 开浏览器开关。

## HTTP API surface

| endpoint | 用途 |
|---|---|
| `GET /health` | server + 模型加载状态 + KEEP_AUDIO flag |
| `POST /transcribe` | multipart audio file + optional `peak_level` + `client_meta` → 转写 + 持久化 |
| `GET /history?limit=50` | 最近 N 条 transcripts,newest first |
| `DELETE /history/{id}` | 单条删除(audio 文件也删,如果保留) |

## SQLite schema

```sql
CREATE TABLE transcripts (
    id           TEXT PRIMARY KEY,    -- uuid hex
    created_at   TEXT NOT NULL,       -- ISO-8601 UTC
    text         TEXT NOT NULL,       -- 可能是空("") - 空也存
    ms           INTEGER NOT NULL,    -- ASR 转写耗时
    audio_bytes  INTEGER NOT NULL,    -- 上传音频字节
    peak_level   REAL,                -- client analyser RMS peak 0..1, nullable
    model        TEXT NOT NULL,       -- "Qwen/Qwen3-ASR-0.6B"
    audio_path   TEXT,                -- 仅 KEEP_AUDIO=1 时填
    client_meta  TEXT                 -- 自由 JSON 字符串 (browser/UA/rec_ms)
);
```

查最近识别"翻车"案例(空文本但 mic 有声):
```bash
sqlite3 ~/voice-asr-test/transcripts.db "
SELECT created_at, ms, audio_bytes, peak_level, length(text) as chars
FROM transcripts
WHERE text = '' AND peak_level > 0.05
ORDER BY created_at DESC LIMIT 20;
"
```

## 现状(2026-05-24 晚)

**Done — 服务端核心**:
- ✓ FastAPI server (`server.py` thin entry,~130 行) + `voice/` 包模块化拆分
  (config / runtime / db / audio / chat / ws / http + storage + polish +
  4 个 providers)
- ✓ **三 stage × 多 provider 自由组合**:ASR (mlx-qwen3-asr 0.6B/1.7B,
  dashscope paraformer-realtime-v2) / LLM (mlx-lm Qwen3-4B,dashscope
  qwen3.7-max,**ablework agent**,ollama) / TTS (mlx Qwen3-TTS-CustomVoice
  9 voices,dashscope qwen3-tts-instruct-flash ~50 voices 含 Maia)
- ✓ Provider Protocol + factory dispatch — `voice/providers/base.py` 的
  `get_asr/get_llm/get_tts()`,新增 backend 加 class + 一行 factory match
- ✓ Settings 单例(`voice/config.py`)— 43 个 env 收口,typed +
  validation,启动一行打印有效配置
- ✓ `/ws` WebSocket — AudioWorklet 16kHz PCM 上行,实时 ASR partial,
  句切 streaming TTS,真打断 (~10ms 反应,partial assistant text **不进**
  history)
- ✓ `/chat` SSE + `/transcribe` + `/tts` + `/history` + `/health` REST 路由
- ✓ SQLite 持久化所有转写(空文本也存,便于诊断 mic 静默)
- ✓ **Polish agent**(LangGraph,`voice/polish/`):ASR 转写 → classify →
  polish (mlx/dashscope) → validate → retry → 最终文本。WS 发
  `transcript_polished` event,chat 默认用 polished 文本喂 LLM。详
  ``POLISH_*`` env。已有 `_dynamic_sections()` 扩展点等 v2 加领域 vocab
- ✓ **Crash-safe draft 录音持久化**(`voice/storage.py`):每段 recording
  实时落盘 `recordings/draft-<id>.pcm` + SQLite `recording_drafts` 表
  记录 `latest_partial`。WS 异常断开 / server crash 后,startup hook 把
  `in_progress` 翻成 `interrupted`,通过 `GET /drafts` +
  `POST /drafts/<id>/recover` 重跑 ASR 落表。长录音 (1-5min) 不丢
- ✓ Markdown 自动剥(`**bold**` / `` `code` `` / 表格 pipes → 逗号),
  TTS 不会念出 `*` 或 `|`

**Done — 客户端 + UX**:
- ✓ Vite + React UI(`demo-ui/`):push-to-talk (mouse + Space)、实时音量条、
  partial text 渲染、按钮顺序播放 audio chunks
- ✓ textual TUI client(`tui.py`):同一份 `/ws` 协议,Space 录音、i 打断、
  r 重置,持久 OutputStream 消除 sd.play gap,braille spinner
- ✓ `start.sh` / `start-tui.sh`:一键起 server + UI/TUI,自动 load `.env.local`
- ✓ TTS 稳定化:per-chunk RMS normalize(swing 12dB→3dB)+ silence trim
  (头尾 ~100ms → 20-30ms)+ 保守句切(只在 。!? 切,代价首音 +0.5s)
  + `MLX_TTS_INSTRUCT` 平稳播报指令

**Done — 工程化**(2026-05-24 晚加的)
- ✓ pytest 套件:34 unit case (~0.09s,offline) + 6 integration case
  (~40s,真 server + 真 backend)。约束 + 啥时候写测试见
  [`tests/README.md`](tests/README.md)
- ✓ 文件归位:fixture → `tests/fixtures/`,辅助脚本 → `scripts/`,
  pycache + 临时 db gitignored

**实验阶段 — ablemind 端到端闭环还没真接通**

当前 `LLM_PROVIDER=ablework` 是默认,意思是 voice loop **可以**把用户
语音转写后塞给 ablework `/api/chat` 拿到流式 token 回复 + TTS 播。但这
**只是 chat-style 对话**,跟"真任务闭环"还差几步:

1. 我们走的是 ablework `/api/chat`(AI SDK v6 UIMessage SSE),**不是**
   `/chat/sync`。`/chat/sync` 是 task 路径(下发任务 + 后台执行 + 完成
   回调),voice 客户端目前没接
2. 没有 **"任务完成通知"** 语义 — ablework backend 一旦完成 RAG/tool/
   报告生成,我们这边没有事件订阅,只能等流式 text-delta 自然 finish
3. 没有 **OS-level 通知 / hotkey** — 录音必须页面/TUI 在前台,完成只是
   屏幕上文字 + TTS 播。真桌面 agent 应该全局 hotkey + macOS Notification
   Center
4. 没有 **后台任务队列** — 用户说"帮我查联想财报"那种长任务,目前要
   一直等着,关掉 client 就丢了

短期内这个 probe 不补这些 — 那是真桌面客户端(SwiftUI/Tauri menubar
app)+ ablework backend `/chat/sync` + 任务订阅协议的活。本目录只验证
"voice in → text out → 流式 TTS out"链路本身。

**Todo (按价值优先级)**:
- 共享 httpx — `voice/runtime.py` 的 `http(verify=...)` 已暴露但 4 处
  provider stream 还在内部各开 AsyncClient,低风险时机切(~30min,见
  最近一条 daily_record open items)
- ablework backend `controller_mode=off` / skip-RAG 模式探查 — 现在
  agent 首音 ~8s,backend 端能不能给 voice client 一个"短反应"开关
- TUI 同款拆分(目前 846 行单文件) — 不急,改频次低
- 浏览器 UI 加 spinner + gap-free AudioStreamer(目前只 TUI 有)
- 流式 TTS 跨 chunk「语气不衔接」终极方案 — `stream=True` 单次 generate
  内部 chunked yield(代价首音 +1s),要重写 chat pipeline 调度

**未做也不打算做**:
- 不写 OS-level hotkey / Notification Center / TTS 系统播报 — 那是
  桌面 app 的活,这是 browser/TUI probe
- 不做用户认证 — localhost only
- 不做模型微调 / 词表扩展
- 不接 ablework `/chat/sync` 任务路径 — voice probe 只做"短交互",
  长任务回调留给真客户端

## 跟 ablework 主仓的关系

这是 **probe / sandbox**,不会进 main repo。Tier B 拆分后 port 路径
比之前清晰 — 真要复用时**只搬这三块**,其他都是 demo 特有:

1. `voice/providers/asr.py` 的 `MlxStreamingAsr` 类(+`AsrSession`
   Protocol)→ ablework backend 一个新的 voice 路由(替换或并列现有
   DashScope `/ws/speech`),前提是 backend 跑在 Apple Silicon
2. `voice/audio.py` 三个纯函数(`pop_speakable` / `strip_markdown_inline`
   / `pcm_float_to_wav_bytes`)→ 任何流式 TTS pipeline 复用,无依赖
3. `voice/ws.py` 的 WS 协议形态(`hello/start_recording/.../audio_chunk/
   chat_done` 双向 JSON + 二进制 PCM)→ 真桌面客户端跟 backend 之间的
   协议参考,实现端用 SwiftUI/Tauri 重写

**不 port**:
- UI(`demo-ui/`)— 真客户端是 macOS menubar app,不走 browser
- SQLite 持久化思路可以参考,但 menubar app 自己存
- 整个 `voice/` 包的 provider matrix — 真 backend 只需要选定一套,不需要
  4 LLM × 2 ASR × 2 TTS 自由组合

**端到端 ablemind 闭环还没接通**(见上文"实验阶段"段)。port 之前
需要先在 ablework 主仓那边定 `/chat/sync` 任务回调协议 + 桌面 client 通知
机制,这俩定了再说 voice 怎么接。

ablework 主仓相关计划详见
`/Users/jameslee/ablemind/able-alilab/dpagt/docs/done/daily_record/2026-05-24-file-processing-workflow-and-graph-runner.md`
末尾的 "下个 session 提示词" 段(语音助手是 8 项待办之一)。

## 一些已知的体验局限

| 现象 | 真因 | 影响 |
|---|---|---|
| 浏览器每次刷新弹麦克风权限 | site permission policy | 桌面 app 版自然不会 |
| 录音必须页面在前台 | 浏览器 MediaRecorder 限制 | 桌面 app 全局 hotkey 解决 |
| 模型每次重启 server 都 reload | 没做 daemon | KEEP_AUDIO + 长连 OK,真要保留就别 restart |
| Webm/opus 上传(不是 PCM) | MediaRecorder 输出格式 | mlx-qwen3-asr 用 ffmpeg 自己 decode,够用 |

## 编辑这个目录时要注意

- **不要把 .venv 进 git** — 1.2GB 模型 + Python deps。`.gitignore` 已经隔离
- **不要把 transcripts.db 进 git** — 含可能敏感的转写
- demo 的 dep 不要继承到 ablework 主仓的 pyproject(`mlx-qwen3-asr` 是
  Mac-only,backend 跑在 Linux ali-lab)
- TS strict 模式打开,加 component 前先 `cd demo-ui && npx tsc --noEmit`
- 改 `voice/` 任何模块后,**先跑 `.venv/bin/pytest tests/unit`**(秒级);
  动了 chat / ws / provider 路径再补一次 `pytest tests/integration`(~40s)
- 新加 pure function / env / db query → 必须配 unit case(见 [`tests/README.md`](tests/README.md))
- 改 server.py 或 voice/*.py 后要手动重启 uvicorn(没开 `--reload`,
  reload 会重 load ASR 模型,慢)。开发期想自动 reload 加 `--reload`
  但接受首条请求多 1s

## 工作日记

每天的会话流水 / 决断 / 待办 / 教训写到 `docs/done/daily_record/YYYY-MM-DD-<slug>.md`,仿 ablework 的格式:TL;DR + 事实流水(分组) + 关键技术决断 + 待办 + 实测数据。**本地不进 git**(.gitignore 已 cover `docs/done/`)。新会话来读最近一条就能接上下文。

