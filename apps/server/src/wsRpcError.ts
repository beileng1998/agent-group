import { WsRpcError } from "@agent-group/contracts";
import { Cause, Schema } from "effect";

function errorMessage(cause: unknown, fallbackMessage: string) {
  if (
    Cause.isUnknownError(cause) &&
    cause.cause instanceof Error &&
    cause.cause.message.length > 0
  ) {
    return cause.cause.message;
  }
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallbackMessage;
}

export function toWsRpcError(cause: unknown, fallbackMessage: string) {
  return Schema.is(WsRpcError)(cause)
    ? cause
    : new WsRpcError({
        message: errorMessage(cause, fallbackMessage),
        cause,
      });
}
