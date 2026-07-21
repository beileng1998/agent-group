import { ComposerAgentMentionNode } from "./composerAgentMentionNode";
import { ComposerLinkNode, ComposerTerminalContextNode } from "./composerDecoratorNodes";
import {
  ComposerMentionNode,
  ComposerSkillNode,
  ComposerSlashCommandNode,
} from "./composerTextNodes";

export type ComposerInlineTokenNode =
  | ComposerMentionNode
  | ComposerSkillNode
  | ComposerSlashCommandNode
  | ComposerTerminalContextNode
  | ComposerAgentMentionNode
  | ComposerLinkNode;

export function isComposerInlineTokenNode(
  candidate: unknown,
): candidate is ComposerInlineTokenNode {
  return (
    candidate instanceof ComposerMentionNode ||
    candidate instanceof ComposerSkillNode ||
    candidate instanceof ComposerSlashCommandNode ||
    candidate instanceof ComposerTerminalContextNode ||
    candidate instanceof ComposerAgentMentionNode ||
    candidate instanceof ComposerLinkNode
  );
}

/** All node classes for Lexical registration */
export const COMPOSER_NODE_CLASSES = [
  ComposerMentionNode,
  ComposerSkillNode,
  ComposerSlashCommandNode,
  ComposerTerminalContextNode,
  ComposerAgentMentionNode,
  ComposerLinkNode,
] as const;
