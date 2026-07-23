# 全局管家心流模式 PRD

| 项目 | 内容 |
| --- | --- |
| 状态 | Product Definition v1 |
| 日期 | 2026-07-23 |
| 工作名 | Flow Steward / 心流管家 |
| 产品范围 | Agent Group 桌面端的个人长期目标共同推进系统 |
| 首要用户 | 同时进行多个长期项目、学习或创作目标的个人用户 |

## 1. 产品结论

在 Agent Group 左侧永久置顶一个全局管家 Session。用户可以像持续聊天一样，随时输入
零散想法、困惑、目标或对正在进行工作的修正。管家负责：

1. 理解用户真正想实现的变化；
2. 与用户共同形成并保管跨周、跨月、跨年的 Goal；
3. 提出下一步澄清、实践、讨论或 Agent 工作建议；
4. 经用户授权后，把具体工作放入合适的 Group 和 Session tree；
5. 等待用户行动或工作 Session 的结果；
6. 在正确的时机恢复讨论、确认进展并共同重规划。

一句话定义：

> 一个入口、一个持续存在的管家、一个可见的长期 Goal Space，以及许多可进入、可接管的工作 Session。

Claude Dispatch 主要解决“把请求送到哪里并拿回结果”；本产品解决“用户长期想实现什么、
现在怎样理解、取得了什么真实进展、接下来应由谁参与”。Dispatch 是其中一项执行能力，
不是产品本体。

```text
随时输入 ↔ 全局管家 Session ↔ Goal Space
                    │
                    ├─ Human：用户亲自阅读、实践、判断、创作
                    ├─ Agent：研究、整理、实现、准备材料
                    └─ Together：澄清、讨论、反馈、复盘
                                      │
                                      ↓
                                 Session tree
                                      │
                         结果 / 阻塞 / 等待 / 用户介入
                                      │
                                      ↓
                         Continuation 唤醒新的管家 Turn
```

## 2. 背景与问题

现有 Agent 产品通常围绕一次请求或一次 Session 优化，存在五个缺口：

- 用户的输入常常只是尚未成形的想法，过早转成任务会丢失真正意图；
- “学习 AI 经典论文”等目标持续数月，无法由一次对话或一次执行完成；
- 工作散落在不同 Group 和 Session，用户需要自己记住它们为何存在、等待什么；
- 长对话不断压缩后会失真，单个 provider session 无法可靠承担长期记忆；
- 全自动派工会把用户从学习、判断和创作过程中移除，完成物不等于目标进展。

用户需要的不是更多任务卡片，而是一个能跨时间保存意义、在恰当决策点邀请用户参与、
并可靠恢复当前局面的共同推进系统。

## 3. 产品目标

### 3.1 用户目标

- 在任何界面用自然语言快速表达想法，无需先分类或填写表单；
- 知道系统准确保留了哪些长期目标，以及当前如何理解它们；
- 看见当前需要自己参与、正在由 Agent 处理、等待结果或应重新审视的事项；
- 与管家共同决定下一步，而不是被自动生成的计划牵着走；
- 随时进入具体 Session 查看、补充、Steer 或 Stop；
- 数周后回来或更换底层 Agent，仍能从正确上下文继续；
- 能检查、修正、撤销管家保存的目标、原则、证据和判断。

### 3.2 业务与产品目标

- 把 Agent Group 从多 Session 执行工具扩展为长期人机协作入口；
- 让 Session tree 中的工作与用户真正的长期 Goal 建立可解释联系；
- 以可见记忆、明确授权和可靠恢复建立长期信任；
- 形成区别于任务分发器、看板、OKR 工具和全自动 Agent 的产品定位。

### 3.3 非目标

