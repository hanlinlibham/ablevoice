# able-asr TUI 设计规范(交付给设计师)

> 文档目的:把 TUI(终端 UI)的当前布局、信息架构、状态机、交互模型完整描述,
> 便于设计师在**保留 terminal-native 约束**的前提下做视觉与体验优化。
>
> 不是 web/desktop UI。请勿往 GUI 方向重构;输出仍是 monospace 字符 + ANSI
> 8/256 色 + Unicode 字符的终端体验,运行在 80×24 ~ 240×80 各种终端尺寸下。

---

## 0. 背景一句话

able-asr 是一个**桌面语音助手**的早期 probe。用户按住空格说话 → 转写 →
LLM 回 → 流式 TTS 播。TUI 是其中一个客户端形态(另有 browser、Tauri 桌面)。
TUI 的优势是低开销 + 可走 SSH + 可在专注开发场景常驻不抢焦点。

设计目标是**让一个开发者在工作时,能用一只眼角余光感知 "现在在哪个阶段"**,
而不需要切窗口看进度条。

---

## 1. 当前布局总览(自上而下 5 区)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Header                            ← Textual built-in,显示标题 + 时钟  │  height: 1
├──────────────────────────────────────────────────────────────────────────┤
│  StatusBar (mode + providers + latency)                                  │  height: 1
├──────────────────────────────────────────────────────────────────────────┤
│  WorkspaceBar (当前工作区 chip + 工作区数 + 切换提示)                       │  height: 1
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Conversation (滚动区,渲染对话气泡 + 系统消息 + 分割线)                       │  flex
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  MicMeter (仅录音时显示电平条 + mm:ss 时长)                                 │  height: 1
├──────────────────────────────────────────────────────────────────────────┤
│  Footer (Textual built-in 显示所有热键)                                    │  height: 1
└──────────────────────────────────────────────────────────────────────────┘
```

总固定开销 ~5 行,中间 Conversation 占据剩余全部高度。

---

## 2. 各区详细规格

### 2.1 StatusBar(模式 + 模型链 + 延迟)

**职责**:任何瞬间能一眼看到 "现在是哪个阶段"。是整个 UI 最关键的反馈窗口。

**布局**:左对齐,水平流式,每列用 ` · `(空格点空格)分隔。

```
 ✦ 录音中   ASR paraformer-realtime-v2 (cloud) · LLM ablework · TTS Maia (cloud) · ★首音 705ms · total 2340ms
└──────┘  └────────────────────────────────────────────────────────────────────┘ └──────────────────────────┘
 mode chip            providers (模型/后端)                                            latency telemetry
```

**Mode chip**(最左,固定宽度感):

| 状态 | 文字 | 配色 | 触发 |
|---|---|---|---|
| 未连接 | ` ● 未连接 ` | bold white on red | WS 断开,非主动 |
| 重连中 | ` ↻ 重连中 ` | bold black on yellow | reconnect loop 中 |
| 录音中 | ` ⠋ 录音中 ` | bold black on yellow | mic 开着 |
| 识别中 | ` ⠋ 识别中 ` | bold black on cyan | ASR finalize 阶段 |
| 整理中 | ` ⠋ 整理中 ` | bold black on magenta | polish agent 运行 |
| 思考中 | ` ⠋ 思考中 ` | bold black on green | LLM 流式 + TTS 合成 |
| 播放中 | ` ⠋ 播放中 ` | bold black on green | TTS 段在播 |
| 就绪 | ` ✓ 就绪 ` | bold black on cyan | 空闲 |

- `⠋` 是 braille spinner,8 帧 8fps 滚动:`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`
- chip 内部两端各 1 空格 padding,以高对比色块作为视觉锚点
- chip 宽度会随中文字数变化(2-4 字),设计师可考虑**等宽 chip**(始终 6 字符)
  让位置不抖

**Providers 段**(中部):
- `ASR <model>` `LLM <model>` `TTS <voice>` 三列,model 名 cyan,label dim
- 当 provider 是 `dashscope` 时附 `(cloud)`,`ablework` 附 `(ablework)` 等标签
- `polish off` 仅在 polish 关闭时显示(默认开)

**Latency telemetry**(右部):
- `★首音 XXXms` — 从用户停止录音到第一段 TTS 出来的时间,bold green
- `total XXXms` — 整轮总时长,green

> ⚠️ 当前问题:providers 段在窄终端(80列)会被截断或挤丢延迟。
> **设计师改进点**:窄屏下自动隐藏 latency 或省略 provider 标签;或让 latency
> 右对齐到右边界。

### 2.2 WorkspaceBar(工作区上下文)

**职责**:让用户知道 "下一句话会落到哪个 ablework 工作区"。
工作区 = ablework backend 中的隔离 sandbox + 文件挂载。

**布局**:

```
 📁  研究 Q3 财报   ✦ 已切到 研究 Q3 财报   共 17 个 · w 列表 W 刷新
