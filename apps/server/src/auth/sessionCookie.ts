import type { ServerAuthSessionMethod } from "@agent-group/contracts";
import { Clock, DateTime, Duration, Effect } from "effect";

import type { SessionCredentialServiceShape } from "./Services/SessionCredentialService";

const SESSION_RENEWAL_WINDOW = Duration.days(7);

export function encodeSessionCookie(input: {
  readonly name: string;
  readonly value: string;
  readonly expiresAt: DateTime.DateTime;
}): string {
  return `${encodeURIComponent(input.name)}=${encodeURIComponent(input.value)}; Expires=${DateTime.toDate(input.expiresAt).toUTCString()}; HttpOnly; Path=/; SameSite=Strict`;
}

export function shouldRenewSessionCookie(expiresAtMs: number, nowMs: number): boolean {
  return (
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > nowMs &&
    expiresAtMs - nowMs <= Duration.toMillis(SESSION_RENEWAL_WINDOW)
  );
}

export const maybeRenewSessionCookie = Effect.fn(function* (input: {
  readonly cookieToken: string | undefined;
  readonly sessionMethod: ServerAuthSessionMethod | undefined;
  readonly expiresAtMs: number;
  readonly sessions: Pick<SessionCredentialServiceShape, "renew">;
}) {
  if (!input.cookieToken || input.sessionMethod !== "browser-session-cookie") return null;
  const nowMs = yield* Clock.currentTimeMillis;
  if (!shouldRenewSessionCookie(input.expiresAtMs, nowMs)) return null;
  return yield* input.sessions.renew(input.cookieToken);
});
