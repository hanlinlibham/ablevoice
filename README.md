# able-asr

> 本地 ASR + LLM + TTS 语音管线 + LangGraph polish agent + crash-safe
> draft 持久化。Apple Silicon Mac 上的 thin 桌面 / 浏览器 voice client。
>
> 仍是 ablework 生态的 probe(本地目录:`voice-asr-test/`),但已经
> 从一次性 demo 长成了一个独立可运行项目 — 拆了模块、配置化、有测试
> 套件、有 polish agent、有 crash recovery。

## 是什么

一个端到端中文语音对话回路。**按住说话 → 实时转写显示 → AI 流式生成 →
逐句 TTS 顺序播放**。三个 stage(ASR / LLM / TTS)各支持 3 类 provider 自
由组合,**全本地**(隐私 + 离线)或 **全云端**(质量 + 低本地资源)都行。

跑在 Apple Silicon Mac(MLX 加速本地模型)+ 可选的 DashScope / ablework
云端 backend。

## 架构

```
                       ┌─────────────────────────────┐
                       │  Client (browser UI / TUI)  │
                       └─────────────────────────────┘
                                ↓ /api/ws (WebSocket)
                                ↓   binary: int16 PCM 16kHz mono (AudioWorklet)
                                ↓   json:   start/stop/interrupt/tts/reset
                       ┌─────────────────────────────┐
                       │   server.py  (FastAPI)      │
                       │   - ASR / LLM / TTS dispatch│
                       │   - chat pipeline (LLM →    │
                       │       sentence split → TTS) │
                       │   - SQLite transcripts      │
                       └─────────────────────────────┘
            ┌───────────────────┼───────────────────┐
            ↓                   ↓                   ↓
        ┌───────┐           ┌───────┐           ┌───────┐
        │  ASR  │           │  LLM  │           │  TTS  │
        ├───────┤           ├───────┤           ├───────┤
   mlx  │ Qwen3 │       mlx │ Qwen3 │       mlx │ Qwen3 │
        │ -ASR  │           │ -4B   │           │ -TTS  │
        │ MLX   │           │ MLX   │           │ Custom│
        │       │           │       │           │ Voice │
   云端 │ para- │     cloud │ qwen  │     cloud │ qwen3-│
        │former │           │3.7-   │           │tts-   │
        │realt- │           │max    │           │instr- │
        │ime-v2 │           │       │           │uct-fl-│
        │ (WS)  │           │       │           │ash    │
        │       │      able │ ag-   │           │ (50+  │
        │       │      work │ ent   │           │voices)│
        └───────┘           └───────┘           └───────┘
```

## Quick start

### 准备

```bash
# Python venv + 依赖(首次)
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install fastapi 'uvicorn[standard]' httpx websockets \
  mlx-qwen3-asr mlx-audio mlx-lm \
  textual sounddevice numpy

# 浏览器 UI(可选)
cd demo-ui && npm install && cd ..
```

### 启动方式(四选一)

```bash
# A. 终端 TUI(textual)— SSH / headless 场景 / 快速测试
./start-tui.sh

# B. 浏览器 UI(Vite :5173 + server :8501)— 调样式时方便
./start.sh         # 然后开 http://127.0.0.1:5173

# C. 桌面 app(Tauri,推荐日常用)— 系统托盘 + 全局快捷键 ⌘⇧Space
./start.sh &                                          # 起 server
cd demo-ui && npm run tauri:dev                       # 起 Tauri 窗口
# 生产打包:cd demo-ui && npm run tauri:build → src-tauri/target/release/

# D. 只起 server(自己写 client)
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8501
```

启动脚本自动加载 `.env.local`(放 cloud provider 的 API key)。

### 第一次跑

模型按需 lazy download(首次 chat 触发):
- ASR Qwen3-ASR-1.7B: ~5GB
- TTS Qwen3-TTS-CustomVoice-bf16: ~4GB
- LLM Qwen3-4B-Instruct-2507-4bit: ~2.5GB

冷启动总下载 ~12GB(只一次,之后在 `~/.cache/huggingface/`)。

macOS 第一次按录音键会弹麦克风权限,允许即可。

## 配置系统(`.env.local` + `voice/config.py`)

**所有 secret 走 `.env.local`**(gitignored)。新人配环境抄一份模板:

```bash
cp .env.example .env.local
# 编辑 .env.local 填:
#   DASHSCOPE_API_KEY=sk-...    (云 ASR/LLM/TTS/Polish 共用)
#   ABLEWORK_TOKEN=eyJ...        (ablework 后端 JWT)
```

**单 source of truth**:`voice/config.py` 的 `settings` 单例 — 43 个 env 全在这一处定义、解析、validate。typo 的 int/float 会在 startup 抛 RuntimeError;空 secret 会 warn 一句。

**结构**:

