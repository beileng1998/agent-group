#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

import { runtimeProgram } from "./dev-runner/cli.ts";

export { createDevRunnerEnv, DEFAULT_AGENT_GROUP_HOME, resolveOffset } from "./dev-runner/config.ts";
export { findFirstAvailableOffset, resolveModePortOffsets } from "./dev-runner/ports.ts";
export { runDevRunnerWithInput } from "./dev-runner/run.ts";

if (import.meta.main) {
  NodeRuntime.runMain(runtimeProgram);
}
