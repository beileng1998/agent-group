import { describe, expect, it } from "vitest";

import { isTerminalQueryReply } from "./terminalQueryReply";

describe("managed terminal query reply classifier", () => {
  it.each([
    "\u001b[3;1R",
    "\u001b[0n",
    "\u001b[?1;2c",
    "\u001b[>0;276;0c",
    "\u001b[6;16;8t",
    "\u001b[?2026;2$y",
    "\u001b[?31u",
    "\u001b]11;rgb:2828/2c2c/3434\u001b\\",
    "\u001bP1$r2 q\u001b\\",
  ])("recognizes xterm's synthetic reply %j", (reply) => {
    expect(isTerminalQueryReply(reply)).toBe(true);
  });

  it.each(["yes", "\r", "\u0003", "\u001b[A", "\u001b[15~", "\u001b[97;5u", "\u001b[200~"])(
    "preserves ordinary terminal input %j",
    (input) => {
      expect(isTerminalQueryReply(input)).toBe(false);
    },
  );
});
