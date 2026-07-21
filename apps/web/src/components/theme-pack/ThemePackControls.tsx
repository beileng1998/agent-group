// FILE: ThemePackControls.tsx
// Purpose: Theme color, font, code-theme, and contrast editor controls.
// Layer: Web settings UI

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import type { ChromeTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import {
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CONTROL_RADIUS_CLASS_NAME,
} from "../../settingsPanelStyles";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_PICKER_COMMIT_DELAY_MS = 220;

export function ThemeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        SETTINGS_CARD_ROW_CLASS_NAME,
        "flex min-h-12 items-center justify-between gap-3",
      )}
    >
      <span className="text-sm text-foreground/90">{label}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function ColorPill({
  color,
  ariaLabel,
  onChange,
  onReset,
}: {
  color: string;
  ariaLabel: string;
  onChange: (next: string) => void;
  onReset?: (() => void) | undefined;
}) {
  const commitTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const colorRef = useRef(color);
  const [draftHex, setDraftHex] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const normalizedDraftHex = draftHex?.trim().toLowerCase() ?? null;
  const previewColor =
    normalizedDraftHex && HEX_COLOR_RE.test(normalizedDraftHex) ? normalizedDraftHex : color;
  const inputValue = draftHex ?? color;
  const textColor = useReadableTextColor(previewColor);
  const ringColor = useReadableTextColor(previewColor, 0.32);

  useEffect(() => {
    colorRef.current = color;
    setDraftHex((current) => (current === color ? null : current));
  }, [color]);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current === null) return;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }, []);

  const commitColor = useCallback(
    (next: string | null = pendingCommitRef.current) => {
      clearCommitTimer();
      pendingCommitRef.current = null;
      if (!next || next === colorRef.current) return;
      onChange(next);
    },
    [clearCommitTimer, onChange],
  );

  const scheduleCommit = useCallback(
    (next: string) => {
      pendingCommitRef.current = next;
      clearCommitTimer();
      commitTimerRef.current = window.setTimeout(
        () => commitColor(next),
        COLOR_PICKER_COMMIT_DELAY_MS,
      );
    },
    [clearCommitTimer, commitColor],
  );

  useEffect(() => () => clearCommitTimer(), [clearCommitTimer]);

  const handleValidDraft = (next: string) => {
    const normalized = next.trim().toLowerCase();
    setDraftHex(normalized);
    scheduleCommit(normalized);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      commitColor();
      setDraftHex(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {onReset ? (
        <button
          type="button"
          onClick={() => {
            clearCommitTimer();
            pendingCommitRef.current = null;
            setDraftHex(null);
            onReset();
          }}
          className="rounded-md p-1 text-[var(--color-text-foreground-tertiary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          aria-label={`Reset ${ariaLabel}`}
          title="Reset to default"
        >
          <ResetGlyph />
        </button>
      ) : null}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                SETTINGS_CONTROL_RADIUS_CLASS_NAME,
                "group relative flex h-8 min-w-44 items-center gap-2 overflow-hidden border px-2 pr-3 text-left transition-[transform,box-shadow] hover:scale-[1.005] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              )}
              style={{ backgroundColor: previewColor, color: textColor, borderColor: ringColor }}
              aria-label={ariaLabel}
            />
          }
        >
          <span
            aria-hidden
            className="block size-5 shrink-0 rounded-full border"
            style={{ borderColor: ringColor }}
          />
          <span className="font-system-ui flex-1 text-[12px] uppercase">{previewColor}</span>
        </PopoverTrigger>
        <PopoverPopup
          align="end"
          side="bottom"
          sideOffset={8}
          className="p-0 [&_[data-slot=popover-viewport]]:p-0"
        >
          <div className="theme-color-picker flex w-56 flex-col gap-3 p-3">
            <HexColorPicker color={previewColor} onChange={handleValidDraft} />
            <input
              type="text"
              value={inputValue}
              onChange={(event) => {
                const next = event.target.value;
                setDraftHex(next);
                if (HEX_COLOR_RE.test(next.trim())) handleValidDraft(next);
              }}
              onBlur={() => {
                commitColor();
                setDraftHex(null);
              }}
              spellCheck={false}
              maxLength={7}
              className={cn(
                SETTINGS_CONTROL_RADIUS_CLASS_NAME,
                "h-8 border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-2 text-center font-chat-code text-xs uppercase outline-none focus:border-[color:var(--color-border-focus)]",
              )}
              aria-label={`${ariaLabel} hex value`}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function CodeThemeBadge({ theme }: { theme: ChromeTheme }) {
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold leading-none"
      style={{
        backgroundColor: theme.surface,
        borderColor: mixColor(theme.surface, theme.ink, 0.16),
        color: theme.accent,
      }}
    >
      Aa
    </span>
  );
}

export function CodeThemeSelectOption({ label, theme }: { label: string; theme: ChromeTheme }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CodeThemeBadge theme={theme} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-[var(--color-text-foreground)]">{label}</div>
      </div>
    </div>
  );
}

export function FontInput({
  value,
  placeholder,
  ariaLabel,
  mono = false,
  onChange,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  mono?: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }}
      onBlur={() => setDraft(null)}
      spellCheck={false}
      aria-label={ariaLabel}
      className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "w-56", mono && "font-chat-code")}
    />
  );
}

export function ContrastSlider({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const id = useId();
  const fillPct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={ariaLabel}
        className="theme-slider h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-transparent focus-visible:outline-none"
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${fillPct}%, var(--input) ${fillPct}%, var(--input) 100%)`,
        }}
      />
      <span className="w-7 text-right font-chat-code text-xs text-muted-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

function useReadableTextColor(hex: string, alpha = 1): string {
  const rgb = parseHex(hex);
  if (!rgb) return alpha === 1 ? "#ffffff" : `rgba(255,255,255,${alpha})`;
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  if (luminance > 0.6) return alpha === 1 ? "#1a1c1f" : `rgba(26,28,31,${alpha})`;
  return alpha === 1 ? "#ffffff" : `rgba(255,255,255,${alpha})`;
}

function ResetGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  );
}

function mixColor(fromHex: string, toHex: string, amount: number): string {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  if (!from || !to) return fromHex;
  const clamped = Math.max(0, Math.min(1, amount));
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_COLOR_RE.test(hex)) return null;
  const value = hex.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}
