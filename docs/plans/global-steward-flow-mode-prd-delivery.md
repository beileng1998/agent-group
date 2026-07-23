# 全局管家心流模式 PRD：交付附录

本文是[主 PRD](global-steward-flow-mode-prd.md)的一部分，定义交付质量、MVP 边界和验证方法。

## 1. 非功能需求

### 1.1 可靠性

- Action Proposal、派工关联、Goal 和 Continuation 在服务重启后不丢失；
- 事件处理具备幂等性，迟到或重复 terminal event 不重复唤醒；
- provider 替换只能发生在 Turn 边界，旧 binding 的迟到事件不能污染新 Turn；
- 无法恢复时显示明确错误与人工修复入口，不静默丢弃等待项。

### 1.2 性能与规模

- 管家首页不依赖加载所有 transcript；
- Current Situation 从索引和 read model 快速生成，深层记录按需加载；
- Steward transcript 使用现有虚拟化机制，历史长度不增加模型 Prompt；
- 支持数百 Goal、数千 Session 关联而不要求一次性渲染关系图。

### 1.3 隐私与安全

- MVP 数据保存在现有本地应用边界；
- 不因建立 Goal Space 自动上传其他 Group 内容；
- 任何跨 Group 写操作均显示真实目标位置；
- Personal Principles 和 Goal 不是广告画像或模型训练授权。

### 1.4 可访问性

- 所有提案、状态和图形关系均有文本等价表达；
- 核心流程可全键盘完成；
- 不仅依靠颜色区分 Human、Agent、Together 或等待状态。

## 2. MVP 范围

### 2.1 必须包含

- profile 级内部 Steward Project、固定 Steward Session 和左侧置顶入口；
- 全局文本快捷输入及连续可见 transcript；
- Personal Principles 的提议、确认、编辑和来源；
- Goal Proposal、Goal 列表、Goal Detail、状态与 narrative revision；
- Checkpoint、Human/Agent/Together 和 Evidence 关联；
- Current Situation 五类视图；
- 跨 Group 搜索、按需读取、创建 Session、Queue、Steer、Interrupt、Stop；
- 一次性 Action Proposal 授权；
- 派工关联、Turn 结果回流和 attention；
- 用户回复、Turn 终态、时间、`any / all` 触发的 Continuation；
- provider 更换后的可见 transcript bootstrap 与 working-set 重建；
- 变更回执、来源跳转、取消与撤销。

### 2.2 后续阶段

- 语音输入与语音式连续交互；
- Goal 关系图与跨 Goal 冲突/协同视图；
- 更丰富的人类实践证据与共同复盘工具；
- 用户主动授予的、可撤销的有界长期 mandate；
- 跨设备同步、移动捕获、第三方日历或知识库连接；
- 团队 Goal、多人确认和组织权限；
- 从运行历史生成可解释的 continuation graph，但不提供图编排器。

## 3. MVP 验收旅程

以“学习 AI 经典论文”为端到端验收：

1. 用户从任意 Group 输入原始想法，消息进入固定管家；
2. 管家能找到相关 Session，但不会未经确认创建 Goal；
3. 用户与管家澄清后确认 Goal narrative；
4. Goal 在列表和详情中可见，并可回到原始消息；
5. 管家提出第一 Checkpoint，包含 Human、Agent、Together 三种参与；
6. 用户修改并确认 Agent 研究工作的 Group、Session 和范围；
7. 系统创建/继续正确 Session，并持久化 Goal—Turn 关联；
8. 用户可进入 Session 补充、Steer 或 Stop；
9. 管家同时等待用户阅读笔记与研究 Turn 结果；
10. 应用重启后 Continuation 和关联仍存在；
11. 两个条件满足后只唤醒一次新的管家 Turn；
12. 即使更换 provider，新 Agent 仍能解释 Goal、当前 Checkpoint、来源与等待原因；
13. 管家把结果作为 Evidence，不能自动宣布 Goal 或 Checkpoint 完成；
14. 用户确认、修订或拒绝进展判断后，Goal 正确更新；
15. 到达复查时间时，管家可以建议继续、暂停或改写，但不能自行处置。

## 4. 成功指标

北极星不是“Agent 完成了多少任务”，而是：

> 用户能否在较长时间后，仍以较低恢复成本参与并确认一个重要 Goal 的真实推进。

产品指标：

