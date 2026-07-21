import { Cause, Effect } from "effect";

import type { AcpSessionRuntimeOptions } from "./acp/AcpSessionRuntime.ts";

export const GROK_ACP_TRANSPORT_DEBUG_MARKER = "grok-acp-meta-stripper-v2";
export const GROK_ACP_DEBUG_ENV = "AGENT_GROUP_GROK_ACP_DEBUG";
const AGENT_GROUP_GROK_ACP_DEBUG_ENV = "AGENT_GROUP_GROK_ACP_DEBUG";
const LEGACY_GROK_ACP_DEBUG_ENV = "DP_GROK_ACP_DEBUG";
const GROK_ACP_LOG_PAYLOAD_LIMIT = 4_000;

function summarizeGrokAcpLogPayload(payload: unknown): unknown {
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
  if (text.length <= GROK_ACP_LOG_PAYLOAD_LIMIT) return text;
  return `${text.slice(0, GROK_ACP_LOG_PAYLOAD_LIMIT)}... [truncated ${text.length - GROK_ACP_LOG_PAYLOAD_LIMIT} chars]`;
}

function summarizeGrokAcpRequestPayload(method: string, payload: unknown): unknown {
  return method === "session/prompt"
    ? "[redacted session/prompt payload]"
    : summarizeGrokAcpLogPayload(payload);
}

export function isGrokAcpDebugEnabled(): boolean {
  return (
    process.env[GROK_ACP_DEBUG_ENV] === "1" ||
    process.env[AGENT_GROUP_GROK_ACP_DEBUG_ENV] === "1" ||
    process.env[LEGACY_GROK_ACP_DEBUG_ENV] === "1"
  );
}

function shouldMirrorGrokAcpProtocolLog(event: {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed" | "dropped";
  readonly payload: unknown;
}): boolean {
  if (event.stage === "decode_failed" || event.stage === "dropped") return true;
  if (event.direction !== "incoming" || event.stage !== "raw") return false;
  const payload = summarizeGrokAcpLogPayload(event.payload);
  return (
    typeof payload === "string" &&
    (payload.includes("grokShell") || payload.includes("x.ai/fs_notify"))
  );
}

export function makeGrokAcpRuntimeLoggers(
  base: Pick<AcpSessionRuntimeOptions, "requestLogger" | "protocolLogging">,
): Pick<AcpSessionRuntimeOptions, "requestLogger" | "protocolLogging"> {
  const debugEnabled = isGrokAcpDebugEnabled();
  const requestLogger: AcpSessionRuntimeOptions["requestLogger"] =
    base.requestLogger || debugEnabled
      ? (event) =>
          Effect.gen(function* () {
            if (base.requestLogger) yield* base.requestLogger(event);
            if (debugEnabled && event.status === "failed") {
              yield* Effect.logWarning("grok.acp.request_failed", {
                marker: GROK_ACP_TRANSPORT_DEBUG_MARKER,
                method: event.method,
                payload: summarizeGrokAcpRequestPayload(event.method, event.payload),
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
              if (!debugEnabled || !shouldMirrorGrokAcpProtocolLog(event)) return;
              yield* Effect.logWarning("grok.acp.protocol", {
                marker: GROK_ACP_TRANSPORT_DEBUG_MARKER,
                direction: event.direction,
                stage: event.stage,
                payload: summarizeGrokAcpLogPayload(event.payload),
              });
            }),
        }
      : undefined;
  return {
    ...(requestLogger ? { requestLogger } : {}),
    ...(protocolLogging ? { protocolLogging } : {}),
  };
}
