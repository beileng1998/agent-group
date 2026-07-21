import { $applyNodeReplacement, DecoratorNode, type NodeKey } from "lexical";
import type { ReactElement } from "react";

import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "~/lib/terminalContext";
import { ComposerPendingTerminalContextChip } from "../chat/ComposerPendingTerminalContexts";
import { COMPOSER_INLINE_DECORATOR_HOST_CLASS_NAME } from "../composerInlineChip";
import { InlineLinkChip } from "../InlineLinkChip";
import type {
  SerializedComposerLinkNode,
  SerializedComposerTerminalContextNode,
} from "./composerNodeTypes";

function ComposerLinkDecorator(props: { url: string }) {
  return <InlineLinkChip url={props.url} />;
}

export class ComposerLinkNode extends DecoratorNode<ReactElement> {
  __url: string;

  static override getType(): string {
    return "composer-link";
  }

  static override clone(node: ComposerLinkNode): ComposerLinkNode {
    return new ComposerLinkNode(node.__url, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerLinkNode): ComposerLinkNode {
    return $createComposerLinkNode(serializedNode.url);
  }

  constructor(url: string, key?: NodeKey) {
    super(key);
    this.__url = url;
  }

  override exportJSON(): SerializedComposerLinkNode {
    return {
      url: this.__url,
      type: "composer-link",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_DECORATOR_HOST_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactElement {
    return <ComposerLinkDecorator url={this.__url} />;
  }

  override getTextContent(): string {
    return this.__url;
  }

  override isInline(): true {
    return true;
  }
}

export function $createComposerLinkNode(url: string): ComposerLinkNode {
  return $applyNodeReplacement(new ComposerLinkNode(url));
}

function ComposerTerminalContextDecorator(props: { context: TerminalContextDraft }) {
  return <ComposerPendingTerminalContextChip context={props.context} />;
}

export class ComposerTerminalContextNode extends DecoratorNode<ReactElement> {
  __context: TerminalContextDraft;

  static override getType(): string {
    return "composer-terminal-context";
  }

  static override clone(node: ComposerTerminalContextNode): ComposerTerminalContextNode {
    return new ComposerTerminalContextNode(node.__context, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedComposerTerminalContextNode,
  ): ComposerTerminalContextNode {
    return $createComposerTerminalContextNode(serializedNode.context);
  }

  constructor(context: TerminalContextDraft, key?: NodeKey) {
    super(key);
    this.__context = context;
  }

  override exportJSON(): SerializedComposerTerminalContextNode {
    return {
      ...super.exportJSON(),
      context: this.__context,
      type: "composer-terminal-context",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_DECORATOR_HOST_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): ReactElement {
    return <ComposerTerminalContextDecorator context={this.__context} />;
  }
}

export function $createComposerTerminalContextNode(
  context: TerminalContextDraft,
): ComposerTerminalContextNode {
  return $applyNodeReplacement(new ComposerTerminalContextNode(context));
}
