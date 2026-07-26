import { PI_TERMINAL_EXTENSION_SPOOL_SOURCE } from "./piTerminalExtensionSpoolSource";

const PI_BRIDGE_DEADLINE_MS = 8_000;

export function buildPiTerminalExtensionSource(): string {
  return `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;
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
  const failure = stopReason === "error" ? errorMessage || "Pi turn failed."
    : stopReason === "aborted" ? errorMessage || "Pi turn aborted." : undefined;
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
  let prepared;
  let pendingCommit;
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
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
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
        incoming.on("error", (error) => finish(error));
        incoming.on("end", () => {
          if (incoming.statusCode !== 200) {
            finish(new Error("Bridge rejected event."));
            return;
          }
          try {
            finish(undefined, JSON.parse(output || "{}"));
          } catch (error) {
            finish(error);
          }
        });
      });
      timer = setTimeout(() => {
        request.destroy(new Error("Bridge timeout."));
      }, ${PI_BRIDGE_DEADLINE_MS});
      request.on("error", (error) => finish(error));
      request.end(encoded);
    });
  }
${PI_TERMINAL_EXTENSION_SPOOL_SOURCE}
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

  function stopManagedDelivery(ctx, message) {
    try { ctx.abort(); } catch { /* continue to shutdown */ }
    try { ctx.shutdown(); } catch { /* the empty payload is the fallback */ }
    notify(ctx, message);
  }
  function contextMessage(delivery) {
    return {
      customType: "agent-group-context",
      content: delivery.context,
      display: false,
      details: delivery.turnId ? { turnId: delivery.turnId } : undefined
    };
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
    if (prepared || pendingCommit) {
      notify(ctx, "The previous managed input is still pending.");
      return { action: "handled" };
    }
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
      const turnId = asText(response.turnId);
      const delivery = {
        eventId,
        prompt: event.text,
        context: additionalContext,
        turnId
      };
      if (event.streamingBehavior) {
        pendingCommit = delivery;
        try {
          pi.sendMessage(contextMessage(delivery), {
            deliverAs: event.streamingBehavior
          });
        } catch (error) {
          pendingCommit = undefined;
          throw error;
        }
      } else {
        prepared = delivery;
      }
      return { action: "continue" };
    } catch {
      notify(ctx, "Agent Group context unavailable.");
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const delivery = prepared;
    if (!delivery || delivery.prompt !== event.prompt || pendingCommit) {
      stopManagedDelivery(ctx, "Managed context required.");
      try {
        await send({
          event_name: "unmanaged_input",
          ...sessionFields(ctx),
          prompt: event.prompt
        });
      } catch {}
      return { systemPrompt: "Stop. Managed context is unavailable." };
    }
    prepared = undefined;
    pendingCommit = delivery;
    return { message: contextMessage(delivery) };
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const delivery = pendingCommit;
    if (!delivery) return;
    try {
      const encodedContext = JSON.stringify(delivery.context).slice(1, -1);
      if (!JSON.stringify(event.payload).includes(encodedContext)) {
        throw new Error("Managed context missing from provider payload.");
      }
      await requestBridge({
        runtimeInstanceId,
        eventId: delivery.eventId,
        mode: "prompt-accepted",
        input: { prompt: delivery.prompt }
      });
      await clearRecoveryPrompt();
      pendingCommit = undefined;
      activeTurnId = delivery.turnId || activeTurnId;
      managedRun = true;
    } catch {
      pendingCommit = undefined;
      stopManagedDelivery(ctx, "Agent Group context delivery failed.");
      return {};
    }
  });

  pi.on("message_end", (event) => {
    const outcome = assistantOutcome(event.message);
    if (!outcome) return;
    lastAssistant = outcome.text;
    lastFailure = outcome.failure;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!managedRun) return;
    const input = boundLifecycleInput({
      event_name: lastFailure ? "turn_failure" : "turn_stop",
      ...sessionFields(ctx),
      ...(activeTurnId ? { turn_id: activeTurnId } : {}),
      ...(lastFailure
        ? { message: lastFailure }
        : lastAssistant
          ? { assistant_text: lastAssistant }
          : {})
    });
    const abandonedCommit = pendingCommit !== undefined;
    prepared = undefined;
    pendingCommit = undefined;
    managedRun = false;
    activeTurnId = undefined;
    lastAssistant = undefined;
    lastFailure = undefined;
    try {
      await send(input, true);
      if (abandonedCommit) await clearRecoveryPrompt();
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
    prepared = undefined;
    pendingCommit = undefined;
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
