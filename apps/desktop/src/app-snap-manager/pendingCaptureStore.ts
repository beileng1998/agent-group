// FILE: app-snap-manager/pendingCaptureStore.ts
// Purpose: Owns the ordered, durable set of pending AppSnap captures.
// Layer: Desktop main-process service

import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type DesktopAppSnapCapture } from "@agent-group/contracts";

import type { AppSnapCapturedMessage, ResolvedDesktopAppSnapManagerOptions } from "./contracts";
import {
  emitCaptureError,
  isPathInsideDirectory,
  normalizeAppIconDataUrl,
  normalizeDate,
  normalizeOptionalText,
} from "./helperProtocol";
import {
  deletePendingCaptureFiles,
  HELPER_CAPTURE_IMAGE_PATTERN,
  MAX_PENDING_CAPTURE_METADATA_BYTES,
  parseStoredPendingCapture,
  PENDING_CAPTURE_FILE_PATTERN,
  PENDING_CAPTURE_IMAGE_PATTERN,
  pendingCaptureStorageKey,
  persistPendingCapture,
  readRegularFile,
  readValidatedPendingPng,
  type PendingAppSnapCaptureRecord,
} from "./persistence";

const MAX_PENDING_CAPTURES = PROVIDER_SEND_TURN_MAX_ATTACHMENTS;

export class AppSnapPendingCaptureStore {
  readonly #options: ResolvedDesktopAppSnapManagerOptions;
  #pendingCaptures: PendingAppSnapCaptureRecord[] = [];
  #pendingCapturesLoadPromise: Promise<void> | null = null;
  #captureReadQueue: Promise<void> = Promise.resolve();

  constructor(options: ResolvedDesktopAppSnapManagerOptions) {
    this.#options = options;
  }

