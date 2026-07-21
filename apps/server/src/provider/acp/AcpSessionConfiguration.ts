import { Deferred, Effect, Option, Ref, Schema } from "effect";
import type * as EffectAcpClient from "effect-acp/client";
import * as EffectAcpErrors from "effect-acp/errors";
import * as EffectAcpSchema from "effect-acp/schema";

import {
  collectSessionConfigOptionValues,
  findSessionConfigOption,
  type AcpSessionModeState,
} from "./AcpRuntimeModel.ts";

const CONFIG_OPTION_UPDATE_TIMEOUT = "5 seconds";

type ConfigOptionUpdateWaiter = {
  readonly configId: string;
  readonly value: string | boolean;
  readonly deferred: Deferred.Deferred<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>;
};

type RunLoggedRequest = <A>(
  method: string,
  payload: unknown,
  effect: Effect.Effect<A, EffectAcpErrors.AcpError>,
) => Effect.Effect<A, EffectAcpErrors.AcpError>;

export interface AcpSessionConfigController {
  readonly rememberConfigOptions: (
    configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  ) => Effect.Effect<void>;
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<EffectAcpSchema.SetSessionConfigOptionResponse, EffectAcpErrors.AcpError>;
  readonly setMode: (
    modeId: string,
  ) => Effect.Effect<EffectAcpSchema.SetSessionModeResponse, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
}

export function makeAcpSessionConfigController(input: {
  readonly acp: Pick<EffectAcpClient.AcpClientShape, "raw">;
  readonly configOptionsRef: Ref.Ref<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>;
  readonly modeStateRef: Ref.Ref<AcpSessionModeState | undefined>;
  readonly getStartedState: Effect.Effect<
    { readonly sessionId: string; readonly modelConfigId: string | undefined },
    EffectAcpErrors.AcpError
  >;
  readonly runLoggedRequest: RunLoggedRequest;
}): Effect.Effect<AcpSessionConfigController> {
  return Effect.gen(function* () {
    const updateWaitersRef = yield* Ref.make<ReadonlyArray<ConfigOptionUpdateWaiter>>([]);

    const resolveUpdateWaiters = (
      configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
    ): Effect.Effect<void> =>
      Ref.modify(updateWaitersRef, (waiters) => {
        const resolved: ConfigOptionUpdateWaiter[] = [];
        const pending: ConfigOptionUpdateWaiter[] = [];
        for (const waiter of waiters) {
          const configOption = findSessionConfigOption(configOptions, waiter.configId);
          if (configOption && configOptionCurrentValueMatches(configOption, waiter.value)) {
            resolved.push(waiter);
          } else {
            pending.push(waiter);
          }
        }
        return [resolved, pending] as const;
      }).pipe(
        Effect.flatMap((waiters) =>
          Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter.deferred, configOptions), {
            discard: true,
          }),
        ),
      );

    const rememberConfigOptions = (
      configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
    ): Effect.Effect<void> =>
      Ref.set(input.configOptionsRef, configOptions).pipe(
        Effect.andThen(resolveUpdateWaiters(configOptions)),
      );

    const validateConfigOptionValue = (
      configId: string,
      value: string | boolean,
    ): Effect.Effect<void, EffectAcpErrors.AcpError> =>
      Effect.gen(function* () {
        const configOption = findSessionConfigOption(
          yield* Ref.get(input.configOptionsRef),
          configId,
        );
        if (!configOption) return;
        if (configOption.type === "boolean") {
          if (typeof value === "boolean") return;
          return yield* new EffectAcpErrors.AcpRequestError({
            code: -32602,
            errorMessage: `Invalid value ${JSON.stringify(value)} for session config option "${configOption.id}": expected boolean`,
            data: {
              configId: configOption.id,
              expectedType: "boolean",
              receivedValue: value,
            },
          });
        }
        if (typeof value !== "string") {
          return yield* new EffectAcpErrors.AcpRequestError({
            code: -32602,
            errorMessage: `Invalid value ${JSON.stringify(value)} for session config option "${configOption.id}": expected string`,
            data: {
              configId: configOption.id,
              expectedType: "string",
              receivedValue: value,
            },
          });
        }
        const allowedValues = collectSessionConfigOptionValues(configOption);
        if (allowedValues.includes(value)) return;
        return yield* new EffectAcpErrors.AcpRequestError({
          code: -32602,
          errorMessage: `Invalid value ${JSON.stringify(value)} for session config option "${configOption.id}": expected one of ${allowedValues.join(", ")}`,
          data: {
            configId: configOption.id,
            allowedValues,
            receivedValue: value,
          },
        });
      });

    const waitForConfigOptionUpdate = (
      configId: string,
      value: string | boolean,
    ): Effect.Effect<
      ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
      EffectAcpErrors.AcpError
    > =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>();
        const waiter: ConfigOptionUpdateWaiter = { configId, value, deferred };
        yield* Ref.update(updateWaitersRef, (waiters) => [...waiters, waiter]);

        const current = yield* Ref.get(input.configOptionsRef);
        const currentOption = findSessionConfigOption(current, configId);
        if (currentOption && configOptionCurrentValueMatches(currentOption, value)) {
          yield* Deferred.succeed(deferred, current);
        }

        const result = yield* Deferred.await(deferred).pipe(
          Effect.timeoutOption(CONFIG_OPTION_UPDATE_TIMEOUT),
          Effect.ensuring(
            Ref.update(updateWaitersRef, (waiters) =>
              waiters.filter((candidate) => candidate !== waiter),
            ),
          ),
        );
        if (Option.isNone(result)) {
          return yield* new EffectAcpErrors.AcpTransportError({
            detail:
              "ACP agent returned an empty session/set_config_option response without a matching config_option_update notification",
            cause: new Error(
              `Timed out waiting for config option ${JSON.stringify(configId)} to become ${JSON.stringify(value)}`,
            ),
          });
        }
        return result.value;
      });

    const updateConfigOptions = (
      response:
        | EffectAcpSchema.SetSessionConfigOptionResponse
        | EffectAcpSchema.LoadSessionResponse
        | EffectAcpSchema.NewSessionResponse
        | EffectAcpSchema.ResumeSessionResponse,
    ): Effect.Effect<void> =>
      Ref.set(input.configOptionsRef, sessionConfigOptionsFromSetup(response));

    const setConfigOption: AcpSessionConfigController["setConfigOption"] = (configId, value) =>
      validateConfigOptionValue(configId, value).pipe(
        Effect.flatMap(() => input.getStartedState),
        Effect.flatMap((started) =>
          Ref.get(input.configOptionsRef).pipe(
            Effect.flatMap((configOptions) => {
              const existing = findSessionConfigOption(configOptions, configId);
              if (existing && configOptionCurrentValueMatches(existing, value)) {
                return Effect.succeed({
                  configOptions,
                } satisfies EffectAcpSchema.SetSessionConfigOptionResponse);
              }
              const requestPayload =
                typeof value === "boolean"
                  ? ({
                      sessionId: started.sessionId,
                      configId,
                      type: "boolean",
                      value,
                    } satisfies EffectAcpSchema.SetSessionConfigOptionRequest)
                  : ({
                      sessionId: started.sessionId,
                      configId,
                      value: String(value),
                    } satisfies EffectAcpSchema.SetSessionConfigOptionRequest);
              return input
                .runLoggedRequest(
                  "session/set_config_option",
                  requestPayload,
                  input.acp.raw
                    .request("session/set_config_option", requestPayload)
                    .pipe(
                      Effect.flatMap((response) =>
                        decodeSetSessionConfigOptionResponse(
                          response,
                          waitForConfigOptionUpdate(configId, value),
                        ),
                      ),
                    ),
                )
                .pipe(Effect.tap((response) => updateConfigOptions(response)));
            }),
          ),
        ),
      );

    return {
      rememberConfigOptions,
      setConfigOption,
      setMode: (modeId) =>
        Ref.get(input.modeStateRef).pipe(
          Effect.flatMap((modeState) => {
            if (modeState?.currentModeId === modeId) {
              return Effect.succeed({} satisfies EffectAcpSchema.SetSessionModeResponse);
            }
            return Ref.get(input.configOptionsRef).pipe(
              Effect.map((options) =>
                options.find(
                  (option) =>
                    option.type === "select" &&
                    (option.category === "mode" || option.id === "mode") &&
                    flattenSessionConfigSelectOptions(option.options).some(
                      (entry) => entry.value === modeId,
                    ),
                ),
              ),
              Effect.flatMap((modeOption) => setConfigOption(modeOption?.id ?? "mode", modeId)),
              Effect.tap(() =>
                Ref.update(input.modeStateRef, (current) =>
                  current ? { ...current, currentModeId: modeId } : current,
                ),
              ),
              Effect.as({} satisfies EffectAcpSchema.SetSessionModeResponse),
            );
          }),
        ),
      setModel: (model) =>
        input.getStartedState.pipe(
          Effect.flatMap((started) => setConfigOption(started.modelConfigId ?? "model", model)),
          Effect.asVoid,
        ),
    };
  });
}

