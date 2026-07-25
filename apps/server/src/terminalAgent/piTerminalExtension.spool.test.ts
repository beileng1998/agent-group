import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { preparePiTerminalLaunch } from "./piTerminalDriver";

type Handler = (...args: any[]) => unknown;

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

it("bounds Pi lifecycle spool files and retained assistant output", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-pi-spool-"));
  const endpoint = path.join(stateDir, "bridge.sock");
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as {
        readonly mode?: string;
        readonly input?: { readonly event_name?: string };
      };
      const result =
        payload.input?.event_name === "prompt_submit"
          ? { turnId: "turn-spool", additionalContext: "Managed context." }
          : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
  });
  const originalEnv = { ...process.env };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const launch = await preparePiTerminalLaunch({
      stateDir,
      workspaceRoot: stateDir,
      runtimeInstanceId: "runtime-spool",
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
    for (const [name, value] of Object.entries(launch.env)) {
      process.env[name] = value;
    }
    const extension = await import(
      `${pathToFileURL(launch.extensionPath).href}?${crypto.randomUUID()}`
    );
    const handlers = new Map<string, Handler>();
    extension.default({
      on(name: string, handler: Handler) {
        handlers.set(name, handler);
      },
      getThinkingLevel: () => "high",
      sendMessage: () => {},
    });
    const invoke = (name: string, event: unknown, context: unknown) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Missing ${name} handler.`);
      return handler(event, context);
    };
    const context = {
      mode: "tui",
      hasUI: true,
      model: { provider: "anthropic", id: "claude-sonnet-4-5" },
      abort: () => {},
      shutdown: () => {},
      sessionManager: {
        getSessionId: () => "8fe78524-58e-47ea-8d26-05ff47dcc816",
        getSessionFile: () => path.join(launch.sessionDir, "session.jsonl"),
      },
      ui: {
        notify: () => {},
        confirm: async () => false,
      },
    };

    await invoke(
      "input",
      { text: "Generate a large answer.", source: "interactive" },
      context,
    );
    await invoke(
      "before_agent_start",
      { prompt: "Generate a large answer." },
      context,
    );
    await invoke(
      "before_provider_request",
      { payload: { messages: ["Managed context."] } },
      context,
    );
    await close(server);
    await invoke(
      "message_end",
      {
        message: {
          role: "assistant",
          content: "界".repeat(700_000),
        },
      },
      context,
    );
    await invoke("agent_settled", {}, context);

    const spoolDir = launch.env.AGENT_GROUP_PI_HOOK_SPOOL_DIR!;
    const firstName = (await fs.readdir(spoolDir)).find((name) =>
      name.endsWith(".json"),
    );
    expect(firstName).toBeDefined();
    const firstPath = path.join(spoolDir, firstName!);
    const first = JSON.parse(await fs.readFile(firstPath, "utf8")) as {
      readonly input: { readonly assistant_text: string };
    };
    expect(Buffer.byteLength(first.input.assistant_text)).toBeLessThanOrEqual(
      512 * 1024,
    );
    expect(
      first.input.assistant_text.endsWith(
        "[Agent Group: assistant output truncated.]",
      ),
    ).toBe(true);
    expect((await fs.stat(firstPath)).size).toBeLessThanOrEqual(1024 * 1024);

    const retained = await fs.readFile(firstPath);
    for (let index = 0; index < 20; index += 1) {
      await fs.writeFile(
        path.join(spoolDir, `${String(index).padStart(2, "0")}-retained.json`),
        retained,
      );
    }
    await invoke(
      "session_shutdown",
      { reason: "exit", targetSessionFile: undefined },
      context,
    );
    const entries = (await fs.readdir(spoolDir)).filter((name) =>
      name.endsWith(".json"),
    );
    const totalBytes = (
      await Promise.all(entries.map((name) => fs.stat(path.join(spoolDir, name))))
    ).reduce((total, stat) => total + stat.size, 0);
    expect(entries.length).toBeLessThanOrEqual(32);
    expect(totalBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  } finally {
    if (server.listening) await close(server);
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
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
