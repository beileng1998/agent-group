// FILE: useExpandedImageController.ts
// Purpose: Own expanded transcript-image state, thread reset, and keyboard navigation.
// Layer: Web chat controller

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import type { ExpandedImagePreview } from "../components/chat/ExpandedImagePreview";

export function useExpandedImageController(threadKey: string) {
  const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);

  const open = useCallback((nextPreview: ExpandedImagePreview) => {
    setPreview(nextPreview);
  }, []);
  const close = useCallback(() => {
    setPreview(null);
  }, []);
  const navigate = useCallback((direction: -1 | 1) => {
    setPreview((existing) => {
      if (!existing || existing.images.length <= 1) return existing;
      const nextIndex =
        (existing.index + direction + existing.images.length) % existing.images.length;
      return nextIndex === existing.index ? existing : { ...existing, index: nextIndex };
    });
  }, []);

  useLayoutEffect(() => {
    // ChatView stays mounted across thread switches; reset before the next paint.
    setPreview(null);
  }, [threadKey]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (preview.images.length <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigate(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigate(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, navigate, preview]);

  return { preview, open, close, navigate };
}
