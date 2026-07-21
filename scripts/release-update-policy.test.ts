import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  channelManifestNames,
  prepareReleaseUpdateManifests,
  resolveReleaseUpdatePolicy,
  type ReleaseUpdatePolicyConfig,
} from "./lib/release-update-policy";

const config: ReleaseUpdatePolicyConfig = {
  channel: "agent-group",
};
const defaultNames = ["latest-mac.yml", "latest.yml", "latest-linux.yml"] as const;

describe("release update policy", () => {
  it("publishes stable releases to Latest and keeps prereleases isolated", () => {
    expect(resolveReleaseUpdatePolicy("v0.6.0", config)).toMatchObject({
      tag: "v0.6.0",
      makeLatest: true,
      channel: "agent-group",
    });
    expect(resolveReleaseUpdatePolicy("0.6.1-beta.1", config)).toMatchObject({
      isPrerelease: true,
      makeLatest: false,
    });
    expect(() => resolveReleaseUpdatePolicy("0.6", config)).toThrow("Invalid release version");
  });

  it("copies Latest metadata to the Agent Group channel", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-group-release-policy-"));
    try {
      for (const name of defaultNames) writeFileSync(resolve(root, name), name);

      expect(prepareReleaseUpdateManifests(root, config)).toEqual([
        ...defaultNames,
        ...channelManifestNames("agent-group"),
      ]);
      for (const [index, channelName] of channelManifestNames(config.channel).entries()) {
        expect(readFileSync(resolve(root, channelName), "utf8")).toBe(defaultNames[index]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails before copying when a destination exists or source is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-group-release-policy-"));
    try {
      writeFileSync(resolve(root, "latest-mac.yml"), "mac");
      expect(() => prepareReleaseUpdateManifests(root, config)).toThrow(
        "Release is missing update manifests: latest.yml, latest-linux.yml",
      );
      writeFileSync(resolve(root, "latest.yml"), "win");
      writeFileSync(resolve(root, "latest-linux.yml"), "linux");
      writeFileSync(resolve(root, "agent-group.yml"), "existing");
      expect(() => prepareReleaseUpdateManifests(root, config)).toThrow(
        "Refusing to overwrite existing update manifest: agent-group.yml",
      );
      expect(() => readFileSync(resolve(root, "agent-group-mac.yml"), "utf8")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid channels", () => {
    expect(() => resolveReleaseUpdatePolicy("0.6.0", { ...config, channel: "latest" })).toThrow(
      "Invalid canonical update channel",
    );
  });
});