export function sessionConfigOptionsFromSetup(
  response:
    | { readonly configOptions?: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null }
    | undefined,
  fallback: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [],
): ReadonlyArray<EffectAcpSchema.SessionConfigOption> {
  return response?.configOptions ?? fallback;
}

function flattenSessionConfigSelectOptions(
  options:
    | ReadonlyArray<EffectAcpSchema.SessionConfigSelectOption>
    | ReadonlyArray<EffectAcpSchema.SessionConfigSelectGroup>,
): ReadonlyArray<EffectAcpSchema.SessionConfigSelectOption> {
  return options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

function configOptionCurrentValueMatches(
  configOption: EffectAcpSchema.SessionConfigOption,
  value: string | boolean,
): boolean {
  const currentValue = configOption.currentValue;
  if (configOption.type === "boolean") return currentValue === value;
  if (typeof currentValue !== "string") return false;
  return currentValue.trim() === String(value).trim();
}

export function decodeSetSessionConfigOptionResponse(
  response: unknown,
  configUpdate: Effect.Effect<
    ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
    EffectAcpErrors.AcpError
  >,
): Effect.Effect<EffectAcpSchema.SetSessionConfigOptionResponse, EffectAcpErrors.AcpError> {
  if (isEmptyRecord(response)) {
    return configUpdate.pipe(Effect.map((configOptions) => ({ configOptions })));
  }
  return Schema.decodeUnknownEffect(EffectAcpSchema.SetSessionConfigOptionResponse)(response).pipe(
    Effect.mapError(
      (cause) =>
        new EffectAcpErrors.AcpTransportError({
          detail: "ACP agent returned an invalid session/set_config_option response",
          cause,
        }),
    ),
  );
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
