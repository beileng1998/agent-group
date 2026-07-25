import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config";
import { ExecutionAdapterAuthority } from "../Services/ExecutionAdapterAuthority";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import {
  executionAdapterAuthorityPath,
  loadExecutionAdapterAuthority,
  writeExecutionAdapterAuthority,
} from "./executionAdapterAuthorityPersistence";

export const ExecutionAdapterAuthorityLive = Layer.effect(
  ExecutionAdapterAuthority,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const filePath = executionAdapterAuthorityPath(config.stateDir);
    const loaded = yield* Effect.promise(() =>
      loadExecutionAdapterAuthority(filePath),
    );
    if (loaded.cause !== null) {
      yield* Effect.logError("execution adapter authority snapshot was quarantined", {
        cause: loaded.cause,
        quarantinePath: loaded.quarantinePath,
      });
    }
    return yield* makeExecutionAdapterAuthority({
      initialStates: loaded.states,
      ...(loaded.authorityUnavailableReason
        ? { authorityUnavailableReason: loaded.authorityUnavailableReason }
        : {}),
      persist: (states) =>
        Effect.tryPromise(() =>
          writeExecutionAdapterAuthority(filePath, new Map(states)),
        ),
      now: () => new Date(),
    });
  }),
);
