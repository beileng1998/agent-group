import { Effect, Fiber, Scope } from "effect";

export interface TurnIdleWatchdogParams {
  readonly idleTimeoutMs: number;
  readonly currentIdleTimeoutMs?: () => number;
  readonly checkIntervalMs: number;
  readonly isTurnActive: () => boolean;
  readonly isAwaitingHuman: () => boolean;
  readonly lastActivityAt: () => number;
  readonly touchActivity: () => void;
  readonly onIdleTimeout: (idleMs: number) => Effect.Effect<void>;
}

export type TurnIdleTickDecision = "stop" | "touch" | "timeout" | "continue";

export function evaluateTurnIdleTick(input: {
  readonly isTurnActive: boolean;
  readonly isAwaitingHuman: boolean;
  readonly idleMs: number;
  readonly idleTimeoutMs: number;
}): TurnIdleTickDecision {
  if (!input.isTurnActive) return "stop";
  if (input.isAwaitingHuman) return "touch";
  return input.idleMs >= input.idleTimeoutMs ? "timeout" : "continue";
}

export function resolveTurnIdleTimeoutMs(input: {
  readonly envVar: string;
  readonly defaultMs: number;
  readonly env?: NodeJS.ProcessEnv;
}): number {
  const raw = (input.env ?? process.env)[input.envVar]?.trim();
  if (!raw) return input.defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : input.defaultMs;
}

export function runTurnIdleWatchdog(params: TurnIdleWatchdogParams): Effect.Effect<void> {
  return Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(params.checkIntervalMs);
      const idleMs = Date.now() - params.lastActivityAt();
      const idleTimeoutMs = params.currentIdleTimeoutMs?.() ?? params.idleTimeoutMs;
      const decision = evaluateTurnIdleTick({
        isTurnActive: params.isTurnActive(),
        isAwaitingHuman: params.isAwaitingHuman(),
        idleMs,
        idleTimeoutMs,
      });
      if (decision === "stop") return;
      if (decision === "touch") {
        params.touchActivity();
        continue;
      }
      if (decision === "timeout") {
        yield* params.onIdleTimeout(idleMs);
        return;
      }
    }
  });
}

export const forkTurnIdleWatchdog = (
  params: TurnIdleWatchdogParams & { readonly scope: Scope.Closeable },
): Effect.Effect<Fiber.Fiber<void>> => runTurnIdleWatchdog(params).pipe(Effect.forkIn(params.scope));
