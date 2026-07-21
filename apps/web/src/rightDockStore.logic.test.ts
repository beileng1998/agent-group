import { describe, expect, it } from "vitest";

import {
  RIGHT_DOCK_PANE_KINDS,
  SINGLETON_PANE_KINDS,
  closePaneInState,
  createDefaultRightDockState,
  ensurePaneInState,
  isRightDockPaneKind,
  openPaneInState,
  sanitizeRightDockStateByThreadId,
  sanitizeRightDockThreadState,
  updatePaneInState,
} from "./rightDockStore.logic";

describe("RIGHT_DOCK_PANE_KINDS (single source of truth)", () => {
  it("lists every supported kind", () => {
    expect([...RIGHT_DOCK_PANE_KINDS]).toEqual([
      "context",
      "highlights",
      "group",
      "browser",
      "diff",
      "explorer",
      "file",
      "terminal",
      "sidechat",
      "git",
      "pullRequest",
    ]);
  });

  it("derives singletons as every kind except the multi-instance ones", () => {
    for (const kind of RIGHT_DOCK_PANE_KINDS) {
      expect(SINGLETON_PANE_KINDS.has(kind)).toBe(kind !== "sidechat" && kind !== "file");
    }
  });
});

describe("isRightDockPaneKind", () => {
  it("accepts the known pane kinds", () => {
    for (const kind of [
      "context",
      "highlights",
      "group",
      "browser",
      "diff",
      "explorer",
      "file",
      "terminal",
      "sidechat",
      "git",
      "pullRequest",
    ]) {
      expect(isRightDockPaneKind(kind)).toBe(true);
    }
  });

  it("rejects unknown or malformed kinds", () => {
    expect(isRightDockPaneKind("plan")).toBe(false);
    expect(isRightDockPaneKind(undefined)).toBe(false);
    expect(isRightDockPaneKind(null)).toBe(false);
    expect(isRightDockPaneKind(42)).toBe(false);
  });
});

describe("pull request pane", () => {
  it("reuses the singleton pane and updates its PR identity", () => {
    const first = openPaneInState(createDefaultRightDockState(), {
      paneId: "pr-1",
      kind: "pullRequest",
      pullRequestProjectId: "project-1" as never,
      pullRequestRepository: "acme/one",
      pullRequestNumber: 12,
      pullRequestInitialTab: "summary",
    });
    const reopened = openPaneInState(first, {
      paneId: "pr-2",
      kind: "pullRequest",
      pullRequestProjectId: "project-2" as never,
      pullRequestRepository: "acme/two",
      pullRequestNumber: 24,
      pullRequestInitialTab: "code",
    });
    expect(reopened.panes).toHaveLength(1);
    expect(reopened.activePaneId).toBe("pr-1");
    expect(reopened.panes[0]?.pullRequestProjectId).toBe("project-2");
    expect(reopened.panes[0]?.pullRequestRepository).toBe("acme/two");
    expect(reopened.panes[0]?.pullRequestNumber).toBe(24);
    expect(reopened.panes[0]?.pullRequestInitialTab).toBe("code");
  });

  it("drops persisted pull request panes from the Agent Group surface", () => {
    const sanitized = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "pr-1",
      panes: [
        {
          paneId: "ignored",
          id: "pr-1",
          kind: "pullRequest",
          pullRequestNumber: 1.5,
        },
      ],
    });
    expect(sanitized.panes).toEqual([]);
  });
});

