// FILE: codexVisualizationUrl.ts
// Purpose: Build authenticated URLs for durable Codex visualization fragments.
// Layer: Web utility

import { CODEX_VISUALIZATION_ROUTE_PATH } from "@agent-group/shared/codexVisualizations";

import { resolveWsHttpUrl } from "./wsHttpUrl";

export function buildCodexVisualizationUrl(input: {
  readonly threadId: string;
  readonly messageId: string;
  readonly fileName: string;
}): string {
  const params = new URLSearchParams({
    threadId: input.threadId,
    messageId: input.messageId,
    file: input.fileName,
  });
  return resolveWsHttpUrl(`${CODEX_VISUALIZATION_ROUTE_PATH}?${params.toString()}`);
}
