import {
  DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS,
  type AgentGroupPromptInstructions,
} from "@agent-group/contracts";
import { buildAgentGroupPrompt } from "@agent-group/shared/agentGroupPrompt";
import { useMemo, useState } from "react";

import {
  ChangesIcon,
  FileIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListChecksIcon,
  MessageCircleIcon,
  PaperclipIcon,
  SkillCubeIcon,
  UsersIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Switch } from "./ui/switch";
import {
  AgentGroupPromptPreview,
  LockedPromptSource,
  PromptBlockCard,
  PromptInstructionEditor,
  PromptXmlEditor,
  type PromptPreviewTurn,
  PromptViewTab,
} from "./AgentGroupPromptBuilderParts";

type PromptView = "blocks" | "preview";
type PromptInstructionKey = keyof AgentGroupPromptInstructions;

const SAMPLE_USER_REQUEST = "Review the current plan and implement the next step.";
const SAMPLE_GROUP_RULES = "Follow the conventions documented for this Group.";

interface AgentGroupPromptBuilderProps {
  readonly contextEnabled: boolean;
  readonly globalRules: string;
  readonly promptInstructions: AgentGroupPromptInstructions;
  readonly onContextEnabledChange: (enabled: boolean) => void;
  readonly onGlobalRulesChange: (rules: string) => void;
  readonly onPromptInstructionsChange: (instructions: AgentGroupPromptInstructions) => void;
}