describe("sanitizeRightDockThreadState", () => {
  it("keeps recognized panes and a valid active tab", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "b",
      panes: [
        { id: "a", kind: "diff", threadId: null, diffTurnId: null, diffFilePath: null },
        { id: "b", kind: "terminal", threadId: null, diffTurnId: null, diffFilePath: null },
      ],
    });
    expect(state.panes.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(state.activePaneId).toBe("b");
    expect(state.open).toBe(true);
  });

  it("keeps temporary sidechat panes reachable across reloads", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "side",
      panes: [{ id: "side", kind: "sidechat", threadId: "thread-side" }],
    });

    expect(state.panes).toHaveLength(1);
    expect(state.panes[0]).toMatchObject({
      kind: "sidechat",
      threadId: "thread-side",
    });
  });

  it("drops panes with an unknown kind and repoints the active tab", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "legacy",
      panes: [
        { id: "legacy", kind: "scrabble", threadId: null, diffTurnId: null, diffFilePath: null },
        { id: "keep", kind: "browser", threadId: null, diffTurnId: null, diffFilePath: null },
      ],
    });
    expect(state.panes.map((pane) => pane.id)).toEqual(["keep"]);
    expect(state.activePaneId).toBe("keep");
    expect(state.open).toBe(true);
  });

  it("forces the dock closed when no valid panes survive", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "legacy",
      panes: [
        { id: "legacy", kind: "scrabble", threadId: null, diffTurnId: null, diffFilePath: null },
      ],
    });
    expect(state.panes).toEqual([]);
    expect(state.activePaneId).toBeNull();
    expect(state.open).toBe(false);
  });

  it("returns the default state for malformed input", () => {
    expect(sanitizeRightDockThreadState(null)).toEqual({
      open: false,
      panes: [],
      activePaneId: null,
    });
    expect(sanitizeRightDockThreadState({ panes: "nope" })).toEqual({
      open: false,
      panes: [],
      activePaneId: null,
    });
  });
});

describe("context pane", () => {
  it("is added to a new thread without opening the dock", () => {
    const state = ensurePaneInState(createDefaultRightDockState(), {
      paneId: "context",
      kind: "context",
    });

    expect(state.open).toBe(false);
    expect(state.activePaneId).toBe("context");
    expect(state.panes.map((pane) => pane.kind)).toEqual(["context"]);
  });

  it("preserves a remembered open dock and active tab while adding context", () => {
    const browser = openPaneInState(createDefaultRightDockState(), {
      paneId: "browser",
      kind: "browser",
    });
    const state = ensurePaneInState(browser, {
      paneId: "context",
      kind: "context",
    });

    expect(state.open).toBe(true);
    expect(state.activePaneId).toBe("browser");
    expect(state.panes.map((pane) => pane.kind)).toEqual(["context", "browser"]);
  });

  it("is inserted first and cannot be closed", () => {
    const browser = openPaneInState(createDefaultRightDockState(), {
      paneId: "browser",
      kind: "browser",
    });
    const withContext = openPaneInState(browser, {
      paneId: "context",
      kind: "context",
    });

    expect(withContext.panes.map((pane) => pane.kind)).toEqual(["context", "browser"]);
    expect(closePaneInState(withContext, "context")).toBe(withContext);
  });

  it("moves a persisted context pane to the first position", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "browser",
      panes: [
        { id: "browser", kind: "browser" },
        { id: "context", kind: "context" },
      ],
    });

    expect(state.panes.map((pane) => pane.kind)).toEqual(["context", "browser"]);
    expect(state.activePaneId).toBe("browser");
  });
});

describe("group pane", () => {
  it("is a closable singleton ordered after context and before tools", () => {
    const browser = openPaneInState(createDefaultRightDockState(), {
      paneId: "browser",
      kind: "browser",
    });
    const group = openPaneInState(browser, { paneId: "group", kind: "group" });
    const complete = openPaneInState(group, { paneId: "context", kind: "context" });

    expect(complete.panes.map((pane) => pane.kind)).toEqual(["context", "group", "browser"]);
    expect(closePaneInState(complete, "group").panes.map((pane) => pane.kind)).toEqual([
      "context",
      "browser",
    ]);
    expect(
      openPaneInState(complete, { paneId: "another-group", kind: "group" }).panes.filter(
        (pane) => pane.kind === "group",
      ),
    ).toHaveLength(1);
  });

  it("restores persisted control panes in their fixed order", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "group",
      panes: [
        { id: "browser", kind: "browser" },
        { id: "group", kind: "group" },
        { id: "context", kind: "context" },
      ],
    });

    expect(state.panes.map((pane) => pane.kind)).toEqual(["context", "group", "browser"]);
    expect(state.activePaneId).toBe("group");
  });
});

