// FILE: chatWorktreeSetupScript.ts
// Purpose: Run the configured project setup action after a first-send worktree is bound.
// Layer: Web send orchestration

import { type ProjectScript, type ThreadId } from "@agent-group/contracts";

export async function runChatWorktreeSetupScript(input: {
  threadId: ThreadId;
  setupScript: ProjectScript | null;
  worktreePath: string | null;
  isServerThread: boolean;
  createdServerThreadForLocalDraft: boolean;
  onRunning: (setupScriptName: string) => void;
  runProjectScript: (
    script: ProjectScript,
    options: {
      worktreePath: string | null;
      cwd?: string;
      rememberAsLastInvoked: false;
      throwOnError: true;
    },
  ) => Promise<{ terminalId: string } | null>;
  waitForTerminalActivity: (input: { threadId: ThreadId; terminalId: string }) => Promise<unknown>;
}): Promise<void> {
  if (!input.setupScript || (!input.isServerThread && !input.createdServerThreadForLocalDraft)) {
    return;
  }

  input.onRunning(input.setupScript.name);
  const options: {
    worktreePath: string | null;
    cwd?: string;
    rememberAsLastInvoked: false;
    throwOnError: true;
  } = {
    worktreePath: input.worktreePath,
    rememberAsLastInvoked: false,
    throwOnError: true,
  };
  if (input.worktreePath) {
    options.cwd = input.worktreePath;
  }
  const terminal = await input.runProjectScript(input.setupScript, options);
  if (terminal) {
    await input.waitForTerminalActivity({
      threadId: input.threadId,
      terminalId: terminal.terminalId,
    });
  }
}
