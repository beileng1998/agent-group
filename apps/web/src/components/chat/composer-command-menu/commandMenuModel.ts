import {
  type ModelSlug,
  type ProjectEntry,
  type ProviderKind,
  type ProviderMentionReference,
  type ProviderNativeCommandDescriptor,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
} from "@agent-group/contracts";
import { type ComposerTriggerKind } from "../../../composer-logic";
import { type ComposerSlashCommand } from "../../../composerSlashCommands";
import { formatSkillScope } from "~/lib/providerDiscovery";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "local-root";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "session";
      sessionId: string;
      title: string;
      mentionName: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
      source: "app" | "shared";
    }
  | {
      id: string;
      type: "provider-native-command";
      provider: ProviderKind;
      command: ProviderNativeCommandDescriptor["name"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "fork-target";
      target: "local" | "worktree";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "review-target";
      target: "changes" | "base-branch";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: ModelSlug;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "plugin";
      plugin: ProviderPluginDescriptor;
      mention: ProviderMentionReference;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      skill: ProviderSkillDescriptor;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "agent";
      provider: ProviderKind;
      alias: string;
      color: string;
      label: string;
      description: string;
    };

export type ComposerCommandGroupModel = {
  id: string;
  label: string | null;
  items: ComposerCommandItem[];
};

function humanizeProviderCommandName(command: string): string {
  return command
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function commandMenuTitle(
  item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-native-command" }>,
): string {
  switch (item.command) {
    case "clear":
      return "Clear";
    case "compact":
      return "Compact Context";
    case "model":
      return "Model";
    case "fast":
      return "Fast Mode";
    case "plan":
      return "Plan Mode";
    case "default":
      return "Default Mode";
    case "review":
      return "Code Review";
    case "fork":
      return "Fork";
    case "side":
      return "Sidechat";
    case "status":
      return "Status";
    case "subagents":
      return "Subagents";
    default:
      return humanizeProviderCommandName(item.command);
  }
}

export function commandMenuTrailingMeta(item: ComposerCommandItem): string | null {
  if (item.type === "agent") return "delegate task to subagent";
  if (item.type === "plugin") return "Plugin";
  if (item.type === "session") return item.description;
  if (item.type === "local-root") return "Local";
  if (item.type === "skill") return formatSkillScope(item.skill.scope);
  if (item.type === "model") return "Model";
  if (item.type === "slash-command" || item.type === "provider-native-command") {
    return `/${item.command}`;
  }
  if (item.type === "path") return item.description.length > 0 ? item.description : null;
  return null;
}

export function commandMenuSecondaryText(item: ComposerCommandItem): string | null {
  if (
    item.type === "slash-command" ||
    item.type === "provider-native-command" ||
    item.type === "agent" ||
    item.type === "plugin" ||
    item.type === "skill" ||
    item.type === "local-root"
  ) {
    return item.description;
  }
  return null;
}

export function groupCommandItems(
  items: ComposerCommandItem[],
  triggerKind: ComposerTriggerKind | null,
  groupSlashCommandSections: boolean,
): ComposerCommandGroupModel[] {
  if (triggerKind === "mention") {
    const sessionItems = items.filter((item) => item.type === "session");
    const pluginItems = items.filter((item) => item.type === "plugin");
    const localItems = items.filter((item) => item.type === "local-root" || item.type === "path");
    const agentItems = items.filter((item) => item.type === "agent");
    const otherItems = items.filter(
      (item) =>
        item.type !== "plugin" &&
        item.type !== "session" &&
        item.type !== "local-root" &&
        item.type !== "path" &&
        item.type !== "agent",
    );
    const groups: Array<ComposerCommandGroupModel | null> = [
      sessionItems.length > 0 ? { id: "sessions", label: "Sessions", items: sessionItems } : null,
      pluginItems.length > 0 ? { id: "plugins", label: "Plugins", items: pluginItems } : null,
      localItems.length > 0 ? { id: "local", label: "Local", items: localItems } : null,
      agentItems.length > 0 ? { id: "subagents", label: "Subagents", items: agentItems } : null,
      otherItems.length > 0 ? { id: "other", label: null, items: otherItems } : null,
    ];
    return groups.filter((group): group is ComposerCommandGroupModel => group !== null);
  }

  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }

  const builtInItems = items.filter((item) => item.type === "slash-command");
  const providerItems = items.filter((item) => item.type === "provider-native-command");
  const skillItems = items.filter((item) => item.type === "skill");
  const otherItems = items.filter(
    (item) =>
      item.type !== "slash-command" &&
      item.type !== "provider-native-command" &&
      item.type !== "skill",
  );
  const groups: Array<ComposerCommandGroupModel | null> = [
    builtInItems.length > 0 ? { id: "built-in", label: "Built-in", items: builtInItems } : null,
    providerItems.length > 0 ? { id: "provider", label: "Provider", items: providerItems } : null,
    skillItems.length > 0 ? { id: "skills", label: "Skills", items: skillItems } : null,
    otherItems.length > 0 ? { id: "other", label: null, items: otherItems } : null,
  ];
  return groups.filter((group): group is ComposerCommandGroupModel => group !== null);
}