describe("file panes", () => {
  it("opens a file pane carrying the file path", () => {
    const state = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
      filePath: "src/page.tsx",
    });
    expect(state.open).toBe(true);
    expect(state.activePaneId).toBe("f1");
    expect(state.panes).toHaveLength(1);
    expect(state.panes[0]?.filePath).toBe("src/page.tsx");
  });

  it("opens another file in a new tab instead of swapping the existing pane", () => {
    const first = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
      filePath: "src/page.tsx",
    });
    const second = openPaneInState(first, {
      paneId: "f2",
      kind: "file",
      filePath: "README.md",
    });
    expect(second.panes).toHaveLength(2);
    expect(second.panes[0]?.filePath).toBe("src/page.tsx");
    expect(second.panes[1]?.filePath).toBe("README.md");
    expect(second.activePaneId).toBe("f2");
  });

  it("focuses the existing tab when the same file is opened again", () => {
    const first = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
      filePath: "src/page.tsx",
    });
    const second = openPaneInState(first, {
      paneId: "f2",
      kind: "file",
      filePath: "README.md",
    });
    const reopened = openPaneInState(second, {
      paneId: "f3",
      kind: "file",
      filePath: "src/page.tsx",
    });
    expect(reopened.panes).toHaveLength(2);
    expect(reopened.activePaneId).toBe("f1");
  });

  it("reuses an existing empty file pane on a bare open", () => {
    const first = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
    });
    const reopened = openPaneInState({ ...first, open: false }, { paneId: "f2", kind: "file" });
    expect(reopened.open).toBe(true);
    expect(reopened.panes).toHaveLength(1);
    expect(reopened.activePaneId).toBe("f1");
  });

  it("adds a new empty tab on a bare open when every file pane is occupied", () => {
    const first = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
      filePath: "src/page.tsx",
    });
    const second = openPaneInState(first, { paneId: "f2", kind: "file" });
    expect(second.panes).toHaveLength(2);
    expect(second.panes[1]?.filePath).toBeNull();
    expect(second.activePaneId).toBe("f2");
  });

  it("updates the file path through updatePaneInState", () => {
    const state = openPaneInState(createDefaultRightDockState(), {
      paneId: "f1",
      kind: "file",
      filePath: "src/page.tsx",
    });
    const updated = updatePaneInState(state, "f1", { filePath: "src/other.tsx" });
    expect(updated.panes[0]?.filePath).toBe("src/other.tsx");
    expect(updatePaneInState(updated, "f1", { filePath: "src/other.tsx" })).toBe(updated);
  });

  it("sanitizes persisted file panes, preserving the file path", () => {
    const state = sanitizeRightDockThreadState({
      open: true,
      activePaneId: "f1",
      panes: [
        {
          id: "f1",
          kind: "file",
          threadId: null,
          diffTurnId: null,
          diffFilePath: null,
          filePath: "src/page.tsx",
        },
      ],
    });
    expect(state.panes[0]?.kind).toBe("file");
    expect(state.panes[0]?.filePath).toBe("src/page.tsx");
  });
});

describe("sanitizeRightDockStateByThreadId", () => {
  it("sanitizes every thread entry and skips undefined values", () => {
    const result = sanitizeRightDockStateByThreadId({
      t1: {
        open: true,
        activePaneId: "x",
        panes: [{ id: "x", kind: "browser", threadId: null, diffTurnId: null, diffFilePath: null }],
      },
      t2: undefined,
    });
    expect(Object.keys(result)).toEqual(["t1"]);
    expect(result.t1?.panes).toHaveLength(1);
  });

  it("returns an empty map for non-object input", () => {
    expect(sanitizeRightDockStateByThreadId(null)).toEqual({});
    expect(sanitizeRightDockStateByThreadId("oops")).toEqual({});
  });
});
