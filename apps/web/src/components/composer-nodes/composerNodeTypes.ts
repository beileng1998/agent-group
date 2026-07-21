import type { SerializedLexicalNode, SerializedTextNode, Spread } from "lexical";

import type { ComposerSlashCommand } from "~/composerSlashCommands";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import type { MentionChipKind } from "../chat/MentionChipIcon";

export type SerializedComposerMentionNode = Spread<
  {
    kind?: MentionChipKind;
    path: string;
    type: "composer-mention";
    version: 1;
  },
  SerializedTextNode
>;

export type SerializedComposerSkillNode = Spread<
  {
    skillName: string;
    type: "composer-skill";
    version: 1;
  },
  SerializedTextNode
>;

export type SerializedComposerSlashCommandNode = Spread<
  {
    command: ComposerSlashCommand;
    type: "composer-slash-command";
    version: 1;
  },
  SerializedTextNode
>;

export type SerializedComposerAgentMentionNode = Spread<
  {
    alias: string;
    color: string;
    type: "composer-agent-mention";
    version: 1;
  },
  SerializedTextNode
>;

export type SerializedComposerLinkNode = Spread<
  {
    url: string;
    type: "composer-link";
    version: 1;
  },
  SerializedLexicalNode
>;

export type SerializedComposerTerminalContextNode = Spread<
  {
    context: TerminalContextDraft;
    type: "composer-terminal-context";
    version: 1;
  },
  SerializedLexicalNode
>;
