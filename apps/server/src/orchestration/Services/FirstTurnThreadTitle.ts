import type {
  ChatAttachment,
  ModelSelection,
  ProviderStartOptions,
  ThreadId,
} from "@agent-group/contracts";
import type { Effect } from "effect";
import { ServiceMap } from "effect";

export interface FirstTurnTitleInput {
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly messageText: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
}

export interface FirstTurnThreadTitleShape {
  readonly maybeGenerateAndRename: (input: FirstTurnTitleInput) => Effect.Effect<void>;
}

export class FirstTurnThreadTitle extends ServiceMap.Service<
  FirstTurnThreadTitle,
  FirstTurnThreadTitleShape
>()("agent-group/orchestration/Services/FirstTurnThreadTitle") {}
