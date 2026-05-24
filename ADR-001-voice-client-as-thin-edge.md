# ADR-001: Voice client as thin edge — local-first capture, cloud agent

- **Status**: Accepted
- **Date**: 2026-05-24
- **Owner**: hanlinlibham
- **Scope**: 本 probe(`~/voice-asr-test/`) + 未来 ablework 主仓的真桌面
  客户端;不绑定具体语言 / 平台
- **Related**: ablework `dpagt/docs/adr/010-local-first-control-plane.md`
  (数据面 local-first 总方向);
  `dpagt/docs/done/daily_record/2026-05-24-file-processing-workflow-and-graph-runner.md`
  末尾 P0-P2 中的语音助手段

## Context

ablework 要做语音助手:用户按 hotkey 说话 → 转写 → backend agent 干活 →
完成时通知用户("OK 了")。约束(用户 2026-05-24 拍板):

1. 语音段是**入口和接收层**,不该重(thin layer)
2. **可以接受异步** — 网络不好时仍要能"帮我记住一些事情",不能因为网
   络问题丢用户意图
3. 本机是 M3 Max 128GB — 本地小模型(ASR / 意图分类 / TTS / wake)
   完全跑得动

这就引出一个架构问题:**本地客户端的职责边界**到底在哪里?能本地跑 ≠
应该本地跑。如果不画清楚,本地代码会一步步膨胀成 mini agent,跟云端
agent 双源一致性 / 安全策略 / 状态同步全都成问题。

## Options considered

### A. Fat client — 本地 mini agent + 离线全功能

本地跑完整 LLM(M3 跑 qwen2.5-7b)+ 工具调用 + 本地 sandbox + 本地状
态。云端只是远程备份 / 协作通道。

**优点**:断网完全工作;延迟最低;隐私最强
**缺点**:
- 跟云端 agent 双源一致性是地狱(工具集 / prompt / state machine /
  middleware 全要 mirror)
- 安全策略(PolicyGate / capability / red zone)必须 mirror,改一处忘
  一处就出事(见 ablework memory `feedback_capability_grant_unmasks_routing_guard_gaps.md`)
- 本地模型质量天花板低(qwen2.5-7b 远不如 qwen3.7-max)
- multi-client(桌面 + 手机 + IM)就是 N×fat-client = N×bug
- debug / 监控分散

### B. Thin edge — 本地只 capture/buffer/notify,agent 全在云

本地只做:hotkey 录音 → ASR → SQLite intent buffer → push 给云;云回
推完成 → OS notification + TTS。
本地**不持有任何任务状态的真源**。

**优点**:
- 本地实现可独立演化(Swift → Tauri → Electron 都行)
- multi-client 自然平级(都是 capture/buffer/notify,共享同一个云
  agent)
- 离线**可降级**(intent 仍可 capture),**不可全功能**(执行要等网络)
- debug / 监控集中(任务状态 / provenance 只看云端一处)
- 安全策略(PolicyGate)只在云端一份
**缺点**:
- 完全断网时不能"完成"任务,只能"记下"
- ASR / 通知有延迟感(但实测 warm-call 600ms 可接受)

### C. Hybrid — 本地小 agent + 云大 agent 协作

本地跑小 LLM(qwen2.5-1.5b)做意图分类 / 简单任务,复杂的转云。

**优点**:简单 query 离线也能"完成"
**缺点**:
- "哪些归本地 / 哪些归云"的路由规则又是一套要维护的状态
- 安全策略 surface 翻倍(本地 + 云都要 enforce)
- 上下文不连续(本地小 agent 决策不会进云端 conversation history)
- 是 A 的弱化版,继承 A 的大多数痛点

## Decision

**B — Thin edge**。

本地客户端的核心定义:
> **agent 的 hands and ears,buffer 在它脚边;agent 大脑在云**

具体职责清单:

| 本地做(thin edge) | 云做(agent runtime) |
|---|---|
| 录音 + ASR(信号转换) | 任务理解 / 路由 / dispatch |
| SQLite intent_queue(网络 resilience buffer) | agent 推理 / tool 调用 / workflow |
| OS 通知 + TTS(I/O) | 状态机 / context / memory / 多步规划 |
| 本地意图分类做 **metadata enrichment**(可选) | 子任务编排 / 沙箱 / 工具执行 |
| 时延 / 音量 / 录音质量 metrics | 安全策略 / capability / PolicyGate |

## Invariants(对应 spec 红线)

