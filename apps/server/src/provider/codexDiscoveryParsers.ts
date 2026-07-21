import type {
  ProviderListModelsResult,
  ProviderListPluginsResult,
  ProviderPluginAppSummary,
  ProviderPluginDescriptor,
  ProviderPluginDetail,
  ProviderSkillDescriptor,
} from "@agent-group/contracts";

import {
  readArray,
  readBoolean,
  readFirstBoolean,
  readObject,
  readString,
} from "./codexJsonValues.ts";

export function parseSkillDescriptor(skill: unknown): ProviderSkillDescriptor | undefined {
  const record = readObject(skill);
  if (!record) return undefined;
  const name = readString(record, "name")?.trim();
  const path = readString(record, "path")?.trim();
  if (!name || !path) {
    return undefined;
  }
  const description = readString(record, "description")?.trim();
  const scope = readString(record, "scope")?.trim();
  const display = readObject(record, "interface");
  return {
    name,
    path,
    enabled: record.enabled !== false,
    ...(description ? { description } : {}),
    ...(scope ? { scope } : {}),
    ...(display
      ? {
          interface: {
            ...(readString(display, "displayName")
              ? { displayName: readString(display, "displayName") }
              : {}),
            ...(readString(display, "shortDescription")
              ? {
                  shortDescription: readString(display, "shortDescription"),
                }
              : {}),
          },
        }
      : {}),
    ...(record.dependencies !== undefined ? { dependencies: record.dependencies } : {}),
  } satisfies ProviderSkillDescriptor;
}

export function parseSkillsListResponse(response: unknown, cwd: string): ProviderSkillDescriptor[] {
  const responseRecord = readObject(response);
  const resultRecord = readObject(responseRecord, "result") ?? responseRecord;
  const dataItems = readArray(resultRecord, "data") ?? [];
  const scopedData = dataItems.find((value) => {
    const item = readObject(value);
    const itemCwd = readString(item, "cwd");
    return itemCwd === cwd;
  });
  const scopedSkills = readArray(readObject(scopedData), "skills");
  const directSkills = readArray(resultRecord, "skills");
  const rawSkills = scopedSkills ?? directSkills ?? [];

  const parsedSkills = rawSkills.flatMap((skill) => {
    const parsedSkill = parseSkillDescriptor(skill);
    return parsedSkill ? [parsedSkill] : [];
  });

  return parsedSkills.toSorted((a, b) => a.name.localeCompare(b.name));
}