└──┘└─────────────┘└──────────────────────┘└──────────────────────────┘
emoji  workspace chip  flash action (淡出)        right hint
```

- 工作区名 chip:`bold black on yellow`,前后各 1 空格 padding
- 默认 sandbox 状态:文字 `默认 sandbox` 改用 `dim italic`(不用 chip)
- `flash action`:语音/热键切换 / 新建 / 移动 / 退出工作区后,4 秒内以
  `bold magenta` 显示 "已切到 X" / "已搬到 X" / "已新建 X" / "已退出工作区"
- 右边提示:`w` 查列表,`W` 强制 refetch

> ⚠️ 当前问题:截图里看到 "默 sandbox" 的视觉切割(字体渲染问题或宽度抖动)。
> **设计师改进点**:为 chip 设计稳定的 fallback 视觉,或者默认态完全隐藏(空 bar)。

### 2.3 Conversation(主体对话区)

**职责**:历史 + 当前流式输出。3 种渲染类型:

#### A. 用户气泡(User Message)

```
╭─ 你   ASR 705ms · 92KB · polish 412ms  ─────────────────────────────╮
│  请帮我看一下今天的财报数据。                                              │
│    原 ▸ 请帮我看一下今。今天的财报数据。                                     │
╰────────────────────────────────────────────────────────────────────╯
```

- 边框:`cyan`(普通)或 `magenta`(polish 实际修改了 raw 文本时)
- title 行:`[bold cyan]你[/bold cyan]` + 可选 `✨ 已整理` 标记 +
  dim info(`ASR XXXms · YYYKB · polish ZZZms`)
- 实时识别中:title 末尾 blink cursor `▮`,info 显示 `(实时识别…)`
- polish 改了文字:body 第 1 行加粗的 polished 文本,第 2 行
  `原 ▸ <strikethrough dim raw>`(磁带划除)
- 空消息占位:`(empty)`

#### B. 助手气泡(Assistant Message)

```
╭─ AI   2340ms · 5 TTS 段  ──────────────────────────────────────────╮
│  今天的财报显示营收同比增长 12%,主要来自...                                │
╰────────────────────────────────────────────────────────────────────╯
```

- 边框:`green`
- title:`[bold green]AI[/bold green]` + dim info
- 流式中:title 末尾 blink cursor `▮`;若 token 还没到,body 显示
  `⠋ AI 思考中…` (dim italic + 旋转 spinner)
- 被打断:body 尾部加 `[⏹ 打断]` 标记,info 改为 `interrupted (reason)`

#### C. 系统消息

```
 · server ready: ASR=... · LLM=... · TTS=... @ 24000Hz
 · [yellow]⚠ mic 丢帧 ×3 — WS/上游堵塞,本段录音可能有缺口[/yellow]
 · [magenta bold]✦ ws_switch[/magenta bold] 已切到研究 Q3 财报  (412ms)
```

- 前缀单字符 ` · `,整体 `dim italic` 基底
- 允许调用方塞 markup(`[red]...[/red]`、`[bold]...`)做高亮
- 用途:启动信息、错误、retry 通知、工作区操作回执、丢帧告警

#### D. 分割线(Divider)— 工作区切换时插入

```
 ── 已切到 研究 Q3 财报 ──
```

`bold magenta`,前后各 2 个 `─` 长破折,作为对话流中的明显视觉断点。

#### 视觉补充

- 气泡之间:无额外空行(Rich Panel 自带边框),Conversation 容器有 1 行
  vertical padding 在最外层
- 滚动:仅当用户视口在底部时,新消息才 auto scroll;往上翻历史时不被拽回
- 长气泡:Panel 自动 wrap,1 字符内边距

> ⚠️ 当前问题:气泡边框用 `cyan / green / magenta` 简单分色,在浅色终端下
> 对比度可能不够。
> **设计师改进点**:为气泡设计明暗双主题(根据终端 background 自适应);考虑
> 是否需要更柔和的边框字符(`╭╮╰╯` vs `╔╗╚╝` vs 极简的 `┌┐└┘`)。

### 2.4 MicMeter(录音电平 + 时长)

```
 00:23 mic ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  lvl 35.2% · peak 78%
