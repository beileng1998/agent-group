import { $applyNodeReplacement, TextNode, type EditorConfig, type NodeKey } from "lexical";

import { COMPOSER_INLINE_AGENT_CHIP_CLASS_NAME } from "../composerInlineChip";
import { renderAgentMentionChipDom } from "./composerNodeDom";
import type { SerializedComposerAgentMentionNode } from "./composerNodeTypes";

export class ComposerAgentMentionNode extends TextNode {
  __alias: string;
  __color: string;

  static override getType(): string {
    return "composer-agent-mention";
  }

  static override clone(node: ComposerAgentMentionNode): ComposerAgentMentionNode {
    return new ComposerAgentMentionNode(node.__alias, node.__color, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedComposerAgentMentionNode,
  ): ComposerAgentMentionNode {
    return $createComposerAgentMentionNode(serializedNode.alias, serializedNode.color);
  }

  constructor(alias: string, color: string, key?: NodeKey) {
    // The text content is just @alias - parentheses are regular text
    super(`@${alias}`, key);
    this.__alias = alias;
    this.__color = color;
  }

  override exportJSON(): SerializedComposerAgentMentionNode {
    return {
      ...super.exportJSON(),
      alias: this.__alias,
      color: this.__color,
      type: "composer-agent-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_AGENT_CHIP_CLASS_NAME;
    dom.contentEditable = "false";
    dom.setAttribute("spellcheck", "false");
    renderAgentMentionChipDom(dom, this.__alias, this.__color);
    return dom;
  }

  override updateDOM(
    prevNode: ComposerAgentMentionNode,
    dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    dom.contentEditable = "false";
    if (prevNode.__alias !== this.__alias || prevNode.__color !== this.__color) {
      renderAgentMentionChipDom(dom, this.__alias, this.__color);
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

export function $createComposerAgentMentionNode(
  alias: string,
  color: string,
): ComposerAgentMentionNode {
  return $applyNodeReplacement(new ComposerAgentMentionNode(alias, color));
}
