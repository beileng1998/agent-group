// FILE: codexVisualizations.ts
// Purpose: Share the narrow Codex inline-visualization compatibility contract.
// Layer: Shared runtime utility

export const CODEX_VISUALIZATION_ROUTE_PATH = "/api/codex-visualization" as const;
export const MAX_CODEX_VISUALIZATION_BYTES = 2 * 1024 * 1024;
export const MAX_CODEX_VISUALIZATIONS_PER_MESSAGE = 8;

const VISUALIZATION_FILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126})\.html$/u;
const INLINE_VISUALIZATION_DIRECTIVE_PATTERN =
  /^::codex-inline-vis\{file="(?<fileName>[a-z0-9](?:[a-z0-9-]{0,126})\.html)"\}$/u;

export interface CodexInlineVisualizationDirective {
  readonly fileName: string;
}

export function isCodexVisualizationFileName(value: string): boolean {
  return VISUALIZATION_FILE_NAME_PATTERN.test(value);
}

export function parseCodexInlineVisualizationDirective(
  value: string,
): CodexInlineVisualizationDirective | null {
  const match = INLINE_VISUALIZATION_DIRECTIVE_PATTERN.exec(value.trim());
  const fileName = match?.groups?.fileName;
  return fileName ? { fileName } : null;
}

export function extractCodexInlineVisualizationDirectives(
  text: string,
): CodexInlineVisualizationDirective[] {
  const directives: CodexInlineVisualizationDirective[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const directive = parseCodexInlineVisualizationDirective(line);
    if (!directive || seen.has(directive.fileName)) continue;
    seen.add(directive.fileName);
    directives.push(directive);
    if (directives.length >= MAX_CODEX_VISUALIZATIONS_PER_MESSAGE) break;
  }
  return directives;
}
