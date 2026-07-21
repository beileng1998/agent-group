import { type ModelSelection, type ProviderOptionDescriptor } from "@agent-group/contracts";
import {
  getModelCapabilities,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@agent-group/shared/model";
import { useEffect, useState, type ReactNode } from "react";

import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import {
  buildModelSelection,
  buildNextProviderOptions,
  buildProviderOptionPatch,
  type ProviderOptions,
} from "~/providerModelOptions";

import type { SelectOption } from "./automationDetailValues";

export function DetailGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-0.5">
      <h2 className="px-1.5 pb-1 text-xs font-medium text-muted-foreground/70">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function DetailRow({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-xs">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}

export function StatusValue({
  tone = "default",
  children,
}: {
  readonly tone?: "default" | "muted";
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        tone === "muted" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function EditRow({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md py-px pl-1.5 pr-0.5 text-xs transition-colors hover:bg-foreground/[0.04]">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export const INLINE_CONTROL_CLASS =
  "cursor-pointer rounded-md bg-transparent px-2 py-1.5 text-right text-xs text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring";

export function InlineSelect({
  value,
  options,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative flex min-w-0 items-center">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INLINE_CONTROL_CLASS, "max-w-[11rem] appearance-none truncate pr-5")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CentralIcon
        name="chevron-down-small"
        className="pointer-events-none absolute right-1 size-3 text-muted-foreground"
      />
    </div>
  );
}

function InlineToggle({
  value,
  onChange,
}: {
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(INLINE_CONTROL_CLASS, "min-w-[3rem]")}
    >
      {value ? "On" : "Off"}
    </button>
  );
}

export function ModelOptionRows({
  modelSelection,
  onChange,
}: {
  readonly modelSelection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}) {
  const { provider, model } = modelSelection;
  const caps = getModelCapabilities(provider, model);
  const descriptors = getProviderOptionDescriptors({
    provider,
    caps,
    selections: modelSelection.options as Record<string, unknown> | undefined,
  });
  if (descriptors.length === 0) return null;

  const setOption = (descriptor: ProviderOptionDescriptor, value: string | boolean) => {
    const optionPatch = buildProviderOptionPatch(provider, descriptor.id, value);
    const nextOptions = buildNextProviderOptions(
      provider,
      modelSelection.options as ProviderOptions | undefined,
      optionPatch,
    );
    onChange(buildModelSelection(provider, model, nextOptions));
  };

  return (
    <>
      {descriptors.map((descriptor) => {
        if (descriptor.type === "boolean") {
          return (
            <EditRow key={descriptor.id} label={descriptor.label}>
              <InlineToggle
                value={getProviderOptionCurrentValue(descriptor) === true}
                onChange={(checked) => setOption(descriptor, checked)}
              />
            </EditRow>
          );
        }
        const current = getProviderOptionCurrentValue(descriptor);
        return (
          <EditRow key={descriptor.id} label={descriptor.label}>
            <InlineSelect
              value={typeof current === "string" ? current : ""}
              options={descriptor.options.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              onChange={(value) => setOption(descriptor, value)}
            />
          </EditRow>
        );
      })}
    </>
  );
}

export function InlineTime({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={INLINE_CONTROL_CLASS}
    />
  );
}

export function InlineCommitTextInput({
  value,
  onCommit,
  className,
  placeholder,
}: {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly className?: string;
  readonly placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commitDraft = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(INLINE_CONTROL_CLASS, className)}
    />
  );
}
