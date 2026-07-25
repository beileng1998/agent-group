# 内嵌 Agent Terminal：最终实现与合入说明

| 项目 | 内容 |
| --- | --- |
| 状态 | 实现完成，等待分支统一 PR |
| 日期 | 2026-07-25 |
| 前版归档 | `archive/managed-tui-20260725`（No-Go 实现，仅供追溯） |
| Orca 基准 | `8a23618310968bd3ab7ad37db89929414910d690` |
| 发布方式 | `enableManagedAgentTerminal` 默认关闭，按安装显式开启 |

## 1. 最终产品边界

Agent Terminal 是 Thread 的另一种 execution adapter，不是新的 Provider，也不是
第二套 Session。Chat 与 Terminal 共用同一个 Group workspace、Thread 历史、Turn
投影和 provider resume cursor；一个 Thread 在任一时刻只能由 structured 或 terminal
其中一个 adapter 持有执行权。

我们只维护：

- provider hooks / Pi extension，以及 Agent Group context 注入；
- 本机私有 bridge、adapter authority、Turn 编排和 PTY 生命周期；
- xterm attach/snapshot/sequence 的薄 glue。

屏幕状态、ANSI 解释、光标、alternate screen、Unicode 与 Web 绘制全部交给
`@xterm/headless`、`@xterm/addon-serialize`、`@xterm/addon-unicode11` 和
`@xterm/xterm`。生产代码不读取 xterm 私有字段，也没有自研 terminal renderer。

## 2. 运行时结构

```text
Provider CLI
  └─ hook / extension ── authenticated local bridge
                            ├─ context preparation
                            ├─ Turn/event projection
                            └─ durable resume cursor

ExecutionAdapterAuthority (durable, per Thread)
  ├─ structured claims / queued-turn leases
  ├─ terminal operation leases
  ├─ revision + generation event fence
  └─ transition / deletion tombstones
             │
ExecutionAdapterCoordinator
  ├─ suspend/finalize/resume structured runtime
  └─ spawn/stop/restart TerminalHost
             │
node-pty ── @xterm/headless snapshot ── WS snapshot-first stream
                                      └─ Web @xterm/xterm
```

所有会启动、停止或替换 provider runtime 的路径都经过同一 authority：
composer dispatch、queued Turn、compact、model/meta update、automation、generic stop、
thread deletion、Terminal start/restart/switch。Project workspace 变更与新 Thread
创建还共享 project gate，不能与同一 Project 的 Terminal launch 交叉。

## 3. 上版 No-Go 的封堵

| 风险 | 最终防线 |
| --- | --- |
| meta/model update 绕过 coordinator | command admission 在 dispatch 前持有 structured claim |
| 切换先写 terminal、后发现 structured Turn | transition lock 内先检查 live runtime，再原子抢占 authority；Turn start reservation 封住检查后的竞态 |
| deletion/stop 旁路 | durable deletion tombstone、claim drain、统一 teardown/finalize |
| provider 事件跨 epoch 写入 | ingestion 起点校验 `revision + generation`，stale 直接拒绝 |
| Web 无限快照/静默缺帧 | snapshot-first；重复序列忽略，只接受精确下一序列，forward gap 作废 epoch 并重新订阅 |
| server crash 后后台子进程残留 | POSIX 持久化 owner 与 process-group identity，恢复时验证、组杀并复查后才允许重启 |
| 长队列 claim 过期 | queue 接管后 claim 进入 leased 状态，直到 promotion/cancel/retry 才释放 |

## 4. Provider 适配

### Codex

- 使用原生 `SessionStart`、`UserPromptSubmit`、`SubagentStart`、`Stop` hooks；
- Codex 延迟到首次 prompt 才创建 provider thread；此前 authority 保持 `checking`，
  Web 显示 `Waiting for session`。首次 prompt 与 resume 后的首次 prompt 都先收到
  `SessionStart` 并完成握手，再进入 `UserPromptSubmit`，不能用启动超时误判失败；
- prompt 分为 prepare 与 `prompt-accepted` 两阶段，context 未进入 provider payload
  时 fail closed；
- 使用 provider thread ID 恢复；保留当前 model、reasoning effort 与 fast mode；
- 支持 Stop spool/replay，bridge 故障不会把未投影的 completion 当成成功。

### Claude Code

- 使用原生 lifecycle hooks 与 status-line hook；
- UserPromptSubmit 同样两阶段确认，Stop/StopFailure/SessionEnd 可 spool/replay；
- resume cursor、model、effort 与 permission mode 都由 hook 观察并持久化；
- background task / cron 未结束时不提前关闭 Agent Turn。

### Pi

