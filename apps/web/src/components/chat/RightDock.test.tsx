// FILE: RightDock.test.tsx
// Purpose: Guards adaptive dock geometry against nested sidebar variable collisions.
// Layer: Chat right-dock rendering tests

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RightDockPane } from "~/rightDockStore.logic";
import { RightDock } from "./RightDock";

const contextPane: RightDockPane = {
  id: "context",
  kind: "context",
  threadId: null,
  diffTurnId: null,
  diffFilePath: null,
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
};

describe("RightDock", () => {
  it("uses a dock-owned width variable inside the nested sidebar provider", () => {
    const html = renderToStaticMarkup(
      <RightDock
        state={{ open: true, panes: [contextPane], activePaneId: contextPane.id }}
        minWidth={416}
        defaultWidth="50%"
        shouldAcceptWidth={() => true}
        addMenuKinds={[]}
        onClosePane={() => {}}
        onCollapse={() => {}}
        onAddPane={() => {}}
        renderPane={() => <div>Session content</div>}
      />,
    );

    expect(html).toContain("--right-dock-width:50%");
    expect(html).toContain("var(--right-dock-width)");
    expect(html).toContain("w-(--right-dock-width)");
    expect(html).not.toContain("w-(--sidebar-width)");
  });
});
