import type { ServerAuthDescriptor } from "@agent-group/contracts";
import { Effect, ServiceMap } from "effect";

export interface ServerAuthPolicyShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
}

export class ServerAuthPolicy extends ServiceMap.Service<ServerAuthPolicy, ServerAuthPolicyShape>()(
  "agent-group/auth/Services/ServerAuthPolicy",
) {}
