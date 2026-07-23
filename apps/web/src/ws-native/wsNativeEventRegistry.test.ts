// FILE: wsNativeEventRegistry.test.ts
// Purpose: Verifies stale HTTP snapshots cannot overwrite newer orchestration events.
// Layer: Web transport tests

import type {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "@agent-group/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  onOrchestrationShellEvent,
  onOrchestrationThreadEvent,
  publishOrchestrationShellEvent,
  publishOrchestrationThreadEvent,
  resetWsEventRegistry,
} from "./wsNativeEventRegistry";

afterEach(() => resetWsEventRegistry(true));

describe("orchestration event registry", () => {
  it("drops a shell snapshot older than an already delivered event", () => {
    const listener = vi.fn();
    onOrchestrationShellEvent(listener);
    publishOrchestrationShellEvent({
      kind: "thread-removed",
      sequence: 10,
      threadId: "thread-1",
    } as OrchestrationShellStreamItem);
    publishOrchestrationShellEvent({
      kind: "snapshot",
      snapshot: { snapshotSequence: 9 },
    } as OrchestrationShellStreamItem);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ sequence: 10 });
  });

  it("drops a thread snapshot older than an already delivered thread event", () => {
    const listener = vi.fn();
    onOrchestrationThreadEvent(listener);
    publishOrchestrationThreadEvent({
      kind: "event",
      event: {
        sequence: 10,
        aggregateId: "thread-1",
      },
    } as OrchestrationThreadStreamItem);
    publishOrchestrationThreadEvent({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 9,
        thread: { id: "thread-1" },
      },
    } as OrchestrationThreadStreamItem);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ event: { sequence: 10 } });
  });

  it("replays retained events that arrived before a listener mounted", () => {
    publishOrchestrationShellEvent({
      kind: "snapshot",
      snapshot: { snapshotSequence: 9 },
    } as OrchestrationShellStreamItem);
    publishOrchestrationShellEvent({
      kind: "thread-removed",
      sequence: 10,
      threadId: "thread-1",
    } as OrchestrationShellStreamItem);
    const listener = vi.fn();

    onOrchestrationShellEvent(listener);

    expect(listener.mock.calls.map(([item]) => item)).toEqual([
      expect.objectContaining({ kind: "snapshot" }),
      expect.objectContaining({ kind: "thread-removed", sequence: 10 }),
    ]);
  });
});
