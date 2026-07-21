import { describe, expect, it } from "vitest";

import {
  disclosureChevronClassName,
  disclosureContentClassName,
  disclosureShellClassName,
  DISCLOSURE_CSS_VARIABLES,
  DISCLOSURE_EASING,
  DISCLOSURE_INSET_MOTION_CLASS,
  DISCLOSURE_ROOT_CSS,
  DISCLOSURE_SLIDE_MOTION_CLASS,
  DISCLOSURE_SHELL_CLOSED_CLASS,
  DISCLOSURE_SHELL_OPEN_CLASS,
} from "./disclosureMotion";

describe("disclosureMotion", () => {
  it("maps open state to the shared shell classes", () => {
    expect(disclosureShellClassName(true)).toContain(DISCLOSURE_SHELL_OPEN_CLASS);
    expect(disclosureShellClassName(false)).toContain(DISCLOSURE_SHELL_CLOSED_CLASS);
  });

  it("rotates the chevron when open", () => {
    expect(disclosureChevronClassName(true)).toContain("rotate-90");
    expect(disclosureChevronClassName(false)).not.toContain("rotate-90");
  });

  it("disables interaction on closed content", () => {
    expect(disclosureContentClassName(false)).toContain("pointer-events-none");
    expect(disclosureContentClassName(true)).not.toContain("pointer-events-none");
  });

  it("keeps slide and inset disclosures on the shared timing", () => {
    expect(DISCLOSURE_CSS_VARIABLES).toMatchObject({
      "--app-disclosure-duration": "220ms",
      "--app-disclosure-easing": DISCLOSURE_EASING,
    });
    expect(DISCLOSURE_ROOT_CSS).toContain("--app-disclosure-duration: 220ms");
    expect(DISCLOSURE_SLIDE_MOTION_CLASS).toContain("var(--app-disclosure-duration)");
    expect(DISCLOSURE_SLIDE_MOTION_CLASS).toContain("var(--app-disclosure-easing)");
    expect(DISCLOSURE_INSET_MOTION_CLASS).toContain("var(--app-disclosure-duration)");
    expect(DISCLOSURE_INSET_MOTION_CLASS).toContain("var(--app-disclosure-easing)");
  });
});
