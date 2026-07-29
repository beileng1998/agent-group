// FILE: MessagesTimeline.toolDisclosure.tsx
// Purpose: Shared live-turn partitioning and default-collapsed tool disclosure.
// Layer: Web chat timeline presentation

import type { ReactNode } from "react";
import { disclosureContentClassName } from "~/lib/disclosureMotion";
import type { WorkLogEntry } from "../../session-logic";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { isReasoningUpdateWorkEntry } from "./agentActivity.logic";

export function partitionLiveWorkEntries(entries: ReadonlyArray<WorkLogEntry>) {
  const reasoningEntries: WorkLogEntry[] = [];
  const toolEntries: WorkLogEntry[] = [];
  const statusEntries: WorkLogEntry[] = [];
  const visibleEntries: WorkLogEntry[] = [];
  for (const entry of entries) {
    if (isReasoningUpdateWorkEntry(entry)) {
      reasoningEntries.push(entry);
      visibleEntries.push(entry);
    } else if (entry.tone === "tool") {
      toolEntries.push(entry);
    } else {
      statusEntries.push(entry);
      visibleEntries.push(entry);
    }
  }
  return { reasoningEntries, statusEntries, toolEntries, visibleEntries };
}

export function ToolEntriesDisclosure(props: {
  children: ReactNode;
  count: number;
  fontSizePx: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const toolLabel = props.count === 1 ? "tool" : "tools";
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger
        className="group/process inline-flex items-center gap-1 py-0.5 text-left text-muted-foreground/60 transition-colors duration-200 hover:text-muted-foreground/90"
        style={{ fontSize: `${props.fontSizePx}px` }}
      >
        <span>
          Process{" "}
          <span className="text-muted-foreground/45">
            {props.count} {toolLabel}
          </span>
        </span>
        <DisclosureChevron open={props.open} className="text-muted-foreground/45" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className={disclosureContentClassName(props.open, "space-y-px pt-1")}>
          {props.children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