  async list(): Promise<DesktopAppSnapCapture[]> {
    await this.#ensureLoaded();
    return this.#pendingCaptures.map(({ capture }) => ({
      ...capture,
      bytes: new Uint8Array(capture.bytes),
    }));
  }

  async acknowledge(captureId: string): Promise<void> {
    if (captureId.trim().length === 0) return;
    await this.#ensureLoaded();
    const matchingRecords = this.#pendingCaptures.filter(({ capture }) => capture.id === captureId);
    for (const record of matchingRecords) {
      await deletePendingCaptureFiles(record);
    }
    this.#pendingCaptures = this.#pendingCaptures.filter(({ capture }) => capture.id !== captureId);
  }

  enqueue(message: AppSnapCapturedMessage): void {
    this.#captureReadQueue = this.#captureReadQueue
      .then(() => this.#consume(message))
      .catch((error) => {
        emitCaptureError(
          this.#options,
          "capture-read-failed",
          error instanceof Error ? error.message : "Could not read the captured AppSnap.",
          message.capturedAt,
          true,
        );
      });
  }

  clear(): void {
    this.#pendingCaptures = [];
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#pendingCapturesLoadPromise) {
      this.#pendingCapturesLoadPromise = this.#load();
    }
    const loadPromise = this.#pendingCapturesLoadPromise;
    try {
      await loadPromise;
    } catch (error) {
      if (this.#pendingCapturesLoadPromise === loadPromise) {
        this.#pendingCapturesLoadPromise = null;
      }
      throw error;
    }
  }

  async #load(): Promise<void> {
    const captureDirectory = this.#options.captureDirectory;
    await FS.promises.mkdir(captureDirectory, { recursive: true, mode: 0o700 });
    await FS.promises.chmod(captureDirectory, 0o700).catch(() => undefined);
    const entries = await FS.promises.readdir(captureDirectory);
    const records: PendingAppSnapCaptureRecord[] = [];
    const metadataStorageKeys = new Set(
      entries.flatMap((entry) => PENDING_CAPTURE_FILE_PATTERN.exec(entry)?.[1] ?? []),
    );

    for (const entry of entries) {
      const imageStorageKey = PENDING_CAPTURE_IMAGE_PATTERN.exec(entry)?.[1];
      if (!imageStorageKey || metadataStorageKeys.has(imageStorageKey)) continue;
      await FS.promises.unlink(Path.join(captureDirectory, entry)).catch(() => undefined);
    }

    for (const entry of entries) {
      const match = PENDING_CAPTURE_FILE_PATTERN.exec(entry);
      if (!match) continue;
      const storageKey = match[1];
      const metadataPath = Path.join(captureDirectory, entry);
      const imagePath = Path.join(captureDirectory, `pending-${storageKey}.png`);
      try {
        const metadataBytes = await readRegularFile(
          metadataPath,
          MAX_PENDING_CAPTURE_METADATA_BYTES,
        );
        const stored = parseStoredPendingCapture(JSON.parse(metadataBytes.toString("utf8")));
        if (!stored || pendingCaptureStorageKey(stored.id) !== storageKey) {
          throw new Error("Pending AppSnap metadata is invalid.");
        }
        const bytes = await readValidatedPendingPng(imagePath, stored.sizeBytes);
        records.push({
          capture: {
            id: stored.id,
            capturedAt: stored.capturedAt,
            name: stored.name,
            mimeType: stored.mimeType,
            sizeBytes: bytes.byteLength,
            bytes: new Uint8Array(bytes),
            sourceAppName: stored.sourceAppName,
            sourceBundleIdentifier: stored.sourceBundleIdentifier,
            sourceAppIconDataUrl: stored.sourceAppIconDataUrl,
            sourceWindowTitle: stored.sourceWindowTitle,
          },
          imagePath,
          metadataPath,
        });
      } catch (error) {
        console.warn(
          `[desktop-appsnap] Removing unreadable pending capture ${entry}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await FS.promises.unlink(imagePath).catch(() => undefined);
        await FS.promises.unlink(metadataPath).catch(() => undefined);
      }
    }

    await this.#recoverHelperCaptures(entries, records);

    records.sort(
      (left, right) =>
        Date.parse(left.capture.capturedAt) - Date.parse(right.capture.capturedAt) ||
        left.capture.id.localeCompare(right.capture.id),
    );
    const overflow = records.slice(0, Math.max(0, records.length - MAX_PENDING_CAPTURES));
    for (const record of overflow) {
      await deletePendingCaptureFiles(record).catch((error) =>
        console.warn("[desktop-appsnap] Could not remove an overflow pending capture", error),
      );
    }
    this.#pendingCaptures = records.slice(-MAX_PENDING_CAPTURES);
  }

  async #recoverHelperCaptures(
    entries: string[],
    records: PendingAppSnapCaptureRecord[],
  ): Promise<void> {
    for (const entry of entries) {
      const captureId = HELPER_CAPTURE_IMAGE_PATTERN.exec(entry)?.[1];
      if (!captureId) continue;
      const helperImagePath = Path.join(this.#options.captureDirectory, entry);
      if (records.some((record) => record.capture.id === captureId)) {
        await FS.promises.unlink(helperImagePath).catch(() => undefined);
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await readValidatedPendingPng(helperImagePath);
      } catch (error) {
        console.warn(
          `[desktop-appsnap] Removing unreadable helper capture ${entry}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await FS.promises.unlink(helperImagePath).catch(() => undefined);
        continue;
      }

      const capture: DesktopAppSnapCapture = {
        id: captureId,
        capturedAt: this.#options.now().toISOString(),
        name: entry,
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        bytes: new Uint8Array(bytes),
        sourceAppName: null,
        sourceBundleIdentifier: null,
        sourceAppIconDataUrl: null,
        sourceWindowTitle: null,
      };
      try {
        records.push(await persistPendingCapture(this.#options.captureDirectory, capture));
        await FS.promises.unlink(helperImagePath).catch(() => undefined);
      } catch (error) {
        console.warn(
          `[desktop-appsnap] Could not recover helper capture ${entry}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async #consume(message: AppSnapCapturedMessage): Promise<void> {
    const capturePath = Path.resolve(message.path);
    if (!isPathInsideDirectory(this.#options.captureDirectory, capturePath)) {
      throw new Error("The AppSnap helper returned a capture outside its private directory.");
    }

    await this.#ensureLoaded();
    const bytes = await readValidatedPendingPng(capturePath);
    const now = this.#options.now();
    const capture: DesktopAppSnapCapture = {
      id: normalizeOptionalText(message.id, 128) ?? Crypto.randomUUID(),
      capturedAt: normalizeDate(message.capturedAt, now),
      name:
        normalizeOptionalText(message.name, 240) ??
        `AppSnap-${now.toISOString().replace(/[:.]/g, "-")}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      bytes: new Uint8Array(bytes),
      sourceAppName: normalizeOptionalText(message.sourceAppName),
      sourceBundleIdentifier: normalizeOptionalText(message.sourceBundleIdentifier),
      sourceAppIconDataUrl: normalizeAppIconDataUrl(message.sourceAppIconDataUrl),
      sourceWindowTitle: normalizeOptionalText(message.sourceWindowTitle),
    };
    const pendingRecord = await persistPendingCapture(this.#options.captureDirectory, capture);
    await FS.promises.unlink(capturePath).catch(() => undefined);
    const nextPendingCaptures = [
      ...this.#pendingCaptures.filter((entry) => entry.capture.id !== capture.id),
      pendingRecord,
    ];
    const discardedRecord =
      nextPendingCaptures.length > MAX_PENDING_CAPTURES ? nextPendingCaptures[0] : null;
    this.#pendingCaptures = nextPendingCaptures.slice(-MAX_PENDING_CAPTURES);
    if (discardedRecord) {
      await deletePendingCaptureFiles(discardedRecord).catch((error) =>
        console.warn("[desktop-appsnap] Could not delete an overflow pending capture", error),
      );
      emitCaptureError(
        this.#options,
        "pending-capture-overflow",
        `Agent Group could retain only the latest ${MAX_PENDING_CAPTURES} AppSnaps while the composer was unavailable. The oldest capture was discarded.`,
        discardedRecord.capture.capturedAt,
        false,
      );
    }
    this.#options.onCaptured(capture);
  }
}
