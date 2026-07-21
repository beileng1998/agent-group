// FILE: chatTurnStartDispatch.ts
// Purpose: Persist turn settings and dispatch one fully prepared chat turn.
// Layer: Web send orchestration

import { type ClientOrchestrationCommand, type NativeApi } from "@agent-group/contracts";

type TurnStartCommand = Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>;
type TurnStartMessage = TurnStartCommand["message"];

export async function dispatchPreparedChatTurn(input: {
  api: NativeApi;
  persistSettings: (() => Promise<unknown>) | null;
  onStartingSession: () => void;
  attachments: Promise<TurnStartMessage["attachments"]>;
  rememberProviderDispatch: () => void;
  buildCommand: (attachments: TurnStartMessage["attachments"]) => TurnStartCommand;
}): Promise<void> {
  if (input.persistSettings) {
    await input.persistSettings();
  }
  input.onStartingSession();
  const attachments = await input.attachments;
  input.rememberProviderDispatch();
  await input.api.orchestration.dispatchCommand(input.buildCommand(attachments));
}
