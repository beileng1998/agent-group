import { TurnId } from "@agent-group/contracts";
import { Effect } from "effect";

import { ProviderAdapterRequestError } from "./Errors.ts";
import type { PiAdapterShape } from "./Services/PiAdapter.ts";
import type { ProviderThreadSnapshot } from "./Services/ProviderAdapter.ts";
import { PROVIDER, type PiSessionContext, toMessage } from "./piAdapterCore.ts";
import type { makePiSessionRegistry } from "./piSessionRegistry.ts";
import { mapMessageHistory } from "./piToolProjection.ts";

type PiSessionRegistry = ReturnType<typeof makePiSessionRegistry>;

export function makePiThreadOperations(requireSession: PiSessionRegistry["requireSession"]) {
  const snapshotThread = (context: PiSessionContext): ProviderThreadSnapshot => {
    const historyItems = mapMessageHistory(context.runtime.session);
    const activeTurn = context.activeTurnId
      ? context.turns.find((turn) => turn.id === context.activeTurnId)
      : undefined;
    const turns = [
      ...(historyItems.length > 0
        ? [
            {
              id: TurnId.makeUnsafe(`pi-history-${context.runtime.session.sessionId}`),
              items: historyItems,
            },
          ]
        : []),
      ...(activeTurn ? [{ id: activeTurn.id, items: [...activeTurn.items] }] : []),
    ];
    return {
      threadId: context.session.threadId,
      ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
      turns:
        turns.length > 0
          ? turns
          : context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
    };
  };

  const readThread: PiAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(Effect.map(snapshotThread));

  const rollbackThread: PiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const nextLength = Math.max(0, context.turns.length - Math.max(0, numTurns));
      context.turns.splice(nextLength);
      const leafId = context.turns.at(-1)?.leafId;
      if (leafId) {
        context.runtime.session.sessionManager.branch(leafId);
      } else if (nextLength === 0) {
        context.runtime.session.sessionManager.resetLeaf();
      }
      return snapshotThread(context);
    });

  const compactThread: NonNullable<PiAdapterShape["compactThread"]> = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((context) =>
        Effect.tryPromise({
          try: () => context.runtime.session.compact(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "thread/compact",
              detail: toMessage(cause, "Failed to compact Pi thread."),
              cause,
            }),
        }),
      ),
      Effect.asVoid,
    );

  return { compactThread, readThread, rollbackThread };
}
