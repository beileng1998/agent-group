import {
  firstShellCommandSegment,
  splitToolAndArgs,
  stripCommandDisplayWrappers,
  unwrapShellCommandIfPresent,
} from "./commandParsing";
import { deriveCommandDisplayForTool, isInspectCommandTool } from "./commandSemantics";
import type { CommandVisualKind, ReadableCommandDisplay } from "./types";

export function deriveReadableCommandDisplay(
  rawCommand: string,
  isRunning = false,
): ReadableCommandDisplay {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const primaryCommand = firstShellCommandSegment(command);
  const [tool, args] = splitToolAndArgs(primaryCommand);
  return deriveCommandDisplayForTool({ tool, args, command, rawCommand, isRunning });
}

export function isInspectCommand(rawCommand: string): boolean {
  return resolveCommandVisualKind(rawCommand) === "inspect";
}

export function resolveCommandVisualKind(rawCommand: string): CommandVisualKind {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const [tool] = splitToolAndArgs(firstShellCommandSegment(command));
  if (isInspectCommandTool(tool)) {
    return "inspect";
  }
  if (tool === "git") {
    return "git";
  }
  if (tool === "gh" || tool === "hub") {
    return "github";
  }
  return "terminal";
}

export function deriveInlineCommandCall(rawCommand: string): string {
  return stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
}
