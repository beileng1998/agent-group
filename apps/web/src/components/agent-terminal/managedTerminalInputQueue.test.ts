import { describe, expect, it, vi } from "vitest";

import { ManagedTerminalInputQueue } from "./managedTerminalInputQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const firstFence = { revision: 1, generation: "generation-1" };
const secondFence = { revision: 2, generation: "generation-2" };

describe("ManagedTerminalInputQueue", () => {
  it("drops an old epoch backlog and fences again immediately before send", async () => {
    const firstSend = deferred();
    const sends: string[] = [];
    const queue = new ManagedTerminalInputQueue(async (fence, data) => {
      sends.push(`${fence.generation}:${data}`);
      if (data === "active") await firstSend.promise;
    }, vi.fn());

    queue.setFence(firstFence);
    queue.enqueue("active");
    queue.enqueue("stale-backlog");
    await Promise.resolve();
    expect(sends).toEqual(["generation-1:active"]);

    queue.setFence(secondFence);
    queue.enqueue("fresh");
    firstSend.resolve();
    await firstSend.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sends).toEqual(["generation-1:active", "generation-2:fresh"]);
  });

  it("drops a queued send when its fence changes before the send microtask", async () => {
    const send = vi.fn(async () => {});
    const queue = new ManagedTerminalInputQueue(send, vi.fn());

    queue.setFence(firstFence);
    queue.enqueue("stale");
    queue.setFence(secondFence);
    queue.enqueue("fresh");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(secondFence, "fresh");
  });

  it("bounds queued input by UTF-8 bytes", () => {
    const onOverflow = vi.fn();
    const queue = new ManagedTerminalInputQueue(
      async () => new Promise<void>(() => {}),
      onOverflow,
      4,
    );

    queue.setFence(firstFence);
    expect(queue.enqueue("🙂")).toBe(true);
    expect(queue.enqueue("x")).toBe(false);
    expect(onOverflow).toHaveBeenCalledOnce();
  });

  it("fails the current epoch closed and settles queued work after a send rejection", async () => {
    const failedSend = deferred();
    const sends: string[] = [];
    const onOverflow = vi.fn();
    const queue = new ManagedTerminalInputQueue(async (_fence, data) => {
      sends.push(data);
      if (data === "fails") await failedSend.promise;
    }, onOverflow);

    queue.setFence(firstFence);
    queue.enqueue("fails");
    queue.enqueue("must-drop");
    await Promise.resolve();
    failedSend.reject(new Error("transport lost"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sends).toEqual(["fails"]);
    expect(onOverflow).toHaveBeenCalledOnce();
    expect(queue.enqueue("paused")).toBe(false);

    queue.setFence(secondFence);
    expect(queue.enqueue("fresh")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sends).toEqual(["fails", "fresh"]);
  });

  it("ignores a late rejection from an old epoch and preserves new input order", async () => {
    const oldSend = deferred();
    const sends: string[] = [];
    const onOverflow = vi.fn();
    const queue = new ManagedTerminalInputQueue(async (fence, data) => {
      sends.push(`${fence.generation}:${data}`);
      if (data === "old") await oldSend.promise;
    }, onOverflow);

    queue.setFence(firstFence);
    queue.enqueue("old");
    await Promise.resolve();
    queue.setFence(secondFence);
    queue.enqueue("one");
    queue.enqueue("two");
    oldSend.reject(new Error("stale transport"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onOverflow).not.toHaveBeenCalled();
    expect(sends).toEqual([
      "generation-1:old",
      "generation-2:one",
      "generation-2:two",
    ]);
  });
});
