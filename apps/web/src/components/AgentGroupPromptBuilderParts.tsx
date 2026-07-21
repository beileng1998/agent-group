import type { ReactNode } from "react";

import { LockIcon, RotateCcwIcon, type LucideIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { DisclosureRegion } from "./ui/DisclosureRegion";

export type PromptPreviewTurn = "first" | "later";

export function PromptViewTab(props: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      className={cn(
        "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
        props.active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function PromptBlockCard(props: {
  index: number;
  id: string;
  title: string;
  description: string;
  condition: string;
  icon: LucideIcon;
  editable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/25">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/25"
        aria-expanded={props.open}
        aria-controls={`prompt-block-${props.id}`}
        onClick={() => props.onOpenChange(!props.open)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[10px] font-medium">{props.title}</span>
            <span className="text-[8px] tabular-nums text-muted-foreground/70">
              {String(props.index).padStart(2, "0")}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
            {props.description}
          </span>
        </span>
        <span className="rounded-md bg-muted/45 px-1.5 py-0.5 text-[8px] font-medium text-muted-foreground">
          {props.condition}
          {props.editable ? " · Customizable" : ""}
        </span>
        <DisclosureChevron open={props.open} className="size-3 text-muted-foreground" />
      </button>
      <DisclosureRegion open={props.open}>
        <div id={`prompt-block-${props.id}`} className="space-y-2.5 border-t border-border p-3">
          {props.children}
        </div>
      </DisclosureRegion>
    </div>
  );
}

export function LockedPromptSource(props: { children: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground">
        <LockIcon className="size-3" /> Protected runtime data
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-2.5 font-mono text-[9px] leading-4 text-muted-foreground">
        {props.children}
      </pre>
    </div>
  );
}

export function PromptInstructionEditor(props: {
  label: string;
  value: string;
  defaultValue: string;
  openingTag: string;
  closingTag: string;
  protectedAfter?: string;
  onChange: (value: string) => void;
}) {
  const changed = props.value !== props.defaultValue;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium">{props.label}</span>
        {changed ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-5 px-1.5 text-[9px]"
            onClick={() => props.onChange(props.defaultValue)}
          >
            <RotateCcwIcon className="size-3" /> Reset
          </Button>
        ) : null}
      </div>
      <PromptXmlEditor
        label={props.label}
        value={props.value}
        openingTag={props.openingTag}
        closingTag={props.closingTag}
        {...(props.protectedAfter !== undefined
          ? { protectedAfter: props.protectedAfter }
          : {})}
        onChange={props.onChange}
      />
    </div>
  );
}

export function PromptXmlEditor(props: {
  label: string;
  value: string;
  openingTag: string;
  closingTag: string;
  protectedAfter?: string;
  placeholder?: string;
  textareaClassName?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-border bg-muted/15 font-mono">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[9px] leading-4 text-muted-foreground">
        {props.openingTag}
      </pre>
      <textarea
        aria-label={props.label}
        className={cn(
          "min-h-16 w-full resize-y border-x-0 border-y border-border bg-background/45 p-2.5 font-mono text-[10px] leading-4 outline-none focus:bg-background/70",
          props.textareaClassName,
        )}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        spellCheck={false}
      />
      {props.protectedAfter ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-b border-border bg-muted/20 px-2.5 py-2 text-[9px] leading-4 text-muted-foreground">
          {props.protectedAfter}
        </pre>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[9px] leading-4 text-muted-foreground">
        {props.closingTag}
      </pre>
    </div>
  );
}

export function AgentGroupPromptPreview(props: {
  prompt: string;
  turn: PromptPreviewTurn;
  contextEnabled: boolean;
  globalRulesIncluded: boolean;
  groupRulesIncluded: boolean;
  onTurnChange: (turn: PromptPreviewTurn) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/25">
      <div className="flex items-start justify-between gap-3 border-b border-border p-3">
        <div>
          <h3 className="text-[10px] font-medium">What the Agent receives</h3>
          <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
            Live configuration with representative runtime values.
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-muted/45 p-0.5" role="tablist">
          <PromptViewTab active={props.turn === "first"} onClick={() => props.onTurnChange("first")}>
            First
          </PromptViewTab>
          <PromptViewTab active={props.turn === "later"} onClick={() => props.onTurnChange("later")}>
            Later
          </PromptViewTab>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        <PreviewStatus active={props.contextEnabled}>
          {props.contextEnabled ? "Assembly on" : "Pass-through"}
        </PreviewStatus>
        <PreviewStatus active={props.globalRulesIncluded}>Global rules</PreviewStatus>
        <PreviewStatus active={props.groupRulesIncluded}>Group rules</PreviewStatus>
        <PreviewStatus active={props.turn === "first"}>Parent context</PreviewStatus>
      </div>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[9px] leading-4 text-foreground/80">
        {props.prompt}
      </pre>
      <div className="border-t border-border px-3 py-2 text-right text-[9px] tabular-nums text-muted-foreground">
        {props.prompt.length.toLocaleString()} characters
      </div>
    </div>
  );
}

function PreviewStatus(props: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-medium",
        props.active
          ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted/20 text-muted-foreground",
      )}
    >
      <span className={cn("size-1 rounded-full", props.active ? "bg-emerald-500" : "bg-border")} />
      {props.children}
    </span>
  );
}
