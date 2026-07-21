import type { ServerAuthDescriptor } from "@agent-group/contracts";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config";
import { isLoopbackHost, isWildcardHost } from "../../startupAccess";
import { ServerAuthPolicy, type ServerAuthPolicyShape } from "../Services/ServerAuthPolicy";
import { resolveSessionCookieName } from "../utils";

export const makeServerAuthPolicy = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const remoteReachable = isWildcardHost(config.host) || !isLoopbackHost(config.host);

  const policy: ServerAuthDescriptor["policy"] = !config.authToken
    ? "unsafe-no-auth"
    : config.mode === "desktop"
      ? remoteReachable
        ? "remote-reachable"
        : "desktop-managed-local"
      : remoteReachable
        ? "remote-reachable"
        : "loopback-browser";

  const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] =
    policy === "unsafe-no-auth"
      ? []
      : policy === "desktop-managed-local"
        ? ["desktop-bootstrap"]
        : config.mode === "desktop" && policy === "remote-reachable"
          ? ["desktop-bootstrap", "one-time-token"]
          : ["one-time-token"];

  const descriptor: ServerAuthDescriptor = {
    policy,
    bootstrapMethods,
    sessionMethods:
      policy === "unsafe-no-auth" ? [] : ["browser-session-cookie", "bearer-session-token"],
    sessionCookieName: resolveSessionCookieName(),
  };

  return {
    getDescriptor: () => Effect.succeed(descriptor),
  } satisfies ServerAuthPolicyShape;
});

export const ServerAuthPolicyLive = Layer.effect(ServerAuthPolicy, makeServerAuthPolicy);