- 不构建通用 Kanban、日程管理器、OKR 填报工具或工作流图编辑器；
- 不以 Agent 自动完成尽可能多的工作为目标；
- 不把每个想法立刻转换成 Goal 或 Task；
- 不用百分比、完成任务数或 Session 终态自动代表 Goal 进度；
- 不让管家未经授权创建工作、发消息、Steer、Stop 或改变目标状态；
- 不建立隐藏用户画像、隐藏摘要、One Brain 或不可检查的长期记忆；
- 不让一个 LLM Turn、provider 进程或轮询循环永久运行；
- 不改变 Group、Session、Turn、ModelSelection 的现有产品语义；
- MVP 不解决团队共享目标、多人权限、跨设备云同步或第三方项目管理同步。

## 4. 目标用户与核心场景

### 4.1 目标用户

首版面向同时处理多个长期目标的个人知识工作者，包括开发者、研究者、创作者、创业者和
深度学习者。他们已经使用多个 Agent Session，但不希望把人生和工作变成自动化任务队列。

### 4.2 Jobs to be Done

| 时刻 | 用户想要完成的事 |
| --- | --- |
| 灵感出现 | “先把我的原话接住，之后帮我判断它意味着什么。” |
| 目标形成 | “通过对话把模糊愿望变成我真正认可的方向。” |
| 决定下一步 | “告诉我当前最有价值的选择，并让我决定怎么做。” |
| 参与过程 | “让我亲自学习、判断和创作，Agent 提供准备与反馈。” |
| 工作分派 | “把已确认的具体工作放到正确 Session，并允许我接管。” |
| 长时间等待 | “不用我记住一周后应继续什么，系统在正确事件后找回上下文。” |
| 回顾与修正 | “根据真实证据判断进展，必要时暂停、改写或结束目标。” |

## 5. 产品原则

1. **对话优先，结构渐进。** 先保留原话与意义，只有能支持导航、提醒、可视化或决策时才增加结构。
2. **Goal 优先于 Task。** Goal 说明为什么与什么变化值得实现；Session 只说明一次工作在哪里发生。
3. **人是共同作者。** 用户参与目标定义、路径选择、实践、证据判断和复盘，而不只是批准 Agent。
4. **建议不等于决定。** 管家可以主动提醒、提出关联或判定建议，但目标与里程碑状态由用户确认。
5. **产品保存事实，Agent 按需取用。** 永久性属于数据和产品身份，不属于某个模型上下文。
6. **记忆可见、可追溯、可纠正。** 重要理解必须指向原始话语、Session、Turn 或用户确认。
7. **执行有限，恢复持续。** 每个 Turn 正常结束；Continuation 在未来事件发生后恢复新的 Turn。
8. **不预编开放式认知图。** 未来路径由当时上下文决定，图和循环只是运行历史的派生视图。
9. **用户操作始终优先。** 用户可以直接进入工作 Session、修改规划、Steer 或 Stop，管家必须重新理解现状。
10. **低运行时心智负担。** Prompt 保持极简，系统承担检索、ID、状态、去重和权限等机械工作。

## 6. 核心概念

| 概念 | 定义 | 不是 |
| --- | --- | --- |
| Steward Session | profile 级、永久置顶的可见对话身份 | 永久运行的 Agent 进程 |
| Personal Principles | 跨 Goal 稳定且经用户认可的原则、偏好和边界 | 隐藏画像或聊天琐事 |
| Goal | 用户长期想实现的变化及其当前含义 | Task、Session 或固定 OKR |
| Checkpoint | 与用户确认的下一阶段成果或判断点 | 自动计算的百分比 |
| Evidence | 支持进展判断的原话、产物、行为或讨论结果 | 自动完成证明 |
| Action Proposal | 管家建议执行、但尚待用户授权的一组有界动作 | 后台自动化 |
| Continuation | 在可解析事件发生后重新思考某个问题的恢复契约 | 压缩上下文或未来死命令 |
| Current Situation | 从 Goal、Continuation、授权和 Session 状态确定性派生的当前局面 | 第二份手工维护任务表 |
| Session / Turn | 具体讨论或执行的容器与一次有限请求 | Goal 生命周期 |

### 6.1 关系

