// FILE: app-snap-manager/persistence.ts
// Purpose: Validates and durably stores pending AppSnap PNG/metadata pairs.
// Layer: Desktop main-process persistence adapter

import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type DesktopAppSnapCapture } from "@agent-group/contracts";

import { normalizeAppIconDataUrl, normalizeOptionalText } from "./helperProtocol";

export const MAX_PENDING_CAPTURE_METADATA_BYTES = 512 * 1024;
export const PENDING_CAPTURE_STORAGE_VERSION = 1;
export const PENDING_CAPTURE_FILE_PATTERN = /^pending-([a-f0-9]{64})\.json$/;
export const PENDING_CAPTURE_IMAGE_PATTERN = /^pending-([a-f0-9]{64})\.png$/;
export const HELPER_CAPTURE_IMAGE_PATTERN =
  /^appsnap-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.png$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PendingAppSnapCaptureRecord {
  capture: DesktopAppSnapCapture;
  imagePath: string;
  metadataPath: string;
}

interface StoredPendingAppSnapCapture {
  version: typeof PENDING_CAPTURE_STORAGE_VERSION;
  id: string;
  capturedAt: string;
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  sourceAppName: string | null;
  sourceBundleIdentifier: string | null;
  sourceAppIconDataUrl: string | null;
  sourceWindowTitle: string | null;
}

export function pendingCaptureStorageKey(captureId: string): string {
  return Crypto.createHash("sha256").update(captureId).digest("hex");
}

export function pendingCaptureStoragePaths(
  captureDirectory: string,
  captureId: string,
): { imagePath: string; metadataPath: string } {
  const key = pendingCaptureStorageKey(captureId);
  const basePath = Path.join(captureDirectory, `pending-${key}`);
  return {
    imagePath: `${basePath}.png`,
    metadataPath: `${basePath}.json`,
  };
}

export function toStoredPendingCapture(
  capture: DesktopAppSnapCapture,
): StoredPendingAppSnapCapture {
  return {
    version: PENDING_CAPTURE_STORAGE_VERSION,
    id: capture.id,
    capturedAt: capture.capturedAt,
    name: capture.name,
    mimeType: "image/png",
    sizeBytes: capture.sizeBytes,
    sourceAppName: capture.sourceAppName,
    sourceBundleIdentifier: capture.sourceBundleIdentifier,
    sourceAppIconDataUrl: capture.sourceAppIconDataUrl,
    sourceWindowTitle: capture.sourceWindowTitle,
  };
}

export function parseStoredPendingCapture(value: unknown): StoredPendingAppSnapCapture | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = normalizeOptionalText(candidate.id, 128);
  const name = normalizeOptionalText(candidate.name, 240);
  const capturedAt = normalizeOptionalText(candidate.capturedAt, 128);
  const sizeBytes = candidate.sizeBytes;
  if (
    candidate.version !== PENDING_CAPTURE_STORAGE_VERSION ||
    !id ||
    !name ||
    !capturedAt ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    candidate.mimeType !== "image/png" ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
  ) {
    return null;
  }
  return {
    version: PENDING_CAPTURE_STORAGE_VERSION,
    id,
    capturedAt: new Date(capturedAt).toISOString(),
    name,
    mimeType: "image/png",
    sizeBytes,
    sourceAppName: normalizeOptionalText(candidate.sourceAppName),
    sourceBundleIdentifier: normalizeOptionalText(candidate.sourceBundleIdentifier),
    sourceAppIconDataUrl: normalizeAppIconDataUrl(candidate.sourceAppIconDataUrl),
    sourceWindowTitle: normalizeOptionalText(candidate.sourceWindowTitle),
  };
}

export async function readRegularFile(
  filePath: string,
  maximumBytes: number,
  expectedBytes?: number,
): Promise<Buffer> {
  const file = await FS.promises.open(
    filePath,
    FS.constants.O_RDONLY | FS.constants.O_NOFOLLOW | FS.constants.O_NONBLOCK,
  );
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Expected a regular file.");
    if (stats.size <= 0) throw new Error("The file is empty.");
    if (stats.size > maximumBytes) throw new Error("The file is larger than allowed.");
    if (expectedBytes !== undefined && stats.size !== expectedBytes) {
      throw new Error("The file size does not match its metadata.");
    }
    const bytes = await file.readFile();
    if (bytes.length !== stats.size) throw new Error("The file changed while it was read.");
    return bytes;
  } finally {
    await file.close();
  }
}

export async function readValidatedPendingPng(
  filePath: string,
  expectedBytes?: number,
): Promise<Buffer> {
  const bytes = await readRegularFile(filePath, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, expectedBytes);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("The file is not a valid PNG image.");
  }
  return bytes;
}

export async function writePrivateFileAtomically(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Crypto.randomUUID()}`;
  try {
    await FS.promises.writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    await FS.promises.rename(temporaryPath, filePath);
    await FS.promises.chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await FS.promises.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function persistPendingCapture(
  captureDirectory: string,
  capture: DesktopAppSnapCapture,
): Promise<PendingAppSnapCaptureRecord> {
  const paths = pendingCaptureStoragePaths(captureDirectory, capture.id);
  await writePrivateFileAtomically(paths.imagePath, capture.bytes);
  try {
    const metadata = Buffer.from(`${JSON.stringify(toStoredPendingCapture(capture))}\n`, "utf8");
    if (metadata.byteLength > MAX_PENDING_CAPTURE_METADATA_BYTES) {
      throw new Error("Pending AppSnap metadata exceeds its storage limit.");
    }
    await writePrivateFileAtomically(paths.metadataPath, metadata);
  } catch (error) {
    await FS.promises.unlink(paths.imagePath).catch(() => undefined);
    throw error;
  }
  return { capture, ...paths };
}

export async function deletePendingCaptureFiles(
  record: PendingAppSnapCaptureRecord,
): Promise<void> {
  await FS.promises.unlink(record.imagePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await FS.promises.unlink(record.metadataPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
