import { AGENT_GROUP_PRODUCTION_BUNDLE_ID } from "@agent-group/shared/desktopIdentity";
import { Config, Effect } from "effect";

import {
  createDesktopPlatformBuildConfig,
  TAILNET_SIDECAR_STAGE_PATH,
  TAILNET_SIDECAR_WINDOWS_STAGE_PATH,
} from "../lib/desktop-platform-build-config.ts";
import { resolveCatalogDependencies } from "../lib/resolve-catalog.ts";
import { BuildPlatform } from "./model.ts";

const AzureTrustedSigningOptionsConfig = Config.all({
  publisherName: Config.string("AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"),
  endpoint: Config.string("AZURE_TRUSTED_SIGNING_ENDPOINT"),
  certificateProfileName: Config.string("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
  codeSigningAccountName: Config.string("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
  fileDigest: Config.string("AZURE_TRUSTED_SIGNING_FILE_DIGEST").pipe(Config.withDefault("SHA256")),
  timestampDigest: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_DIGEST").pipe(
    Config.withDefault("SHA256"),
  ),
  timestampRfc3161: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161").pipe(
    Config.withDefault("http://timestamp.acs.microsoft.com"),
  ),
});

export function resolveDesktopRuntimeDependencies(
  dependencies: Record<string, unknown> | undefined,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return {};
  }

  const runtimeDependencies = Object.fromEntries(
    Object.entries(dependencies).filter(([dependencyName]) => dependencyName !== "electron"),
  );

  return resolveCatalogDependencies(runtimeDependencies, catalog, "apps/desktop");
}

export function resolveGitHubPublishConfig():
  | {
      readonly provider: "github";
      readonly owner: string;
      readonly repo: string;
      readonly releaseType: "release";
    }
  | undefined {
  const rawRepo =
    process.env.AGENT_GROUP_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) return undefined;

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) return undefined;

  return {
    provider: "github",
    owner,
    repo,
    releaseType: "release",
  };
}

export const createBuildConfig = Effect.fn("createBuildConfig")(function* (
  platform: typeof BuildPlatform.Type,
  target: string,
  productName: string,
  signed: boolean,
  mockUpdates: boolean,
  mockUpdateServerPort: string | undefined,
) {
  const buildConfig: Record<string, unknown> = {
    appId: AGENT_GROUP_PRODUCTION_BUNDLE_ID,
    productName,
    artifactName: "Agent-Group-${version}-${arch}.${ext}",
    directories: {
      buildResources: "apps/desktop/resources",
    },
    extraResources: [
      {
        from: "apps/desktop/prod-resources/legal",
        to: "legal",
      },
      {
        from: platform === "win" ? TAILNET_SIDECAR_WINDOWS_STAGE_PATH : TAILNET_SIDECAR_STAGE_PATH,
        to: platform === "win" ? "tailnet/agent-group-tailnet.exe" : "tailnet/agent-group-tailnet",
      },
    ],
  };
  const publishConfig = resolveGitHubPublishConfig();
  if (publishConfig) {
    buildConfig.publish = [publishConfig];
  } else if (mockUpdates) {
    buildConfig.publish = [
      {
        provider: "generic",
        url: `http://localhost:${mockUpdateServerPort ?? 3000}`,
      },
    ];
  }

  const windowsAzureSignOptions =
    platform === "win" && signed ? yield* AzureTrustedSigningOptionsConfig : undefined;

  const platformBuildConfigInput = {
    platform,
    signed,
    target,
    ...(windowsAzureSignOptions ? { windowsAzureSignOptions } : {}),
  } as const;

  Object.assign(buildConfig, createDesktopPlatformBuildConfig(platformBuildConfigInput));

  return buildConfig;
});