```text
Profile
├─ Personal Principles
├─ Steward Session
├─ Goal Space
│  └─ Goal
│     ├─ narrative
│     ├─ Checkpoints
│     ├─ Evidence
│     ├─ related Goals
│     ├─ linked Sessions / Turns
│     └─ Continuations
└─ Groups
   └─ Session trees
```

- 一个 Goal 可以跨多个 Group 和 Session；
- 一个 Session 可以为多个 Goal 提供证据；
- Goal 可以在没有活动 Session 时继续存在；
- Session 或 Turn 完成不自动改变 Goal；
- Goal 的分解关系不能用 `parentThreadId` 代替；
- runtime subagent 仍然只是 Turn activity，不成为正式 Session。

## 7. 信息架构

### 7.1 左侧导航

- 管家固定显示在所有 Group 之前，不能被普通排序或归档隐藏；
- 显示 `Needs you` 和新结果的轻量 badge；
- 管家下面仍是现有 Group 和 Session tree；
- 进入具体工作 Session 后，管家仍可通过全局快捷输入接收新想法。

### 7.2 管家会话

- 保持普通聊天的连续感，支持文本、附件和未来的语音输入；
- 完整 transcript 对用户可见并可搜索，但不全部注入每个 Agent Turn；
- Goal 建议、Action Proposal、工作结果和记忆变更以内联卡片出现；
- 用户可用自然语言修改提案，不被迫操作表单；
- 正在回复时的新输入默认 Queue；明确纠正当前方向时允许 Steer。

### 7.3 Goal Space

MVP 提供可搜索的 Goal 列表和 Goal Detail，不使用 Kanban：

- Goal 列表显示标题、当前叙述摘要、状态、下一 Checkpoint、当前等待和最近确认；
- 支持 Active、Paused、Closed 过滤，但不强迫按领域或期限分类；
- Goal Detail 展示原始意图、当前理解、Checkpoint、Human/Agent/Together 参与方式、
  Evidence、关联 Session、Continuation 和演变历史；
- 关系图谱是后续派生视图，不作为编辑或执行控制面。

### 7.4 Current Situation

在管家和 Goal Space 中提供统一视图：

```text
Needs you       等待用户判断、输入、审批或实践
Running         已授权且正在执行的 Session / Turn
Waiting         等待具体事件或时间的 Continuation
Ready to discuss 已有结果，等待人与管家共同处理
Review suggested 管家建议检查是否仍然相关
```

这些分组由事实源确定性计算，不单独存储或要求用户维护。

## 8. 核心用户旅程

### 8.1 模糊想法形成 Goal

1. 用户从任意界面输入：“我想学习所有 AI 经典论文。”
2. 原话立即进入管家 transcript，不要求分类。
3. 管家检查相关 Goal 和 Session，判断是新方向、已有目标补充还是一次性请求。
4. 管家通过少量高价值问题澄清动机、当前基础、投入方式和用户认可的进展。
5. 管家提出 Goal narrative；此时只是一项提议。
6. 用户确认、修改或暂不建立。
7. 确认后 Goal 出现在 Goal Space，并保留原始消息来源。

### 8.2 共同拆解与推进

1. 管家提出一个可讨论的下一 Checkpoint，而不是生成完整长期计划。
2. 用户修改并确认。
3. Checkpoint 中可包含：
   - Human：阅读原文、写理解、复现实验；
   - Agent：整理候选论文、准备先修材料；
   - Together：讨论、答辩、检查理解偏差。
4. 需要具体 Agent 工作时，管家提出目标 Group、Session、范围和返回条件。
5. 用户确认后才创建或继续 Session。
6. 用户可进入 Session 亲自参与，并随时 Steer 或 Stop。

### 8.3 跨时间恢复

