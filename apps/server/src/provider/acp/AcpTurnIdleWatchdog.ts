/** Compatibility aliases for ACP providers; the watchdog is shared with Claude. */
export {
  evaluateTurnIdleTick as evaluateAcpTurnIdleTick,
  forkTurnIdleWatchdog as forkAcpTurnIdleWatchdog,
  resolveTurnIdleTimeoutMs as resolveAcpTurnIdleTimeoutMs,
} from "../turnIdleWatchdog.ts";
export type {
  TurnIdleTickDecision as AcpTurnIdleTickDecision,
  TurnIdleWatchdogParams as AcpTurnIdleWatchdogParams,
} from "../turnIdleWatchdog.ts";
