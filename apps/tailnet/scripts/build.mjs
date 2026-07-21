#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function readFlag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const goos =
  readFlag("--goos") ?? { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
const goarch = readFlag("--goarch") ?? { arm64: "arm64", x64: "amd64" }[process.arch];

if (!goos || !goarch) {
  throw new Error(`Unsupported build target: ${process.platform}/${process.arch}`);
}

const binaryName = goos === "windows" ? "agent-group-tailnet.exe" : "agent-group-tailnet";
const output = resolve(
  readFlag("--output") ?? resolve(appDir, "bin", `${goos}-${goarch}`, binaryName),
);
mkdirSync(dirname(output), { recursive: true });

const result = spawnSync(
  "go",
  ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "./cmd/agent-group-tailnet"],
  {
    cwd: appDir,
    env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.info(output);
