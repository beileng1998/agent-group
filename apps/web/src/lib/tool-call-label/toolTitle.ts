import { deriveReadableCommandDisplay } from "./commandDisplay";
import { isGenericToolTitle, normalizeCompactToolLabel } from "./normalization";
import { extractToolDescriptorFromPayload, normalizeToolDescriptor } from "./toolDescriptors";
import type { ReadableToolTitleInput } from "./types";

export function deriveReadableToolTitle(input: ReadableToolTitleInput): string | null {
  const normalizedTitle = normalizeCompactToolLabel(input.title ?? "");
  const normalizedFallback = normalizeCompactToolLabel(input.fallbackLabel);
  const commandLabel = input.command
    ? deriveReadableCommandDisplay(input.command, input.isRunning).verb
    : null;
  const commandLike = input.itemType === "command_execution" || input.requestKind === "command";
  const requestKindLabel = humanizeRequestKind(input.requestKind, input.itemType);

  if (normalizedTitle.length > 0 && !isGenericToolTitle(normalizedTitle)) {
    return normalizedTitle;
  }
  if (requestKindLabel) {
    return requestKindLabel;
  }
  if (commandLike && commandLabel) {
    return commandLabel;
  }

  const descriptor = normalizeToolDescriptor(extractToolDescriptorFromPayload(input.payload));
  if (descriptor && !isGenericToolTitle(descriptor)) {
    return descriptor;
  }
  if (normalizedFallback.length > 0 && !isGenericToolTitle(normalizedFallback)) {
    return normalizedFallback;
  }
  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }
  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }
  return null;
}

function humanizeRequestKind(
  requestKind: ReadableToolTitleInput["requestKind"],
  itemType: ReadableToolTitleInput["itemType"],
): string | null {
  if (requestKind === "file-read") return "Read";
  if (requestKind === "file-change" || itemType === "file_change") return "Edited";
  if (itemType === "web_search") return "Searched the web";
  if (itemType === "image_generation") return "Generated image";
  if (itemType === "image_view") return "Viewed image";
  if (itemType === "collab_agent_tool_call") return "Agent task";
  return null;
}
