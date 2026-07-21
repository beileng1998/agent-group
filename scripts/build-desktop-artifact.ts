#!/usr/bin/env node
// FILE: build-desktop-artifact.ts
// Purpose: Stages and builds packaged desktop artifacts plus updater metadata for GitHub releases.
// Layer: Release/build script
// Depends on: apps/desktop package metadata, electron-builder, and GitHub release config.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

import { runtimeProgram } from "./build-desktop-artifact/cli.ts";

export { resolveBuildOptions } from "./build-desktop-artifact/model.ts";

NodeRuntime.runMain(runtimeProgram);
