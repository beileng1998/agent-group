import type {
  TerminalAgentRuntimeState,
  TerminalAgentSerializedSnapshot,
} from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import {
  acceptManagedTerminalState,
  buildManagedTerminalSnapshotAnsi,
  classifyManagedTerminalOutput,
  isManagedTerminalAuthority,
  managedTerminalEventThreadId,
  managedTerminalStatusLabel,
  splitManagedTerminalInput,
} from "./managedTerminalPresentation";

function runtimeState(revision: number): TerminalAgentRuntimeState {
  return {
    threadId: "thread-managed-terminal",
    authority: "terminal",
    revision,
    provider: "codex",
    status: "running",
    runtimeInstanceId: "runtime-1",
    generation: "generation-1",
    pid: 42,
    providerSessionId: null,
    model: null,
    effort: null,
    permission: null,
    capabilities: null,
    exit: null,
    error: null,
  } as TerminalAgentRuntimeState;
}

describe("managed terminal presentation", () => {
  it("describes the pre-handshake state without implying a failed check", () => {
    expect(
      managedTerminalStatusLabel({
        ...runtimeState(1),
        status: "checking",
      }),
    ).toBe("Waiting for session");
  });

  it("restores normal history, terminal modes, active screen, then a partial escape tail", () => {
    const snapshot = {
      scrollbackAnsi: "history\r\n",
      rehydrateSequences: "\u001b[?1049h\u001b[?2004h",
      snapshotAnsi: "active-screen",
      pendingEscapeTailAnsi: "\u001b[38;5;",
      cols: 100,
      rows: 30,
      outputSequence: 12,
    } as TerminalAgentSerializedSnapshot;

    expect(buildManagedTerminalSnapshotAnsi(snapshot)).toBe(
      "history\r\n\u001b[?1049h\u001b[?2004hactive-screen\u001b[38;5;",
    );
  });

  it("writes only the next fenced output and resyncs forward gaps", () => {
    const base = {
      attachedRevision: 7,
      attachedGeneration: "generation-7",
      outputSequence: 41,
      revision: 7,
      generation: "generation-7",
    };

    expect(classifyManagedTerminalOutput({ ...base, seq: 42 })).toBe("write");
    expect(classifyManagedTerminalOutput({ ...base, seq: 43 })).toBe("resync");
    expect(classifyManagedTerminalOutput({ ...base, seq: 41 })).toBe("ignore");
    expect(classifyManagedTerminalOutput({ ...base, seq: 40 })).toBe("ignore");
    expect(
      classifyManagedTerminalOutput({ ...base, revision: 8, seq: 42 }),
    ).toBe("ignore");
    expect(
      classifyManagedTerminalOutput({
        ...base,
        generation: "generation-restarted",
        seq: 42,
      }),
    ).toBe("ignore");
  });

  it("keeps terminal authority explicit and ignores stale state refreshes", () => {
    const current = runtimeState(9);
    const stale = { ...runtimeState(8), authority: "structured" as const };

    expect(isManagedTerminalAuthority(current)).toBe(true);
    expect(acceptManagedTerminalState(current, stale)).toBe(current);
    expect(
      isManagedTerminalAuthority({
        ...current,
        authority: "structured",
      }),
    ).toBe(false);
  });

  it("reads the thread identity from both state and streamed terminal events", () => {
    expect(
      managedTerminalEventThreadId({
        type: "state",
        state: runtimeState(10),
      }),
    ).toBe("thread-managed-terminal");
    expect(
      managedTerminalEventThreadId({
        type: "output",
        threadId: "thread-managed-terminal",
        revision: 10,
        generation: "generation-1",
        seq: 43,
        data: "ready",
      }),
    ).toBe("thread-managed-terminal");
  });

  it("chunks large paste input without splitting a surrogate pair", () => {
    const prefix = "a".repeat(65_535);
    const chunks = splitManagedTerminalInput(`${prefix}🙂tail`);

    expect(chunks).toHaveLength(2);
    expect(chunks.join("")).toBe(`${prefix}🙂tail`);
    expect(chunks[0]?.endsWith("\ud83d")).toBe(false);
    expect(chunks.every((chunk) => chunk.length <= 65_536)).toBe(true);
  });
});
