// FILE: resilientRpcSocketProtocol.ts
// Purpose: Effect RPC socket protocol with a weak-network heartbeat policy.
// Layer: Web transport infrastructure
// Exports: layerResilientRpcSocketProtocol.

import { Cause, Effect, Latch, Layer, Result } from "effect";
import { RpcClient, RpcClientError, RpcMessage, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

const PING_INTERVAL = "10 seconds";
const MISSED_PONGS_BEFORE_TIMEOUT = 3;

// Effect's stock socket protocol fails after one missed 5-second pong and then
// retries inside the protocol. Mobile recovery is owned by WsTransportSession,
// so this layer only supplies a longer liveness window and reports one failure.
const makePinger = Effect.fnUntraced(function* <A, E, R>(writePing: Effect.Effect<A, E, R>) {
  let receivedPong = true;
  let missedPongs = 0;
  const timedOut = Latch.makeUnsafe();

  const reset = () => {
    receivedPong = true;
    missedPongs = 0;
    timedOut.closeUnsafe();
  };
  const onPong = () => {
    receivedPong = true;
    missedPongs = 0;
  };

  yield* Effect.suspend((): Effect.Effect<void, E, R> => {
    if (!receivedPong) {
      missedPongs += 1;
      if (missedPongs >= MISSED_PONGS_BEFORE_TIMEOUT) {
        timedOut.openUnsafe();
        return Effect.void;
      }
    }
    receivedPong = false;
    return Effect.asVoid(writePing);
  }).pipe(
    Effect.delay(PING_INTERVAL),
    Effect.ignore,
    Effect.forever,
    Effect.interruptible,
    Effect.forkScoped,
  );

  return { timeout: timedOut.await, reset, onPong } as const;
});

const makeProtocol = RpcClient.Protocol.make(
  Effect.fnUntraced(function* (writeResponse) {
    const socket = yield* Socket.Socket;
    const serialization = yield* RpcSerialization.RpcSerialization;
    const write = yield* socket.writer;

    let parser = serialization.makeUnsafe();
    const pinger = yield* makePinger(write(parser.encode(RpcMessage.constPing)!));
    let currentError: RpcClientError.RpcClientError | undefined;

    yield* Effect.suspend(() => {
      parser = serialization.makeUnsafe();
      pinger.reset();
      currentError = undefined;

      return socket
        .runRaw(
          (message) => {
            try {
              const responses = parser.decode(message) as Array<RpcMessage.FromServerEncoded>;
              return Effect.forEach(
                responses,
                (response) => {
                  if (response._tag === "Pong") pinger.onPong();
                  return writeResponse(response);
                },
                { discard: true },
              );
            } catch (cause) {
              return writeResponse({
                _tag: "ClientProtocolError",
                error: new RpcClientError.RpcClientError({
                  reason: new RpcClientError.RpcClientDefect({
                    message: "Error decoding message",
                    cause,
                  }),
                }),
              });
            }
          },
          { onOpen: Effect.void },
        )
        .pipe(
          Effect.raceFirst(
            Effect.flatMap(pinger.timeout, () =>
              Effect.fail(
                new Socket.SocketError({
                  reason: new Socket.SocketOpenError({
                    kind: "Timeout",
                    cause: new Error("heartbeat timeout"),
                  }),
                }),
              ),
            ),
          ),
        );
    }).pipe(
      Effect.flatMap(() =>
        Effect.fail(
          new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) }),
        ),
      ),
      Effect.tapCause((cause) => {
        const error = Cause.findError(cause);
        const reason = Result.isSuccess(error)
          ? error.success.reason
          : new RpcClientError.RpcClientDefect({
              message: "Unknown socket error",
              cause: Cause.squash(cause),
            });
        currentError = new RpcClientError.RpcClientError({ reason });
        return writeResponse({ _tag: "ClientProtocolError", error: currentError });
      }),
      Effect.annotateLogs({ module: "RpcClient", method: "resilientSocket" }),
      Effect.forkScoped,
    );

    return {
      send(request: RpcMessage.FromClientEncoded) {
        if (currentError) return Effect.fail(currentError);
        const encoded = parser.encode(request);
        return encoded === undefined ? Effect.void : Effect.orDie(write(encoded));
      },
      supportsAck: true,
      supportsTransferables: false,
    };
  }),
);

export const layerResilientRpcSocketProtocol = Layer.effect(RpcClient.Protocol, makeProtocol);
