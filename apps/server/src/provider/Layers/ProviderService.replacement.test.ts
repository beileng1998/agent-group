import { ThreadId, type ProviderSessionStartInput } from "@agent-group/contracts";
import { assert } from "@effect/vitest";
import { Effect, Option } from "effect";

import { ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { makeProviderServiceLayer } from "./ProviderService.testSupport.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const replacement = makeProviderServiceLayer();

replacement.layer("ProviderService provider replacement", (it) => {
  it.effect("stops the previous provider before starting its replacement", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-provider-replacement-order");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });

      const order: string[] = [];
      const defaultStop = replacement.codex.stopSession.getMockImplementation();
      const defaultStart = replacement.claude.startSession.getMockImplementation();
      if (!defaultStop || !defaultStart) {
        assert.fail("Expected default provider lifecycle implementations");
      }
      replacement.codex.stopSession.mockImplementationOnce((input: ThreadId) =>
        Effect.sync(() => order.push("stop:codex")).pipe(Effect.andThen(defaultStop(input))),
      );
      replacement.claude.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        Effect.sync(() => order.push("start:claude")).pipe(Effect.andThen(defaultStart(input))),
      );

      const session = yield* provider.startSession(threadId, {
        provider: "claudeAgent",
        threadId,
        runtimeMode: "full-access",
      });

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.deepEqual(order, ["stop:codex", "start:claude"]);
      assert.equal(session.provider, "claudeAgent");
      assert.equal(binding?.provider, "claudeAgent");
      assert.equal(yield* replacement.codex.hasSession(threadId), false);
      assert.equal(yield* replacement.claude.hasSession(threadId), true);
    }),
  );

  it.effect("restores the previous provider when replacement start fails", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-provider-replacement-start-failure");
      const providerOptions = {
        codex: {
          homePath: "/tmp/replacement-codex-home",
          binaryPath: "/usr/local/bin/codex",
        },
      };
      const modelSelection = { provider: "codex" as const, model: "gpt-5" };
      const initial = yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/replacement-workspace",
        modelSelection,
        providerOptions,
        runtimeMode: "full-access",
      });
      replacement.codex.startSession.mockClear();
      replacement.codex.stopSession.mockClear();
      replacement.claude.stopSession.mockClear();
      replacement.claude.startSession.mockImplementationOnce(() =>
        Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: "claudeAgent", threadId })),
      );

      const result = yield* provider
        .startSession(threadId, {
          provider: "claudeAgent",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const restoredInput = replacement.codex.startSession.mock.calls[0]?.[0];
      assert.equal(result._tag, "Failure");
      assert.equal(replacement.codex.stopSession.mock.calls.length, 1);
      assert.equal(replacement.codex.startSession.mock.calls.length, 1);
      assert.equal(replacement.claude.stopSession.mock.calls.length, 1);
      assert.equal(restoredInput?.cwd, "/tmp/replacement-workspace");
      assert.deepEqual(restoredInput?.modelSelection, modelSelection);
      assert.deepEqual(restoredInput?.providerOptions, providerOptions);
      assert.deepEqual(restoredInput?.resumeCursor, initial.resumeCursor);
      assert.equal(binding?.provider, "codex");
      assert.equal(yield* replacement.codex.hasSession(threadId), true);
      assert.equal(yield* replacement.claude.hasSession(threadId), false);
    }),
  );

  it.effect("cleans a started replacement before restoring on validation failure", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-provider-replacement-validation-failure");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      const defaultClaudeStart = replacement.claude.startSession.getMockImplementation();
      if (!defaultClaudeStart) {
        assert.fail("Expected a default Claude startSession implementation");
      }
      replacement.claude.stopSession.mockClear();
      replacement.claude.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        defaultClaudeStart(input).pipe(
          Effect.map((session) => ({ ...session, provider: "codex" as const })),
        ),
      );

      const result = yield* provider
        .startSession(threadId, {
          provider: "claudeAgent",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(result._tag, "Failure");
      assert.equal(replacement.claude.stopSession.mock.calls.length, 1);
      assert.equal(binding?.provider, "codex");
      assert.equal(yield* replacement.codex.hasSession(threadId), true);
      assert.equal(yield* replacement.claude.hasSession(threadId), false);
    }),
  );
});