- 私有 extension 拦截 input，在 `before_provider_request` 验证 context 后才接受 Turn；
- lifecycle spool 单文件上限 1 MiB、总量 8 MiB、最多 32 个文件，assistant 文本有
  明确截断标记；
- resume 文件必须是私有 managed session 目录中的常规文件，header `id` 必须与
  provider session ID 一致，header `cwd` 必须与 canonical workspace 一致；
- unmanaged input 与无 UI 的敏感 tool call 均 fail closed。

本地兼容 smoke 基准：Codex CLI `0.144.6`、Claude Code `2.1.220`、Pi `0.80.10`。
三者的 fail-closed smoke 都在故意拒绝 prompt acceptance 时保持零模型请求。

## 5. TerminalHost 与 Web

Orca MIT 代码仅用于 headless emulator、snapshot/mode rehydration、partial escape tail
和 absolute cursor 修正；来源、固定 commit 与完整许可证见
`apps/server/src/terminalHost/NOTICE.md` 和根目录 `THIRD_PARTY_NOTICES.md`。

TerminalHost 提供稳定 session ID、随机 generation、create-or-attach、write、resize、
snapshot 和可验证 teardown。每个 attach 先注册 output listener，再取得同一 emulator
队列上的 snapshot，因此不会出现 snapshot 与 live bytes 的空窗。服务端和 Web 端均有
按字节的 backlog 上限；溢出或序列缺口通过新 snapshot 恢复，而不是继续显示损坏屏幕。
PTY 启动后会先注册监听并暂存早期输出/退出，再执行 ownership capture；进程树扫描不在
输出热路径运行。

普通 shell Terminal 沿用原实现；Agent Terminal 的 session ID 有独立 namespace，
两者不会互相 attach 或 teardown。

## 6. 安全、恢复与资源上限

- bridge 只监听本机 Unix socket（目录 `0700`、socket `0600`），每个 runtime 使用
  256-bit bearer token；
- body 最大 1 MiB；每 runtime 最多 32 个并发请求、4 MiB pending body；
- 10 秒内最多 240 个请求，完整 header/body/handler deadline 为 7 秒；
- runtime/event ID 最长 128 字符；会进入公开 runtime state 的 provider 元数据最长
  512 字符；
- client 永远不能传 executable 或 argv；命令结构由已验证 driver 固定生成；
- runtime files、hooks、extensions、spool 和 recovery prompt 使用私有权限与原子写；
- startup 先恢复 durable authority 和旧 process group，再开放 command admission；
  repair、compact、automation run/cancel 都受同一 readiness barrier 保护；
- feature flag 在运行中关闭后，新的 prompt 与尚未 accepted 的 prompt 立即 fail
  closed；stop/session-end/get/subscribe/switch-to-chat 仍可用于安全清理。

## 7. 平台与发布策略

macOS 与 Linux 使用 POSIX process group 所有权验证。Windows 当前明确返回
unsupported：在 Job Object 或等价的稳定进程树身份落地前，不允许创建或重启 managed
Agent Terminal，避免 `taskkill /T` 在 PID 复用后杀到无关进程。普通 shell Terminal
不受影响；已有 durable terminal state 会在启动恢复中先验证并尝试清理，只有可证明
进程组已退出时才回到 structured，否则保留 error state 并 fail closed。

POSIX process group 能覆盖 Codex、Claude Code 与 Pi 的普通进程树；若后代主动
`setsid` 脱离原 PGID，则需要 cgroup、launchd 等 OS supervisor 才能在服务崩溃后继续
追踪。当前三家 CLI 不采用这种 daemon 模式。

`enableManagedAgentTerminal` 保持默认关闭。建议先在内部安装按 provider 小流量开启，
观察 probe、bridge、recovery 与 snapshot-resync 日志，再扩大范围。关闭开关后无需
迁移数据；重启会回收旧 PTY 并恢复 structured adapter。

## 8. 合入验收门

合入前必须同时满足：

- contracts、server、web 构建通过；
- architecture check 无新环、生产源码单文件不超过 500 行；
- authority/coordinator、queue lease、deletion、runtime fence、launch compensation、
  process-group crash recovery、三家 hook/driver、bridge limits、subscription
  backpressure 与 Web sequence-gap 聚焦测试通过；
- Chromium 中真实 xterm snapshot、reconnect、sequence gap、keyboard/query reply
  行为通过；
- 使用隔离 home、显式非默认端口启动 server/web，并在浏览器完成 default-off 与
  opt-in UI smoke；Codex 真实流程还需覆盖首次 prompt、stop、resume、再次 prompt
  与切回 Chat，并验证持久化 PGID 在 stop/switch 后不存在；
- `git diff --check` 通过，`.codex/` 及其他会话文件不进入提交。
