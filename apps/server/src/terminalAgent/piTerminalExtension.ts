const PI_BRIDGE_TIMEOUT_MS = 5_000;

export function buildPiTerminalExtensionSource(): string {
  return `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;
const MAX_SPOOL_FILES = 32;

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assistantOutcome(message) {
  if (!message || message.role !== "assistant") return undefined;
  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content
          .filter((part) => part && part.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("")
      : undefined;
  const stopReason = asText(message.stopReason);
  const errorMessage = asText(message.errorMessage);
  const failure = stopReason === "error"
    ? errorMessage || "Pi turn failed."
    : stopReason === "aborted"
      ? errorMessage || "Pi turn aborted."
      : undefined;
  return {
    ...(text && text.trim() ? { text } : {}),
    ...(failure ? { failure } : {})
  };
}

function modelState(model) {
  const id = asText(model && model.id);
  if (!id) return {};
  const provider = asText(model.provider);
  return {
    model: provider ? provider + "/" + id : id,
    ...(provider ? { model_provider: provider } : {})
  };
}

export default function agentGroupExtension(pi) {
  const endpoint = process.env.AGENT_GROUP_HOOK_ENDPOINT;
  const token = process.env.AGENT_GROUP_HOOK_TOKEN;
  const runtimeInstanceId = process.env.AGENT_GROUP_RUNTIME_INSTANCE_ID;
  const spoolDir = process.env.AGENT_GROUP_PI_HOOK_SPOOL_DIR;
  const permissionMode =
    process.env.AGENT_GROUP_PI_RUNTIME_MODE || "approval-required";
  const recoveryPromptPath = spoolDir
    ? path.join(path.dirname(spoolDir), "recovery-prompt.json")
    : undefined;
  const prepared = [];
  let activeTurnId;
  let managedRun = false;
  let lastAssistant;
  let lastFailure;
  let transportQueue = Promise.resolve();

  function requestBridge(inputOrPayload) {
    return new Promise((resolve, reject) => {
      if (!endpoint || !token || !runtimeInstanceId) {
        reject(new Error("Bridge unavailable."));
        return;
      }
      const payload = inputOrPayload && inputOrPayload.runtimeInstanceId
        ? inputOrPayload
        : {
            runtimeInstanceId,
            eventId: inputOrPayload.event_id,
            input: inputOrPayload
          };
      const encoded = JSON.stringify(payload);
      if (Buffer.byteLength(encoded) > MAX_BYTES) {
        reject(new Error("Bridge event too large."));
        return;
      }
      const request = http.request({
        socketPath: endpoint,
        path: "/hook",
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(encoded)
        }
      }, (incoming) => {
        let output = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          output += chunk;
          if (Buffer.byteLength(output) > MAX_BYTES) {
            incoming.destroy(new Error("Bridge response too large."));
          }
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          if (incoming.statusCode !== 200) {
            reject(new Error("Bridge rejected event."));
            return;
          }
          try {
            resolve(JSON.parse(output || "{}"));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.setTimeout(${PI_BRIDGE_TIMEOUT_MS}, () => {
        request.destroy(new Error("Bridge timeout."));
      });
      request.on("error", reject);
      request.end(encoded);
    });
  }

  async function writePrivateJson(filePath, value) {
    const temporaryPath = filePath + "." + randomUUID() + ".tmp";
    await fs.writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }

  async function writeSpool(input) {
    if (!spoolDir) throw new Error("Spool unavailable.");
    await fs.mkdir(spoolDir, { recursive: true, mode: 0o700 });
    await fs.chmod(spoolDir, 0o700);
    const entries = (await fs.readdir(spoolDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const stale of entries.slice(
      0,
      Math.max(0, entries.length - MAX_SPOOL_FILES + 1),
    )) {
      await fs.rm(path.join(spoolDir, stale), { force: true });
    }
    const filePath = path.join(
      spoolDir,
      String(Date.now()).padStart(13, "0") + "-" + input.event_id + ".json"
    );
    await writePrivateJson(filePath, {
      runtimeInstanceId,
      eventId: input.event_id,
      input
    });
  }

  async function readRecoveryPrompt() {
    if (!recoveryPromptPath) return undefined;
    try {
      return JSON.parse(await fs.readFile(recoveryPromptPath, "utf8"));
    } catch {
      return undefined;
    }
  }

  async function resolvePromptEventId(prompt) {
    const previous = await readRecoveryPrompt();
    return previous &&
      previous.runtimeInstanceId === runtimeInstanceId &&
      previous.prompt === prompt &&
      typeof previous.eventId === "string"
      ? previous.eventId
      : randomUUID();
  }

  async function persistRecoveryPrompt(prompt, eventId) {
    if (!recoveryPromptPath || typeof prompt !== "string") {
      throw new Error("Recovery storage unavailable.");
    }
    await writePrivateJson(recoveryPromptPath, {
      prompt,
      eventId,
      runtimeInstanceId,
      reason: "Context delivery interrupted.",
      createdAt: new Date().toISOString()
    });
  }

  async function clearRecoveryPrompt() {
    if (recoveryPromptPath) {
      await fs.rm(recoveryPromptPath, { force: true });
    }
  }

  async function replaySpool() {
    if (!spoolDir) return;
    const entries = (await fs.readdir(spoolDir).catch(() => []))
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const entry of entries) {
      const filePath = path.join(spoolDir, entry);
      let payload;
      try {
        payload = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch {
        await fs.rm(filePath, { force: true });
        continue;
      }
      if (payload.runtimeInstanceId !== runtimeInstanceId) {
        await fs.rm(filePath, { force: true });
        continue;
      }
      await requestBridge(payload);
      await fs.rm(filePath, { force: true });
    }
  }

  function send(rawInput, lifecycle = false) {
    const input = { event_id: randomUUID(), ...rawInput };
    const task = transportQueue.then(async () => {
      if (lifecycle) {
        await writeSpool(input);
        await replaySpool();
        return {};
      }
      await replaySpool();
      return requestBridge(input);
    });
    transportQueue = task.catch(() => undefined);
    return task;
  }

  function sessionFields(ctx) {
    return {
      session_id: ctx.sessionManager.getSessionId(),
      ...(asText(ctx.sessionManager.getSessionFile())
        ? { session_file: ctx.sessionManager.getSessionFile() }
        : {})
    };
  }

  function notify(ctx, message) {
    try {
      ctx.ui.notify(message, "error");
    } catch {
      // Input remains blocked without a UI.
    }
  }

  pi.on("session_start", async (event, ctx) => {
    try {
      await send({
        event_name: "session_start",
        ...sessionFields(ctx),
        reason: event.reason,
        ...modelState(ctx.model),
        thinking_level: pi.getThinkingLevel(),
        permission_mode: permissionMode
      });
    } catch {
      notify(ctx, "Agent Group bridge unavailable.");
    }
  });

  pi.on("input", async (event, ctx) => {
    const eventId = await resolvePromptEventId(event.text);
    try {
      await persistRecoveryPrompt(event.text, eventId);
      const response = await send({
        event_id: eventId,
        event_name: "prompt_submit",
        ...sessionFields(ctx),
        prompt: event.text,
        source: event.source,
        ...(event.streamingBehavior
          ? { streaming_behavior: event.streamingBehavior }
          : {})
      });
      if (response && response.block && asText(response.block.message)) {
        await persistRecoveryPrompt(event.text, randomUUID());
        notify(ctx, response.block.message);
        return { action: "handled" };
      }
      const rawContext = response && response.additionalContext;
      const additionalContext =
        typeof rawContext === "string" && rawContext.trim()
          ? rawContext
          : undefined;
      if (!additionalContext) throw new Error("Context unavailable.");
      await requestBridge({
        runtimeInstanceId,
        eventId,
        mode: "prompt-accepted",
        input: { prompt: event.text }
      });
      await clearRecoveryPrompt();
      const turnId = asText(response.turnId);
      if (event.streamingBehavior) {
        activeTurnId = turnId || activeTurnId;
        managedRun = true;
        pi.sendMessage({
          customType: "agent-group-context",
          content: additionalContext,
          display: false,
          details: turnId ? { turnId } : undefined
        }, { deliverAs: event.streamingBehavior });
      } else {
        prepared.push({ context: additionalContext, turnId });
      }
      return { action: "continue" };
    } catch {
      notify(ctx, "Agent Group context unavailable.");
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const delivery = prepared.shift();
    if (!delivery) {
      try {
        ctx.abort();
      } catch {
        // Shutdown is the independent fail-closed boundary.
      }
      try {
        ctx.shutdown();
      } catch {
        // The guard message remains as a final fallback.
      }
      try {
        await send({
          event_name: "unmanaged_input",
          ...sessionFields(ctx),
          prompt: event.prompt
        });
      } catch {
        // Shutdown remains fail-closed without telemetry.
      }
      notify(ctx, "Managed context required.");
      return { systemPrompt: "Stop. Managed context is unavailable." };
    }
    activeTurnId = delivery.turnId || activeTurnId;
    managedRun = true;
    return {
      message: {
        customType: "agent-group-context",
        content: delivery.context,
        display: false,
        details: delivery.turnId ? { turnId: delivery.turnId } : undefined
      }
    };
  });

  pi.on("message_end", (event) => {
    const outcome = assistantOutcome(event.message);
    if (!outcome) return;
    lastAssistant = outcome.text;
    lastFailure = outcome.failure;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!managedRun) return;
    const input = {
      event_name: lastFailure ? "turn_failure" : "turn_stop",
      ...sessionFields(ctx),
      ...(activeTurnId ? { turn_id: activeTurnId } : {}),
      ...(lastFailure
        ? { message: lastFailure }
        : lastAssistant
          ? { assistant_text: lastAssistant }
          : {})
    };
    prepared.length = 0;
    managedRun = false;
    activeTurnId = undefined;
    lastAssistant = undefined;
    lastFailure = undefined;
    try {
      await send(input, true);
    } catch {
      notify(ctx, "Agent Group bridge unavailable.");
    }
  });

  pi.on("model_select", async (event, ctx) => {
    try {
      await send({
        event_name: "runtime_state",
        ...sessionFields(ctx),
        ...modelState(event.model),
        thinking_level: pi.getThinkingLevel(),
        permission_mode: permissionMode
      });
    } catch {
      notify(ctx, "Agent Group bridge unavailable.");
    }
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    try {
      await send({
        event_name: "runtime_state",
        ...sessionFields(ctx),
        ...modelState(ctx.model),
        thinking_level: event.level,
        permission_mode: permissionMode
      });
    } catch {
      notify(ctx, "Agent Group bridge unavailable.");
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    try {
      await send({
        event_name: "session_compact",
        ...sessionFields(ctx),
        reason: event.reason,
        will_retry: event.willRetry
      });
    } catch {
      notify(ctx, "Agent Group bridge unavailable.");
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    prepared.length = 0;
    managedRun = false;
    activeTurnId = undefined;
    lastAssistant = undefined;
    lastFailure = undefined;
    try {
      await send({
        event_name: "session_shutdown",
        ...sessionFields(ctx),
        reason: event.reason,
        ...(asText(event.targetSessionFile)
          ? { target_session_file: event.targetSessionFile }
          : {})
      }, true);
    } catch {
      // The event remains in the private spool.
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (
      permissionMode !== "approval-required" ||
      ["read", "grep", "find", "ls"].includes(event.toolName)
    ) {
      return;
    }
    if (!ctx.hasUI || ctx.mode !== "tui") {
      return { block: true, reason: "Approval required." };
    }
    const toolInput =
      event.input && typeof event.input === "object" ? event.input : {};
    const detail =
      asText(toolInput.path) || asText(toolInput.command) || event.toolName;
    try {
      const approved = await ctx.ui.confirm(
        "Allow " + event.toolName + "?",
        String(detail).slice(0, 500)
      );
      return approved
        ? undefined
        : { block: true, reason: "Approval denied." };
    } catch {
      return { block: true, reason: "Approval required." };
    }
  });
}
`;
}
