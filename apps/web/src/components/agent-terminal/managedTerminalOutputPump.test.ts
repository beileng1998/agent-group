import { describe, expect, it, vi } from "vitest";

import {
  ManagedTerminalOutputPump,
  type ManagedTerminalWriteTarget,
} from "./managedTerminalOutputPump";

function makeTarget() {
  const writes: Array<{ data: string; complete: () => void }> = [];
  const target: ManagedTerminalWriteTarget = {
    write: (data, complete = () => {}) => {
      writes.push({ data, complete });
    },
  };
  return { target, writes };
}

describe("ManagedTerminalOutputPump", () => {
  it("waits for xterm parsing before advancing to the next write", () => {
    const { target, writes } = makeTarget();
    const parsed: number[] = [];
    const pump = new ManagedTerminalOutputPump(target, vi.fn());

    expect(pump.enqueue("one", () => parsed.push(1))).toBe(true);
    expect(pump.enqueue("two", () => parsed.push(2))).toBe(true);
    expect(writes.map(({ data }) => data)).toEqual(["one"]);
    expect(parsed).toEqual([]);

    writes[0]!.complete();
    expect(parsed).toEqual([1]);
    expect(writes.map(({ data }) => data)).toEqual(["one", "two"]);
    writes[1]!.complete();
    expect(parsed).toEqual([1, 2]);
  });

  it("drops queued writes from an old snapshot epoch", () => {
    const { target, writes } = makeTarget();
    const parsed: string[] = [];
    const pump = new ManagedTerminalOutputPump(target, vi.fn());

    pump.enqueue("old-active", () => parsed.push("old-active"));
    pump.enqueue("old-queued", () => parsed.push("old-queued"));
    expect(pump.reset("fresh-snapshot", () => parsed.push("snapshot"))).toBe(true);

    writes[0]!.complete();
    expect(parsed).toEqual([]);
    expect(writes.map(({ data }) => data)).toEqual([
      "old-active",
      "fresh-snapshot",
    ]);
    writes[1]!.complete();
    expect(parsed).toEqual(["snapshot"]);
  });

  it("bounds pending output and requests a fresh snapshot after overflow", () => {
    const { target, writes } = makeTarget();
    const onOverflow = vi.fn();
    const pump = new ManagedTerminalOutputPump(target, onOverflow, 5);

    expect(pump.enqueue("1234", vi.fn())).toBe(true);
    expect(pump.enqueue("56", vi.fn())).toBe(false);
    expect(onOverflow).toHaveBeenCalledOnce();
    expect(pump.enqueue("x", vi.fn())).toBe(false);

    writes[0]!.complete();
    expect(pump.reset("new", vi.fn())).toBe(true);
    expect(writes.map(({ data }) => data)).toEqual(["1234", "new"]);
  });

  it("uses UTF-8 bytes rather than UTF-16 code units for its hard bound", () => {
    const { target } = makeTarget();
    const onOverflow = vi.fn();
    const pump = new ManagedTerminalOutputPump(target, onOverflow, 4);

    expect(pump.enqueue("🙂", vi.fn())).toBe(true);
    expect(pump.enqueue("x", vi.fn())).toBe(false);
    expect(onOverflow).toHaveBeenCalledOnce();
  });

  it("treats a synchronous xterm write failure as resync-required", () => {
    const onOverflow = vi.fn();
    const pump = new ManagedTerminalOutputPump(
      {
        write: () => {
          throw new Error("write buffer full");
        },
      },
      onOverflow,
    );

    expect(pump.enqueue("output", vi.fn())).toBe(false);
    expect(onOverflow).toHaveBeenCalledOnce();
  });

  it("does not flush queued output after a synchronous write failure", () => {
    const writes: string[] = [];
    let completeFirst = () => {};
    const onOverflow = vi.fn();
    const pump = new ManagedTerminalOutputPump(
      {
        write: (data, complete = () => {}) => {
          writes.push(data);
          if (data === "first") {
            completeFirst = complete;
            return;
          }
          throw new Error("xterm rejected the write");
        },
      },
      onOverflow,
    );

    pump.enqueue("first", vi.fn());
    pump.enqueue("failing", vi.fn());
    pump.enqueue("must-not-write", vi.fn());
    completeFirst();

    expect(writes).toEqual(["first", "failing"]);
    expect(onOverflow).toHaveBeenCalledOnce();
  });
});
