import type {
  ProviderComposerCapabilities,
  ProviderListModelsResult,
  ProviderListPluginsResult,
  ProviderListSkillsResult,
  ProviderReadPluginResult,
  ServerVoiceTranscriptionResult,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type { CodexAppServerManager } from "../codexAppServerManager.ts";
import { codexUserFacingErrorMessage as toMessage } from "../codexErrorClassification.ts";
import { asObject, codexHomePathFromRuntimePayload } from "./codexEventValues.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";
import { findCodexTranscriptPath } from "./ProviderTranscriptPaths.ts";
import type { CodexAdapterShape } from "./Services/CodexAdapter.ts";

const PROVIDER = "codex" as const;

export function makeCodexCapabilityBridge(manager: CodexAppServerManager) {
  const getComposerCapabilities: NonNullable<CodexAdapterShape["getComposerCapabilities"]> = () =>
    Effect.succeed(manager.getComposerCapabilities() satisfies ProviderComposerCapabilities);

  const listSkills: NonNullable<CodexAdapterShape["listSkills"]> = (input) =>
    Effect.tryPromise({
      try: () =>
        manager.listSkills({
          cwd: input.cwd,
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
          ...(input.forceReload !== undefined ? { forceReload: input.forceReload } : {}),
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "skills/list",
          detail: toMessage(cause, "skills/list failed"),
          cause,
        }),
    }).pipe(Effect.map((result) => result satisfies ProviderListSkillsResult));

  const listPlugins: NonNullable<CodexAdapterShape["listPlugins"]> = (input) =>
    Effect.tryPromise({
      try: () =>
        manager.listPlugins({
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
          ...(input.forceRemoteSync !== undefined
            ? { forceRemoteSync: input.forceRemoteSync }
            : {}),
          ...(input.forceReload !== undefined ? { forceReload: input.forceReload } : {}),
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "plugin/list",
          detail: toMessage(cause, "plugin/list failed"),
          cause,
        }),
    }).pipe(Effect.map((result) => result satisfies ProviderListPluginsResult));

  const readPlugin: NonNullable<CodexAdapterShape["readPlugin"]> = (input) =>
    Effect.tryPromise({
      try: () =>
        manager.readPlugin({
          marketplacePath: input.marketplacePath,
          pluginName: input.pluginName,
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "plugin/read",
          detail: toMessage(cause, "plugin/read failed"),
          cause,
        }),
    }).pipe(Effect.map((result) => result satisfies ProviderReadPluginResult));

  const listModels: NonNullable<CodexAdapterShape["listModels"]> = () =>
    Effect.tryPromise({
      try: () => manager.listModels(),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "model/list",
          detail: toMessage(cause, "model/list failed"),
          cause,
        }),
    }).pipe(Effect.map((result) => result satisfies ProviderListModelsResult));

  const transcribeVoice: NonNullable<CodexAdapterShape["transcribeVoice"]> = (input) =>
    Effect.tryPromise({
      try: () => manager.transcribeVoice(input),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "voice/transcribe",
          detail: toMessage(cause, "voice/transcribe failed"),
          cause,
        }),
    }).pipe(Effect.map((result) => result satisfies ServerVoiceTranscriptionResult));

  const resolveTranscriptPath: NonNullable<CodexAdapterShape["resolveTranscriptPath"]> = (
    input,
  ) => {
    const providerThreadId = asObject(input.resumeCursor)?.threadId;
    if (typeof providerThreadId !== "string") return Effect.succeed(null);
    const homePath = codexHomePathFromRuntimePayload(input.runtimePayload);
    return Effect.promise(() =>
      findCodexTranscriptPath({
        providerThreadId,
        ...(homePath ? { homePath } : {}),
      }),
    );
  };

  return {
    getComposerCapabilities,
    listModels,
    listPlugins,
    listSkills,
    readPlugin,
    resolveTranscriptPath,
    transcribeVoice,
  };
}
