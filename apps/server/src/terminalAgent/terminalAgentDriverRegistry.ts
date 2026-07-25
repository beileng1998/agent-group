import {
  type ModelSelection,
  type RuntimeMode,
  type ServerSettings,
  type TerminalAgentProvider,
} from "@agent-group/contracts";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  claudeTerminalRuntimeDir,
  prepareClaudeTerminalLaunch,
} from "./claudeTerminalDriver";
import { probeClaudeTerminal } from "./claudeTerminalProbe";
import {
  codexTerminalRuntimeDir,
  prepareCodexTerminalLaunch,
} from "./codexTerminalDriver";
import { probeCodexTerminal } from "./codexTerminalProbe";
import {
  piTerminalRuntimeDir,
  preparePiTerminalLaunch,
} from "./piTerminalDriver";
import { probePiTerminal } from "./piTerminalProbe";
import {
  managedTerminalProviderDescriptor,
  type TerminalAgentDriverLaunch,
  type TerminalAgentProviderResumeCursor,
} from "./terminalAgentProtocol";

type ManagedModelSelection = Extract<
  ModelSelection,
  { provider: TerminalAgentProvider }
>;

function assertProviderMatches(
  provider: TerminalAgentProvider,
  modelSelection: ManagedModelSelection,
): void {
  if (provider !== modelSelection.provider) {
    throw new Error("Terminal provider does not match the server model.");
  }
}

export function terminalAgentRuntimeDir(input: {
  readonly stateDir: string;
  readonly threadId: string;
  readonly runtimeInstanceId: string;
  readonly provider: TerminalAgentProvider;
}): string {
  switch (input.provider) {
    case "codex":
      return codexTerminalRuntimeDir(input.stateDir, input.threadId);
    case "claudeAgent":
      return claudeTerminalRuntimeDir(
        input.stateDir,
        input.runtimeInstanceId,
      );
    case "pi":
      return piTerminalRuntimeDir(input.stateDir, input.runtimeInstanceId);
  }
}

export function terminalAgentExecutable(
  settings: ServerSettings,
  provider: TerminalAgentProvider,
): string {
  return (
    settings.providers[provider].binaryPath.trim() ||
    managedTerminalProviderDescriptor(provider).executable
  );
}

export function probeTerminalAgent(input: {
  readonly provider: TerminalAgentProvider;
  readonly modelSelection: ManagedModelSelection;
  readonly settings: ServerSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}) {
  assertProviderMatches(input.provider, input.modelSelection);
  const executable = terminalAgentExecutable(input.settings, input.provider);
  switch (input.modelSelection.provider) {
    case "codex":
      return probeCodexTerminal(
        executable,
        input.childProcessSpawner,
        input.settings.providers.codex.homePath.trim() || undefined,
      );
    case "claudeAgent":
      return probeClaudeTerminal(executable, input.childProcessSpawner);
    case "pi":
      return probePiTerminal(
        executable,
        input.modelSelection,
        input.childProcessSpawner,
      );
  }
}

export async function prepareTerminalAgentLaunch(input: {
  readonly stateDir: string;
  readonly threadId: string;
  readonly workspaceRoot: string;
  readonly runtimeInstanceId: string;
  readonly provider: TerminalAgentProvider;
  readonly providerSessionId: string | null;
  readonly providerResumeCursor: TerminalAgentProviderResumeCursor | null;
  readonly resume: boolean;
  readonly hookEndpoint: string;
  readonly hookToken: string;
  readonly modelSelection: ManagedModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly settings: ServerSettings;
}): Promise<TerminalAgentDriverLaunch> {
  assertProviderMatches(input.provider, input.modelSelection);
  const executable = terminalAgentExecutable(input.settings, input.provider);
  switch (input.modelSelection.provider) {
    case "codex":
      return prepareCodexTerminalLaunch({
        stateDir: input.stateDir,
        sessionKey: input.threadId,
        runtimeInstanceId: input.runtimeInstanceId,
        hookEndpoint: input.hookEndpoint,
        hookToken: input.hookToken,
        executable,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        ...(input.resume && input.providerSessionId
          ? { resumeSessionId: input.providerSessionId }
          : {}),
        ...(input.settings.providers.codex.homePath.trim()
          ? {
              codexHomePath:
                input.settings.providers.codex.homePath.trim(),
            }
          : {}),
      });
    case "claudeAgent":
      if (!input.providerSessionId) {
        throw new Error("Claude Terminal requires a session id.");
      }
      return prepareClaudeTerminalLaunch({
        stateDir: input.stateDir,
        runtimeInstanceId: input.runtimeInstanceId,
        providerSessionId: input.providerSessionId,
        hookEndpoint: input.hookEndpoint,
        hookToken: input.hookToken,
        executable,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        ...(input.resume ? { resume: true } : {}),
      });
    case "pi":
      const resumeSessionPath =
        typeof input.providerResumeCursor === "string"
          ? input.providerResumeCursor.trim() || undefined
          : input.providerResumeCursor &&
              "path" in input.providerResumeCursor
            ? input.providerResumeCursor.path
            : undefined;
      if (!resumeSessionPath && !input.providerSessionId) {
        throw new Error("Pi Terminal requires a session id or resume file.");
      }
      return preparePiTerminalLaunch({
        stateDir: input.stateDir,
        workspaceRoot: input.workspaceRoot,
        runtimeInstanceId: input.runtimeInstanceId,
        ...(input.providerSessionId
          ? { providerSessionId: input.providerSessionId }
          : {}),
        ...(resumeSessionPath
          ? { resumeSessionPath }
          : {}),
        hookEndpoint: input.hookEndpoint,
        hookToken: input.hookToken,
        executable,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        ...(input.settings.providers.pi.agentDir.trim()
          ? { agentDir: input.settings.providers.pi.agentDir.trim() }
          : {}),
      });
  }
}
