import { $applyNodeReplacement, TextNode, type EditorConfig, type NodeKey } from "lexical";

import type { ComposerSlashCommand } from "~/composerSlashCommands";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import type { MentionChipKind } from "../chat/MentionChipIcon";
import {
  createInlineChipHost,
  renderMentionChipDom,
  renderSkillChipDom,
  renderSlashCommandChipDom,
} from "./composerNodeDom";
import type {
  SerializedComposerMentionNode,
  SerializedComposerSkillNode,
  SerializedComposerSlashCommandNode,
} from "./composerNodeTypes";

export class ComposerMentionNode extends TextNode {
  __kind: MentionChipKind;
  __path: string;

  static override getType(): string {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__kind, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode): ComposerMentionNode {
    return $createComposerMentionNode(serializedNode.path, serializedNode.kind);
  }

  constructor(path: string, kind: MentionChipKind = "path", key?: NodeKey) {
    const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
    super(formatComposerMentionToken(normalizedPath), key);
    this.__path = normalizedPath;
    this.__kind = kind;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      kind: this.__kind,
      path: this.__path,
      type: "composer-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = createInlineChipHost();
    renderMentionChipDom(dom, this.__path, this.__kind);
    return dom;
  }

  override updateDOM(
    prevNode: ComposerMentionNode,
    dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    dom.contentEditable = "false";
    if (
      prevNode.__text !== this.__text ||
      prevNode.__path !== this.__path ||
      prevNode.__kind !== this.__kind
    ) {
      renderMentionChipDom(dom, this.__path, this.__kind);
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

export function $createComposerMentionNode(
  path: string,
  kind: MentionChipKind = "path",
): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(path, kind));
}

export class ComposerSkillNode extends TextNode {
  __skillName: string;

  static override getType(): string {
    return "composer-skill";
  }

  static override clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(node.__skillName, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerSkillNode): ComposerSkillNode {
    return $createComposerSkillNode(serializedNode.skillName);
  }

  constructor(name: string, key?: NodeKey) {
    const normalizedName = name.startsWith("$") || name.startsWith("/") ? name.slice(1) : name;
    const prefix = name.startsWith("/") ? "/" : "$";
    super(`${prefix}${normalizedName}`, key);
    this.__skillName = normalizedName;
  }

  override exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      skillName: this.__skillName,
      type: "composer-skill",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = createInlineChipHost();
    renderSkillChipDom(dom, this.__skillName);
    return dom;
  }

  override updateDOM(
    prevNode: ComposerSkillNode,
    dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    dom.contentEditable = "false";
    if (prevNode.__text !== this.__text || prevNode.__skillName !== this.__skillName) {
      renderSkillChipDom(dom, this.__skillName);
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): true {
    return true;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

export function $createComposerSkillNode(name: string): ComposerSkillNode {
  return $applyNodeReplacement(new ComposerSkillNode(name));
}

export class ComposerSlashCommandNode extends TextNode {
  __command: ComposerSlashCommand;

  static override getType(): string {
    return "composer-slash-command";
  }

  static override clone(node: ComposerSlashCommandNode): ComposerSlashCommandNode {
    return new ComposerSlashCommandNode(node.__command, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedComposerSlashCommandNode,
  ): ComposerSlashCommandNode {
    return $createComposerSlashCommandNode(serializedNode.command);
  }

  constructor(command: ComposerSlashCommand, key?: NodeKey) {
    super(`/${command}`, key);
    this.__command = command;
  }

  override exportJSON(): SerializedComposerSlashCommandNode {
    return {
      ...super.exportJSON(),
      command: this.__command,
      type: "composer-slash-command",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = createInlineChipHost();
    renderSlashCommandChipDom(dom, this.__command);
    return dom;
  }

  override updateDOM(
    prevNode: ComposerSlashCommandNode,
    dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    dom.contentEditable = "false";
    if (prevNode.__text !== this.__text || prevNode.__command !== this.__command) {
      renderSlashCommandChipDom(dom, this.__command);
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): true {
    return true;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

export function $createComposerSlashCommandNode(
  command: ComposerSlashCommand,
): ComposerSlashCommandNode {
  return $applyNodeReplacement(new ComposerSlashCommandNode(command));
}