```

- 仅录音时可见(其他时刻整行空白,但仍占 height:1)
- `00:23` mm:ss bold yellow,固定宽度(让 bar 起始位置稳定)
- `mic ` dim label
- 40 字符宽 bar:`█` 实心、`░` 空心,颜色按 level 阶梯:
  - level < 2%:`red`(没采到声音)
  - level < 8%:`yellow`(偏弱)
  - else:`green`(健康)
- 右侧:`lvl 35.2%` 当前 RMS 百分比,`peak 78%` session 峰值
- level < 2% 末尾追加 `← 没采到声音`(bold red),帮 diagnose 麦克风没开

> **设计师改进点**:考虑用渐变色 bar(red→yellow→green 三段),或者改用 dB
> 刻度更符合录音专业直觉。

### 2.5 Footer(全局热键提示)

Textual 内置 Footer,固定底部 1 行,自动列出所有 BINDINGS。当前定义:

| key | 动作 | 描述 |
|---|---|---|
| `space` | toggle_record | 录音 |
| `i` | interrupt | 打断 |
| `r` | reset | 重置 |
| `R` | recover | 恢复 |
| `v` | cycle_voice_mlx | 本地声 |
| `V` | cycle_voice_dashscope | 云声 |
| `p` | toggle_polish | polish |
| `w` | list_workspaces | 工作区 |
| `W` | refresh_workspaces | 刷新 |
| `q` | quit | 退出 |

样式由 Textual 控制:key 以 chip 形式(bold + 背景色),后跟 dim 描述。

> ⚠️ 当前问题:10 个 binding 在窄屏会折行或截断,且 `v/V` `w/W` 大小写区分
> 不直观。
> **设计师改进点**:把 binding 分组(录音 / 切换 / 控制),按优先级折叠;
> 或在窄屏下只显示最常用的 3-4 个 + `?` 进 modal 看全集。

---

## 3. 状态机(模式优先级)

任意瞬间只有一个 chip 可见,优先级(高→低):

```
reconnecting > recording > finalizing > polishing > chatting > idle
```

事件 → 状态变迁:

```
[idle] ──按 space──▶ [recording] ──松 space──▶ [finalizing] (ASR 处理中)
                                              │
                                              ▼
                                      [polishing] (LangGraph polish)
                                              │
                                              ▼
                                      [chatting] (LLM token + TTS 流)
                                              │
                                              ▼ chat_done
                                          [idle]

