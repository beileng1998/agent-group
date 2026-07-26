import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { preparePiTerminalLaunch } from "./piTerminalDriver";
import { parsePiTerminalEvent, type PiTerminalBridgeResponse } from "./piTerminalProtocol";

type Handler = (...args: any[]) => unknown;

function mockPi() {
  const handlers = new Map<string, Handler>();
  const sentMessages: Array<{ message: unknown; options: unknown }> = [];
  return {
    handlers,
    sentMessages,
    pi: {
      on(name: string, handler: Handler) {
        handlers.set(name, handler);
      },
      getThinkingLevel() {
        return "high";
      },
      sendMessage(message: unknown, options: unknown) {
        sentMessages.push({ message, options });
      },
    },
  };
}

async function invoke(
  handlers: Map<string, Handler>,
  name: string,
  event: unknown,
  context: unknown,
) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing ${name} handler.`);
  return handler(event, context);
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

function installExtensionEnvironment(env: Record<string, string>): void {
  for (const name of [
    "AGENT_GROUP_HOOK_ENDPOINT",
    "AGENT_GROUP_HOOK_TOKEN",
    "AGENT_GROUP_RUNTIME_INSTANCE_ID",
    "AGENT_GROUP_PI_HOOK_SPOOL_DIR",
    "AGENT_GROUP_PI_RUNTIME_MODE",
  ]) {
    process.env[name] = env[name];
  }
}

describe("Pi managed terminal extension", () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];
  const originalEnv = { ...process.env };

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
    await Promise.all(
      tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
    for (const name of [
      "AGENT_GROUP_HOOK_ENDPOINT",
      "AGENT_GROUP_HOOK_TOKEN",
      "AGENT_GROUP_RUNTIME_INSTANCE_ID",
      "AGENT_GROUP_PI_HOOK_SPOOL_DIR",
      "AGENT_GROUP_PI_RUNTIME_MODE",
    ]) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  it("injects context and fails every unmanaged path closed", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-pi-extension-"));
    tempDirs.push(stateDir);
    const endpoint = path.join(stateDir, "bridge.sock");
    const seen: Array<Record<string, unknown>> = [];
    let rejectAck = false;
    const server = http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(request.headers.authorization).toBe("Bearer secret-token");
        const payload = JSON.parse(body) as Record<string, unknown>;
        seen.push(payload);
        if (rejectAck && payload.mode === "prompt-accepted") {
          response.writeHead(503);
          response.end();
          return;
        }
        const input = payload.input as Record<string, unknown>;
        let result: PiTerminalBridgeResponse = {};
        if (input.event_name === "prompt_submit") {
          result =
            input.prompt === "blocked"
              ? { block: { message: "Blocked." } }
              : input.prompt === "empty"
                ? {}
                : {
                    turnId: "turn-one",
                    additionalContext: "Managed context.",
                  };
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      });
    });
    servers.push(server);
    await listen(server, endpoint);

    const launch = await preparePiTerminalLaunch({
      stateDir,
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-one",
      providerSessionId: "8fe78524-58e0-47ea-8d26-05ff47dcc816",
      hookEndpoint: endpoint,
      hookToken: "secret-token",
      executable: "pi",
      modelSelection: {
        provider: "pi",
        model: "anthropic/claude-sonnet-4-5",
      },
      runtimeMode: "approval-required",
    });
    installExtensionEnvironment(launch.env);
    const extension = await import(
      `${pathToFileURL(launch.extensionPath).href}?${crypto.randomUUID()}`
    );
    const { handlers, pi, sentMessages } = mockPi();
    extension.default(pi);

    const notifications: string[] = [];
    let aborted = 0;
    let shutdown = 0;
    let approve = false;
    const context = {
      mode: "tui",
      hasUI: true,
      model: { provider: "anthropic", id: "claude-sonnet-4-5" },
      abort() {
        aborted += 1;
      },
      shutdown() {
        shutdown += 1;
      },
      sessionManager: {
        getSessionId: () => "8fe78524-58e0-47ea-8d26-05ff47dcc816",
        getSessionFile: () => path.join(launch.sessionDir, "session.jsonl"),
      },
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
        confirm: async () => approve,
      },
    };

    await invoke(handlers, "session_start", { reason: "startup" }, context);
    expect(
      await invoke(handlers, "input", { text: "Ship it.", source: "interactive" }, context),
    ).toEqual({ action: "continue" });
    expect(seen.some((payload) => payload.mode === "prompt-accepted")).toBe(false);
    expect(await invoke(handlers, "before_agent_start", { prompt: "Ship it." }, context)).toEqual({
      message: {
        customType: "agent-group-context",
        content: "Managed context.",
        display: false,
        details: { turnId: "turn-one" },
      },
    });
    expect(seen.some((payload) => payload.mode === "prompt-accepted")).toBe(false);
    expect(
      await invoke(
        handlers,
        "before_provider_request",
        { payload: { messages: ["user", "Managed context."] } },
        context,
      ),
    ).toBeUndefined();
    expect(seen.some((payload) => payload.mode === "prompt-accepted")).toBe(true);
    await invoke(
      handlers,
      "message_end",
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
        },
      },
      context,
    );
    await invoke(handlers, "agent_settled", {}, context);

    expect(
      await invoke(handlers, "input", { text: "empty", source: "interactive" }, context),
    ).toEqual({ action: "handled" });
    expect(
      await invoke(handlers, "input", { text: "blocked", source: "interactive" }, context),
    ).toEqual({ action: "handled" });
    rejectAck = true;
    expect(
      await invoke(
        handlers,
        "input",
        { text: "Ack must succeed.", source: "interactive" },
        context,
      ),
    ).toEqual({ action: "continue" });
    await invoke(handlers, "before_agent_start", { prompt: "Ack must succeed." }, context);
    expect(
      await invoke(
        handlers,
        "before_provider_request",
        { payload: { messages: ["Managed context."] } },
        context,
      ),
    ).toEqual({});
    expect(aborted).toBe(1);
    expect(shutdown).toBe(1);
    const recoveryPath = path.join(launch.runtimeDir, "recovery-prompt.json");
    const failedRecovery = JSON.parse(await fs.readFile(recoveryPath, "utf8")) as {
      readonly eventId: string;
    };
    expect((await fs.stat(recoveryPath)).mode & 0o777).toBe(0o600);
    rejectAck = false;
    expect(
      await invoke(
        handlers,
        "input",
        { text: "Ack must succeed.", source: "interactive" },
        context,
      ),
    ).toEqual({ action: "continue" });
    await invoke(handlers, "before_agent_start", { prompt: "Ack must succeed." }, context);
    await invoke(
      handlers,
      "before_provider_request",
      { payload: { messages: ["Managed context."] } },
      context,
    );
    const retryPrompt = seen
      .filter((payload) => {
        const input = payload.input as Record<string, unknown>;
        return input.prompt === "Ack must succeed.";
      })
      .at(-1);
    expect(retryPrompt?.eventId).toBe(failedRecovery.eventId);
    await expect(fs.stat(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
    const acceptedBeforeMissingPayload = seen.filter(
      (payload) => payload.mode === "prompt-accepted",
    ).length;
    expect(
      await invoke(
        handlers,
        "input",
        {
          text: "Payload must contain context.",
          source: "interactive",
          streamingBehavior: "steer",
        },
        context,
      ),
    ).toEqual({ action: "continue" });
    expect(
      await invoke(
        handlers,
        "before_provider_request",
        { payload: { messages: ["context-was-dropped"] } },
        context,
      ),
    ).toEqual({});
    expect(seen.filter((payload) => payload.mode === "prompt-accepted").length).toBe(
      acceptedBeforeMissingPayload,
    );
    expect(aborted).toBe(2);
    expect(shutdown).toBe(2);

    expect(
      await invoke(handlers, "before_agent_start", { prompt: "Bypass input hook." }, context),
    ).toEqual({
      systemPrompt: "Stop. Managed context is unavailable.",
    });
    expect(aborted).toBe(3);
    expect(shutdown).toBe(3);
    expect(notifications).toContain("Managed context required.");

    expect(
      await invoke(
        handlers,
        "tool_call",
        { toolName: "write", input: { path: "result.txt" } },
        context,
      ),
    ).toEqual({ block: true, reason: "Approval denied." });
    expect(
      await invoke(
        handlers,
        "tool_call",
        { toolName: "read", input: { path: "README.md" } },
        context,
      ),
    ).toBeUndefined();
    approve = true;
    expect(
      await invoke(
        handlers,
        "tool_call",
        { toolName: "bash", input: { command: "git status" } },
        context,
      ),
    ).toBeUndefined();

    expect(sentMessages).toMatchObject([
      {
        message: {
          customType: "agent-group-context",
          content: "Managed context.",
        },
        options: { deliverAs: "steer" },
      },
    ]);
    const events = seen
      .filter((payload) => {
        const input = payload.input as Record<string, unknown>;
        return typeof input?.event_name === "string";
      })
      .map((payload) => parsePiTerminalEvent(payload.input));
    expect(events.map((event) => event.event_name)).toEqual([
      "session_start",
      "prompt_submit",
      "turn_stop",
      "prompt_submit",
      "prompt_submit",
      "prompt_submit",
      "prompt_submit",
      "prompt_submit",
      "unmanaged_input",
    ]);
    expect(events[2]).toMatchObject({
      turn_id: "turn-one",
      assistant_text: "Done.",
    });
  });

  it("blocks input when the bridge is offline", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-pi-offline-"));
    tempDirs.push(stateDir);
    const launch = await preparePiTerminalLaunch({
      stateDir,
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-offline",
      providerSessionId: "8fe78524-58e0-47ea-8d26-05ff47dcc816",
      hookEndpoint: path.join(stateDir, "missing.sock"),
      hookToken: "secret-token",
      executable: "pi",
      modelSelection: {
        provider: "pi",
        model: "anthropic/claude-sonnet-4-5",
      },
      runtimeMode: "approval-required",
    });
    installExtensionEnvironment(launch.env);
    const extension = await import(
      `${pathToFileURL(launch.extensionPath).href}?${crypto.randomUUID()}`
    );
    const { handlers, pi } = mockPi();
    extension.default(pi);
    const notifications: string[] = [];
    const context = {
      sessionManager: {
        getSessionId: () => "8fe78524-58e0-47ea-8d26-05ff47dcc816",
        getSessionFile: () => undefined,
      },
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
      },
    };
    expect(
      await invoke(handlers, "input", { text: "Offline.", source: "interactive" }, context),
    ).toEqual({ action: "handled" });
    expect(notifications).toContain("Agent Group context unavailable.");
  });
});
