# Voice Channel — Client-Side Contract

**Status**: draft
**Owners**: ablevoice probe owner
**Source of truth**: `voice/providers/llm.py::AbleworkLlm.stream`(请求装配位置,待扩展 `channel` + `channel_metadata`);`voice/polish/api.py::PolishResult`、`voice/intents/enums.py::IntentResult`(metadata 字段的客户端真源)
**Last reviewed**: 2026-05-27
**ADR refs**: `ADR-001-voice-client-as-thin-edge.md`(本 spec 是该 ADR 中"本地不持有任务状态真源 / 本地分类只产生 metadata"两条 invariant 在协议层的具体化)
**Mirror**: ablework 仓 `dpagt/docs/spec/protocol/voice-channel.md`(server-side 契约) — 两份 spec 必须保持一致,服务端约束的字段含义即本 spec 客户端必须装配的内容

## Scope

约束 ablevoice 客户端(probe 及未来桌面客户端)向 ablework backend 发起 `POST /chat` 调用时的 wire-format 装配规则、字段语义边界、降级策略。

**不在 scope**:
- ablework 收到请求后的验参 / preset 路由 / fuzzy match 行为(那是 server-side spec 管的)
- 本地 ASR / Polish / Intent classification 的内部实现(算法、prompt、retry 策略 — 实现细节,见 `voice/polish/` 与 `voice/intents/`)
- 出站 SSE 事件的消费(`voice/providers/llm.py` 解析 `text-delta` 的现有路径不变)
- WebSocket 协议(`/ws` 是客户端与本地 server 之间的事,跟 ablework 调用无关)

## Invariants

### MUST-channel-payload-on-every-call

每一次发往 ablework `/chat` 的请求,**必须** 同时携带:

- `channel: "voice"`(顶层字段)
- `channel_metadata: VoiceChannelMetadata`(顶层字段,5 字段齐全:`raw_transcript` / `polished_text` / `intent` / `workspace_match` / `confidence`)

`channel_metadata` 的字段含义与 schema 以 server-side spec `MUST-voice-metadata-schema` 为准。

不允许"第一轮带,后续省"——每一轮都要带。后端用 `channel` 决定 preset 路由,缺字段会被 422。

### MUST-NOT-rewrite-user-intent

`polished_text` **只能**对 `raw_transcript` 做表面整理:删口语助词("呃"、"嗯"、"那个")、修 ASR 错字、补缺漏标点、把支离破碎的口语连成通顺句。

**不能** 做的(违反 = bug):
- 改变原意(例:用户说"看看茅台",polish 成"查询贵州茅台财报"——加了"财报"语义)
- 增加新信息 / 解释 / 推断意图
- 把陈述句改写成命令句 / 工具调用 prompt
- 重组段落、拆分语义

理由:ADR-001 invariant #2 — 客户端只做 metadata enrichment,不做硬决策。Polish 越权重写会让 backend 看到的不是用户原话,语义事故责任无法追溯。

### MUST-NOT-channel-directive-in-content

`messages` 数组里任何 `role="user"` 的 `content` / `parts` **绝不** 包含形如 `【语音通道】`、`【请简短】`、`【TTS 输出,无 markdown】` 等 channel directive 前缀 / 后缀。

通道约束通过 `channel="voice"` 字段表达,由 backend preset 一次性吸收 — 见 server-side `MUST-NOT-channel-directive-injection`。客户端往 content 里塞 directive 会破坏 backend 的 directive-free 不变量,把本来要避开的 perseveration loop 拖回来。

### MUST-workspace-name-not-id

`channel_metadata.workspace_match` **必须** 是用户口语里出现的**工作区名称**(自然语言串,如 "联想"、"宁德时代分析"),或 `null`(没匹配到)。

**不能** 是:
- workspace UUID / id 字符串
- 客户端本地解析后的"标准化"名称(如把"联想"改写成"联想研究")
- 空字符串(应该传 `null`)

理由:解析"用户说的名字"→`workspace_id`是 backend 的责任(server-side `MUST-workspace-fuzzy-validate`)。客户端本地不持有 user 的 workspace 列表真源,自己解析会跟 backend 不一致。

### SHOULD-degraded-metadata-on-failure

当本地 polish / intent classification 任一步骤失败(超时、LLM 报错、JSON 解析失败),客户端**应**用如下 fallback 装 metadata 后仍发请求,**不应** 阻塞用户语音 UX:

- polish 失败 → `polished_text = raw_transcript`,`confidence` 降为反映 "polish-skipped" 的低置信度
- intent 失败 → `intent = "chat"`(保守默认),`workspace_match = null`,`confidence` 降为反映 "intent-fallback" 的低置信度
- 两者都失败 → 上述同时生效,`confidence` 取两者更低值

具体置信度数值是实现选择(见 Open questions),spec 只约束"必须降到与 success path 可区分的水平"。

例外:`raw_transcript` 完全空(ASR 0 字符)时**应**直接返回不发请求,让 UI 提示用户重说。

理由:语音 UX 上,本地一两次 LLM 故障不应该让用户感觉"系统坏了"。backend 接到 raw=polished + low confidence 仍能正常聊,只是失去 polish/intent 增强 — 优雅降级。

### SHOULD-stable-id-per-voice-session

