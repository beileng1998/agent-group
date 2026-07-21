/** Cursor ACP runtime construction and compatibility exports. */
import { Effect, Layer, Scope, ServiceMap } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";
import * as EffectAcpSchema from "effect-acp/schema";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";
import {
  CURSOR_AGENT_BROWSERLESS_ENV,
  buildCursorAgentCommand,
  type CursorAgentCommand,
  type CursorAgentCommandOptions,
} from "./CursorAcpCommand.ts";

export {
  buildCursorAcpModelDescriptorsFromAvailableModels,
  CURSOR_LIST_AVAILABLE_MODELS_METHOD,
  fetchCursorAcpModelDescriptors,
  parseCursorCliModelList,
  type CursorAcpAvailableModel,
} from "./CursorAcpModelCatalog.ts";
export { buildCursorAcpModelDescriptors } from "./CursorAcpModelDescriptors.ts";
export {
  applyCursorAcpModelSelection,
  type CursorAcpModelSelectionErrorContext,
} from "./CursorAcpModelSelection.ts";
export {
  flattenCursorAcpModelChoices,
  resolveCursorAcpBaseModelId,
  type CursorAcpModelChoice,
} from "./CursorAcpModelValues.ts";

export interface CursorAcpRuntimeCursorSettings {
  readonly apiEndpoint?: string;
  readonly binaryPath?: string;
}

export const CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES = {
  _meta: { parameterizedModelPicker: true },
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

export interface CursorAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined;
}

export function buildCursorAcpSpawnInput(
  cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined,
  cwd: string,
  commandOptions?: CursorAgentCommandOptions,
): AcpSpawnInput {
  const command = buildCursorAgentCommand(
    cursorSettings?.binaryPath,
    [...(cursorSettings?.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []), "acp"],
    commandOptions,
  );
  return {
    command: command.command,
    args: command.args,
    cwd,
    env: CURSOR_AGENT_BROWSERLESS_ENV,
  };
}

export function buildCursorCliModelListCommand(
  cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined,
  commandOptions?: CursorAgentCommandOptions,
): CursorAgentCommand {
  return buildCursorAgentCommand(
    cursorSettings?.binaryPath,
    [
      ...(cursorSettings?.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
      "models",
    ],
    commandOptions,
  );
}

export const makeCursorAcpRuntime = (
  input: CursorAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildCursorAcpSpawnInput(input.cursorSettings, input.cwd),
        authMethodId: "cursor_login",
        authenticateMeta: { headless: true },
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return ServiceMap.getUnsafe(acpContext, AcpSessionRuntime);
  });
