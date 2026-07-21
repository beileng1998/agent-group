// FILE: prepare-release-update-feed.ts
// Purpose: Creates Agent Group channel aliases from Latest updater metadata.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareReleaseUpdateManifests,
  readReleaseUpdatePolicyConfig,
} from "./lib/release-update-policy.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetDirectory = resolve(process.argv[2] ?? "release-assets");
const prepared = prepareReleaseUpdateManifests(
  assetDirectory,
  readReleaseUpdatePolicyConfig(repoRoot),
);

console.log(`Prepared updater manifests: ${prepared.join(", ")}`);
