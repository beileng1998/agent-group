import type { TerminalCliKind } from "@agent-group/shared/terminalThreads";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";

export function normalizeTerminalIds(terminalIds: string[]): string[] {
  const ids = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

export function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

export function normalizeTerminalLabels(
  terminalLabelsById: Record<string, string> | null | undefined,
  terminalIds: string[],
): Record<string, string> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalLabelsById ?? {})
    .map(([terminalId, label]) => [terminalId.trim(), label.trim()] as const)
    .filter(([terminalId, label]) => terminalId.length > 0 && label.length > 0)
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

export function normalizeTerminalTitleOverrides(
  terminalTitleOverridesById: Record<string, string> | null | undefined,
  terminalIds: string[],
): Record<string, string> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalTitleOverridesById ?? {})
    .map(([terminalId, titleOverride]) => [terminalId.trim(), titleOverride.trim()] as const)
    .filter(
      ([terminalId, titleOverride]) =>
        terminalId.length > 0 && titleOverride.length > 0 && validTerminalIdSet.has(terminalId),
    )
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

export function normalizeTerminalCliKinds(
  terminalCliKindsById: Record<string, TerminalCliKind> | null | undefined,
  terminalIds: string[],
): Record<string, TerminalCliKind> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalCliKindsById ?? {})
    .map(([terminalId, cliKind]) => [terminalId.trim(), cliKind] as const)
    .filter(
      ([terminalId, cliKind]) =>
        terminalId.length > 0 &&
        (cliKind === "codex" || cliKind === "claude" || cliKind === "antigravity"),
    )
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

export function normalizeTerminalAttentionStates(
  terminalAttentionStatesById: Record<string, "attention" | "review"> | null | undefined,
  terminalIds: string[],
): Record<string, "attention" | "review"> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalAttentionStatesById ?? {})
    .map(([terminalId, state]) => [terminalId.trim(), state] as const)
    .filter(
      ([terminalId, state]) =>
        terminalId.length > 0 && (state === "attention" || state === "review"),
    )
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

export function clearTerminalReviewState(
  terminalAttentionStatesById: Record<string, "attention" | "review">,
  terminalId: string,
): Record<string, "attention" | "review"> {
  if (terminalAttentionStatesById[terminalId] !== "review") {
    return terminalAttentionStatesById;
  }
  const nextAttentionStatesById = { ...terminalAttentionStatesById };
  delete nextAttentionStatesById[terminalId];
  return nextAttentionStatesById;
}

function generatedTerminalTitleBase(cliKind: TerminalCliKind | null): string {
  if (cliKind === "codex") return "Codex";
  if (cliKind === "claude") return "Claude";
  if (cliKind === "antigravity") return "Antigravity";
  return "Terminal";
}

function resolveTerminalDisplayTitle(options: {
  terminalId: string;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): string {
  return (
    options.terminalTitleOverridesById[options.terminalId]?.trim() ||
    options.terminalLabelsById[options.terminalId]?.trim() ||
    ""
  );
}

export function createUniqueTerminalTitle(options: {
  cliKind: TerminalCliKind | null;
  excludeTerminalId?: string | undefined;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById?: Record<string, string> | undefined;
}): string {
  const baseTitle = generatedTerminalTitleBase(options.cliKind);
  const takenTitles = new Set(
    Object.keys(options.terminalLabelsById)
      .filter((terminalId) => terminalId !== options.excludeTerminalId)
      .map((terminalId) =>
        resolveTerminalDisplayTitle({
          terminalId,
          terminalLabelsById: options.terminalLabelsById,
          terminalTitleOverridesById: options.terminalTitleOverridesById ?? {},
        }),
      )
      .filter((title) => title.length > 0),
  );
  let index = 1;
  while (true) {
    const candidate = `${baseTitle} ${index}`;
    if (!takenTitles.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function ensureTerminalLabels(options: {
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): Record<string, string> {
  const nextLabelsById = { ...options.terminalLabelsById };
  for (const terminalId of options.terminalIds) {
    const existingLabel = nextLabelsById[terminalId]?.trim();
    if (existingLabel && existingLabel.length > 0) {
      continue;
    }
    nextLabelsById[terminalId] = createUniqueTerminalTitle({
      cliKind: options.terminalCliKindsById[terminalId] ?? null,
      excludeTerminalId: terminalId,
      terminalLabelsById: nextLabelsById,
      terminalTitleOverridesById: options.terminalTitleOverridesById,
    });
  }
  return nextLabelsById;
}

export function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}
