// FILE: RightDock.browser.tsx
// Purpose: Verifies the horizontal dock paints the full width reserved by its shell.
// Layer: Chat right-dock browser tests

import { render } from "vitest-browser-react";
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

describe("RightDock horizontal geometry", () => {
  it("fills the entire width reserved by the dock root", async () => {
    const screen = await render(
      <div style={{ display: "flex", width: 1200, height: 800 }}>
        <main style={{ flex: 1 }}>Chat</main>
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
        />
      </div>,
    );

    const root = screen.container.querySelector<HTMLElement>("[data-right-dock-root]");
    const content = screen.container.querySelector<HTMLElement>("[data-right-dock-content]");
    expect(root).not.toBeNull();
    expect(content).not.toBeNull();

    await expect.poll(() => Math.round(root?.getBoundingClientRect().width ?? 0)).toBe(600);
    expect(Math.round(content?.getBoundingClientRect().width ?? 0)).toBe(600);
  });
});