- Goal proposal 的确认、修改、拒绝比例及修改原因；
- 用户从提醒进入有效讨论或主动暂停/重写 Goal 的比例；
- 工作结果回流后，用户能定位来源并做出下一判断的比例；
- 用户主动参与的 Human / Together Checkpoint 占比；
- 长间隔恢复后，用户纠正“管家忘记或误解上下文”的频率；
- Goal 关闭时具有用户确认和可指向 Evidence 的比例。

系统护栏：

- 未授权跨 Group 写操作为 0；
- Continuation 丢失、重复消费或错误唤醒为 0；
- Turn terminal event 被误判为 Goal 完成为 0；
- provider 更换后使用旧 cursor 或隐藏摘要恢复为 0。

不把消息数、Goal 数、任务完成数或在线时长作为核心成功指标。

## 5. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Agent 把自然目标强行 OKR 化 | narrative-first；字段按能力渐进出现；用户确认 |
| Goal Space 变成另一套任务管理器 | 以意义、Checkpoint、Evidence 和讨论为主，不做 Kanban |
| 管家过度主动造成打扰 | 仅在 attention、结果或确认过的 review 点提醒；可静音 |
| Continuation 变成无限递归自动化 | 有界授权、单 successor、revision 检查、新动作再确认 |
| 长期摘要层层失真 | 原始记录为事实源；派生 brief 可重建；保留 sourceRefs |
| 多 Goal 导致 Current Situation 过载 | 按用户决策需求排序，只突出需要处理和最新变化 |
| 跨 Group 全局权限造成泄漏 | 专用 Steward workspace、按需读取、来源可见、写入确认 |
| Session 完成被误当作用户进展 | Evidence 与 Goal state 分离；Checkpoint 需用户确认 |
| 用户忘记为什么收到提醒 | Continuation 保留 resumeIntent、Goal 和原始来源 |
| 时间触发被误解为 Automation | 时间只唤醒重新判断，不直接执行工作 |

## 6. 发布与验证计划

1. **内部原型：** 固定管家、Goal Proposal、Goal Detail 和模拟 Current Situation；
2. **闭环原型：** 接入一个 Group 的 Session 创建、结果关联和 Continuation；
3. **全局 MVP：** 开放跨 Group 只读与经确认的控制面，验证重启恢复；
4. **长期试用：** 使用至少四周的真实学习、开发和创作 Goal，观察上下文纠正与提醒质量；
5. **公开实验：** 默认显式确认，不提供长期自动授权；收集 Goal 形成、恢复和用户参与数据；
6. **稳定发布：** 事件幂等、权限审计、provider 轮换和数据迁移达到验收标准后开放。

## 7. 已锁定的产品决策

- 主要入口是永久置顶管家会话，不是 Inbox、Kanban 或 Automation 页面；
- Goal 是跨 Group 的一等对象，Session 是工作容器；
- Potential Goal、Checkpoint 完成和过时处置都由管家提议、用户确认；
- Human-in-the-loop 指共同定义、实践、判断和复盘，不只是审批；
- Goal 内容优先于 OKR 式结构，采用 progressive formalization；
- 长期记忆必须可见、有来源、可修订，不依赖无限长对话；
- 永久的是 Steward identity，底层 Agent / provider binding 可替换；
- Continuation 是跨时间推进原语，开放式未来路径不预编成图；
- 结果回流只触发理解与建议，不自动连续派工；
- 用户可以随时进入 Session 并拥有最终控制权。

## 8. 仍需通过原型验证

- Goal Space 默认使用列表、聚焦视图还是空间图作为第一落点；
- 管家对一条同时包含多个想法的输入，何时拆成多个 Goal Proposal；
- review suggestion 的默认安静程度和用户可配置方式；
- 用户怎样最自然地区分“继续已授权工作”和“进入新的 Goal 决策”；
- app 未运行时的本地时间 Continuation 如何显示和补偿；
- 语音输入是否进入首个公开版本，还是在文本闭环稳定后加入。

这些问题不改变主 PRD 的产品边界，可通过交互原型和长期试用收敛。

## 9. 研究依据

- [Claude Dispatch](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork)
- [Things Inbox](https://culturedcode.com/things/support/articles/4001304/)
- [Sunsama Sunny / Braindump](https://help.sunsama.com/docs/usage-guides/sunny/)
- [Linear Loops](https://linear.app/now/introducing-loops)
- [Formality Considered Harmful](https://people.engr.tamu.edu/shipman/viki/papers/tochi/tochi.html)
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [MemGPT](https://arxiv.org/abs/2310.08560)
- [Microsoft Agent Framework durable extension](https://learn.microsoft.com/en-us/agent-framework/integrations/durable-extension)
- [Cloudflare long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/)
