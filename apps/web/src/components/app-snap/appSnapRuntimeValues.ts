// FILE: appSnapRuntimeValues.ts
// Purpose: Shared AppSnap capture identity, target availability, and icon hydration helpers.
// Layer: Web AppSnap coordinator support

import type { DesktopAppSnapCapture, ThreadId } from "@agent-group/contracts";
import {
  type ComposerImageAttachment,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { persistAppSnapIcon, readAppSnapIcon } from "../../lib/appSnapIconStore";
import type { ComposerAppSnapSource } from "../../lib/composerImageSource";
import { useStore } from "../../store";

const MAX_REMEMBERED_CAPTURE_IDS = 100;

export interface PersistedAppSnapHydrationTarget {
  attachments: ReadonlyArray<PersistedComposerImageAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
  hasAttachment: (attachmentId: string) => boolean;
  addImage: (image: ComposerImageAttachment) => void;
  removeAttachment: (attachmentId: string) => Promise<unknown>;
}

export function captureTimestampMs(capture: DesktopAppSnapCapture): number {
  const parsed = Date.parse(capture.capturedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function isThreadAvailable(threadId: ThreadId): boolean {
  const state = useStore.getState();
  if (state.sidebarThreadSummaryById[threadId]) return true;
  if (state.threads.some((thread) => thread.id === threadId)) return true;
  const draftState = useComposerDraftStore.getState();
  return Boolean(
    draftState.draftsByThreadId[threadId] || draftState.draftThreadsByThreadId[threadId],
  );
}

export function rememberCaptureId(captureIds: Map<string, true>, captureId: string): boolean {
  if (captureIds.has(captureId)) return false;
  captureIds.set(captureId, true);
  while (captureIds.size > MAX_REMEMBERED_CAPTURE_IDS) {
    const oldest = captureIds.keys().next().value as string | undefined;
    if (!oldest) break;
    captureIds.delete(oldest);
  }
  return true;
}

export async function sourceWithCachedIcon(
  source: ComposerAppSnapSource,
): Promise<ComposerAppSnapSource> {
  const bundleIdentifier = source.bundleIdentifier?.trim() || null;
  if (!bundleIdentifier) return source;
  if (source.appIconDataUrl) {
    await persistAppSnapIcon({
      bundleIdentifier,
      dataUrl: source.appIconDataUrl,
    }).catch((error) => console.warn("[appsnap] Could not cache source app icon", error));
    return source;
  }
  const appIconDataUrl = await readAppSnapIcon(bundleIdentifier).catch((error) => {
    console.warn("[appsnap] Could not restore source app icon", error);
    return null;
  });
  return appIconDataUrl ? { ...source, appIconDataUrl } : source;
}
