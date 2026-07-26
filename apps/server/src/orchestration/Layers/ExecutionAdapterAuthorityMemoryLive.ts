import { Effect, Layer } from "effect";

import { ExecutionAdapterAuthority } from "../Services/ExecutionAdapterAuthority";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";

export const ExecutionAdapterAuthorityMemoryLive = Layer.effect(
  ExecutionAdapterAuthority,
  makeExecutionAdapterAuthority({
    persist: () => Effect.void,
    now: () => new Date(),
  }),
);
