import { describe, expect, it } from "vitest";

import {
  clampBottomDockHeight,
  defaultBottomDockHeight,
  resolveRightDockPlacement,
  RIGHT_DOCK_BOTTOM_MIN_HEIGHT_PX,
  RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX,
} from "./rightDockPlacement";

describe("resolveRightDockPlacement", () => {
  it("keeps automatic docks on the right in a wide landscape host", () => {
    expect(
      resolveRightDockPlacement({ preference: "auto", hostWidth: 1280, hostHeight: 800 }),
    ).toBe("right");
  });

  it("moves automatic docks below narrow or portrait hosts", () => {
    expect(resolveRightDockPlacement({ preference: "auto", hostWidth: 900, hostHeight: 700 })).toBe(
      "bottom",
    );
    expect(
      resolveRightDockPlacement({ preference: "auto", hostWidth: 1100, hostHeight: 1600 }),
    ).toBe("bottom");
  });

  it("keeps a short host side by side when stacking would leave no readable panes", () => {
    expect(resolveRightDockPlacement({ preference: "auto", hostWidth: 700, hostHeight: 500 })).toBe(
      "right",
    );
  });

  it("honors an explicit placement regardless of host shape", () => {
    expect(
      resolveRightDockPlacement({ preference: "right", hostWidth: 700, hostHeight: 1200 }),
    ).toBe("right");
    expect(
      resolveRightDockPlacement({ preference: "bottom", hostWidth: 1600, hostHeight: 900 }),
    ).toBe("bottom");
  });
});

describe("bottom dock sizing", () => {
  it("opens at half height when both surfaces remain readable", () => {
    expect(defaultBottomDockHeight(900)).toBe(450);
  });

  it("clamps between the dock and primary-surface floors", () => {
    expect(clampBottomDockHeight(10, 900)).toBe(RIGHT_DOCK_BOTTOM_MIN_HEIGHT_PX);
    expect(clampBottomDockHeight(1000, 900)).toBe(900 - RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX);
  });

  it("lets the dock shrink below its normal floor in a short host", () => {
    expect(clampBottomDockHeight(300, 500)).toBe(500 - RIGHT_DOCK_PRIMARY_MIN_HEIGHT_PX);
  });
});