```
settings
├── dashscope    # api_key + base_url + chat_model + asr_model + tts_model + polish_model (一个 vendor account 服务所有 cloud stage)
├── ablework     # url + token + verify_ssl
├── ollama       # url + model
├── asr          # provider + mlx_model + stream_chunk_sec
├── llm          # provider + mlx_model + system_prompt
├── tts          # provider + mlx_model + voice + 12 个调参
├── polish       # enabled + provider + use_polished_for_chat
├── sentence     # 句切 4 个常量
├── storage      # db_path / audio_dir / keep_audio
└── warmup
```

**运行时查实际生效配置**:

```bash
curl -s http://127.0.0.1:8501/config | jq
# secret 被脱敏成 "sk-4…(len=35)" / "eyJh…(len=3023)" — 能验配但不泄露
```

**SYSTEM_PROMPT 支持文件**(多行中文 prompt 用 env 转义麻烦):

```bash
# .env.local
SYSTEM_PROMPT_FILE=prompts/system.md
```

完整 env 参考见 [`.env.example`](.env.example)。

## Provider 配置

通过 env 切换。默认配置见 server.py 顶部,常用组合:

```bash
# 全本地(最快,~2s 首音,纯离线,隐私)
ASR_PROVIDER=mlx LLM_PROVIDER=mlx TTS_PROVIDER=mlx ./start-tui.sh

# 当前默认(本地 ASR + ablework agent + 本地 TTS serena)
./start-tui.sh

# 全云端(最高质量,可选 Maia 等 ~50 voice)
ASR_PROVIDER=dashscope LLM_PROVIDER=dashscope TTS_PROVIDER=dashscope \
  MLX_TTS_VOICE=Maia ./start-tui.sh
```

| Env | 默认 | 可选值 |
|---|---|---|
| `ASR_PROVIDER` | `mlx` | `mlx` / `dashscope` |
| `MLX_QWEN_MODEL` | `Qwen/Qwen3-ASR-1.7B` | `Qwen/Qwen3-ASR-0.6B`(更快) |
| `LLM_PROVIDER` | `ablework` | `mlx` / `dashscope` / `ablework` / `ollama` |
| `MLX_LLM_MODEL` | `mlx-community/Qwen3-4B-Instruct-2507-4bit` | 任何 mlx-lm 兼容模型 |
| `DASHSCOPE_MODEL` | `qwen3.7-max` | `qwen-max` / `qwen-plus` 等 |
| `TTS_PROVIDER` | `mlx` | `mlx` / `dashscope` |
| `MLX_TTS_VOICE` | `serena` | 本地 9 个 / 云端 ~50 个 |
| `MLX_TTS_INSTRUCT` | (新闻播报指令) | 任何自然语言描述,空串关闭 |
| `DASHSCOPE_API_KEY` | (.env.local 读) | sk-xxx |
| `ABLEWORK_TOKEN` | (.env.local 读) | ablework JWT |
| `VOICE_INPUT_DEVICE` | (PortAudio default) | sounddevice 设备索引 |
| `VOICE_INPUT_NAME` | — | substring 匹配设备名,蓝牙重连后仍有效 |
| `KEEP_AUDIO` | `0` | `1` 保留上传录音到 `recordings/` |

完整 env 列表在 `start-tui.sh` 顶部注释。

## 实测延迟(M3 Max,warm)

| 配置 | 首音(松手→听到字)| Total |
|---|---|---|
| 全本地小模型(0.6B/4B-MLX/0.6B-Lite) | **2.1s** | ~4.3s |
| 本地 ASR + 云 LLM + 本地 TTS | ~4.5s | ~5.5s |
| 全云端 + ablework agent | ~8.5s | ~16s |

ablework agent 5-6s 是 backend 端 RAG/tool pipeline 固有延迟,跟 voice 客户端无关。

## 主要特性

- **流式 ASR partial 显示**:用户还在说时实时显示识别中文字(本地用
  `mlx_qwen3_asr.Session.init_streaming/feed_audio/finish_streaming`,云端
  桥接 `paraformer-realtime-v2` WebSocket)
- **句级 streaming TTS**:LLM 一边吐 token,server 按句号切分,每句独立
  合成 + 推给客户端按序播放;首句 ~2s 可到
- **真打断**:用户开始新录音 / 按 i 键 → server `task.cancel`,清音频队
  列,partial assistant text **不写入** history(没听完的不该记)
- **AudioWorklet 16kHz PCM 上行**:替代 MediaRecorder webm/opus,消除
  ffmpeg decode 延迟,WebSocket binary frame 直传
- **Voice 稳定化**:
  - per-chunk RMS normalize(段间响度均一)
  - silence trim(段间真空 178ms → 40ms)
  - 客户端持久 OutputStream + ring buffer(消除 sd.play 重启 gap)
  - `MLX_TTS_INSTRUCT` 平稳播报指令 + temperature 0.5 + fixed seed(同段
    文字每次输出一致)
- **Markdown 自动剥**:`**bold**` / `*italic*` / `` `code` `` / 链接 /
  headers / **markdown 表格(pipes 转逗号,separator 行删)** 都剥,TTS
  不会念出 `**` 或 `|`
