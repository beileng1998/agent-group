import type { ChatAttachment } from "@agent-group/contracts";

export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

export function attachmentMetadataLines(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
): string[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.type === "image")
    .map(
      (attachment) =>
        `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
    );
}
