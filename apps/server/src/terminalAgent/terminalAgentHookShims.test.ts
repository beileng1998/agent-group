import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaudeHookShimSource } from "./claudeHookShim";
import { prepareClaudeTerminalLaunch } from "./claudeTerminalDriver";
import { buildCodexHookShimSource } from "./codexHookShim";
import { prepareCodexTerminalLaunch } from "./codexTerminalDriver";

interface ShimResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runShim(
  shimPath: string,
  env: Record<string, string>,
  input: unknown,
): Promise<ShimResult> {
  const child = spawn(process.execPath, [shimPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const [code] = (await once(child, "close")) as [number];
  return { stdout, stderr, code };
}

async function runShimWithClosedOutput(
  shimPath: string,
  env: Record<string, string>,
  input: unknown,
): Promise<Omit<ShimResult, "stdout">> {
  const child = spawn(process.execPath, [shimPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.destroy();
  child.stdin.end(JSON.stringify(input));
  const [code] = (await once(child, "close")) as [number];
  return { stderr, code };
}

function listen(server: http.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function bridgeServer(input: {
  readonly seen: Array<Record<string, unknown>>;
  readonly token: string;
  readonly response: (
    payload: Record<string, unknown>,
  ) => { readonly status?: number; readonly body?: unknown };
}): http.Server {
  return http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      expect(request.headers.authorization).toBe(`Bearer ${input.token}`);
      const payload = JSON.parse(body) as Record<string, unknown>;
      input.seen.push(payload);
      const result = input.response(payload);
      response.writeHead(result.status ?? 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(result.body ?? {}));
    });
  });
}

const codexInput = {
  session_id: "019f0000-0000-7000-8000-000000000001",
  transcript_path: "/tmp/codex-rollout.jsonl",
  cwd: "/workspace",
  model: "gpt-5.6",
  permission_mode: "default",
};

describe("managed terminal hook shims", () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
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

  it("blocks Codex until context and acknowledgement both succeed", async () => {
    const stateDir = await temporary("agent-group-codex-shim-");
    const sourceHome = await temporary("agent-group-codex-home-");
    await fs.writeFile(path.join(sourceHome, "config.toml"), "");
    const endpoint = path.join(stateDir, "bridge.sock");
    const launch = await prepareCodexTerminalLaunch({
      stateDir,
      sessionKey: "thread-one",
      runtimeInstanceId: "runtime-one",
      hookEndpoint: endpoint,
      hookToken: "secret-token",
      executable: "codex",
      modelSelection: { provider: "codex", model: "gpt-5.6" },
      runtimeMode: "approval-required",
      codexHomePath: sourceHome,
    });
    const offlineSessionStart = await runShim(
      launch.shimPath,
      launch.env,
      {
        ...codexInput,
        hook_event_name: "SessionStart",
        source: "startup",
      },
    );
    expect(offlineSessionStart).toMatchObject({
      stdout: "",
      code: 2,
    });
    expect(offlineSessionStart.stderr).toContain(
      "Agent Group context unavailable",
    );
    const prompt = {
      ...codexInput,
      hook_event_name: "UserPromptSubmit",
      turn_id: "turn-1",
      prompt: "Ship it.",
    };

    const offline = await runShim(launch.shimPath, launch.env, prompt);
    expect(JSON.parse(offline.stdout)).toMatchObject({ decision: "block" });
    const recoveryPath = path.join(launch.runtimeDir, "recovery-prompt.json");
    const recovery = JSON.parse(await fs.readFile(recoveryPath, "utf8")) as {
      readonly eventId: string;
    };
    expect((await fs.stat(recoveryPath)).mode & 0o777).toBe(0o600);

    const seen: Array<Record<string, unknown>> = [];
    let bridgeMode: "empty" | "reject-ack" | "ready" = "empty";
    const server = bridgeServer({
      seen,
      token: "secret-token",
      response: (payload) => {
        if (payload.mode === "prompt-accepted") {
          return bridgeMode === "reject-ack"
            ? { status: 503 }
            : { body: {} };
        }
        return bridgeMode === "empty"
          ? { body: {} }
          : { body: { additionalContext: "Managed context." } };
      },
    });
    servers.push(server);
    await listen(server, endpoint);

    expect(JSON.parse((await runShim(launch.shimPath, launch.env, prompt)).stdout))
      .toMatchObject({ decision: "block" });
    expect(seen.at(-1)?.eventId).toBe(recovery.eventId);
    bridgeMode = "reject-ack";
    const rejectedAck = await runShim(launch.shimPath, launch.env, prompt);
    expect(rejectedAck.code).toBe(2);
    expect(JSON.parse(rejectedAck.stdout)).toMatchObject({
      hookSpecificOutput: { additionalContext: "Managed context." },
    });
    expect(rejectedAck.stderr).toContain("context unavailable");
    expect(
      JSON.parse(await fs.readFile(recoveryPath, "utf8")),
    ).toMatchObject({ eventId: recovery.eventId, prompt: "Ship it." });
    bridgeMode = "ready";
    expect(JSON.parse((await runShim(launch.shimPath, launch.env, prompt)).stdout))
      .toEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "Managed context.",
        },
      });
    await expect(fs.stat(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(seen.some((payload) => payload.mode === "prompt-accepted")).toBe(true);
  });

  it("spools Claude lifecycle events and blocks empty context", async () => {
    const stateDir = await temporary("agent-group-claude-shim-");
    const endpoint = path.join(stateDir, "bridge.sock");
    const launch = await prepareClaudeTerminalLaunch({
      stateDir,
      runtimeInstanceId: "runtime-one",
      providerSessionId: "4d55ec11-cc83-452a-80f0-7a2f877224e8",
      hookEndpoint: endpoint,
      hookToken: "secret-token",
      executable: "claude",
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
      runtimeMode: "approval-required",
    });
    await runShim(launch.shimPath, launch.env, {
      hook_event_name: "Stop",
      last_assistant_message: "Done.",
    });
    const spoolDir = path.join(launch.runtimeDir, "hook-spool");
    const spooled = (await fs.readdir(spoolDir)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(spooled).toHaveLength(1);
    expect((await fs.stat(path.join(spoolDir, spooled[0]!))).mode & 0o777).toBe(
      0o600,
    );

    const seen: Array<Record<string, unknown>> = [];
    let contextReady = false;
    const server = bridgeServer({
      seen,
      token: "secret-token",
      response: (payload) => {
        const hook = payload.input as Record<string, unknown>;
        return hook.hook_event_name === "UserPromptSubmit" && contextReady
          ? { body: { additionalContext: "Managed context." } }
          : { body: {} };
      },
    });
    servers.push(server);
    await listen(server, endpoint);
    const prompt = {
      hook_event_name: "UserPromptSubmit",
      prompt: "Ship it.",
    };
    expect(JSON.parse((await runShim(launch.shimPath, launch.env, prompt)).stdout))
      .toMatchObject({ decision: "block" });
    contextReady = true;
    expect(JSON.parse((await runShim(launch.shimPath, launch.env, prompt)).stdout))
      .toMatchObject({
        hookSpecificOutput: { additionalContext: "Managed context." },
      });
    expect(
      seen.map((payload) => {
        const hook = payload.input as Record<string, unknown>;
        return payload.mode ?? hook.hook_event_name;
      }),
    ).toEqual([
      "Stop",
      "UserPromptSubmit",
      "UserPromptSubmit",
      "prompt-accepted",
    ]);
    expect(
      (await fs.readdir(spoolDir)).filter((name) => name.endsWith(".json")),
    ).toEqual([]);
  });

  it("does not commit when the provider output pipe rejects context", async () => {
    const stateDir = await temporary("agent-group-closed-hook-output-");
    const sourceHome = await temporary("agent-group-closed-codex-home-");
    await fs.writeFile(path.join(sourceHome, "config.toml"), "");
    const endpoint = path.join(stateDir, "bridge.sock");
    const launch = await prepareCodexTerminalLaunch({
      stateDir,
      sessionKey: "thread-closed-output",
      runtimeInstanceId: "runtime-closed-output",
      hookEndpoint: endpoint,
      hookToken: "secret-token",
      executable: "codex",
      modelSelection: { provider: "codex", model: "gpt-5.6" },
      runtimeMode: "approval-required",
      codexHomePath: sourceHome,
    });
    const seen: Array<Record<string, unknown>> = [];
    const server = bridgeServer({
      seen,
      token: "secret-token",
      response: () => ({ body: { additionalContext: "Managed context." } }),
    });
    servers.push(server);
    await listen(server, endpoint);

    const result = await runShimWithClosedOutput(
      launch.shimPath,
      launch.env,
      {
        ...codexInput,
        hook_event_name: "UserPromptSubmit",
        prompt: "Do not half commit.",
      },
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("context unavailable");
    expect(seen.some((payload) => payload.mode === "prompt-accepted")).toBe(false);
    await expect(
      fs.stat(path.join(launch.runtimeDir, "recovery-prompt.json")),
    ).resolves.toBeDefined();
  });

  it("does not prepare a prompt without durable recovery storage", async () => {
    const stateDir = await temporary("agent-group-missing-hook-recovery-");
    const endpoint = path.join(stateDir, "bridge.sock");
    const shimPath = path.join(stateDir, "hook.mjs");
    await fs.writeFile(shimPath, buildCodexHookShimSource(500), { mode: 0o700 });
    const seen: Array<Record<string, unknown>> = [];
    const server = bridgeServer({
      seen,
      token: "secret-token",
      response: () => ({ body: { additionalContext: "Must not run." } }),
    });
    servers.push(server);
    await listen(server, endpoint);

    const result = await runShim(
      shimPath,
      {
        AGENT_GROUP_HOOK_ENDPOINT: endpoint,
        AGENT_GROUP_HOOK_TOKEN: "secret-token",
        AGENT_GROUP_RUNTIME_INSTANCE_ID: "runtime-no-recovery",
      },
      {
        ...codexInput,
        hook_event_name: "UserPromptSubmit",
        prompt: "Require recovery.",
      },
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ decision: "block" });
    expect(seen).toEqual([]);
  });

  it.each([
    ["Codex", buildCodexHookShimSource, {
      ...codexInput,
      hook_event_name: "UserPromptSubmit",
      prompt: "Wait forever.",
    }],
    ["Claude", buildClaudeHookShimSource, {
      hook_event_name: "UserPromptSubmit",
      prompt: "Wait forever.",
    }],
  ] as const)(
    "aborts a hung %s bridge before the provider hook deadline",
    async (_provider, buildSource, prompt) => {
      const stateDir = await temporary("agent-group-hung-hook-");
      const endpoint = path.join(stateDir, "bridge.sock");
      const shimPath = path.join(stateDir, "hook.mjs");
      await fs.writeFile(shimPath, buildSource(120), { mode: 0o700 });
      let resolveClosed!: () => void;
      const socketClosed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const server = http.createServer((request) => {
        request.resume();
        request.socket.once("close", resolveClosed);
      });
      servers.push(server);
      await listen(server, endpoint);

      const startedAt = Date.now();
      const result = await runShim(
        shimPath,
        {
          AGENT_GROUP_HOOK_ENDPOINT: endpoint,
          AGENT_GROUP_HOOK_TOKEN: "secret-token",
          AGENT_GROUP_RUNTIME_INSTANCE_ID: "runtime-hung",
          AGENT_GROUP_HOOK_SPOOL_DIR: path.join(stateDir, "spool"),
        },
        prompt,
      );
      await socketClosed;

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ decision: "block" });
    },
  );
});
