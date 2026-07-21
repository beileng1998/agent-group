import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { toWsRpcError } from "./wsRpcError";

describe("toWsRpcError", () => {
  it("surfaces the underlying error from Effect.tryPromise", async () => {
    const cause = await Effect.runPromise(
      Effect.flip(
        Effect.tryPromise(() => Promise.reject(new Error("Workspace state is incompatible"))),
      ),
    );

    expect(toWsRpcError(cause, "Failed to load session").message).toBe(
      "Workspace state is incompatible",
    );
  });
});