1. 管家登记“等待用户阅读笔记”和“等待研究 Turn 完成”的 Continuation。
2. Agent 释放，不维持长期进程或轮询。
3. 事件发生后，系统将 Continuation 标记为 Ready 并启动新的管家 Turn。
4. 新 Agent 从当前 Goal、用户原则、相关原始记录、Session 结果和 Current Situation 重建 working set。
5. 管家与用户讨论证据，提出 Checkpoint 是否达成或下一步是否改变。
6. 只有用户确认后才更新进展或进入下一阶段。

### 8.4 目标可能过时

1. 时间、长期无活动、用户新表达或目标冲突可触发 review suggestion；
2. 管家说明为什么认为需要复查，并引用依据；
3. 用户选择继续、改写、暂停、合并或关闭；
4. 管家不能根据沉默自行关闭或降级 Goal。

### 8.5 更换底层 Agent

1. provider 改变、上下文压力、运行失败或用户手动刷新时，旧 binding 在 Turn 边界停止；
2. Steward Session ID、transcript、Goal 和 Continuation 保持不变；
3. 新 binding 获得一次可见 transcript bootstrap 和当前工作的有限 orientation；
4. 新 Agent 从工具按需读取更深记录，不依赖旧 provider cursor 或多代摘要。

## 9. 功能需求

### FR-1：全局管家身份

- 系统为每个本地 profile 创建且仅创建一个 Steward Session；
- 产品层不把它显示为工作 Group；runtime 使用专用内部 Project 和隔离 workspace 承载 Thread；
- 管家仍使用现有 Turn 与 `ModelSelection`，允许在 Turn 边界切换 Agent；
- 管家不能直接把专用 workspace 当成任意 Group 的代码目录；
- Steward Session 可恢复、不可被普通 Session 删除流程误删。

### FR-2：全局输入

- 用户可在管家页面直接输入，也可从任意页面打开快捷输入；
- 快捷输入必须保留用户原文和附件，并进入同一 Steward transcript；
- 输入成功后立即提供可见回执，不要求先选择 Goal 或 Group；
- 同一 Steward Session 仍遵守单 active Turn；后续输入使用现有 Queue / Steer 语义；
- MVP 支持文本和附件，语音是后续输入适配器。

### FR-3：全局只读认知

管家可通过按需工具：

- 列出、搜索所有可访问的 Group 和 Session；
- 读取树关系、运行状态、标题、最近活动和 attention 状态；
- 读取相关 Session Context、可见 transcript 片段和 Turn 结果；
- 返回来源引用，使用户可以跳转到原始 Session；
- 不把全部 Group transcript 常驻注入 Prompt。

### FR-4：Goal 提议与维护

- 管家检测潜在 Goal 时先产生可编辑提议，用户确认后才创建；
- Goal 主体是自由 Markdown narrative，保留“为什么在意、当前如何理解、仍模糊什么、现实约束”等内容；
- 结构字段仅在支持产品能力时出现，不要求填写 Objective、KR、期限或百分比；
- 用户可以合并重复 Goal、关联已有 Goal、暂停、恢复和关闭；
- 任何 Goal 语义变更必须显示变更回执、来源和撤销入口；
- Agent 不能无提示重写历史；新理解以 revision / supersedes 关系保留演变。

### FR-5：个人原则与约束

- 保存少量具有跨 Goal 价值的稳定原则、工作方式、时间和风险边界；
- 用户明确表达时，管家可写入并显示回执；
- Agent 推断出的原则必须作为提议等待确认；
- 用户可直接编辑、撤销并查看来源；
- 不保存无跨 Goal 价值的琐碎偏好，不生成不可见心理或人口画像。

### FR-6：Checkpoint、参与方式与 Evidence

- 管家和用户可以为 Goal 确认下一 Checkpoint；
- Checkpoint 使用自由描述，并可标注 `Human / Agent / Together` 参与方式；
- 管家可链接消息、Turn、Session 结果或用户产物作为 Evidence；
- Evidence 只证明发生了什么，不自动证明 Goal 已进步；
- Checkpoint 达成、失败、调整或撤销由管家提议并经用户确认；
- 默认不显示伪精确进度百分比，列表优先展示下一判断点与证据状态。