1. **本地不持有任务状态的真源**。SQLite intent_queue 只是"未发出 / 未
   确认的 buffer",一旦云端确认收到,本地这条记录就是历史。任务运行中
   / 完成 / 失败的真源永远是 backend `task_runs` 表。
2. **本地意图分类只产生 metadata**(`hint: workspace_id=...`),云端主
   agent **可以 override**。不是"硬决策",是"加 hint 的客户端"。
3. **本地不缓存 conversation history**(那是 backend 真源,/conversations
   API 是唯一权威)。
4. **本地不跑完整 agent loop**(包括 tool dispatch、subagent、middleware
   链)。
5. **本地不决定 safety policy**(L3 destructive operations 仍由 PolicyGate
   在云端 enforce,即使 voice + autonomous mode)。
6. **本地不写 workspace 文件**(workspace 是云端 sandbox 资源)。

## Consequences

### 立刻生效(本 probe 已遵守)

- `mlx-qwen3-asr` 选择:thin-friendly(ASR 是"信号转换",不算 agent)
- SQLite `transcripts.db`:仅 buffer 用,**不是** conversation 真源
- 不接 ablework backend `/chat/sync`:probe 阶段 transcript 停在 SQLite,
  user 看到就行
- UI 不带 markdown / 富渲染 / 状态机:thin
- 不做用户认证:localhost only

### 未来真桌面客户端要遵守

- macOS menubar app(Swift / Tauri)只做 hotkey + ASR + buffer + 通知
  四件事
- 完成 → 调 ablework `/notifications/stream?user_id=...` SSE long-poll
  → 收到 push 时 `osascript display notification` + `say "ok 了"`
- 任务 list / 历史查看 / 设置 → 跳浏览器到 ablework web UI(就是
  dpagt/frontend_dp/),不在 menubar 内复刻
- multi-client 时(手机 / IM bot)都是平级 thin client,**不**有"主
  / 从"区分,都跟云端 agent 直连

### 演化路径

- 本地客户端的实现语言换 → 不动云端
- 云端 agent 升级 → 不动客户端
- 加新 capture 通道(IM bot / 邮件入口)→ 各自写一个 thin edge,共享
  云端 agent
- 加新输出通道(智能音箱 / iWatch)→ 各自写一个 thin output,订阅同
  一个 `/notifications/stream`

## Anti-patterns(被这条决策禁掉的事)

- ❌ 本地 import deepagents / 跑 LangGraph
- ❌ 本地 conversation_kit / message_events 镜像表
- ❌ 本地 PolicyGate / middleware 集
- ❌ 本地决定"voice 命令可以跳过 confirmation"(那是云端 safety 责任)
- ❌ 本地写 user workspace 下任何文件
- ❌ 本地用 `mlx-lm` 跑 7B+ 模型做 agent 决策(本地小模型只用于
  enrichment 类 deterministic 任务:意图分类 / wakeword / 静音检测 /
  简单总结)

## Open questions

1. **本地意图分类**的 invariant 边界(metadata vs decision)需要更细的
   规则。当本地分类高置信(>95%)时,云端 agent 是否仍要独立校验?这
   涉及"信任 / 性能"权衡。**待真用上 classifier 时再 ADR**。
2. **streaming partial transcript** 算 thin 还是 fat?当前判断:仍属
   thin —— 那只是"边录边出 ASR partial",ASR 仍是信号转换,不是 agent
   决策。client-side ASR streaming UI 不违反本 ADR。
3. **跨 device 同步**(手机说一句,桌面看到结果)走云端 SSE 还是本地
   mDNS 直连?当前判断走云端(更通用,multi-tenant 友好),但 P95 延迟
   会差一点。等多端真用上时再决。
4. **完全离线模式**是否要 export 成 explicit flag(client 启动 `--offline`
   时不做 sync 尝试,只 capture)?**待用户真在飞机 / 远程地区用时再说**,
   目前 SQLite buffer 已经能 cover 这个场景(自然异步重试)。

## 参考

- ablework `dpagt/docs/adr/010-local-first-control-plane.md` — 数据面
  local-first 总方向。本 ADR 跟它**不冲突**:用户数据 + voice client
  都是本地端,云端是控制面 + 主 agent。
- ablework `feedback_capability_grant_unmasks_routing_guard_gaps.md` —
  对应 invariant #5(safety policy 集中在云,不要在边缘 enforce)。
- ablework `feedback_main_direct_push_default.md` — 工作流默认直推
  main,本 probe 不在 main repo 但同样遵守(独立目录 + 独立 git history,
  如果以后建 repo)。
