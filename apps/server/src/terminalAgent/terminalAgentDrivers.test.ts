import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_SERVER_SETTINGS } from "@agent-group/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_TERMINAL_PROFILE_NAME,
  buildCodexHookCommand,
  buildCodexTerminalArgs,
  buildCodexTerminalProfile,
  codexTerminalRuntimeDir,
  prepareCodexTerminalLaunch,
} from "./codexTerminalDriver";
import {
  buildClaudeTerminalArgs,
  claudeTerminalRuntimeDir,
  prepareClaudeTerminalLaunch,
} from "./claudeTerminalDriver";
import {
  piTerminalRuntimeDir,
  piTerminalSessionDir,
  preparePiTerminalLaunch,
} from "./piTerminalDriver";
import {
  prepareTerminalAgentLaunch,
  terminalAgentExecutable,
} from "./terminalAgentDriverRegistry";

describe("managed terminal drivers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function temporary(prefix: string): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(directory);
    return directory;
  }

  it("uses public Codex trust controls for the managed hook and workspace", () => {
    const command = buildCodexHookCommand(
      "/Applications/Agent Group.app/Contents/MacOS/Agent Group",
      "/tmp/codex hook.mjs",
      "darwin",
      true,
    );
    const workspaceRoot = "/tmp/agent-group-workspace";
    const profile = buildCodexTerminalProfile(command, workspaceRoot);
    expect(command).toBe(
      "ELECTRON_RUN_AS_NODE=1 '/Applications/Agent Group.app/Contents/MacOS/Agent Group' '/tmp/codex hook.mjs'",
    );
    expect(profile.match(/\[\[hooks\.(\w+)\]\]/gu)).toHaveLength(4);
    expect(profile).toContain(`[projects."${workspaceRoot}"]`);
    expect(profile).toContain('trust_level = "trusted"');
    expect(profile).not.toContain("trusted_hash");
  });

  it("maps Codex permissions without changing the original executable", () => {
    const common = {
      profileName: "agent-group-terminal",
      modelSelection: {
        provider: "codex" as const,
        model: "gpt-5.6",
        options: { reasoningEffort: "xhigh" as const, fastMode: true },
      },
      runtimeMode: "full-access" as const,
    };
    const args = buildCodexTerminalArgs(common);
    expect(args).toContain("danger-full-access");
    expect(args).toContain("never");
    expect(args).toContain("--no-alt-screen");
    expect(args).toContain("--dangerously-bypass-hook-trust");
    expect(
      buildCodexTerminalArgs({
        ...common,
        runtimeMode: "approval-required",
        resumeSessionId: "019f0000-0000-7000-8000-000000000001",
      }).slice(0, 2),
    ).toEqual([
      "resume",
      "019f0000-0000-7000-8000-000000000001",
    ]);
  });

  it("isolates and hardens the Codex overlay on repeated launch", async () => {
    const stateDir = await temporary("agent-group-codex-driver-");
    const sourceHome = await temporary("agent-group-codex-home-");
    const sourceConfig = 'model = "gpt-5.6"\n';
    const sourceProfile = 'model = "user-profile"\n';
    await fs.writeFile(path.join(sourceHome, "config.toml"), sourceConfig);
    await fs.writeFile(path.join(sourceHome, "auth.json"), '{"tokens":{}}\n');
    await fs.mkdir(path.join(sourceHome, "skills"));
    await fs.writeFile(
      path.join(sourceHome, "agent-group-terminal.config.toml"),
      sourceProfile,
    );
    const runtimeDir = codexTerminalRuntimeDir(stateDir, "thread-one");
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o777 });
    await fs.chmod(runtimeDir, 0o777);
    const victim = path.join(stateDir, "victim");
    await fs.writeFile(victim, "unchanged");
    await fs.symlink(victim, path.join(runtimeDir, "codex-hook.mjs"));

    const launch = await prepareCodexTerminalLaunch({
      stateDir,
      sessionKey: "thread-one",
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-one",
      hookEndpoint: path.join(stateDir, "bridge.sock"),
      hookToken: "secret-token",
      executable: "/usr/local/bin/codex-original",
      modelSelection: { provider: "codex", model: "gpt-5.6" },
      runtimeMode: "approval-required",
      codexHomePath: sourceHome,
      baseEnv: { PATH: process.env.PATH, SHELL: process.env.SHELL },
    });

    expect(launch.executable).toBe("/usr/local/bin/codex-original");
    expect(launch.env.CODEX_HOME).toBe(launch.codexHome);
    expect((await fs.stat(launch.runtimeDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(launch.profilePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(launch.shimPath)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(victim, "utf8")).toBe("unchanged");
    expect(await fs.readFile(path.join(sourceHome, "config.toml"), "utf8")).toBe(
      sourceConfig,
    );
    expect(
      await fs.readFile(
        path.join(sourceHome, "agent-group-terminal.config.toml"),
        "utf8",
      ),
    ).toBe(sourceProfile);
    expect(
      (await fs.lstat(path.join(launch.codexHome, "auth.json"))).isSymbolicLink(),
    ).toBe(true);
  });

  it("uses Codex's canonical profile path for native hook trust", async () => {
    if (process.platform === "win32") return;
    const realStateDir = await temporary("agent-group-codex-real-state-");
    const aliasRoot = await temporary("agent-group-codex-state-alias-");
    const stateDir = path.join(aliasRoot, "state");
    const sourceHome = await temporary("agent-group-codex-canonical-home-");
    await fs.writeFile(path.join(sourceHome, "auth.json"), "{}\n");
    await fs.symlink(realStateDir, stateDir, "dir");

    const launch = await prepareCodexTerminalLaunch({
      stateDir,
      sessionKey: "thread-canonical",
      workspaceRoot: realStateDir,
      runtimeInstanceId: "runtime-canonical",
      hookEndpoint: path.join(realStateDir, "bridge.sock"),
      hookToken: "secret-token",
      executable: "/usr/local/bin/codex-original",
      modelSelection: { provider: "codex", model: "gpt-5.6" },
      runtimeMode: "approval-required",
      codexHomePath: sourceHome,
      baseEnv: { PATH: process.env.PATH, SHELL: process.env.SHELL },
    });

    expect(launch.profilePath).toBe(
      path.join(
        await fs.realpath(launch.codexHome),
        `${CODEX_TERMINAL_PROFILE_NAME}.config.toml`,
      ),
    );
    expect(await fs.readFile(launch.profilePath, "utf8")).toContain(
      `[projects."${realStateDir}"]`,
    );
  });

  it("uses a private Claude settings overlay and disables updates", async () => {
    const stateDir = await temporary("agent-group-claude-driver-");
    const userSettings = path.join(stateDir, "user-settings.json");
    await fs.writeFile(userSettings, '{"theme":"dark"}\n');
    const runtimeDir = claudeTerminalRuntimeDir(stateDir, "runtime-one");
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o777 });
    await fs.chmod(runtimeDir, 0o777);
    const victim = path.join(stateDir, "victim");
    await fs.writeFile(victim, "unchanged");
    await fs.symlink(victim, path.join(runtimeDir, "claude-settings.json"));

    const launch = await prepareClaudeTerminalLaunch({
      stateDir,
      runtimeInstanceId: "runtime-one",
      providerSessionId: "4d55ec11-cc83-452a-80f0-7a2f877224e8",
      hookEndpoint: path.join(stateDir, "bridge.sock"),
      hookToken: "secret-token",
      executable: "/usr/local/bin/claude-original",
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
      runtimeMode: "approval-required",
      baseEnv: {
        PATH: "/usr/local/bin:/usr/bin",
        HOME: stateDir,
        AGENT_GROUP_AUTH_TOKEN: "must-not-leak",
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    expect(launch.executable).toBe("/usr/local/bin/claude-original");
    expect(launch.args.slice(-2)).toEqual(["--permission-mode", "manual"]);
    expect(launch.env.DISABLE_AUTOUPDATER).toBe("1");
    expect(launch.env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(launch.env.TERM).toMatch(/^xterm/u);
    expect(launch.env.AGENT_GROUP_AUTH_TOKEN).toBeUndefined();
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect((await fs.stat(launch.runtimeDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(launch.settingsPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(launch.shimPath)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(userSettings, "utf8")).toBe('{"theme":"dark"}\n');
    expect(await fs.readFile(victim, "utf8")).toBe("unchanged");
    const settings = JSON.parse(await fs.readFile(launch.settingsPath, "utf8"));
    expect(Object.keys(settings.hooks)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "SubagentStart",
      "Stop",
      "StopFailure",
      "SessionEnd",
    ]);
  });

  it("uses a private fail-closed Pi extension and exact session", async () => {
    const stateDir = await temporary("agent-group-pi-driver-");
    const runtimeDir = piTerminalRuntimeDir(stateDir, "runtime-one");
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o777 });
    await fs.chmod(runtimeDir, 0o777);
    const launch = await preparePiTerminalLaunch({
      stateDir,
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-one",
      providerSessionId: "8fe78524-58e0-47ea-8d26-05ff47dcc816",
      hookEndpoint: path.join(stateDir, "bridge.sock"),
      hookToken: "secret-token",
      executable: "/usr/local/bin/pi-original",
      modelSelection: {
        provider: "pi",
        model: "anthropic/claude-sonnet-4-5",
        options: { thinkingLevel: "high" },
      },
      runtimeMode: "approval-required",
    });
    expect(launch.executable).toBe("/usr/local/bin/pi-original");
    expect(launch.args).toEqual([
      "--no-extensions",
      "-e",
      launch.extensionPath,
      "--session-id",
      "8fe78524-58e0-47ea-8d26-05ff47dcc816",
      "--session-dir",
      launch.sessionDir,
      "--model",
      "anthropic/claude-sonnet-4-5",
      "--thinking",
      "high",
    ]);
    expect((await fs.stat(launch.runtimeDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(launch.sessionDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(launch.extensionPath)).mode & 0o777).toBe(0o700);
  });

  it("resumes Pi only from a regular file in the managed session directory", async () => {
    const stateDir = await temporary("agent-group-pi-resume-");
    const sessionDir = piTerminalSessionDir(stateDir);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, "session.jsonl");
    await fs.writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "resume-id",
        timestamp: "2026-07-25T00:00:00.000Z",
        cwd: stateDir,
      })}\n`,
    );
    const common = {
      stateDir,
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-resume",
      providerSessionId: "resume-id",
      resumeSessionPath: sessionPath,
      hookEndpoint: path.join(stateDir, "bridge.sock"),
      hookToken: "secret-token",
      executable: "pi",
      modelSelection: {
        provider: "pi" as const,
        model: "anthropic/claude-sonnet-4-5",
      },
      runtimeMode: "approval-required" as const,
    };

    const launch = await preparePiTerminalLaunch(common);
    expect(launch.args.slice(2, 6)).toEqual([
      launch.extensionPath,
      "--session",
      await fs.realpath(sessionPath),
      "--session-dir",
    ]);
    expect(launch.args).not.toContain("--session-id");

    const outsidePath = path.join(stateDir, "outside.jsonl");
    await fs.writeFile(
      outsidePath,
      `${JSON.stringify({
        type: "session",
        id: "resume-id",
        timestamp: "2026-07-25T00:00:00.000Z",
        cwd: stateDir,
      })}\n`,
    );
    await expect(
      preparePiTerminalLaunch({
        ...common,
        runtimeInstanceId: "runtime-outside",
        resumeSessionPath: outsidePath,
      }),
    ).rejects.toThrow("outside the managed session directory");

    const mismatchedPath = path.join(sessionDir, "mismatched.jsonl");
    await fs.writeFile(
      mismatchedPath,
      `${JSON.stringify({
        type: "session",
        id: "different-id",
        timestamp: "2026-07-25T00:00:00.000Z",
        cwd: stateDir,
      })}\n`,
    );
    await expect(
      preparePiTerminalLaunch({
        ...common,
        runtimeInstanceId: "runtime-mismatched",
        resumeSessionPath: mismatchedPath,
      }),
    ).rejects.toThrow("id does not match");

    const otherWorkspace = await temporary("agent-group-pi-other-workspace-");
    const otherWorkspacePath = path.join(sessionDir, "other-workspace.jsonl");
    await fs.writeFile(
      otherWorkspacePath,
      `${JSON.stringify({
        type: "session",
        id: "resume-id",
        timestamp: "2026-07-25T00:00:00.000Z",
        cwd: otherWorkspace,
      })}\n`,
    );
    await expect(
      preparePiTerminalLaunch({
        ...common,
        runtimeInstanceId: "runtime-other-workspace",
        resumeSessionPath: otherWorkspacePath,
      }),
    ).rejects.toThrow("different workspace");
  });

  it("derives launch executable from server settings only", async () => {
    const stateDir = await temporary("agent-group-registry-");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        pi: {
          ...DEFAULT_SERVER_SETTINGS.providers.pi,
          binaryPath: "/server/pi-original",
        },
      },
    };
    expect(terminalAgentExecutable(settings, "pi")).toBe(
      "/server/pi-original",
    );
    const serverInput = {
      stateDir,
      threadId: "thread-one",
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-one",
      provider: "pi" as const,
      providerSessionId: "8fe78524-58e0-47ea-8d26-05ff47dcc816",
      providerResumeCursor: null,
      resume: false,
      hookEndpoint: path.join(stateDir, "bridge.sock"),
      hookToken: "server-token",
      modelSelection: {
        provider: "pi" as const,
        model: "anthropic/claude-sonnet-4-5",
      },
      runtimeMode: "approval-required" as const,
      settings,
      executable: "/client/evil",
    };
    const launch = await prepareTerminalAgentLaunch(serverInput);
    expect(launch.executable).toBe("/server/pi-original");
    await expect(
      prepareTerminalAgentLaunch({
        ...serverInput,
        provider: "codex",
      }),
    ).rejects.toThrow("does not match");
  });

  it("rejects path-like runtime identifiers", () => {
    expect(() => claudeTerminalRuntimeDir("/tmp/state", "../escape")).toThrow(
      "invalid",
    );
    expect(() => piTerminalRuntimeDir("/tmp/state", "nested/runtime")).toThrow(
      "invalid",
    );
    expect(() =>
      buildClaudeTerminalArgs({
        settingsPath: "/tmp/settings.json",
        providerSessionId: "",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-5",
        },
        runtimeMode: "approval-required",
      }),
    ).toThrow("session id");
  });
});
