import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_WRITE_LENGTH,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "./terminal";
import {
  TerminalAgentAttachedEvent,
  TerminalAgentEvent,
  TerminalAgentResizeInput,
  TerminalAgentRestartInput,
  TerminalAgentRuntimeState,
  TerminalAgentStartInput,
  TerminalAgentSubscribeInput,
  TerminalAgentWriteInput,
} from "./terminalAgent";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

const terminalState = {
  threadId: "thread-1",
  authority: "terminal",
  revision: 4,
  provider: "codex",
  status: "ready",
  runtimeInstanceId: "runtime-1",
  generation: "generation-1",
  pid: 1234,
  providerSessionId: "provider-session-1",
  model: "gpt-5",
  effort: "high",
  permission: "on-request",
  capabilities: {
    cliVersion: "0.144.6",
    authentication: "authenticated",
    authMethod: "chatgpt",
    apiProvider: "openai",
    hookSchema: "cli-verified",
  },
  exit: null,
  error: null,
};

describe("TerminalAgentRuntimeState", () => {
  it.each(["codex", "claudeAgent", "pi"] as const)("accepts the %s provider", (provider) => {
    const state = decodeSync(TerminalAgentRuntimeState, {
      ...terminalState,
      provider,
    });

    expect(state.provider).toBe(provider);
    expect(state.revision).toBe(4);
  });

  it("rejects providers outside the managed terminal allowlist", () => {
    expect(
      decodes(TerminalAgentRuntimeState, {
        ...terminalState,
        provider: "cursor",
      }),
    ).toBe(false);
  });

  it("represents structured authority without a terminal process", () => {
    expect(
      decodes(TerminalAgentRuntimeState, {
        ...terminalState,
        authority: "structured",
        status: "idle",
        runtimeInstanceId: null,
        generation: null,
        pid: null,
        providerSessionId: null,
        capabilities: null,
      }),
    ).toBe(true);
  });

  it("does not expose raw context or local paths in public runtime state", () => {
    const state = decodeSync(TerminalAgentRuntimeState, {
      ...terminalState,
      context: {
        content: "hidden",
        filePath: "/private/context.md",
      },
    });
    expect("context" in state).toBe(false);
  });

  it("rejects negative revisions and invalid pids", () => {
    expect(
      decodes(TerminalAgentRuntimeState, {
        ...terminalState,
        revision: -1,
      }),
    ).toBe(false);
    expect(
      decodes(TerminalAgentRuntimeState, {
        ...terminalState,
        pid: 0,
      }),
    ).toBe(false);
  });
});