任何状态下:i 键 → interrupt → 立刻 [idle]
任何状态下:r 键 → reset → 清空 history + [idle]
WS 断开 → [reconnecting] 持续到重连成功
```

---

## 4. 色板(当前实际使用的 ANSI 颜色)

| 用途 | 颜色 |
|---|---|
| 用户/录音 | yellow + cyan border |
| 助手/正常 | green |
| polish/工作区切换 | magenta |
| 错误 | red |
| 提示/dim 标签 | bright_black (dim) |
| 重要标签(模型名) | cyan |

> **设计师改进点**:目前 6 色用法没有严格语义,且重叠(yellow 同时表示录音 +
> 工作区 chip)。建议定义 2-3 个"角色色"(用户 / 助手 / 系统),其余状态
> 用亮度差表达。

---

## 5. 字符 / 排版细节

- 字体:全部 monospace,中英文混排时**1 中文 = 2 宽度**,设计师注意对齐
  时不能假设 1 字符 1 宽度。
- 间隔统一:列与列之间 ` · `(3 字符宽度),不用 4 空格或多空格
- chip 视觉:前后各 1 空格 padding,内部以背景色+前景反白形成色块
- 强调字符:`★`(延迟)、`✦`(动作)、`✨`(polish 改过)、`📁`(工作区)、
  `⏹`(打断)、`⠋`(spinner)、`▮`(光标 blink)
- 分隔字符:` · `(列分隔)、`──`(分割线)、`▸`(原文标记)

---

## 6. 不能改的硬约束

1. **必须保持 keyboard-only 操作**。不可加鼠标点击依赖,远程 SSH 也要能用。
2. **所有视觉必须 ANSI 256 色之内**,不能依赖 true color(部分终端不支持)。
3. **每个固定行只 1 高度**,不要做"展开式"组件(会破坏 docked layout)。
4. **不能用图片 / 表情符号当核心反馈**(emoji 在某些终端字体下宽度不一致,
   会破坏对齐)。少量装饰 emoji 可以,但不能依赖它们传达关键状态。
5. **延迟 telemetry 数字必须可见**(★首音 + total)— 这是 demo 的核心指标。

---

## 7. 设计师可以优化的方向(open invitation)

按价值优先排序:

1. **窄屏自适应**:80 列下,StatusBar 信息过载会折行/截断。设计响应式策略。
2. **Mode chip 等宽化**:让 chip 永远是固定 char 宽度(如 8 字符),消除位移。
3. **气泡视觉减负**:目前每条用户/助手消息都是完整 Panel(4 边 + title),
   长对话叠满屏。可考虑紧凑模式(无边框,左侧 vertical bar 代替),
   设计师产出两种气泡 variant 让用户切换。
4. **空状态界面**:首次启动 Conversation 为空时,可加一个 hint 卡片
   告诉用户怎么开始(类似 IDE 的 welcome 屏)。
5. **延迟 telemetry 可视化**:用 sparkline / mini bar 而非纯数字。
6. **配色主题切换**:让用户在 dark / light / high-contrast 间切。

---

## 8. 参考资料

- 主体代码:[`voice_tui/widgets.py`](../voice_tui/widgets.py) (StatusBar / WorkspaceBar / Conversation / MicMeter)
- 应用编排:[`voice_tui/app.py`](../voice_tui/app.py) (布局 + 热键 + 事件分发)
- WS 协议:[`voice_tui/ws.py`](../voice_tui/ws.py) (server event 类型)
- Textual 框架文档:https://textual.textualize.io/
- Rich(Textual 的渲染层)文档:https://rich.readthedocs.io/

设计师在 mockup 阶段建议直接用 monospace 字符做(任何文本编辑器或
[asciiflow.com](https://asciiflow.com) 都行),不需要 Figma。

---

## Appendix:目前一帧的实拍(截屏对应的文本镜像)

```
┌─────────────────────────────────────────────────────────────────────── able-asr  18:48 ─┐
│  ✓ 就绪    ASR paraformer-realtime-v2 (cloud) · LLM (server-side preset) · TTS Maia (cloud) │
│  📁  默认 sandbox    共 17 个 · w 列表 W 刷新                                                  │
│                                                                                          │
│  · server ready: ASR=paraformer-realtime-v2 (cloud) · LLM=(server-side preset) ...       │
│                                                                                          │
│                                                                                          │
│                              (空白 — 等待用户开始)                                          │
│                                                                                          │
│                                                                                          │
│                                                                                          │
│                                                                                          │
│ space 录音  i 打断  r 重置  R 恢复  v 本地声  V 云声  p polish  w 工作区  W 刷新  q 退出       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

录音 + 流式回复 + 工作区切换时的样子(理想态):

```
┌──────────────────────────────────────────────────────── able-asr  18:50 ─┐
│  ⠹ 思考中    ASR paraformer-... · LLM ablework · TTS Maia · ★首音 705ms     │
│  📁  研究 Q3 财报    ✦ 已切到 研究 Q3 财报    共 17 个 · w 列表 W 刷新           │
│                                                                          │
│ ── 已切到 研究 Q3 财报 ──                                                   │
│                                                                          │
│ ╭─ 你   ASR 705ms · 92KB · polish 412ms  ────────────────────────────╮     │
│ │  请帮我看一下今天的财报数据。                                                │     │
│ │    原 ▸ 请帮我看一下今。今天的财报数据。                                       │     │
│ ╰─────────────────────────────────────────────────────────────────────╯     │
│ ╭─ AI ▮  ───────────────────────────────────────────────────────────╮      │
│ │  今天的财报显示营收同比增长 12%,主要来自服务器业务,▮                          │     │
│ ╰─────────────────────────────────────────────────────────────────────╯     │
│  00:00 mic                                                                │
│ space 录音  i 打断  r 重置  R 恢复  v 本地声  V 云声  p polish  w 工作区  q 退出 │
└──────────────────────────────────────────────────────────────────────────┘
```
