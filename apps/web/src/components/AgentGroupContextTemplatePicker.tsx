import type {
  AgentGroupContextTemplate,
  AgentGroupContextTemplateId,
} from "@agent-group/contracts";

import { CheckIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

export function AgentGroupContextTemplatePicker(props: {
  templates: readonly AgentGroupContextTemplate[];
  value: AgentGroupContextTemplateId | null;
  legacyContent: string;
  onChange: (value: AgentGroupContextTemplateId) => void;
}) {
  const inferred = props.templates.find((template) => template.content === props.legacyContent);
  const selectedId = props.value ?? inferred?.id ?? null;
  const unavailable = selectedId
    ? !props.templates.some((template) => template.id === selectedId)
    : !inferred;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">Context template</span>
        <span className="text-[10px] text-muted-foreground">New Sessions only</span>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Context template">
        {props.templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            selected={selectedId === template.id}
            onClick={() => props.onChange(template.id)}
          />
        ))}
        {unavailable ? (
          <div className="min-h-28 rounded-lg border border-dashed border-border bg-background/25 p-3 text-left">
            <span className="block text-xs font-semibold">Previous custom template</span>
            <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
              Select a template from the shared library to replace it.
            </span>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Templates are managed in Settings → Agent Groups.
      </p>
    </div>
  );
}

function TemplateCard(props: {
  template: AgentGroupContextTemplate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      className={cn(
        "relative min-h-28 rounded-lg border bg-background/40 p-3 text-left outline-none transition-colors hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring/60",
        props.selected ? "border-foreground" : "border-border",
      )}
      onClick={props.onClick}
    >
      <span className="block pe-5 text-xs font-semibold">{props.template.name}</span>
      {props.selected ? <CheckIcon className="absolute end-3 top-3 size-3.5" /> : null}
      <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
        {props.template.description}
      </span>
      <pre className="mt-3 line-clamp-3 whitespace-pre-wrap font-mono text-[9px] leading-4 text-muted-foreground/75">
        {templatePreview(props.template.content)}
      </pre>
    </button>
  );
}

function templatePreview(content: string): string {
  const headings = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line));
  return headings.length > 0 ? headings.join("\n") : content.trim().slice(0, 180);
}