export function AgentGroupPromptBuilder(props: AgentGroupPromptBuilderProps) {
  const [view, setView] = useState<PromptView>("blocks");
  const [previewTurn, setPreviewTurn] = useState<PromptPreviewTurn>("first");
  const [previewBrowserEnabled, setPreviewBrowserEnabled] = useState(false);
  const [openBlock, setOpenBlock] = useState<string | null>("session-context");
  const promptPreview = useMemo(
    () =>
      props.contextEnabled
        ? buildAgentGroupPrompt({
            userText: SAMPLE_USER_REQUEST,
            attachments: [{ kind: "file", path: "/workspace/brief.md" }],
            contextPath: ".agent-group/sessions/current/context.md",
            ...(previewTurn === "first"
              ? { parentContextPath: ".agent-group/sessions/parent/context.md" }
              : {}),
            mentionedSessions: [
              {
                sessionId: "research",
                title: "Research",
                contextPath: ".agent-group/sessions/research/context.md",
              },
            ],
            contextAwarenessCommand:
              "git -C .agent-group diff {seen}..{latest} -- 'sessions/*/context.md'",
            ...(previewBrowserEnabled ? { browserSessionId: "current" } : {}),
            firstTurn: previewTurn === "first",
            globalRules: props.globalRules,
            groupRules: SAMPLE_GROUP_RULES,
            promptInstructions: props.promptInstructions,
          })
        : SAMPLE_USER_REQUEST,
    [
      previewTurn,
      props.contextEnabled,
      props.globalRules,
      props.promptInstructions,
      previewBrowserEnabled,
    ],
  );

  const updateInstruction = (key: PromptInstructionKey, value: string) => {
    props.onPromptInstructionsChange({ ...props.promptInstructions, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-background/30">
        <div className="flex items-start justify-between gap-4 p-3.5">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/45 text-foreground">
              <SkillCubeIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-medium">Prompt assembly</h3>
                <span className="rounded-md border border-border bg-muted/35 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-muted-foreground">
                  AGENT GROUP
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Compose each turn from protected data and editable instructions.
              </p>
            </div>
          </div>
          <Switch
            checked={props.contextEnabled}
            onCheckedChange={(checked) => props.onContextEnabledChange(Boolean(checked))}
            aria-label="Agent Group prompt assembly"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <div className="inline-flex rounded-lg bg-muted/45 p-0.5" role="tablist">
            <PromptViewTab active={view === "blocks"} onClick={() => setView("blocks")}>
              Blocks
            </PromptViewTab>
            <PromptViewTab active={view === "preview"} onClick={() => setView("preview")}>
              Preview
            </PromptViewTab>
          </div>
          <span className="text-[9px] text-muted-foreground">
            {props.contextEnabled ? "9 blocks · adaptive" : "Pass-through mode"}
          </span>
        </div>
      </div>

      {view === "blocks" ? (
        <div className={cn("space-y-1.5", !props.contextEnabled && "opacity-55")}>
          <PromptBlockCard
            index={1}
            id="user-request"
            title="User request"
            description="The original message, preserved verbatim"
            condition="Always"
            icon={MessageCircleIcon}
            open={openBlock === "user-request"}
            onOpenChange={(open) => setOpenBlock(open ? "user-request" : null)}
          >
            <LockedPromptSource>{`<user_request>\n{original message}\n</user_request>`}</LockedPromptSource>
          </PromptBlockCard>

          <PromptBlockCard
            index={2}
            id="attachments"
            title="Attachments"
            description="Resolved file and image paths"
            condition="When present"
            icon={PaperclipIcon}
            open={openBlock === "attachments"}
            onOpenChange={(open) => setOpenBlock(open ? "attachments" : null)}
          >
            <LockedPromptSource>{`<attachments>\n<attachment kind="{file | image}">{resolved path}</attachment>\n</attachments>`}</LockedPromptSource>
          </PromptBlockCard>

          <PromptBlockCard
            index={3}
            id="session-context"
            title="Session context"
            description="The current Session's context.md"
            condition="Every turn"
            icon={FileIcon}
            editable
            open={openBlock === "session-context"}
            onOpenChange={(open) => setOpenBlock(open ? "session-context" : null)}
          >
            <PromptInstructionEditor
              label="First turn prompt"
              value={props.promptInstructions.sessionContextFirstTurn}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.sessionContextFirstTurn}
              openingTag={`<session_context path="{current Session context path}">`}
              closingTag="</session_context>"
              onChange={(value) => updateInstruction("sessionContextFirstTurn", value)}
            />
            <PromptInstructionEditor
              label="Later turn prompt"
              value={props.promptInstructions.sessionContextLaterTurn}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.sessionContextLaterTurn}
              openingTag={`<session_context path="{current Session context path}">`}
              closingTag="</session_context>"
              onChange={(value) => updateInstruction("sessionContextLaterTurn", value)}
            />
          </PromptBlockCard>

          <PromptBlockCard
            index={4}
            id="parent-context"
            title="Parent context"
            description="Background inherited by a child Session"
            condition="First turn"
            icon={FolderOpenIcon}
            editable
            open={openBlock === "parent-context"}
            onOpenChange={(open) => setOpenBlock(open ? "parent-context" : null)}
          >
            <PromptInstructionEditor
              label="Prompt text"
              value={props.promptInstructions.parentContext}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.parentContext}
              openingTag={`<parent_context path="{parent Session context path}">`}
              closingTag="</parent_context>"
              onChange={(value) => updateInstruction("parentContext", value)}
            />
          </PromptBlockCard>

          <PromptBlockCard
            index={5}
            id="mentioned-sessions"
            title="Mentioned Sessions"
            description="Context and transcript references from @mentions"
            condition="When mentioned"
            icon={UsersIcon}
            editable
            open={openBlock === "mentioned-sessions"}
            onOpenChange={(open) => setOpenBlock(open ? "mentioned-sessions" : null)}
          >
            <PromptInstructionEditor
              label="Prompt text"
              value={props.promptInstructions.mentionedSessions}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.mentionedSessions}
              openingTag="<mentioned_sessions>"
              protectedAfter={`{"session_id":"{id}","title":"{title}","context_path":"{path}","transcript_path":"{optional path}"}`}
              closingTag="</mentioned_sessions>"
              onChange={(value) => updateInstruction("mentionedSessions", value)}
            />
          </PromptBlockCard>

          <PromptBlockCard
            index={6}
            id="context-changes"
            title="Context changes"
            description="A pull command for unseen Group context"
            condition="When changed"
            icon={ChangesIcon}
            editable
            open={openBlock === "context-changes"}
            onOpenChange={(open) => setOpenBlock(open ? "context-changes" : null)}
          >
            <PromptInstructionEditor
              label="Prompt text"
              value={props.promptInstructions.contextChanges}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.contextChanges}
              openingTag="<group_context_changes>"
              protectedAfter="{Context Git diff command}"
              closingTag="</group_context_changes>"
              onChange={(value) => updateInstruction("contextChanges", value)}
            />
          </PromptBlockCard>

          <PromptBlockCard
            index={7}
            id="browser-tools"
            title="Browser capability"
            description="Included when the Group allows Browser access"
            condition="Per Group"
            icon={GlobeIcon}
            editable
            open={openBlock === "browser-tools"}
            onOpenChange={(open) => setOpenBlock(open ? "browser-tools" : null)}
          >
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
              <div>
                <div className="text-[10px] font-medium">Preview Browser access</div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">
                  Represents a Group with Browser access enabled.
                </div>
              </div>
              <Switch
                checked={previewBrowserEnabled}
                onCheckedChange={(checked) => setPreviewBrowserEnabled(Boolean(checked))}
                aria-label="Preview browser tools prompt block"
              />
            </div>
            <PromptInstructionEditor
              label="Prompt text"
              value={props.promptInstructions.browserTools}
              defaultValue={DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.browserTools}
              openingTag="<browser_tools>"
              protectedAfter="playwright-cli -s={Session ID}"
              closingTag="</browser_tools>"
              onChange={(value) => updateInstruction("browserTools", value)}
            />
          </PromptBlockCard>

          <PromptBlockCard
            index={8}
            id="global-rules"
            title="Global rules"
            description="Shared rules, inserted exactly as written"
            condition={props.globalRules.trim() ? "Included" : "Empty"}
            icon={ListChecksIcon}
            editable
            open={openBlock === "global-rules"}
            onOpenChange={(open) => setOpenBlock(open ? "global-rules" : null)}
          >
            <div className="text-[10px] font-medium">Rules</div>
            <PromptXmlEditor
              label="Global rules"
              value={props.globalRules}
              openingTag={`<rules scope="global">`}
              closingTag="</rules>"
              textareaClassName="min-h-28"
              onChange={props.onGlobalRulesChange}
              placeholder="Add concise rules shared by every Group."
            />
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
              An empty block is omitted from the final prompt.
            </p>
          </PromptBlockCard>

          <PromptBlockCard
            index={9}
            id="group-rules"
            title="Group rules"
            description="Rules supplied by the active Group"
            condition="Per Group"
            icon={ListChecksIcon}
            open={openBlock === "group-rules"}
            onOpenChange={(open) => setOpenBlock(open ? "group-rules" : null)}
          >
            <LockedPromptSource>{`<rules scope="group">\n{current Group rules}\n</rules>`}</LockedPromptSource>
          </PromptBlockCard>
        </div>
      ) : (
        <AgentGroupPromptPreview
          prompt={promptPreview}
          turn={previewTurn}
          contextEnabled={props.contextEnabled}
          globalRulesIncluded={props.globalRules.trim().length > 0}
          groupRulesIncluded
          onTurnChange={setPreviewTurn}
        />
      )}
    </div>
  );
}
