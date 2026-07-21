import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_SERVER_SETTINGS } from "@agent-group/contracts";
import { CONTEXT_TEMPLATE_PRESETS } from "@agent-group/shared/contextTemplates";
import { Effect, FileSystem, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "agent-group-settings-test-",
}).pipe(Layer.provide(NodeServices.layer));
const makeTestLayer = Layer.merge(NodeServices.layer, serverConfigLayer);
const testLayer = Layer.merge(makeTestLayer, ServerSettingsLive.pipe(Layer.provide(makeTestLayer)));

const runWithSettings = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ServerSettingsService | ServerConfig | FileSystem.FileSystem | Path.Path
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

describe("ServerSettingsService", () => {
  it("loads defaults when settings file does not exist", async () => {
    const settings = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        yield* service.start;
        return yield* service.getSettings;
      }),
    );

    expect(settings.providers.codex.binaryPath).toBe("codex");
    expect(settings.providers.grok.binaryPath).toBe("grok");
    expect(settings.defaultThreadEnvMode).toBe("local");
    expect(settings.enableProviderUpdateChecks).toBe(true);
    expect(settings.agentGroup).toEqual({
      ...DEFAULT_SERVER_SETTINGS.agentGroup,
      contextTemplates: CONTEXT_TEMPLATE_PRESETS,
    });
  });

  it("upgrades legacy prompt defaults without replacing custom instructions", async () => {
    const settings = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            ...DEFAULT_SERVER_SETTINGS,
            agentGroup: {
              ...DEFAULT_SERVER_SETTINGS.agentGroup,
              promptInstructions: {
                sessionContextFirstTurn:
                  "Read before work. Maintain this file as your session context; edit only this file.",
                sessionContextLaterTurn: "Maintain this file as the current Session context.",
                parentContext: "Keep this custom parent instruction.",
                mentionedSessions:
                  "Server-resolved context and transcript references for mentioned Sessions.",
                contextChanges: "Command for checking recent Session context changes:",
                browserTools: "Browser automation available to this Session.",
              },
            },
          }),
        );
        yield* service.start;
        return yield* service.getSettings;
      }),
    );

    expect(settings.agentGroup.promptInstructions).toEqual({
      ...DEFAULT_SERVER_SETTINGS.agentGroup.promptInstructions,
      parentContext: "Keep this custom parent instruction.",
    });
  });

  it("persists updates and reloads them", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* service.start;

        const updated = yield* service.updateSettings({
          enableAssistantStreaming: true,
          enableProviderUpdateChecks: false,
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex",
              customModels: ["gpt-custom"],
            },
          },
          agentGroup: {
            defaultModelSelection: {
              provider: "claudeAgent",
              model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
            },
            contextTemplates: [
              {
                id: "custom",
                name: "Custom",
                description: "A custom context template",
                content: "# Custom\n",
              },
            ],
            globalRules: "Keep the user's request verbatim.",
            promptInstructions: {
              ...DEFAULT_SERVER_SETTINGS.agentGroup.promptInstructions,
              mentionedSessions: "Inspect these Sessions only when relevant.",
            },
          },
        });
        const raw = yield* fs.readFileString(settingsPath);
        return { updated, parsed: JSON.parse(raw) as unknown };
      }),
    );

    expect(result.updated.enableAssistantStreaming).toBe(true);
    expect(result.updated.enableProviderUpdateChecks).toBe(false);
    expect(result.updated.providers.codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(result.updated.agentGroup.globalRules).toBe("Keep the user's request verbatim.");
    expect(result.updated.agentGroup.defaultModelSelection.provider).toBe("claudeAgent");
    expect(result.updated.agentGroup.contextTemplates[0]?.content).toBe("# Custom\n");
    expect(result.updated.agentGroup.promptInstructions.mentionedSessions).toBe(
      "Inspect these Sessions only when relevant.",
    );
    expect(result.parsed).toMatchObject({
      enableAssistantStreaming: true,
      enableProviderUpdateChecks: false,
      providers: {
        codex: {
          binaryPath: "/usr/local/bin/codex",
          customModels: ["gpt-custom"],
        },
      },
      agentGroup: {
        globalRules: "Keep the user's request verbatim.",
        promptInstructions: {
          mentionedSessions: "Inspect these Sessions only when relevant.",
        },
      },
    });
  });

  it("resolves text generation selection away from disabled providers", async () => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getSettings;
      }).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            textGenerationModelSelection: {
              provider: "antigravity",
              model: DEFAULT_MODEL_BY_PROVIDER.antigravity,
            },
            providers: {
              antigravity: { enabled: false },
            },
          }),
        ),
      ),
    );

    expect(settings.textGenerationModelSelection.provider).toBe("codex");
    expect(settings.textGenerationModelSelection.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });
});
