// FILE: MessagesTimeline.workEntryModel.tsx
// Purpose: Normalize work-entry labels, icons, previews, and tooltip content.
// Layer: Web chat timeline presentation model

import type { ReactElement, ReactNode } from "react";
import { isFileChangeWorkLogEntry } from "../../session-logic";
import { deriveReadableCommandDisplay, resolveCommandVisualKind } from "../../lib/toolCallLabel";
import {
  formatSubagentModelLabel,
  humanizeSubagentStatus,
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
} from "../../lib/subagentPresentation";
import {
  formatAgentActivityEntryPreview,
  isCodexActivityStatusWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import {
  ArrowUpCircleIcon,
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleQuestionIcon,
  EyeIcon,
  GitHubIcon,
  HammerIcon,
  PencilIcon,
  SearchIcon,
  SkillCubeIcon,
  TerminalIcon,
  WebSearchIcon,
  ZapIcon,
  type LucideIcon,
} from "~/lib/icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { normalizeCompactToolLabel, type MessagesTimelineRow } from "./MessagesTimeline.logic";

export type TimelineWorkEntry = Extract<
  MessagesTimelineRow,
  { kind: "work" }
>["groupedEntries"][number];

const AgentTaskIcon: LucideIcon = (props) => <BotIcon {...props} />;

export function basename(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): LucideIcon {
  if (tone === "error") return CircleAlertIcon;
  if (tone === "thinking") return BotIcon;
  if (tone === "info") return CheckIcon;
  return ZapIcon;
}

export function extractFilePathFromDetail(detail: string): string | null {
  const plainPathMatch = /^(.+?\.[A-Za-z0-9][A-Za-z0-9._-]*)(?::\d+)?(?::\d+)?$/u.exec(
    detail.trim(),
  );
  if (plainPathMatch?.[1]?.includes("/")) return plainPathMatch[1].trim();
  const jsonStart = detail.indexOf("{");
  if (jsonStart < 0) return null;
  const jsonEnd = detail.lastIndexOf("}");
  if (jsonEnd <= jsonStart) return null;
  try {
    const parsed = JSON.parse(detail.slice(jsonStart, jsonEnd + 1));
    const filePath = parsed.file_path ?? parsed.filePath ?? parsed.path ?? parsed.filename ?? null;
    return typeof filePath === "string" && filePath.trim().length > 0 ? filePath.trim() : null;
  } catch {
    const match = /"(?:file_path|filePath|path|filename)"\s*:\s*"([^"]+)"/i.exec(detail);
    return match?.[1] ?? null;
  }
}

export function workEntryPreview(workEntry: TimelineWorkEntry): string | null {
  if (isReasoningUpdateWorkEntry(workEntry)) {
    return formatAgentActivityEntryPreview(workEntry);
  }
  const isFileRelated =
    workEntry.requestKind === "file-read" ||
    workEntry.requestKind === "file-change" ||
    workEntry.itemType === "file_change";
  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    const command = workEntry.command ?? workEntry.rawCommand;
    if (command) return deriveReadableCommandDisplay(command).target;
  }
  if (workEntry.preview) return workEntry.preview;
  if (workEntry.changedFiles && workEntry.changedFiles.length > 0) {
    const names = workEntry.changedFiles.map((path) => basename(path));
    return names.length === 1 ? names[0]! : `${names.length} files`;
  }
  if (workEntry.itemType === "collab_agent_tool_call" && (workEntry.subagents?.length ?? 0) > 0) {
    if (workEntry.subagentAction?.summaryText) return workEntry.subagentAction.summaryText;
    const labels = workEntry.subagents!.map((subagent) => {
      const presentation = subagentPrimaryLabel(subagent);
      return presentation.nickname ?? presentation.primaryLabel ?? basename(subagent.threadId);
    });
    return labels.length === 1 ? labels[0]! : `${labels.length} subagents`;
  }
  if (workEntry.itemType === "collab_agent_tool_call") {
    return workEntry.detail ?? workEntry.subagentAction?.prompt ?? null;
  }
  if (!workEntry.detail) return null;
  const filePath = extractFilePathFromDetail(workEntry.detail);
  if (filePath) return basename(filePath);
  if (isFileRelated) return null;
  const trimmedDetail = workEntry.detail.trim();
  if (trimmedDetail.startsWith("{") || trimmedDetail.startsWith("[")) return null;
  const readLinesMatch = /^Read\s+(\d+\s+lines?)$/i.exec(trimmedDetail);
  return readLinesMatch?.[1] ?? trimmedDetail;
}

export function isFileReadToolEntry(workEntry: TimelineWorkEntry): boolean {
  const name = (workEntry.toolName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return name === "read" || name === "readfile" || name === "viewfile";
}

function commandWorkEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  const command = workEntry.command ?? workEntry.rawCommand;
  switch (command ? resolveCommandVisualKind(command) : "terminal") {
    case "inspect":
      return SearchIcon;
    case "git":
    case "github":
      return GitHubIcon;
    case "terminal":
      return TerminalIcon;
  }
}