### FR-7：Action Proposal 与授权

涉及写操作时，管家先给出紧凑提案，至少说明：

- 为什么现在做；
- 目标 Group / Session 或拟建 Session tree 位置；
- 工作范围和参与方式；
- 预期返回什么以及何时停止。

授权规则：

- 只读查询可直接进行；
- 用户明确命令本身可视为对该有界动作的授权；
- 管家主动建议的创建、Queue、Steer、Interrupt、Stop 必须先确认；
- 用户的修改会生成新提案，旧提案失效；
- MVP 不授予永久自动派工权限，不开放删除、移动历史或不可逆操作。

### FR-8：跨 Group Session 控制

经授权后，管家可以：

- 在指定 Group 创建根 Session；
- 在指定 Session 下创建正式子 Session；
- 向 idle/running Session Queue 消息；
- 对正在运行的 Turn Steer 或 Interrupt；
- Stop 对应的 native provider binding；
- 跳转并邀请用户进入工作 Session。

所有操作必须使用目标 Group 的 canonical `workspaceRoot`，不能创建 per-Session worktree。

### FR-9：派工关联与结果回流

- 系统持久化 `Action Proposal → Goal / Checkpoint → target Session → target Turn` 的关联；
- 管家只关注自己派出的工作或用户明确要求关注的工作；
- `turn.completed`、`turn.aborted`、输入/审批 attention 触发关联更新；
- `session.exited` 只表示 provider 生命周期，不能当作工作或 Goal 完成；
- 应用重启后仍能恢复未结关联并去重结果事件；
- 结果回流只唤醒管家理解和提议，不自动更新 Goal 或派发下一项新工作。

### FR-10：Agentic Continuation

Continuation 至少包含：

- 所属 Steward、可选 Goal / Checkpoint 和来源引用；
- 可被系统解析的 `wakeOn`：用户回复、指定 Turn 终态、attention、明确时间或 `any / all` 事件组合；
- 简短 `resumeIntent`：事件发生后应重新判断的问题；
- 系统管理的 revision、状态、去重键和创建来源。

生命周期为：

```text
Waiting → Ready → Consumed
       ↘ Cancelled
       ↘ Superseded
```

约束：

- Agent 只提供语义意图与 trigger 参数；系统生成 ID、状态和机械字段；
- Continuation 不保存 transcript 摘要或模型隐藏状态；
- 唤醒后必须用最新 Goal revision 重建上下文并重新判断；
- 同一工作 lineage 最多有一个 successor continuation，避免无授权 fan-out；
- profile 中可以同时存在多个 Goal 的 Continuation；
- 已授权且边界不变的工作可以跨 Turn / IO 恢复；改变 Goal、范围或工作落点则必须重新确认；
- Goal continuation 只唤醒管家讨论和提议，不能把“建议下一步”变成自动执行权限；
- 时间触发只是唤醒 review，不等同于定时自动执行；
- 用户可以查看、取消或替代任何 Continuation。

### FR-11：长期上下文与 Agent 轮换

事实与上下文分层：

1. **Record Layer**：原始消息、事件、用户操作、Session 结果和产物引用；
2. **Meaning Layer**：Personal Principles、Goal narrative、Checkpoint、Evidence 和确认历史；
3. **Derived Layer**：Current Situation、检索索引和 orientation brief，可随时重建；
4. **Working Set**：当前 Turn 的有限上下文，用后即可丢弃。

新 Agent orientation 只包含：

- 极简英文角色规则；
- 当前用户原始请求；
- Personal Principles；
- Current Situation；
- 当前相关 Goal narrative、来源片段和关联结果；
- Session Context 路径；
- provider 改变时的一次可见 transcript bootstrap；
- 按需检索与控制工具。

禁止 summary-of-summary、隐藏 transcript、provider resume cursor 或把所有 Goal 塞入 Prompt。
`context.md` 继续作为 raw Markdown 工作便笺，应用不得解析或把它当作 Goal 数据库。

