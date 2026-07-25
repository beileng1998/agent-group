# 内嵌 Agent Terminal 重做方案（Redo）

| 项目 | 内容 |
| --- | --- |
| 状态 | Redo 计划，Phase 0 进行中 |
| 日期 | 2026-07-25 |
| 前版 | `archive/managed-tui-20260725` 分支（含设计文档与全部实现，已回滚） |
| 研究基准 | Orca `8a23618`（MIT, © 2026 Lovecast Inc.） |

## 1. 为什么重做

前版（8f5d4053..25fd04ff，14 commits，约 14k 行）审计结论 No-Go，根因是方案性的：

**execution adapter 维度没有收敛在单一边界，渗漏进几十个编排调用点。**
模型更新走 `thread.meta.update` 可绕过 coordinator 再起一个 structured runtime；generic
stop、thread deletion 各自旁路；adapter 切换原子性依赖 terminal 私有锁；事件合流处无
epoch 校验；Web 端自研 sequence 状态机存在无限快照循环；服务端快照依赖 xterm 私有
API。后期修复（executionAdapterBoundary / runtimeGeneration 等）是在事后补边界，证明
边界不是设计时唯一的门。

产品定义（Chat/Terminal 双 surface、同一 workspace、hook 注入 context、原版 TUI、
Turn 边界切换）不变，继续有效。推翻的是集成方式与实现路线。

## 2. 原则

1. **单一边界**：所有 thread 级 runtime 操作（start/stop/delete/meta update/switch）
   只经过一个 admission 点；事件从进入系统起携带 runtime epoch，stale 即拒。
2. **渲染与屏幕状态全部交给成熟库**：Web 用 `@xterm/xterm`；服务端屏幕模型用
   `@xterm/headless` + `@xterm/addon-serialize` 公开 API。不自研 ANSI 解析、屏幕
   buffer、sequence 状态机。xterm 非公开 API 仅允许 capability-guarded 读取且有公开
   回退（writeSync、DECSC register——沿用 orca 的带守卫模式）。
3. **一次一家 provider**：一家通过全部共同验收后才接下一家。三家全过前 feature
   flag 默认关闭。
4. **复用 orca 代码做终端宿主层**（MIT）：vendor terminal-host 切片，不自己发明
   attach/snapshot/seq 协议；不搬运 orca 的 Electron/daemon 进程架构。

## 3. 分层与分工

```text
我们写的                                库 / vendored 代码做的
─────────────────────────────────────   ─────────────────────────────────
hooks（context 注入）/ bridge           xterm.js：ANSI 解析、屏幕 buffer、
编排单一 admission 边界                  模式追踪、序列化、scrollback
PTY 生命周期（node-pty spawn/kill）     orca terminal-host 切片：headless
Turn / transcript / context 语义         emulator、snapshot、escape tail、
                                        mode rehydrate、absolute cursor
```

attach 协议只剩一条规则：客户端丢弃 `seq <= snapshotSeq` 的字节。不存在 Web 端
sequence 状态机。

## 4. Phase 拆分

### Phase 0 — 终端宿主核心（不碰编排，进行中）

- vendor orca 切片到 `apps/server/src/terminalHost/`（清单与裁剪见 §5）；
- 新增 `TerminalHost`：createOrAttach（稳定 sessionId + generation epoch）、
  attach（返回 `{snapshot, outputSequence}`，snapshot 来自 SerializeAddon）、
  write/resize/kill（generation 校验 + 进程组 teardown，复用 processTreeKiller）；
- 补依赖 `@xterm/addon-serialize`、`@xterm/addon-unicode11`（与 Web 端对齐）；
- 交付物：隔离的 Effect service + 聚焦测试（create-or-attach、快照/序号去重、
  stale generation 拒绝、teardown 杀进程组、alt-screen rehydrate、escape tail）。
- 普通 shell terminal 行为完全不变。

### Phase 1 — 单一边界 + Codex 垂直切片

- 编排 admission 单点：所有 runtime 操作经一个 coordinator；事件携带 epoch；
  composer dispatch 断言 structured，hook bridge 断言 terminal + generation；
- 回收 archive 分支资产：context envelope builder 拆分、Codex hook shim、
  bridge server（unix socket + token）、capability probe；
- TerminalHost 接入 ws/contracts，Web 端为纯 view（live write + attach 重放）；
- adapter 切换只在 Turn 边界，补偿恢复可观测。

### Phase 2 — Claude / Pi

逐一接入；每家必须通过前版设计文档 §11 的共同验收才开下一家。

### Phase 3 — GA

跨平台 socket、hook spool/replay、server 重启恢复（provider session resume）、
长时间 detach 压测；三家全过后才讨论默认开启。

## 5. Vendoring 清单（orca `8a23618` → `apps/server/src/terminalHost/`）

原样保留（仅改 import 路径）：

- `xterm-env-polyfill.ts` — 非浏览器环境 window polyfill（Bun/Node 必需）；
- `terminal-partial-escape-tail.ts` — chunk 边界残缺转义序列跟踪（Bug E 类）；
- `terminal-serialize-absolute-cursor.ts` — 绝对 CUP 修正 + DECSC 寄存器搬运；
- `terminal-mouse-mode-mirror.ts` — DECSET 鼠标协议/编码镜像；
- `terminal-mode-rehydrate-sequences.ts` — 快照恢复时的模式重放序列；
- `terminal-snapshot-ansi-buffers.ts` — alt-screen 时 normal/alt 缓冲拆分；
- `terminal-modes.ts` / `terminal-snapshot.ts` — 类型。

裁剪后保留：

- `headless-emulator.ts` — 删除 OSC cwd/title scanner、OSC links、view-attribute
  responder、ConPTY DA1、kitty keyboard、orca unicode provider；保留
  Terminal+Serialize+Unicode11、write/guarded writeSync、resize、getSnapshot、
  getVisibleLines、clearScrollback、dispose。
- `terminal-snapshot.ts` 类型删除 oscLinks/cwd/lastTitle 字段（对应 scanner 已删）；
  `outputSequence` 改为必填。

不 vendor（用本项目现有实现或不需要）：Session/pty-subprocess/daemon 协议、
shell-ready barrier、WSL/PowerShell env、history manager（现有 TerminalManager 已覆盖
spawn/env/history）；generations/tombstones 语义以 ~50 行移植进 TerminalHost。

每个 vendored 文件头部标注来源与 commit；署名与许可证见
`apps/server/src/terminalHost/NOTICE.md`。

## 6. 验收门（每个 Phase 出口）

- P0：上述聚焦测试全绿；代码库无对 xterm 非公开 API 的无守卫引用；
  现有 terminal 测试不回归。
- P1：Codex 通过前版设计文档 §11 全部共同验收；模拟审计的五个 No-Go 场景
  （meta.update 旁路、非原子切换、deletion 旁路、无 epoch 事件、快照循环）
  各有针对性测试证明不存在。
- P2/P3：同前版设计文档 §11 + Phase C 可靠性项。
