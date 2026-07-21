import type { ProjectId } from "@agent-group/contracts";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { HIGHLIGHT_SYNTHESIS_PROMPTS, type HighlightSynthesisKind } from "~/lib/highlightSynthesis";

interface SynthesisGroupOption {
  readonly id: ProjectId;
  readonly title: string;
}

const KINDS: ReadonlyArray<{ value: HighlightSynthesisKind; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "note", label: "Full note" },
  { value: "outline", label: "Outline" },
  { value: "decisions", label: "Decisions & actions" },
];

export function HighlightSynthesisDialog(props: {
  open: boolean;
  count: number;
  groups: readonly SynthesisGroupOption[];
  targetGroupId: ProjectId | null;
  targetLocked: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { instruction: string; targetGroupId: ProjectId }) => void;
}) {
  const [kind, setKind] = useState<HighlightSynthesisKind>("summary");
  const [instruction, setInstruction] = useState(HIGHLIGHT_SYNTHESIS_PROMPTS.summary);
  const [targetGroupId, setTargetGroupId] = useState<ProjectId | null>(props.targetGroupId);

  useEffect(() => {
    if (!props.open) return;
    setTargetGroupId(props.targetGroupId);
  }, [props.open, props.targetGroupId]);

  const selectKind = (next: HighlightSynthesisKind) => {
    setKind(next);
    setInstruction(HIGHLIGHT_SYNTHESIS_PROMPTS[next]);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup surface="solid" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create synthesis session</DialogTitle>
          <DialogDescription>
            Start a new session with {props.count} frozen highlight sources and explicit [H#]
            references.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-[var(--color-text-foreground-secondary)]">
              Format
            </legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="xs"
                  variant={kind === option.value ? "secondary" : "outline"}
                  onClick={() => selectKind(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-medium text-[var(--color-text-foreground-secondary)]">
            Instruction
            <Textarea
              className="mt-2"
              size="sm"
              value={instruction}
              maxLength={1_000}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>

          <label className="block text-xs font-medium text-[var(--color-text-foreground-secondary)]">
            Target group
            <select
              className="mt-2 h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background-control-opaque)] px-2.5 text-xs outline-none focus:border-[var(--color-border-focus)] disabled:opacity-60"
              value={targetGroupId ?? ""}
              disabled={props.targetLocked}
              onChange={(event) => setTargetGroupId(event.target.value as ProjectId)}
            >
              <option value="" disabled>
                Select a group
              </option>
              {props.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
          </label>

          <DialogFooter>
            <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={props.busy || !targetGroupId || !instruction.trim()}
              onClick={() => {
                if (targetGroupId) props.onConfirm({ instruction, targetGroupId });
              }}
            >
              {props.busy ? "Creating…" : "Create & start"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
