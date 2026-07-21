import { renderToStaticMarkup } from "react-dom/server";

import { basenameOfPath } from "~/file-icons";
import { createCentralIconElement } from "~/lib/central-icons";
import { AGENT_ROBOT_ICON_NAME, ClockIcon } from "~/lib/icons";
import type { ComposerSlashCommand } from "~/composerSlashCommands";
import {
  COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_AGENT_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_ICON_NAME,
  formatComposerSlashCommandChipLabel,
  formatComposerSkillChipLabel,
  resolveAgentChipColor,
} from "../composerInlineChip";
import { createMentionChipIconElement, type MentionChipKind } from "../chat/MentionChipIcon";

function resetInlineChipContainer(container: HTMLElement): void {
  container.textContent = "";
  container.style.setProperty("user-select", "none");
  container.style.setProperty("-webkit-user-select", "none");
}

export function createInlineChipHost(): HTMLElement {
  const dom = document.createElement("span");
  dom.className = COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME;
  dom.contentEditable = "false";
  dom.setAttribute("spellcheck", "false");
  return dom;
}

export function renderMentionChipDom(
  container: HTMLElement,
  pathValue: string,
  kind: MentionChipKind,
): void {
  resetInlineChipContainer(container);

  const icon = createMentionChipIconElement(
    pathValue,
    kind,
    COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  );

  const label = document.createElement("span");
  label.className = COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME;
  label.textContent = basenameOfPath(pathValue);

  container.append(icon, label);
}

export function renderSkillChipDom(container: HTMLElement, name: string): void {
  resetInlineChipContainer(container);

  const icon = createCentralIconElement(
    COMPOSER_INLINE_SKILL_CHIP_ICON_NAME,
    COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  );

  const label = document.createElement("span");
  label.className = COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME;
  label.textContent = formatComposerSkillChipLabel(name);

  if (icon) {
    container.append(icon, label);
  } else {
    container.append(label);
  }
}

const AUTOMATION_COMMAND_ICON_SVG = renderToStaticMarkup(
  <ClockIcon aria-hidden="true" className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME} />,
);

export function renderSlashCommandChipDom(
  container: HTMLElement,
  command: ComposerSlashCommand,
): void {
  resetInlineChipContainer(container);

  const icon = document.createElement("span");
  icon.ariaHidden = "true";
  icon.innerHTML = AUTOMATION_COMMAND_ICON_SVG;

  const label = document.createElement("span");
  label.className = COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME;
  label.textContent = formatComposerSlashCommandChipLabel(command);

  container.append(icon, label);
}

export function renderAgentMentionChipDom(
  container: HTMLElement,
  alias: string,
  color: string,
): void {
  resetInlineChipContainer(container);

  const colorStyles = resolveAgentChipColor(color);
  container.style.backgroundColor = colorStyles.bg;
  container.style.color = colorStyles.text;

  const icon = createCentralIconElement(
    AGENT_ROBOT_ICON_NAME,
    COMPOSER_INLINE_AGENT_CHIP_ICON_CLASS_NAME,
  );

  const label = document.createElement("span");
  label.className = COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME;
  label.textContent = `@${alias}`;

  if (icon) {
    container.append(icon, label);
  } else {
    container.append(label);
  }
}
