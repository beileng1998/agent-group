import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TranscriptSelectionAction } from "./TranscriptSelectionAction";

describe("TranscriptSelectionAction", () => {
  it("offers Side only when the caller can create one", () => {
    const baseProps = {
      left: 12,
      top: 24,
      placement: "top" as const,
      onAddToChat: vi.fn(),
    };

    expect(renderToStaticMarkup(<TranscriptSelectionAction {...baseProps} />)).not.toContain(
      "Ask in Side",
    );
    expect(
      renderToStaticMarkup(<TranscriptSelectionAction {...baseProps} onAskInSidechat={vi.fn()} />),
    ).toContain("Ask in Side");
  });

  it("offers the visible Side as an explicit target without changing Add to chat", () => {
    const markup = renderToStaticMarkup(
      <TranscriptSelectionAction
        left={12}
        top={24}
        placement="top"
        onAddToChat={vi.fn()}
        onAddToSidechat={vi.fn()}
      />,
    );

    expect(markup).toContain("Add to chat");
    expect(markup).toContain("Add to Side");
  });
});
