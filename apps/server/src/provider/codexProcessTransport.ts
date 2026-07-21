import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

import {
  EventId,
  type ProviderEvent,
  type ProviderSession,
  type ThreadId,
} from "@agent-group/contracts";

import {
  asObject,
  classifyCodexStderrLine,
  isCodexProtocolEnvelope,
  isIgnorableCodexProcessLine,
  log,
  logIgnoredCodexStdout,
  normalizeCodexUserVisibleErrorMessage,
} from "./codexManagerProtocol.ts";
import type {
  CodexJsonRpcNotification as JsonRpcNotification,
  CodexJsonRpcRequest as JsonRpcRequest,
  CodexJsonRpcResponse as JsonRpcResponse,
} from "./codexJsonRpc.ts";
import { isResponse, isServerNotification, isServerRequest } from "./codexJsonValues.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";

export interface CodexProcessTransportDependencies {
  readonly sessions: Map<ThreadId, CodexSessionContext>;
  readonly discoverySessions: Map<string, CodexSessionContext>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
  readonly handleServerRequest: (context: CodexSessionContext, request: JsonRpcRequest) => void;
  readonly handleServerNotification: (
    context: CodexSessionContext,
    notification: JsonRpcNotification,
  ) => void;
  readonly publishEvent: (event: ProviderEvent) => void;
}

export class CodexProcessTransport {
  constructor(private readonly dependencies: CodexProcessTransportDependencies) {}

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  attachProcessListeners(context: CodexSessionContext): void {
    context.output.on("line", (line) => {
      if (context.stopping || isIgnorableCodexProcessLine(line)) {
        return;
      }
      this.handleStdoutLine(context, line);
    });

    const stderrOutput = createInterface({
      input: context.child.stderr,
      crlfDelay: Infinity,
    });
    stderrOutput.on("line", (rawLine) => {
      if (context.stopping) {
        return;
      }

      const diagnostic = classifyCodexStderrLine(rawLine);
      if (!diagnostic) {
        return;
      }

      log[diagnostic.level]("codex app-server diagnostic", {
        threadId: context.session.threadId,
        message: diagnostic.message,
        target: diagnostic.target,
      });
    });

    context.child.on("error", (error) => {
      const message = normalizeCodexUserVisibleErrorMessage(
        error.message || "codex app-server process errored.",
      );
      this.updateSession(context, {
        status: "error",
        lastError: message,
      });
      this.emitErrorEvent(context, "process/error", message);
    });

    context.child.on("exit", (code, signal) => {
      if (context.stopping) {
        return;
      }

      const message = `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
      this.updateSession(context, {
        status: "closed",
        activeTurnId: undefined,
        lastError: code === 0 ? context.session.lastError : message,
      });
      this.emitLifecycleEvent(context, "session/exited", message);
      if (context.discovery) {
        const discoveryKey = context.session.cwd ?? "";
        if (discoveryKey) {
          this.dependencies.discoverySessions.delete(discoveryKey);
        }
      } else {
        this.dependencies.sessions.delete(context.session.threadId);
      }
    });
  }

  handleStdoutLine(context: CodexSessionContext, line: string): void {
    if (isIgnorableCodexProcessLine(line)) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // App-server stdout is JSONL, but Codex subprocesses and hooks can leak
      // arbitrary output onto the same pipe, including fragments that begin
      // like JSON-RPC. An unparseable line cannot be a usable protocol frame;
      // ignore it and let any affected request fail through its normal timeout.
      logIgnoredCodexStdout(line, "invalid JSON fragment");
      return;
    }

    const protocolEnvelope = asObject(parsed);
    if (!protocolEnvelope || !isCodexProtocolEnvelope(protocolEnvelope)) {
      // Command output can also be valid standalone JSON (`{}`, `[]`, strings,
      // numbers). Only JSON-RPC-shaped envelopes belong to app-server itself.
      logIgnoredCodexStdout(line, "valid JSON without a JSON-RPC envelope");
      return;
    }

    if (isServerRequest(parsed)) {
      this.dependencies.handleServerRequest(context, parsed);
      return;
    }

    if (isServerNotification(parsed)) {
      this.dependencies.handleServerNotification(context, parsed);
      return;
    }

    if (isResponse(parsed)) {
      this.handleResponse(context, parsed);
      return;
    }

    this.emitErrorEvent(
      context,
      "protocol/unrecognizedMessage",
      "Received protocol message in an unknown shape.",
    );
  }

  private handleResponse(context: CodexSessionContext, response: JsonRpcResponse): void {
    const key = String(response.id);
    const pending = context.pending.get(key);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    context.pending.delete(key);

    if (response.error?.message) {
      pending.reject(new Error(`${pending.method} failed: ${String(response.error.message)}`));
      return;
    }

    pending.resolve(response.result);
  }

  async sendRequest<TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<TResponse> {
    if (context.stopping) {
      throw new Error("Cannot send a request while the Codex app-server session is stopping.");
    }
    const id = context.nextRequestId;
    context.nextRequestId += 1;

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        context.pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);

      context.pending.set(String(id), {
        method,
        timeout,
        resolve,
        reject,
      });
      try {
        this.writeMessage(context, {
          method,
          id,
          params,
        });
      } catch (error) {
        clearTimeout(timeout);
        context.pending.delete(String(id));
        reject(error);
      }
    });

    return result as TResponse;
  }

  writeMessage(context: CodexSessionContext, message: unknown): void {
    const encoded = JSON.stringify(message);
    if (!context.child.stdin.writable) {
      throw new Error("Cannot write to codex app-server stdin.");
    }

    context.child.stdin.write(`${encoded}\n`);
  }

  emitLifecycleEvent(context: CodexSessionContext, method: string, message: string): void {
    if (context.discovery) {
      return;
    }
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "session",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
    });
  }

  emitErrorEvent(context: CodexSessionContext, method: string, message: string): void {
    if (context.discovery) {
      return;
    }
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "error",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
    });
  }

  emitEvent(event: ProviderEvent): void {
    this.dependencies.publishEvent(event);
  }
}
