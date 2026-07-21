import { describe, expect, it } from "vitest";

import { RIGHT_DOCK_ADD_MENU_KINDS, getRightDockPaneMeta } from "./rightDockPaneMeta";

describe("RIGHT_DOCK_ADD_MENU_KINDS", () => {
  it("offers the explorer pane but not the chat-driven file pane", () => {
    // The "+" menu surfaces the file-tree explorer; single-file preview tabs are
    // opened by clicking a file reference in chat, not from the add menu.
    expect(RIGHT_DOCK_ADD_MENU_KINDS).toContain("explorer");
    expect(RIGHT_DOCK_ADD_MENU_KINDS).not.toContain("file");
  });

  it("offers only the focused Agent Group tools in product order", () => {
    expect([...RIGHT_DOCK_ADD_MENU_KINDS]).toEqual([
      "highlights",
      "sidechat",
      "explorer",
      "terminal",
      "browser",
      "diff",
    ]);
  });

  it("labels the explorer pane", () => {
    expect(getRightDockPaneMeta("explorer").label).toBe("Explorer");
  });

  it("presents the durable context pane as the Session inspector", () => {
    expect(getRightDockPaneMeta("context").label).toBe("Session");
  });

  it("labels the contextual Highlights pane", () => {
    expect(getRightDockPaneMeta("highlights").label).toBe("Highlights");
  });

  it("labels group settings separately from app settings", () => {
    expect(getRightDockPaneMeta("group").label).toBe("Group");
  });
});
