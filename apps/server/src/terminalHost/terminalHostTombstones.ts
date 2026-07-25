const MAX_KILLED_TOMBSTONES = 1_000;

export function markKilledTombstone(
  tombstones: Set<string>,
  sessionId: string,
): void {
  tombstones.delete(sessionId);
  tombstones.add(sessionId);
  while (tombstones.size > MAX_KILLED_TOMBSTONES) {
    const oldest = tombstones.values().next().value;
    if (oldest === undefined) return;
    tombstones.delete(oldest);
  }
}
