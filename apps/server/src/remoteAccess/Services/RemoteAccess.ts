import type { RemoteAccessStatus } from "@agent-group/contracts";
import { Data, ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export class RemoteAccessError extends Data.TaggedError("RemoteAccessError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface RemoteAccessShape {
  readonly start: Effect.Effect<void, RemoteAccessError, Scope.Scope>;
  readonly getStatus: Effect.Effect<RemoteAccessStatus>;
  readonly restart: Effect.Effect<RemoteAccessStatus, RemoteAccessError>;
  readonly reset: Effect.Effect<RemoteAccessStatus, RemoteAccessError>;
}

export class RemoteAccess extends ServiceMap.Service<RemoteAccess, RemoteAccessShape>()(
  "agent-group/remoteAccess/Services/RemoteAccess",
) {}