- **TUI 动效**:assistant 等首 token / TTS 合成 / mic 录音都有 braille
  spinner 转动,自动滚到底
- **SQLite 持久化所有转写**(空也存,便于诊断 mic 静默)
- **Crash-safe draft 录音**:每段 recording 实时落盘 (`recordings/draft-<id>.pcm`)
  + ASR partial 实时入库,WS 异常断开 / server crash 后通过
  `GET /drafts` + `POST /drafts/<id>/recover` 还原成 transcript(长录音
  1+ 分钟时关键)

## 文件布局

```
~/voice-asr-test/
├── server.py                    # FastAPI entry — lifespan + warmup + 挂路由
├── tui.py                       # textual TUI 客户端
├── start.sh / start-tui.sh      # 一键起 server + UI/TUI
├── .env.local                   # API keys(gitignored)
├── transcripts.db               # SQLite,自动创建
├── voice/                       # 核心包 — 拆出来的模块
│   ├── config.py                #   所有 env → typed Settings 单例 + validation
│   ├── runtime.py               #   单线程 MLX executor + 共享 httpx
│   ├── db.py                    #   SQLite CRUD
│   ├── audio.py                 #   WAV pack / 句切 / markdown strip
│   ├── chat.py                  #   chat pipeline (LLM → 句切 → TTS)
│   ├── ws.py                    #   /ws WebSocket handler(WsSession 类)
│   ├── http.py                  #   /health /transcribe /tts /history /chat
│   └── providers/{base,asr,llm,tts}.py  # Protocol + 各 provider class
├── scripts/                     # 辅助脚本
│   ├── mic-check.py             #   独立 mic 诊断
│   └── smoke_voice_loop.py      #   端到端 smoke(打 HTTP + WS)
├── tests/                       # pytest 套件
│   ├── unit/                    #   纯函数,offline,< 1s
│   ├── integration/             #   真 server + 真模型(``-m integration``)
│   ├── fixtures/                #   test_zh*.wav / test_zh2*.aiff 测试音频
│   ├── conftest.py              #   live_server session fixture
│   └── README.md                #   测试规约 + 啥时候写什么
├── demo-ui/                     # Vite + React + Tailwind UI (+ Tauri 桌面壳)
│   ├── src/App.tsx              #   单文件 UI + useVoiceWS hook
│   ├── public/pcm-worklet.js    #   AudioWorklet processor
│   └── src-tauri/               #   Rust Tauri wrapper (托盘 + 全局快捷键)
│       ├── Cargo.toml
│       ├── src/lib.rs           #   tray icon + ⌘⇧Space global shortcut
│       └── tauri.conf.json      #   window / bundle 配置
├── recordings/                  # opt-in audio store(KEEP_AUDIO=1 才存)
├── docs/done/daily_record/      # 工作日记(gitignored)
├── ADR-001-...md                # 架构决策
└── CLAUDE.md                    # Claude Code 协作规范 + 项目状态
```

## 测试

```bash
pytest                    # unit 套件(秒级,offline)
pytest tests/integration  # 全链路(起真 server,~40s,需 .env.local cred)
```

约定 + 啥时候加测试:见 [`tests/README.md`](tests/README.md)。

## 范围 / 不做的事

跟 ablework 主仓的关系见 [`CLAUDE.md`](CLAUDE.md)。简短:

- **不**写 OS-level hotkey / 全局通知(那是真桌面客户端,这是 browser/TUI demo)
- **不**做用户认证(localhost only,只你自己用)
- **不**做模型微调 / 词表扩展
- **不**进 git(本目录全 gitignored,CLAUDE.md / ADR / 代码逻辑后续按需 port 到 ablework 主仓)

## 进一步

- 项目状态 + 协作规范 + 启动重启 + 常见陷阱:[`CLAUDE.md`](CLAUDE.md)
- 架构决策:[`ADR-001-voice-client-as-thin-edge.md`](ADR-001-voice-client-as-thin-edge.md)
- 历次工作日记:[`docs/done/daily_record/`](docs/done/daily_record/)
- API 健康/状态:`curl http://127.0.0.1:8501/health | jq`

## 已知短板

- **本地 TTS 跨 chunk「语气不衔接」**:open-source mlx-audio 不暴露 KV
  cache 跨 generate 复用,只能 stream=True 单次 generate(代价首音 +1s),
  或上云端 qwen3-tts-instruct-flash(有 `instructions` 自然语言风格控制)
- **ablework agent 首音 ~8s**:backend 端 RAG/tool pipeline 固有延迟,
  voice 客户端没法在 server 端压短
- **长表格 TTS 仍逐项念**:strip 掉 `|` 后变成 "name, value, name,
  value...",真"概括"需要 LLM 二次重写
- **VoiceDesign 变体没装**:1.7B-VoiceDesign-bf16 可以用自然语言描述生
  成新 voice,3.84GB 下载没做
