// FILE: useChatSendPreflightController.ts
// Purpose: Gate one chat send on provider availability and optional browser capture.
// Layer: Web hooks

import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type NativeApi,
  type ProviderKind,
  type ServerProviderStatus,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useRef } from "react";

import type { ComposerImageAttachment } from "../composerDraftStore";
import { toastManager } from "../components/ui/toast";
import {
  maybeResolveBrowserPromptAttachment,
  type BrowserPromptAttachmentResolution,
} from "../lib/browserPromptContext";
import { IMAGE_SIZE_LIMIT_LABEL } from "../lib/composerSend";
import { resolveProviderSendAvailabilityWithRefresh } from "../lib/providerAvailability";
import type { RefreshProviderStatusesNow } from "./useProviderStatusRefresh";

export type ChatSendPreflightResult =
  | { readonly kind: "blocked" }
  | { readonly kind: "ready"; readonly images: readonly ComposerImageAttachment[] };

export type ChatSendPreflightRun = (request: {
  api: NativeApi;
  threadId: ThreadId;
  prompt: string;
  provider: ProviderKind;
  images: readonly ComposerImageAttachment[];
  fileCount: number;
  assistantSelectionCount: number;
}) => Promise<ChatSendPreflightResult>;

export function useChatSendPreflightController(input: {
  providerStatuses: readonly ServerProviderStatus[];
  refreshProviderStatuses: RefreshProviderStatusesNow;
}) {
  const inFlightRef = useRef(false);

  const isInFlight = useCallback(() => inFlightRef.current, []);

  const run: ChatSendPreflightRun = useCallback(
    async (request: {
      api: NativeApi;
      threadId: ThreadId;
      prompt: string;
      provider: ProviderKind;
      images: readonly ComposerImageAttachment[];
      fileCount: number;
      assistantSelectionCount: number;
    }): Promise<ChatSendPreflightResult> => {
      inFlightRef.current = true;
      const availability = await (async () => {
        try {
          return await resolveProviderSendAvailabilityWithRefresh({
            provider: request.provider,
            statuses: input.providerStatuses,
            refreshStatuses: () => input.refreshProviderStatuses({ silent: true }),
          });
        } finally {
          // Browser capture can be slow; only provider discovery is a send-preflight lock.
          inFlightRef.current = false;
        }
      })();

      if (!availability.usable) {
        toastManager.add({
          type: "error",
          title: availability.unavailableReason,
        });
        return { kind: "blocked" };
      }

      const browserAttachment: BrowserPromptAttachmentResolution =
        await maybeResolveBrowserPromptAttachment({
          api: request.api,
          threadId: request.threadId,
          prompt: request.prompt,
        }).catch(
          (): BrowserPromptAttachmentResolution => ({
            requested: false,
            image: null,
          }),
        );

      let images = request.images;
      if (browserAttachment.image) {
        const nextAttachmentCount =
          images.length + request.fileCount + request.assistantSelectionCount + 1;
        if (nextAttachmentCount <= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          images = [...images, browserAttachment.image];
        } else {
          toastManager.add({
            type: "warning",
            title: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
            description:
              "The current browser screenshot was skipped because this message is already at the attachment limit.",
          });
        }
      } else if (browserAttachment.requested) {
        const description =
          browserAttachment.reason === "no-open-browser"
            ? "Open the in-app browser first, then try again."
            : browserAttachment.reason === "no-active-tab"
              ? "The in-app browser has no active tab to capture yet."
              : browserAttachment.reason === "attachment-too-large"
                ? `The browser screenshot exceeded the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`
                : "The current browser context could not be attached.";
        toastManager.add({
          type: "warning",
          title: "Couldn’t attach the in-app browser context",
          description,
        });
      }

      return { kind: "ready", images };
    },
    [input.providerStatuses, input.refreshProviderStatuses],
  );

  return { isInFlight, run };
}