同一**语音会话**内,`ChatRequest.id`(AI SDK v6 conversation key)应保持稳定。"同一语音会话"定义:用户没主动发"新对话"/"重开"语音意图、客户端未被重启。

**例外**:用户发出 `ws_switch` / `ws_create` 等工作区切换意图触发本地 `reset_conversation()` → 应在下一轮发请求时换新 `id`。

理由:与 server-side `SHOULD-stable-conversation-key` 镜像。稳定 `id` 让 backend 多轮 conversation 不被切断;切换工作区时换 id 让 backend 把新会话归到新 workspace。

## Examples

### 正例:正常 chat 请求装配

```python
# voice/providers/llm.py::AbleworkLlm.stream 中(扩展后)
body = {
    "messages": clean_msgs,           # 干净的 user/assistant 数组,无 directive 前缀
    "id": conv_id,                    # 该 session 内稳定
    "channel": "voice",
    "channel_metadata": {
        "raw_transcript":  asr_text,
        "polished_text":   polish_result.final,
        "intent":          intent_result.intent.value,
        "workspace_match": intent_result.workspace_match,   # 自然名 or None
        "confidence":      min(polish_result.confidence, intent_result.confidence),
    },
}
```

### 正例:polish 失败的降级装配

```python
try:
    polish_result = await polish_text(raw)
except Exception:
    polish_result = PolishResult(final=raw, raw=raw, skipped=True, ok=False, ...)

metadata = {
    "raw_transcript":  raw,
    "polished_text":   polish_result.final,   # = raw,fallback
    "intent":          "chat",                # intent 也保守
    "workspace_match": None,
    "confidence":      0.3,                   # 降级置信度
}
```

### 反例:polish 改变原意(禁)

```python
# 用户原话: "看看茅台"
# polish 输出: "查询贵州茅台的最新财报"   ❌ 加了"财报"语义
# 违反 MUST-NOT-rewrite-user-intent
```

### 反例:往 content 塞 channel directive(禁)

```python
body["messages"][-1]["content"] = (
    "【语音通道,请简短回复且不使用 markdown】\n" + user_text
)   # ❌ 违反 MUST-NOT-channel-directive-in-content
```

### 反例:本地把工作区名解析成 id(禁)

```python
ws_id = local_workspace_lookup("联想")   # 客户端不该自己查
metadata["workspace_match"] = ws_id      # ❌ 违反 MUST-workspace-name-not-id
# 正确做法: metadata["workspace_match"] = "联想"  # 传原话,让 backend fuzzy match
```

## Tests

| Invariant | Test |
|---|---|
| `MUST-channel-payload-on-every-call` | `tests/unit/test_ablework_request_assembly.py::test_voice_channel_field_present` `# unverified` |
| `MUST-NOT-rewrite-user-intent` | `tests/unit/test_polish_no_semantic_drift.py::test_polish_preserves_meaning` `# unverified`(语义层 — 需 LLM judge 或 golden set) |
| `MUST-NOT-channel-directive-in-content` | `tests/unit/test_ablework_request_assembly.py::test_no_directive_prefix_in_messages` `# unverified` |
| `MUST-workspace-name-not-id` | `tests/unit/test_intent_workspace_match_is_name.py` `# unverified` |
| `SHOULD-degraded-metadata-on-failure` | `tests/unit/test_polish_fallback.py::test_polish_failure_yields_raw_with_low_confidence` `# unverified` |
| `SHOULD-stable-id-per-voice-session` | `# unverified`(协议建议,无 client assertion 路径) |

## Open questions / drift

- **代码尚未实装**:当前 `voice/providers/llm.py::AbleworkLlm.stream`(line 191-209)的 `body` 装配里**没有** `channel` / `channel_metadata`。本 spec 描述 proposed contract,所有 invariant 当前实现状态为 0%。
- **confidence 字段当前不存在**:`voice/polish/api.py::PolishResult` 没有 `confidence`,`voice/intents/enums.py::IntentResult` 有但默认 1.0(过于乐观)。需要在两个模块各加一个合理的置信度算法(polish 看 attempts / validator pass,intent 看 LLM 输出的 confidence + workspace_match 命中度)。
- **polish 语义保护怎么测**:`MUST-NOT-rewrite-user-intent` 是语义层不变量,unit test 难以彻底覆盖。短期靠 golden set + 人工标注;长期可上 LLM-as-judge,但成本/稳定性都要试。
- **多轮 messages 数组体积**:ablevoice 不持有 conversation history,每轮都要把本地 `_conversations[session_id]` 完整发上去。N 轮后体积膨胀的责任归 server-side Summarization middleware,本 spec 不重复约束。
- **从 WebSocket 通道复用?**:`voice/ws.py` 也走 chat 路径(`run_chat_pipeline`),但它是 ablevoice 本地 server 跟 UI 之间的协议,不是 client→ablework 的协议。本 spec 只管 `AbleworkLlm` 这一处出向调用,WS 路径不在 scope。

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-05-27 | Initial draft — voice channel client-side contract(channel 字段必填 + metadata 装配规则 + 禁止改写原意 / 注入 directive / 客户端解析 ws id + 降级策略),mirror server-side spec | hanlinlibham + assistant |