describe("managed terminal requests", () => {
  it("accepts terminal bounds for start and restart", () => {
    expect(
      decodes(TerminalAgentStartInput, {
        threadId: "thread-1",
        cols: TERMINAL_MIN_COLS,
        rows: TERMINAL_MIN_ROWS,
      }),
    ).toBe(true);
    expect(
      decodes(TerminalAgentRestartInput, {
        threadId: "thread-1",
        cols: TERMINAL_MAX_COLS,
        rows: TERMINAL_MAX_ROWS,
      }),
    ).toBe(true);
  });

  it("rejects start and restart dimensions outside terminal bounds", () => {
    expect(
      decodes(TerminalAgentStartInput, {
        threadId: "thread-1",
        cols: TERMINAL_MIN_COLS - 1,
        rows: TERMINAL_MIN_ROWS,
      }),
    ).toBe(false);
    expect(
      decodes(TerminalAgentRestartInput, {
        threadId: "thread-1",
        cols: TERMINAL_MAX_COLS,
        rows: TERMINAL_MAX_ROWS + 1,
      }),
    ).toBe(false);
  });

  it.each(["command", "cwd", "env", "sessionId"] as const)(
    "rejects server-owned %s on start and restart",
    (field) => {
      const forbiddenValue = field === "env" ? { SECRET: "value" } : "forbidden";
      const request = {
        threadId: "thread-1",
        cols: 120,
        rows: 40,
        [field]: forbiddenValue,
      };

      expect(decodes(TerminalAgentStartInput, request)).toBe(false);
      expect(decodes(TerminalAgentRestartInput, request)).toBe(false);
    },
  );

  it("requires both authority fences for writes", () => {
    const valid = {
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
      data: "hello",
    };

    expect(decodes(TerminalAgentWriteInput, valid)).toBe(true);
    expect(decodes(TerminalAgentWriteInput, { ...valid, revision: undefined })).toBe(false);
    expect(decodes(TerminalAgentWriteInput, { ...valid, generation: undefined })).toBe(false);
  });

  it("uses the existing terminal write limit", () => {
    const request = {
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
    };

    expect(
      decodes(TerminalAgentWriteInput, {
        ...request,
        data: "x".repeat(TERMINAL_MAX_WRITE_LENGTH),
      }),
    ).toBe(true);
    expect(
      decodes(TerminalAgentWriteInput, {
        ...request,
        data: "x".repeat(TERMINAL_MAX_WRITE_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it("requires both authority fences and bounded dimensions for resize", () => {
    const valid = {
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
      cols: 120,
      rows: 40,
    };

    expect(decodes(TerminalAgentResizeInput, valid)).toBe(true);
    expect(decodes(TerminalAgentResizeInput, { ...valid, revision: -1 })).toBe(false);
    expect(decodes(TerminalAgentResizeInput, { ...valid, generation: "" })).toBe(false);
    expect(
      decodes(TerminalAgentResizeInput, {
        ...valid,
        cols: TERMINAL_MAX_COLS + 1,
      }),
    ).toBe(false);
  });

  it.each(["command", "cwd", "env", "sessionId"] as const)(
    "rejects server-owned %s on all other external requests",
    (field) => {
      const forbiddenValue = field === "env" ? { SECRET: "value" } : "forbidden";

      expect(
        decodes(TerminalAgentSubscribeInput, {
          threadId: "thread-1",
          [field]: forbiddenValue,
        }),
      ).toBe(false);
      expect(
        decodes(TerminalAgentWriteInput, {
          threadId: "thread-1",
          revision: 4,
          generation: "generation-1",
          data: "hello",
          [field]: forbiddenValue,
        }),
      ).toBe(false);
      expect(
        decodes(TerminalAgentResizeInput, {
          threadId: "thread-1",
          revision: 4,
          generation: "generation-1",
          cols: 120,
          rows: 40,
          [field]: forbiddenValue,
        }),
      ).toBe(false);
    },
  );
});

describe("TerminalAgentEvent", () => {
  it("accepts the snapshot-first attached payload", () => {
    const attached = decodeSync(TerminalAgentAttachedEvent, {
      type: "attached",
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
      snapshot: {
        snapshotAnsi: "\u001b[Hready",
        scrollbackAnsi: "previous output\n",
        rehydrateSequences: "\u001b[?2004h",
        pendingEscapeTailAnsi: "\u001b[?25",
        cols: 120,
        rows: 40,
        outputSequence: 8,
      },
    });

    expect(attached.type).toBe("attached");
    expect(attached.snapshot.outputSequence).toBe(8);
  });

  it("rejects attached payloads without revision, generation, or xterm snapshot", () => {
    const attached = {
      type: "attached",
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
      snapshot: {
        snapshotAnsi: "",
        scrollbackAnsi: "",
        rehydrateSequences: "",
        cols: 120,
        rows: 40,
        outputSequence: 0,
      },
    };

    expect(decodes(TerminalAgentAttachedEvent, attached)).toBe(true);
    expect(decodes(TerminalAgentAttachedEvent, { ...attached, revision: undefined })).toBe(false);
    expect(decodes(TerminalAgentAttachedEvent, { ...attached, generation: undefined })).toBe(false);
    expect(decodes(TerminalAgentAttachedEvent, { ...attached, snapshot: undefined })).toBe(false);
  });

  it("accepts fenced output and rejects unfenced output", () => {
    const output = {
      type: "output",
      threadId: "thread-1",
      revision: 4,
      generation: "generation-1",
      seq: 9,
      data: "next output",
    };

    expect(decodes(TerminalAgentEvent, output)).toBe(true);
    expect(decodes(TerminalAgentEvent, { ...output, revision: undefined })).toBe(false);
    expect(decodes(TerminalAgentEvent, { ...output, generation: undefined })).toBe(false);
  });

  it("accepts state, exited, and error events", () => {
    expect(
      decodes(TerminalAgentEvent, {
        type: "state",
        state: terminalState,
      }),
    ).toBe(true);
    expect(
      decodes(TerminalAgentEvent, {
        type: "exited",
        threadId: "thread-1",
        revision: 5,
        generation: "generation-1",
        exit: { code: 0, signal: null },
      }),
    ).toBe(true);
    expect(
      decodes(TerminalAgentEvent, {
        type: "error",
        threadId: "thread-1",
        revision: 6,
        generation: null,
        message: "The CLI could not start.",
      }),
    ).toBe(true);
  });
});
