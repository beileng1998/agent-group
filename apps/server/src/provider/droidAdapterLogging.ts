import { Cause, Effect } from "effect";

import type { AcpSessionRuntimeOptions } from "./acp/AcpSessionRuntime.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";

const PROVIDER = "droid" as const;
export const DROID_ACP_TRANSPORT_DEBUG_MARKER = "droid-acp-meta-stripper-v2";
const DROID_ACP_LOG_PAYLOAD_LIMIT = 4_000;
export const DROID_ACP_DEBUG_ENV = "AGENT_GROUP_DROID_ACP_DEBUG";
const LEGACY_DROID_ACP_DEBUG_ENV = "DP_DROID_ACP_DEBUG";
export const DROID_ACP_REQUEST_TIMEOUT_MS = 30_000;

function summarizeDroidAcpLogPayload(payload: unknown): unknown {
  const text =
    typeof payload === "string"
      ? payload
      : (() => {
          try {
            return JSON.stringify(payload, null, 2);
          } catch {
            return String(payload);
          }
        })();
  if (text.length <= DROID_ACP_LOG_PAYLOAD_LIMIT) return text;
  return `${text.slice(0, DROID_ACP_LOG_PAYLOAD_LIMIT)}... [truncated ${text.length - DROID_ACP_LOG_PAYLOAD_LIMIT} chars]`;
}

function summarizeDroidAcpRequestPayload(method: string, payload: unknown): unknown {
  return method === "session/prompt"
    ? "[redacted session/prompt payload]"
    : summarizeDroidAcpLogPayload(payload);
}

export function droidAcpTimeoutError(method: string): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `Droid ACP did not respond to ${method} within ${DROID_ACP_REQUEST_TIMEOUT_MS / 1000}s.`,
  });
}

export function isDroidAcpDebugEnabled(): boolean {
  return (
    process.env[DROID_ACP_DEBUG_ENV] === "1" || process.env[LEGACY_DROID_ACP_DEBUG_ENV] === "1"
  );
}

function shouldMirrorDroidAcpProtocolLog(event: {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed" | "dropped";
  readonly payload: unknown;
}): boolean {
  if (event.stage === "decode_failed" || event.stage === "dropped") return true;
  if (event.direction !== "incoming" || event.stage !== "raw") return false;
  const payload = summarizeDroidAcpLogPayload(event.payload);
  return typeof payload === "string" && payload.includes("droidShell");
}

export function makeDroidAcpRuntimeLoggers(
  base: Pick<AcpSessionRuntimeOptions, "requestLogger" | "protocolLogging">,
): Pick<AcpSessionRuntimeOptions, "requestLogger" | "protocolLogging"> {
  const debugEnabled = isDroidAcpDebugEnabled();
  const requestLogger: AcpSessionRuntimeOptions["requestLogger"] =
    base.requestLogger || debugEnabled
      ? (event) =>
          Effect.gen(function* () {
            if (base.requestLogger) yield* base.requestLogger(event);
            if (debugEnabled && event.status === "failed") {
              yield* Effect.logWarning("droid.acp.request_failed", {
                marker: DROID_ACP_TRANSPORT_DEBUG_MARKER,
                method: event.method,
                payload: summarizeDroidAcpRequestPayload(event.method, event.payload),
                cause: event.cause ? Cause.pretty(event.cause) : undefined,
              });
            }
          })
      : undefined;
  const protocolLogging: AcpSessionRuntimeOptions["protocolLogging"] =
    base.protocolLogging || debugEnabled
      ? {
          logIncoming: base.protocolLogging?.logIncoming ?? debugEnabled,
          logOutgoing: base.protocolLogging?.logOutgoing ?? false,
          logger: (event) =>
            Effect.gen(function* () {
              if (base.protocolLogging?.logger) yield* base.protocolLogging.logger(event);
              if (!debugEnabled || !shouldMirrorDroidAcpProtocolLog(event)) return;
              yield* Effect.logWarning("droid.acp.protocol", {
                marker: DROID_ACP_TRANSPORT_DEBUG_MARKER,
                direction: event.direction,
                stage: event.stage,
                payload: summarizeDroidAcpLogPayload(event.payload),
              });
            }),
        }
      : undefined;
  return {
    ...(requestLogger ? { requestLogger } : {}),
    ...(protocolLogging ? { protocolLogging } : {}),
  };
}