### FR-12：提醒与通知

- 只在需要用户判断、工作返回、执行失败或用户确认过的 review 时间到达时提醒；
- 管家可以建议某 Goal 可能过时，但必须说明依据并等待用户决定；
- 同一结果或 Continuation 只能产生一次可见提醒；
- 用户可静音单个 Goal，但静音不丢失 Current Situation；
- 不使用 Heartbeat 轮询来模拟主要事件流。

### FR-13：审计、纠正与恢复

- Goal、Principle、Checkpoint、Action Proposal、Continuation 的变化都保留时间和来源；
- 用户可以从 Goal Detail 跳回原始消息、Session 或 Turn；
- 所有语义更改和关闭操作可撤销；
- 系统在旧 Continuation 恢复时检测 Goal revision 变化，禁止执行过时意图；
- 跨 Group 读取和控制遵守当前 profile、文件系统与 provider 权限边界；
- 管家不把一个 Group 的敏感内容主动带入无关 Goal 或其他 Group Session。

## 10. 状态语义

### 10.1 Goal

| 状态 | 含义 | 谁决定 |
| --- | --- | --- |
| Proposal | 候选理解，尚未成为 Goal | 用户确认或拒绝 |
| Active | 用户认可并希望持续保管 | 用户 |
| Paused | 仍有意义，但当前不推进 | 用户 |
| Closed | 已达成、不再相关或被替代 | 管家提议，用户确认 |

Goal 是否成熟、清晰或近期活跃不编码为额外强制状态，由 narrative 和 Current Situation 表达。

### 10.2 Checkpoint

`Proposed → Agreed → Confirmed / Revised / Withdrawn`。Turn completion 只能增加 Evidence，
不能直接进入 `Confirmed`。

### 10.3 Action Proposal

`Proposed → Approved → Dispatched → Settled`，也可进入 `Edited / Rejected / Cancelled`。
每次修改范围或目标位置都需要新的批准。

## 11. 概念数据模型

这是产品语义，不是最终数据库 schema：

```text
PersonalPrinciple
  id, text, sourceRefs, confirmation, createdAt, updatedAt

Goal
  id, title, state, narrativeMarkdown, sourceRefs
  optional relations, checkpoints, evidenceLinks, revisions

Checkpoint
  id, goalId, narrativeMarkdown, participationModes
  evidenceExpectation?, state, sourceRefs

GoalWorkLink
  goalId, checkpointId?, projectId, threadId, turnId?
  relation, actionProposalId?, createdAt

ActionProposal
  id, rationale, boundedOperations, targetRefs, expectedReturn
  userDecision, sourceTurnId

Continuation
  id, stewardThreadId, goalId?, checkpointId?
  wakeOn, resumeIntent, sourceRefs, expectedGoalRevision
  status, createdFromTurnId
```

Current Situation 不单独成为事实表；它从以上对象和现有 orchestration read model 派生。

## 12. Prompt 与工具设计

管家的长期角色 Prompt 保持英文且极简：

> Understand the user's goals, preserve their intent, and propose the next useful decision. Read global state only as needed. Never change work without user authorization.

每个 Turn 仍须保留用户原始请求和 global rules 原文；目标 Group rules 只在目标工作 Session
中生效，不被合并成管家的全局隐藏规则。

工具按职责分组：

- Goal：读取、提议创建或修订、链接 Evidence；
- Global Session：搜索、读取、创建、Queue、Steer、Interrupt、Stop；
- Continuation：登记、列出、取消、替代；
- Source：读取原始消息、Turn 结果和当前 revision。

工具描述承担结构与约束，Prompt 不重复完整工作流。所有工具结果使用 ID 和小型摘要返回，
更深内容由 Agent 按需读取。

## 13. 交付与验证

非功能要求、MVP 边界、端到端验收、成功指标、风险、发布阶段、待验证问题和研究来源见
[《全局管家心流模式 PRD：交付附录》](global-steward-flow-mode-prd-delivery.md)。
