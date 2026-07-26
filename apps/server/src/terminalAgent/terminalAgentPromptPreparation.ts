import type { ServerSettings, TerminalAgentContextSnapshot, TurnId } from "@agent-group/contracts";

import { prepareAgentGroupTurn } from "../agentGroup/runtime";
import { deliverTerminalAgentContext } from "./terminalAgentContextDelivery";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export async function prepareTerminalAgentPrompt(input: {
  readonly runtime: TerminalAgentRuntimeRecord;
  readonly settings: ServerSettings;
  readonly prompt: string;
  readonly turnId: TurnId;
}): Promise<{
  readonly delivered: string;
  readonly awarenessHead: string | null;
  readonly context: TerminalAgentContextSnapshot;
  readonly tracksAgentGroupContext: boolean;
}> {
  const prepared = await prepareAgentGroupTurn({
    ...input.runtime.coordinates,
    userText: input.prompt,
    globalSettings: input.settings.agentGroup,
  });
  const contextEnvelope =
    prepared?.contextEnvelope ?? "Agent Group manages this Turn. Follow the user request.";
  const envelope = input.runtime.transcriptBootstrap
    ? [contextEnvelope, `<thread_context>\n${input.runtime.transcriptBootstrap}\n</thread_context>`]
        .filter(Boolean)
        .join("\n\n")
    : contextEnvelope;
  const delivery = await deliverTerminalAgentContext({
    runtimeDir: input.runtime.runtimeDir,
    provider: input.runtime.provider,
    turnId: input.turnId,
    envelope,
  });
  return {
    delivered: delivery.text,
    awarenessHead: prepared?.awarenessHead ?? null,
    tracksAgentGroupContext: prepared !== null,
    context: {
      turnId: input.turnId,
      checksum: delivery.checksum,
      delivery: delivery.delivery,
      filePath: delivery.filePath,
      content: envelope,
      sources: [
        ...(prepared?.contextPath
          ? [{ label: "Session context", path: prepared.contextPath }]
          : []),
        ...(input.runtime.transcriptBootstrap
          ? [{ label: "Visible transcript bootstrap", path: null }]
          : []),
      ],
      createdAt: new Date().toISOString(),
    },
  };
}
