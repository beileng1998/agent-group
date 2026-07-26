import type { Terminal } from "@xterm/xterm";

import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminal/terminalRuntimeAppearance";
import { waitForTerminalFontReady } from "../terminal/terminalFontSettle";

export function observeManagedAgentTerminalAppearance(
  terminal: Terminal,
  onSettled: () => void,
  isDisposed: () => boolean,
): MutationObserver {
  const sync = () => {
    terminal.options.theme = terminalThemeFromApp();
    terminal.options.fontFamily = getTerminalFontFamily();
    terminal.options.fontSize = getTerminalFontSizePx();
    terminal.options.fontWeight = getTerminalFontWeight();
    terminal.options.fontWeightBold = getTerminalBoldFontWeight();
    const fontFamily = String(terminal.options.fontFamily ?? "").trim();
    if (!fontFamily) {
      onSettled();
      return;
    }
    void waitForTerminalFontReady({
      fontFamily,
      fontSize: Number(terminal.options.fontSize ?? 12),
    }).then(() => {
      if (isDisposed()) return;
      terminal.clearTextureAtlas();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
      onSettled();
    });
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  sync();
  return observer;
}
