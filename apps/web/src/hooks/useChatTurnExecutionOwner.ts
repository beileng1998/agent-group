// FILE: useChatTurnExecutionOwner.ts
// Purpose: Compose chat automation, command, and turn execution owners.
// Layer: Web chat execution owner

import { useCallback, useRef } from "react";

import { type ChatAutomationOwnerInput, useChatAutomationOwner } from "./useChatAutomationOwner";
import {
  type ChatComposerCommandOwnerInput,
  useChatComposerCommandOwner,
} from "./useChatComposerCommandOwner";
import {
  type ChatTurnDispatchOwnerInput,
  useChatTurnDispatchOwner,
} from "./useChatTurnDispatchOwner";

type CommandActions = ChatComposerCommandOwnerInput["actions"];
type CommandKeyboardActions = CommandActions["keyboard"];
type TurnComposer = ChatTurnDispatchOwnerInput["composer"];
type TurnComposerActions = TurnComposer["actions"];
type TurnComposerQueue = TurnComposer["queue"];
type TurnAutomation = ChatTurnDispatchOwnerInput["automation"];
type TurnDispatch = ReturnType<typeof useChatTurnDispatchOwner>["send"]["dispatch"];

type ChatExecutionCommandInput = Omit<ChatComposerCommandOwnerInput, "actions"> & {
  readonly actions: Omit<CommandActions, "keyboard"> & {
    readonly keyboard: Omit<CommandKeyboardActions, "send">;
  };
};

type ChatExecutionTurnInput = Omit<ChatTurnDispatchOwnerInput, "automation" | "composer"> & {
  readonly composer: Omit<TurnComposer, "actions" | "queue"> & {
    readonly actions: Omit<TurnComposerActions, "clearInput" | "handleStandaloneSlashCommand">;
    readonly queue: Omit<TurnComposerQueue, "restore">;
  };
  readonly automation: Pick<
    TurnAutomation,
    | "armTranscriptAutoFollow"
    | "clearConversation"
    | "conversation"
    | "isResolveCurrent"
    | "setConversation"
  >;
};

export interface ChatTurnExecutionOwnerInput {
  readonly automation: ChatAutomationOwnerInput;
  readonly command: ChatExecutionCommandInput;
  readonly turn: ChatExecutionTurnInput;
}

export function useChatTurnExecutionOwner(input: ChatTurnExecutionOwnerInput) {
  const turnDispatchRef = useRef<TurnDispatch | null>(null);
  const sendFromCommand = useCallback<CommandKeyboardActions["send"]>((mode) => {
    const dispatch = turnDispatchRef.current;
    return dispatch ? dispatch(undefined, mode) : false;
  }, []);

  const automation = useChatAutomationOwner(input.automation);
  const command = useChatComposerCommandOwner({
    ...input.command,
    actions: {
      ...input.command.actions,
      keyboard: {
        ...input.command.actions.keyboard,
        send: sendFromCommand,
      },
    },
  });
  const turn = useChatTurnDispatchOwner({
    ...input.turn,
    composer: {
      ...input.turn.composer,
      actions: {
        ...input.turn.composer.actions,
        clearInput: automation.clearComposerInput,
        handleStandaloneSlashCommand: command.slash.handleStandaloneCommand,
      },
      queue: {
        ...input.turn.composer.queue,
        restore: automation.restoreQueuedTurnToComposer,
      },
    },
    automation: {
      ...input.turn.automation,
      automationProjects: input.automation.automation.projects,
      promptRef: input.automation.composer.promptRef,
      setComposerDraftPrompt: input.automation.composer.store.setPrompt,
      setComposerTrigger: input.automation.composer.setTrigger,
      openDraftReview: automation.automation.openDraftReview,
      prepareFormForCreate: automation.automation.prepareFormForCreate,
      createFromForm: automation.automation.createFromForm,
    },
  });
  turnDispatchRef.current = turn.send.dispatch;

  return { automation, command, turn };
}
