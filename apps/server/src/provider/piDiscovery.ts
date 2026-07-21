import {
  type ProviderComposerCapabilities,
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  type ProviderListSkillsResult,
  ThreadId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { ProviderAdapterRequestError } from "./Errors.ts";
import type { PiAdapterShape } from "./Services/PiAdapter.ts";
import {
  DEFAULT_PI_THINKING_LEVEL,
  PROVIDER,
  getPiSupportedThinkingOptions,
  loadPiCodingAgentModule,
  type PiCodingAgentModule,
  type PiSessionContext,
  toMessage,
  trimToUndefined,
} from "./piAdapterCore.ts";
import { makeAgentDir } from "./piExtensionUi.ts";
import { getPiDiscoverableModels, getPiProviderDisplayName } from "./piModelRuntime.ts";

export function makePiDiscovery(input: {
  readonly defaultCwd: string;
  readonly sessions: Map<ThreadId, PiSessionContext>;
}) {
  const { sessions } = input;
  const serverConfig = { cwd: input.defaultCwd };
  const listModels: NonNullable<PiAdapterShape["listModels"]> = (input) =>
    Effect.tryPromise({
      try: async () => {
        const piSdk = await loadPiCodingAgentModule();
        const agentDir = makeAgentDir(input.agentDir, piSdk);
        const cwd = trimToUndefined(input.cwd) ?? serverConfig.cwd;
        const services = await piSdk.createAgentSessionServices({
          cwd,
          agentDir,
        });
        const extensionCount = services.resourceLoader.getExtensions().extensions.length;
        const models = (await getPiDiscoverableModels(services.modelRuntime)).map((model) => {
          const supportedThinkingOptions = getPiSupportedThinkingOptions(model);
          return {
            slug: `${model.provider}/${model.id}`,
            name: model.name,
            upstreamProviderId: model.provider,
            upstreamProviderName: getPiProviderDisplayName(services.modelRuntime, model.provider),
            ...(supportedThinkingOptions.length > 0
              ? {
                  supportedReasoningEfforts: supportedThinkingOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                    description: option.description,
                  })),
                  ...(supportedThinkingOptions.some(
                    (option) => option.value === DEFAULT_PI_THINKING_LEVEL,
                  )
                    ? { defaultReasoningEffort: DEFAULT_PI_THINKING_LEVEL }
                    : {}),
                }
              : {}),
          };
        });
        return {
          models,
          source: extensionCount > 0 ? "pi.sdk+extensions" : "pi.sdk",
          cached: false,
        } satisfies ProviderListModelsResult;
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "model/list",
          detail: toMessage(cause, "Failed to list Pi models."),
          cause,
        }),
    });

  const listSkills: NonNullable<PiAdapterShape["listSkills"]> = (input) =>
    Effect.tryPromise({
      try: async () => {
        const active = input.threadId
          ? sessions.get(ThreadId.makeUnsafe(input.threadId))
          : undefined;
        const loader = active?.runtime.session.resourceLoader;
        if (active && input.forceReload) {
          await active.runtime.session.reload();
        }
        let services:
          | Awaited<ReturnType<PiCodingAgentModule["createAgentSessionServices"]>>
          | undefined;
        if (!loader) {
          const piSdk = await loadPiCodingAgentModule();
          services = await piSdk.createAgentSessionServices({
            cwd: input.cwd,
            agentDir: makeAgentDir(input.agentDir, piSdk),
          });
        }
        if (services && input.forceReload) {
          await services.resourceLoader.reload();
        }
        const resourceLoader = loader ?? services?.resourceLoader;
        if (!resourceLoader) {
          throw new Error("Failed to create Pi resource loader.");
        }
        const result = resourceLoader.getSkills();
        return {
          skills: result.skills.map((skill) => {
            const description = trimToUndefined(skill.description);
            const scope = trimToUndefined(skill.sourceInfo.source);
            return {
              name: skill.name,
              ...(description ? { description } : {}),
              path: skill.filePath,
              enabled: !skill.disableModelInvocation,
              ...(scope ? { scope } : {}),
            };
          }),
          source: "pi.sdk",
          cached: false,
        } satisfies ProviderListSkillsResult;
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "skill/list",
          detail: toMessage(cause, "Failed to list Pi skills."),
          cause,
        }),
    });

  const listCommands: NonNullable<PiAdapterShape["listCommands"]> = (input) =>
    Effect.tryPromise({
      try: async () => {
        const active = input.threadId
          ? sessions.get(ThreadId.makeUnsafe(input.threadId))
          : undefined;
        const session = active?.runtime.session;
        const reloadCommand = {
          name: "reload",
          description: "Reload Pi extensions, skills, prompts, themes, tools, and settings",
        };
        if (session) {
          if (input.forceReload) {
            await session.reload();
          }
          const extensionCommands = session.extensionRunner
            .getRegisteredCommands()
            .map((command) => ({
              name: command.invocationName,
              description: trimToUndefined(command.description) ?? "Extension command",
            }));
          const promptCommands = session.promptTemplates.map((template) => ({
            name: template.name,
            description: trimToUndefined(template.description) ?? "Prompt template",
          }));
          const skillCommands = session.resourceLoader.getSkills().skills.map((skill) => ({
            name: `skill:${skill.name}`,
            description: trimToUndefined(skill.description) ?? "Skill",
          }));
          return {
            commands: [reloadCommand, ...extensionCommands, ...promptCommands, ...skillCommands],
            source: "pi.sdk",
            cached: false,
          } satisfies ProviderListCommandsResult;
        }
        const piSdk = await loadPiCodingAgentModule();
        const services = await piSdk.createAgentSessionServices({
          cwd: input.cwd,
          agentDir: makeAgentDir(input.agentDir, piSdk),
        });
        if (input.forceReload) {
          await services.resourceLoader.reload();
        }
        const promptCommands = services.resourceLoader.getPrompts().prompts.map((template) => ({
          name: template.name,
          description: trimToUndefined(template.description) ?? "Prompt template",
        }));
        const skillCommands = services.resourceLoader.getSkills().skills.map((skill) => ({
          name: `skill:${skill.name}`,
          description: trimToUndefined(skill.description) ?? "Skill",
        }));
        return {
          commands: [reloadCommand, ...promptCommands, ...skillCommands],
          source: "pi.sdk",
          cached: false,
        } satisfies ProviderListCommandsResult;
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "command/list",
          detail: toMessage(cause, "Failed to list Pi commands."),
          cause,
        }),
    });

  const getComposerCapabilities: NonNullable<PiAdapterShape["getComposerCapabilities"]> = () =>
    Effect.succeed({
      provider: PROVIDER,
      supportsSkillMentions: true,
      supportsSkillDiscovery: true,
      supportsNativeSlashCommandDiscovery: true,
      supportsPluginMentions: false,
      supportsPluginDiscovery: false,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: true,
      supportsThreadImport: false,
    } satisfies ProviderComposerCapabilities);

  return { getComposerCapabilities, listCommands, listModels, listSkills };
}