export function parsePluginListResponse(
  response: unknown,
): Omit<ProviderListPluginsResult, "source" | "cached"> {
  const responseRecord = readObject(response);
  const resultRecord = readObject(responseRecord, "result") ?? responseRecord;
  const marketplaces = (readArray(resultRecord, "marketplaces") ?? []).flatMap((marketplace) => {
    const record = readObject(marketplace);
    if (!record) return [];
    const name = readString(record, "name")?.trim();
    const path = readString(record, "path")?.trim();
    if (!name || !path) {
      return [];
    }
    const rawPlugins = readArray(record, "plugins") ?? [];
    const plugins = rawPlugins.flatMap((plugin) => {
      const parsedPlugin = parsePluginSummary(plugin);
      return parsedPlugin ? [parsedPlugin] : [];
    });
    const marketplaceInterface = readObject(record, "interface");
    const marketplaceDisplayName = readString(marketplaceInterface, "displayName")?.trim();
    return [
      {
        name,
        path,
        ...(marketplaceDisplayName
          ? {
              interface: {
                displayName: marketplaceDisplayName,
              },
            }
          : {}),
        plugins,
      },
    ];
  });
  const marketplaceLoadErrors = (readArray(resultRecord, "marketplaceLoadErrors") ?? [])
    .map((error) => readObject(error))
    .flatMap((error) => {
      if (!error) return [];
      const marketplacePath = readString(error, "marketplacePath")?.trim();
      const message = readString(error, "message")?.trim();
      if (!marketplacePath || !message) {
        return [];
      }
      return [{ marketplacePath, message }];
    });
  const featuredPluginIds = (readArray(resultRecord, "featuredPluginIds") ?? [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  const remoteSyncError = readString(resultRecord, "remoteSyncError")?.trim() ?? null;

  return {
    marketplaces,
    marketplaceLoadErrors,
    remoteSyncError: remoteSyncError?.length ? remoteSyncError : null,
    featuredPluginIds,
  };
}

export function parsePluginSummary(plugin: unknown): ProviderPluginDescriptor | undefined {
  const record = readObject(plugin);
  if (!record) return undefined;
  const id = readString(record, "id")?.trim();
  const name = readString(record, "name")?.trim();
  const source = readObject(record, "source");
  const sourcePath = readString(source, "path")?.trim();
  const installPolicy = readString(record, "installPolicy");
  const authPolicy = readString(record, "authPolicy");
  if (
    !id ||
    !name ||
    !sourcePath ||
    (installPolicy !== "NOT_AVAILABLE" &&
      installPolicy !== "AVAILABLE" &&
      installPolicy !== "INSTALLED_BY_DEFAULT") ||
    (authPolicy !== "ON_INSTALL" && authPolicy !== "ON_USE")
  ) {
    return undefined;
  }

  const pluginInterface = parsePluginInterface(readObject(record, "interface"));

  return {
    id,
    name,
    source: {
      type: "local",
      path: sourcePath,
    },
    installed: record.installed === true,
    enabled: record.enabled === true,
    installPolicy,
    authPolicy,
    ...(pluginInterface ? { interface: pluginInterface } : {}),
  } satisfies ProviderPluginDescriptor;
}

export function parsePluginInterface(
  value: unknown,
): ProviderPluginDescriptor["interface"] | undefined {
  const record = readObject(value);
  if (!record) return undefined;
  const capabilities = (readArray(record, "capabilities") ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  const defaultPrompt = (readArray(record, "defaultPrompt") ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  const screenshots = (readArray(record, "screenshots") ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);

  return {
    ...(readString(record, "displayName")?.trim()
      ? { displayName: readString(record, "displayName")?.trim() }
      : {}),
    ...(readString(record, "shortDescription")?.trim()
      ? {
          shortDescription: readString(record, "shortDescription")?.trim(),
        }
      : {}),
    ...(readString(record, "longDescription")?.trim()
      ? {
          longDescription: readString(record, "longDescription")?.trim(),
        }
      : {}),
    ...(readString(record, "developerName")?.trim()
      ? { developerName: readString(record, "developerName")?.trim() }
      : {}),
    ...(readString(record, "category")?.trim()
      ? { category: readString(record, "category")?.trim() }
      : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(readString(record, "websiteUrl")?.trim()
      ? { websiteUrl: readString(record, "websiteUrl")?.trim() }
      : {}),
    ...(readString(record, "privacyPolicyUrl")?.trim()
      ? {
          privacyPolicyUrl: readString(record, "privacyPolicyUrl")?.trim(),
        }
      : {}),
    ...(readString(record, "termsOfServiceUrl")?.trim()
      ? {
          termsOfServiceUrl: readString(record, "termsOfServiceUrl")?.trim(),
        }
      : {}),
    ...(defaultPrompt.length > 0 ? { defaultPrompt } : {}),
    ...(readString(record, "brandColor")?.trim()
      ? { brandColor: readString(record, "brandColor")?.trim() }
      : {}),
    ...(readString(record, "composerIcon")?.trim()
      ? { composerIcon: readString(record, "composerIcon")?.trim() }
      : {}),
    ...(readString(record, "logo")?.trim() ? { logo: readString(record, "logo")?.trim() } : {}),
    ...(screenshots.length > 0 ? { screenshots } : {}),
  };
}

export function parsePluginReadResponse(response: unknown): ProviderPluginDetail {
  const responseRecord = readObject(response);
  const resultRecord = readObject(responseRecord, "result") ?? responseRecord;
  const pluginRecord = readObject(resultRecord, "plugin") ?? resultRecord;
  const marketplaceName = readString(pluginRecord, "marketplaceName")?.trim();
  const marketplacePath = readString(pluginRecord, "marketplacePath")?.trim();
  const summary = parsePluginSummary(readObject(pluginRecord, "summary"));
  if (!marketplaceName || !marketplacePath || !summary) {
    throw new Error("plugin/read response did not include a valid plugin payload.");
  }
  const skills = (readArray(pluginRecord, "skills") ?? []).flatMap((skill) => {
    const parsedSkill = parseSkillDescriptor(skill);
    return parsedSkill ? [parsedSkill] : [];
  });
  const apps = (readArray(pluginRecord, "apps") ?? []).flatMap((app) => {
    const parsedApp = parsePluginAppSummary(app);
    return parsedApp ? [parsedApp] : [];
  });
  const mcpServers = (readArray(pluginRecord, "mcpServers") ?? [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  const description = readString(pluginRecord, "description")?.trim();

  return {
    marketplaceName,
    marketplacePath,
    summary,
    ...(description ? { description } : {}),
    skills,
    apps,
    mcpServers,
  };
}

export function parsePluginAppSummary(value: unknown): ProviderPluginAppSummary | undefined {
  const record = readObject(value);
  if (!record) return undefined;
  const id = readString(record, "id")?.trim();
  const name = readString(record, "name")?.trim();
  if (!id || !name) {
    return undefined;
  }
  const description = readString(record, "description")?.trim();
  const installUrl = readString(record, "installUrl")?.trim();
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(installUrl ? { installUrl } : {}),
    needsAuth: record.needsAuth === true,
  };
}

export function parseModelListResponse(response: unknown): ProviderListModelsResult["models"] {
  const responseRecord = readObject(response);
  const resultRecord = readObject(responseRecord, "result") ?? responseRecord;
  const rawModels =
    readArray(resultRecord, "items") ??
    readArray(resultRecord, "data") ??
    readArray(resultRecord, "models") ??
    [];
  const seen = new Set<string>();

  return rawModels.flatMap((value) => {
    const model = readObject(value);
    if (!model) {
      return [];
    }

    const slug = readString(model, "id") ?? readString(model, "slug") ?? readString(model, "model");
    const trimmedSlug = slug?.trim();
    if (!trimmedSlug) {
      return [];
    }

    const name =
      readString(model, "name") ??
      readString(model, "displayName") ??
      readString(model, "display_name") ??
      trimmedSlug;
    const trimmedName = name.trim();
    if (!trimmedName || seen.has(trimmedSlug)) {
      return [];
    }

    // Accept both Agent Group's legacy string array and Remodex-style reasoning objects.
    const supportedReasoningEfforts = Array.from(
      new Map(
        (
          readArray(model, "supportedReasoningEfforts") ??
          readArray(model, "supported_reasoning_efforts") ??
          []
        )
          .flatMap((entry) => {
            if (typeof entry === "string") {
              const value = entry.trim();
              return value.length > 0 ? [{ value }] : [];
            }

            const descriptor = readObject(entry);
            if (!descriptor) {
              return [];
            }

            const value =
              readString(descriptor, "reasoningEffort") ??
              readString(descriptor, "reasoning_effort") ??
              readString(descriptor, "value");
            const trimmedValue = value?.trim();
            if (!trimmedValue) {
              return [];
            }

            const label = readString(descriptor, "description") ?? readString(descriptor, "label");
            const trimmedLabel = label?.trim();
            return [
              {
                value: trimmedValue,
                ...(trimmedLabel ? { description: trimmedLabel } : {}),
              },
            ];
          })
          .map((descriptor) => [descriptor.value, descriptor] as const),
      ).values(),
    );
    const defaultReasoningEffort =
      readString(model, "defaultReasoningEffort") ?? readString(model, "default_reasoning_effort");
    const trimmedDefaultReasoningEffort = defaultReasoningEffort?.trim();
    const additionalSpeedTiers =
      readArray(model, "additionalSpeedTiers") ?? readArray(model, "additional_speed_tiers") ?? [];
    const hasFastSpeedTier = additionalSpeedTiers.some(
      (tier) => typeof tier === "string" && tier.trim().toLowerCase() === "fast",
    );
    const supportsFastMode =
      readFirstBoolean(model, [
        "supportsFastMode",
        "supports_fast_mode",
        "fastMode",
        "fast_mode",
        "fastServiceTier",
        "fast_service_tier",
      ]) ?? (hasFastSpeedTier ? true : undefined);

    seen.add(trimmedSlug);
    return [
      {
        slug: trimmedSlug,
        name: trimmedName,
        ...(supportedReasoningEfforts.length > 0 ? { supportedReasoningEfforts } : {}),
        ...(trimmedDefaultReasoningEffort &&
        supportedReasoningEfforts.some(
          (descriptor) => descriptor.value === trimmedDefaultReasoningEffort,
        )
          ? { defaultReasoningEffort: trimmedDefaultReasoningEffort }
          : {}),
        ...(supportsFastMode !== undefined ? { supportsFastMode } : {}),
      },
    ];
  });
}
