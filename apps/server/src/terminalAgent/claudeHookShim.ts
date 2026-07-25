const CLAUDE_SHIM_REQUEST_DEADLINE_MS = 8_000;

export function buildClaudeHookShimSource(
  requestDeadlineMs = CLAUDE_SHIM_REQUEST_DEADLINE_MS,
): string {
  return `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SPOOL_FILES = 32;
const endpoint = process.env.AGENT_GROUP_HOOK_ENDPOINT;
const token = process.env.AGENT_GROUP_HOOK_TOKEN;
const runtimeInstanceId = process.env.AGENT_GROUP_RUNTIME_INSTANCE_ID;
const spoolDir = process.env.AGENT_GROUP_HOOK_SPOOL_DIR;
const mode = process.argv.includes("--status-line") ? "status-line" : undefined;
const lifecycleEvents = new Set(["Stop", "StopFailure", "SessionEnd"]);
const recoveryPromptPath = spoolDir
  ? path.join(path.dirname(spoolDir), "recovery-prompt.json")
  : undefined;

function failClosed(eventName, outputStarted = false) {
  if (mode === "status-line") {
    process.stdout.write("Agent Group · Context pending");
    return;
  }
  if (eventName === "UserPromptSubmit" || !eventName) {
    const message = "Agent Group context unavailable. Retry.";
    if (outputStarted) {
      process.stderr.write(message + "\\n");
      process.exitCode = 2;
    } else {
      process.stdout.write(JSON.stringify({ decision: "block", reason: message }));
    }
  }
}

async function writeOutput(value) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        process.stdout.off("error", finish);
        resolve();
      }
    };
    process.stdout.once("error", finish);
    process.stdout.write(value, finish);
  });
}

async function emitResponse(eventName, response) {
  if (mode === "status-line") {
    await writeOutput(response.statusLine || "Agent Group · Context pending");
    return;
  }
  if (response.block) {
    if (eventName !== "UserPromptSubmit") throw new Error("Invalid block response.");
    await writeOutput(JSON.stringify({
      decision: "block",
      reason: response.block.message
    }));
    return;
  }
  if (response.additionalContext) {
    await writeOutput(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: response.additionalContext
      }
    }));
  }
}

function hasContext(response) {
  return response &&
    typeof response.additionalContext === "string" &&
    response.additionalContext.trim().length > 0;
}

async function writePrivateJson(filePath, value) {
  const temporaryPath = filePath + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 });
  await fs.chmod(temporaryPath, 0o600);
  await fs.rm(filePath, { force: true });
  await fs.rename(temporaryPath, filePath);
}

async function readRecoveryPrompt() {
  if (!recoveryPromptPath) return undefined;
  try {
    return JSON.parse(await fs.readFile(recoveryPromptPath, "utf8"));
  } catch {
    return undefined;
  }
}

async function resolveEventId(eventName, input) {
  if (eventName !== "UserPromptSubmit" || typeof input.prompt !== "string") {
    return randomUUID();
  }
  const previous = await readRecoveryPrompt();
  return previous &&
    previous.runtimeInstanceId === runtimeInstanceId &&
    previous.prompt === input.prompt &&
    typeof previous.eventId === "string"
    ? previous.eventId
    : randomUUID();
}

async function persistRecoveryPrompt(input, eventId) {
  if (!recoveryPromptPath || typeof input.prompt !== "string") {
    throw new Error("Recovery storage unavailable.");
  }
  await writePrivateJson(recoveryPromptPath, {
    prompt: input.prompt,
    eventId,
    runtimeInstanceId,
    reason: "Context delivery interrupted.",
    createdAt: new Date().toISOString()
  });
}

async function clearRecoveryPrompt() {
  if (recoveryPromptPath) await fs.rm(recoveryPromptPath, { force: true });
}

async function persistLifecycle(payload) {
  if (!spoolDir || !lifecycleEvents.has(payload.input.hook_event_name)) {
    return undefined;
  }
  await fs.mkdir(spoolDir, { recursive: true, mode: 0o700 });
  await fs.chmod(spoolDir, 0o700);
  const existing = (await fs.readdir(spoolDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const stale of existing.slice(
    0,
    Math.max(0, existing.length - MAX_SPOOL_FILES + 1),
  )) {
    await fs.rm(path.join(spoolDir, stale), { force: true });
  }
  const filePath = path.join(
    spoolDir,
    String(Date.now()).padStart(13, "0") + "-" + randomUUID() + ".json"
  );
  await writePrivateJson(filePath, payload);
  return filePath;
}

function sendBridge(payload, deadlineAt) {
  return new Promise((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      reject(new Error("Bridge deadline exceeded."));
      return;
    }
    const encoded = JSON.stringify(payload);
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
        if (Buffer.byteLength(output) > MAX_INPUT_BYTES) {
          incoming.destroy(new Error("Bridge response too large."));
        }
      });
      incoming.on("error", (error) => finish(error));
      incoming.on("end", () => {
        if (incoming.statusCode !== 200) {
          finish(new Error("Bridge rejected hook."));
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
    }, remaining);
    request.on("error", (error) => finish(error));
    request.end(encoded);
  });
}

async function replayLifecycleSpool(currentPath, deadlineAt) {
  if (!spoolDir) return false;
  const entries = (await fs.readdir(spoolDir).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
  let deliveredCurrent = false;
  for (const entry of entries) {
    const filePath = path.join(spoolDir, entry);
    try {
      const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (payload.runtimeInstanceId !== runtimeInstanceId) {
        await fs.rm(filePath, { force: true });
        continue;
      }
      await sendBridge(payload, deadlineAt);
      await fs.rm(filePath, { force: true });
      deliveredCurrent ||= filePath === currentPath;
    } catch (error) {
      if (filePath === currentPath) throw error;
    }
  }
  return deliveredCurrent;
}

let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
  if (Buffer.byteLength(body) > MAX_INPUT_BYTES) {
    failClosed();
    process.exit();
  }
}

let input;
try {
  input = JSON.parse(body || "{}");
} catch {
  failClosed();
  process.exit();
}
const eventName = mode === "status-line" ? "StatusLine" : input.hook_event_name;
const requestDeadlineAt = Date.now() + ${requestDeadlineMs};
const eventId = await resolveEventId(eventName, input);
const payload = {
  runtimeInstanceId,
  eventId,
  input,
  ...(mode ? { mode } : {})
};
let lifecyclePath;
try {
  lifecyclePath = await persistLifecycle(payload);
} catch {
  // Lifecycle recovery storage is best-effort.
}
if (eventName === "UserPromptSubmit") {
  try {
    await persistRecoveryPrompt(input, eventId);
  } catch {
    failClosed(eventName);
    process.exit();
  }
}
if (!endpoint || !token || !runtimeInstanceId) {
  failClosed(eventName);
  process.exit();
}

let promptOutputStarted = false;
try {
  const deliveredCurrent = !mode
    ? await replayLifecycleSpool(lifecyclePath, requestDeadlineAt)
    : false;
  if (deliveredCurrent) process.exit();
  const response = await sendBridge(payload, requestDeadlineAt);
  if (eventName === "UserPromptSubmit") {
    if (response.block) {
      await persistRecoveryPrompt(input, randomUUID());
    } else {
      if (!hasContext(response)) throw new Error("Context unavailable.");
      promptOutputStarted = true;
      await emitResponse(eventName, response);
      await sendBridge({
        runtimeInstanceId,
        eventId,
        mode: "prompt-accepted",
        input: { prompt: input.prompt }
      }, requestDeadlineAt);
      await clearRecoveryPrompt();
      process.exit();
    }
  }
  await emitResponse(eventName, response);
} catch {
  failClosed(eventName, promptOutputStarted);
}
`;
}
