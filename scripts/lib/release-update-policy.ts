// FILE: release-update-policy.ts
// Purpose: Resolves release metadata and creates the Agent Group updater aliases.

import { constants, copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ReleaseUpdatePolicyConfig {
  readonly channel: string;
}

export interface ResolvedReleaseUpdatePolicy {
  readonly version: string;
  readonly tag: string;
  readonly isPrerelease: boolean;
  readonly makeLatest: boolean;
  readonly channel: string;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CHANNEL_PATTERN = /^[a-z0-9-]+$/;
const DEFAULT_MANIFEST_NAMES = ["latest-mac.yml", "latest.yml", "latest-linux.yml"] as const;

function parseVersion(value: string): { isPrerelease: boolean } {
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return { isPrerelease: match[4] !== undefined };
}

function validateChannel(value: unknown, label: string): string {
  if (typeof value !== "string" || !CHANNEL_PATTERN.test(value) || value === "latest") {
    throw new Error(`Invalid ${label} update channel: ${String(value)}`);
  }
  return value;
}

export function validateReleaseUpdatePolicyConfig(config: unknown): ReleaseUpdatePolicyConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("Release update policy must be an object.");
  }
  const candidate = config as Partial<ReleaseUpdatePolicyConfig>;
  const channel = validateChannel(candidate.channel, "canonical");
  return { channel };
}

export function readReleaseUpdatePolicyConfig(rootDirectory: string): ReleaseUpdatePolicyConfig {
  const path = resolve(rootDirectory, "scripts/release-update-policy.json");
  return validateReleaseUpdatePolicyConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function resolveReleaseUpdatePolicy(
  rawVersion: string,
  config: ReleaseUpdatePolicyConfig,
): ResolvedReleaseUpdatePolicy {
  const normalizedConfig = validateReleaseUpdatePolicyConfig(config);
  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
  const { isPrerelease } = parseVersion(version);
  return {
    version,
    tag: `v${version}`,
    isPrerelease,
    makeLatest: !isPrerelease,
    channel: normalizedConfig.channel,
  };
}

export function channelManifestNames(channel: string): readonly string[] {
  const normalizedChannel = validateChannel(channel, "dedicated");
  return [
    `${normalizedChannel}-mac.yml`,
    `${normalizedChannel}.yml`,
    `${normalizedChannel}-linux.yml`,
  ];
}

export function prepareReleaseUpdateManifests(
  assetDirectory: string,
  config: ReleaseUpdatePolicyConfig,
): readonly string[] {
  const normalizedConfig = validateReleaseUpdatePolicyConfig(config);
  const missing = DEFAULT_MANIFEST_NAMES.filter(
    (name) => !existsSync(resolve(assetDirectory, name)),
  );
  if (missing.length > 0) {
    throw new Error(`Release is missing update manifests: ${missing.join(", ")}`);
  }

  const destinationNames = channelManifestNames(normalizedConfig.channel);
  const existing = destinationNames.filter((name) => existsSync(resolve(assetDirectory, name)));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing update manifest: ${existing.join(", ")}`);
  }

  for (const [index, destinationName] of destinationNames.entries()) {
    const sourceName = DEFAULT_MANIFEST_NAMES[index % DEFAULT_MANIFEST_NAMES.length];
    if (!sourceName) throw new Error(`Missing manifest mapping for ${destinationName}.`);
    copyFileSync(
      resolve(assetDirectory, sourceName),
      resolve(assetDirectory, destinationName),
      constants.COPYFILE_EXCL,
    );
  }
  return [...DEFAULT_MANIFEST_NAMES, ...destinationNames];
}
