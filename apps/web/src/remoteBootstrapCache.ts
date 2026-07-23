// FILE: remoteBootstrapCache.ts
// Purpose: Persist the last renderable remote snapshots outside localStorage.
// Layer: Browser storage adapter

import {
  RemoteBootstrapSnapshot,
  type RemoteBootstrapSnapshot as RemoteBootstrapSnapshotValue,
} from "@agent-group/contracts";
import { Schema } from "effect";

import { awaitIdbRequest, openIndexedDbDatabase, waitForIdbTransaction } from "./lib/indexedDb";

const DATABASE_NAME = "agent-group-remote-bootstrap";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const MAX_SNAPSHOTS = 8;
const SHELL_KEY = "__shell__";
const decodeSnapshot = Schema.decodeUnknownSync(RemoteBootstrapSnapshot);

export interface CachedRemoteBootstrapSnapshot {
  readonly key: string;
  readonly etag: string | null;
  readonly savedAt: number;
  readonly snapshot: RemoteBootstrapSnapshotValue;
}

function snapshotKey(threadId: string | null): string {
  return threadId?.trim() || SHELL_KEY;
}

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDbDatabase({
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    storeName: STORE_NAME,
    keyPath: "key",
    label: "remote bootstrap cache",
  });
}

function decodeRecord(value: unknown): CachedRemoteBootstrapSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CachedRemoteBootstrapSnapshot>;
  if (
    typeof candidate.key !== "string" ||
    typeof candidate.savedAt !== "number" ||
    (candidate.etag !== null && typeof candidate.etag !== "string")
  ) {
    return null;
  }
  try {
    return {
      ...candidate,
      snapshot: decodeSnapshot(candidate.snapshot),
    } as CachedRemoteBootstrapSnapshot;
  } catch {
    return null;
  }
}

export async function readCachedRemoteBootstrapSnapshot(
  threadId: string | null,
): Promise<CachedRemoteBootstrapSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = waitForIdbTransaction(transaction, "Remote bootstrap cache read");
    const stored = await awaitIdbRequest(
      transaction.objectStore(STORE_NAME).get(snapshotKey(threadId)),
      "Could not read the remote bootstrap cache.",
    );
    await completion;
    return decodeRecord(stored);
  } finally {
    database.close();
  }
}

async function pruneOldSnapshots(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();
  request.addEventListener("success", () => {
    const records = request.result
      .map(decodeRecord)
      .filter((record): record is CachedRemoteBootstrapSnapshot => record !== null)
      .toSorted((left, right) => right.savedAt - left.savedAt);
    for (const record of records.slice(MAX_SNAPSHOTS)) store.delete(record.key);
  });
  await waitForIdbTransaction(transaction, "Remote bootstrap cache pruning");
}

export async function persistRemoteBootstrapSnapshot(input: {
  readonly threadId: string | null;
  readonly etag: string | null;
  readonly snapshot: RemoteBootstrapSnapshotValue;
}): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: snapshotKey(input.threadId),
      etag: input.etag,
      savedAt: Date.now(),
      snapshot: input.snapshot,
    } satisfies CachedRemoteBootstrapSnapshot);
    await waitForIdbTransaction(transaction, "Remote bootstrap cache write");
    await pruneOldSnapshots(database);
  } finally {
    database.close();
  }
}
