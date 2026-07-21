import type { ProviderEvent, ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";

import {
  codexGeneratedImageArtifact,
  extractCodexGeneratedImageReference,
} from "../codexGeneratedImages.ts";
import {
  codexGeneratedImageThreadId,
  runtimeEventBase,
  withSanitizedGeneratedImageRaw,
} from "./codexEventBase.ts";
import {
  asObject,
  itemDetail,
  itemStatus,
  itemTitle,
  reasoningSummaryDetail,
  toCanonicalItemType,
} from "./codexEventValues.ts";

export function mapCodexItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: "item.started" | "item.updated" | "item.completed",
): ProviderRuntimeEvent | undefined {
  const payload = asObject(event.payload);
  const item = asObject(payload?.item);
  const source = item ?? payload;
  if (!source) {
    return undefined;
  }

  const itemType = toCanonicalItemType(source.type ?? source.kind);
  if (itemType === "unknown" && lifecycle !== "item.updated") {
    return undefined;
  }
  const generatedImageReference =
    itemType === "image_generation"
      ? extractCodexGeneratedImageReference({
          value: source,
          threadId: codexGeneratedImageThreadId(event, payload) ?? canonicalThreadId,
        })
      : undefined;
  if (
    lifecycle === "item.completed" &&
    itemType === "image_generation" &&
    !generatedImageReference
  ) {
    return undefined;
  }

  const canonicalItemType =
    lifecycle === "item.completed" && itemType === "review_exited" ? "assistant_message" : itemType;
  const detail =
    itemType === "reasoning" ? reasoningSummaryDetail(source) : itemDetail(source, payload ?? {});
  const status = itemStatus(lifecycle, source.status);

  return {
    ...(generatedImageReference
      ? withSanitizedGeneratedImageRaw(
          runtimeEventBase(event, canonicalThreadId),
          event,
          canonicalThreadId,
        )
      : runtimeEventBase(event, canonicalThreadId)),
    type: lifecycle,
    payload: {
      itemType: canonicalItemType,
      ...(status ? { status } : {}),
      ...(itemTitle(canonicalItemType) ? { title: itemTitle(canonicalItemType) } : {}),
      ...(generatedImageReference
        ? { detail: generatedImageReference.path }
        : detail
          ? { detail }
          : {}),
      ...(generatedImageReference
        ? { data: codexGeneratedImageArtifact(generatedImageReference) }
        : event.payload !== undefined
          ? { data: event.payload }
          : {}),
    },
  };
}
