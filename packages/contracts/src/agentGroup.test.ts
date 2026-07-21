import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  AgentGroupConfig,
  AgentGroupGetConfigInput,
  AgentGroupUpdateConfigInput,
  AgentGroupWriteContextInput,
} from "./agentGroup";

it.effect("accepts a bounded context write with an optimistic revision", () =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(AgentGroupWriteContextInput)({
      workspaceRoot: "/client-controlled",
      groupId: "client-controlled",
      parentSessionId: "client-controlled",
      sessionId: "session-1",
      context: "raw markdown\n",
      expectedRevision: "a".repeat(64),
    });

    assert.strictEqual(input.context, "raw markdown\n");
    assert.strictEqual(input.expectedRevision, "a".repeat(64));
    assert.ok(!("workspaceRoot" in input));
    assert.ok(!("parentSessionId" in input));
  }),
);

it.effect("selects Group settings without requiring a Session", () =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(AgentGroupGetConfigInput)({
      groupId: "group-1",
      sessionId: "ignored",
    });

    assert.deepStrictEqual(input, { groupId: "group-1" });
  }),
);

it.effect("defaults legacy group configs to context enabled", () =>
  Effect.gen(function* () {
    const legacy = yield* Schema.decodeUnknownEffect(AgentGroupConfig)({
      groupId: "group-1",
      globalRules: "Keep it short.",
      contextTemplate: "# Goal\n",
      revision: 2,
    });
    const disabled = yield* Schema.decodeUnknownEffect(AgentGroupConfig)({
      ...legacy,
      contextEnabled: false,
    });

    assert.strictEqual(legacy.contextEnabled, true);
    assert.strictEqual(legacy.browserToolsEnabled, false);
    assert.strictEqual(legacy.contextTemplateId, null);
    assert.strictEqual(legacy.contextAwarenessDefaultEnabled, false);
    assert.strictEqual(disabled.contextEnabled, false);
  }),
);

it.effect("accepts disabling group context without replacing other settings", () =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(AgentGroupUpdateConfigInput)({
      groupId: "group-1",
      contextEnabled: false,
      browserToolsEnabled: true,
      expectedRevision: 3,
    });

    assert.strictEqual(input.contextEnabled, false);
    assert.strictEqual(input.browserToolsEnabled, true);
    assert.ok(!("globalRules" in input));
    assert.ok(!("contextTemplate" in input));
  }),
);