export function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.activityKind === "user-input.requested") return CircleQuestionIcon;
  if (workEntry.activityKind === "user-input.resolved") return ArrowUpCircleIcon;
  if (workEntry.requestKind === "command") return commandWorkEntryIcon(workEntry);
  if (workEntry.requestKind === "file-read") return SearchIcon;
  if (workEntry.requestKind === "file-change") return PencilIcon;
  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return commandWorkEntryIcon(workEntry);
  }
  if (workEntry.itemType === "file_change") return PencilIcon;
  if (workEntry.itemType === "web_search") return WebSearchIcon;
  if (workEntry.itemType === "image_generation") return ZapIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;
  if (isFileReadToolEntry(workEntry)) return SearchIcon;
  if (workEntry.itemType === "mcp_tool_call") return SkillCubeIcon;
  if (workEntry.itemType === "dynamic_tool_call") return HammerIcon;
  if (workEntry.itemType === "collab_agent_tool_call") return AgentTaskIcon;
  return workToneIcon(workEntry.tone);
}

export function isGitHubMcpToolCall(workEntry: TimelineWorkEntry): boolean {
  return Boolean(workEntry.toolName?.trim().toLowerCase().startsWith("mcp__codex_apps__github"));
}

export function prefersCompactWorkEntryRow(workEntry: TimelineWorkEntry): boolean {
  if (isCodexActivityStatusWorkEntry(workEntry)) return true;
  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    return true;
  }
  const EntryIcon = workEntryIcon(workEntry);
  return [TerminalIcon, HammerIcon, AgentTaskIcon, PencilIcon, SkillCubeIcon, SearchIcon].includes(
    EntryIcon,
  );
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? value : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle ?? workEntry.label));
}

export function normalizeWorkDisplayText(value: string): string {
  return normalizeCompactToolLabel(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function combineWorkEntryDisplayText(heading: string, preview: string | null): string {
  if (!preview) return heading;
  return normalizeWorkDisplayText(heading) === normalizeWorkDisplayText(preview)
    ? heading
    : `${heading} ${preview}`;
}

export function isFileChangeWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isFileChangeWorkLogEntry(workEntry);
}

export function subagentPrimaryLabel(
  subagent: NonNullable<TimelineWorkEntry["subagents"]>[number],
): ReturnType<typeof resolveSubagentPresentation> {
  return resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
    fallbackId: subagent.threadId,
  });
}

export function subagentSecondaryLabel(
  subagent: NonNullable<TimelineWorkEntry["subagents"]>[number],
  primaryLabel: string,
): string | null {
  const parts = [subagent.title, formatSubagentModelLabel(subagent.model)]
    .filter((value): value is string => Boolean(value))
    .filter((value) => value !== primaryLabel);
  return parts.length === 0 ? null : parts.join(" • ");
}

export function subagentStatusClasses(
  statusLabel: string | undefined,
  rawStatus: string | undefined,
  isActive: boolean | undefined,
): string {
  switch (normalizeSubagentStatusKind(statusLabel ?? rawStatus, isActive)) {
    case "running":
      return "border-sky-500/18 bg-sky-500/8 text-sky-200/90";
    case "completed":
      return "border-emerald-500/18 bg-emerald-500/8 text-emerald-200/90";
    case "failed":
      return "border-rose-500/18 bg-rose-500/8 text-rose-200/90";
    case "stopped":
      return "border-amber-500/18 bg-amber-500/8 text-amber-200/90";
    case "queued":
      return "border-violet-500/18 bg-violet-500/8 text-violet-200/90";
    default:
      return "border-border/45 bg-background/85 text-muted-foreground/68";
  }
}

export function subagentCardSummary(workEntry: TimelineWorkEntry): string {
  return (
    workEntry.subagentAction?.summaryText ??
    workEntryPreview(workEntry) ??
    toolWorkEntryHeading(workEntry)
  );
}

export function subagentCardMeta(workEntry: TimelineWorkEntry): string | null {
  const modelLabel = formatSubagentModelLabel(workEntry.subagentAction?.model);
  if (modelLabel && workEntry.subagentAction?.prompt) {
    return `${modelLabel} • ${workEntry.subagentAction.prompt}`;
  }
  return modelLabel ?? workEntry.subagentAction?.prompt ?? null;
}

function commandTooltipContent(command: string, displayText: string) {
  return (
    <div className="max-w-96 whitespace-pre-wrap leading-tight">
      <div className="space-y-2">
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Summary</div>
          <div>{displayText}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Raw call</div>
          <code className="block whitespace-pre-wrap break-words font-chat-code text-[11px] text-foreground/92">
            {command}
          </code>
        </div>
      </div>
    </div>
  );
}

export function toolRowTooltipContent(
  rawCommand: string | null | undefined,
  displayText: string,
  fallback: string | undefined,
): ReactNode {
  if (rawCommand) return commandTooltipContent(rawCommand, displayText);
  return fallback ? <span className="whitespace-pre-wrap">{fallback}</span> : null;
}

export function ToolRowTooltip(props: { content: ReactNode; children: ReactElement }) {
  if (!props.content) return props.children;
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup side="top" align="start" className="max-w-96 whitespace-normal">
        {props.content}
      </TooltipPopup>
    </Tooltip>
  );
}

export { humanizeSubagentStatus, isCodexActivityStatusWorkEntry };
