import { describe, expect, it } from "vitest";

import { CODEX_TERMINAL_BASELINE_VERSION, inspectCodexTerminalProbe } from "./codexTerminalProbe";
import { inspectClaudeTerminalProbe } from "./claudeTerminalProbe";
import { inspectPiTerminalProbe } from "./piTerminalProbe";

const codexOptions = [
  "--dangerously-bypass-hook-trust",
  "--no-alt-screen",
  "--config <key=value>",
  "--profile <profile>",
  "--enable <feature>",
  "--model <model>",
  "--sandbox <mode>",
  "--ask-for-approval <policy>",
].join("\n");

const validCodex = {
  version: { code: 0, stdout: "codex-cli 0.144.6", stderr: "" },
  help: { code: 0, stdout: `Codex CLI\n${codexOptions}`, stderr: "" },
  resumeHelp: {
    code: 0,
    stdout: `Usage: codex resume [OPTIONS] [SESSION_ID]\n${codexOptions}`,
    stderr: "",
  },
  features: { code: 0, stdout: "hooks  stable  true\n", stderr: "" },
  auth: { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" },
};

const claudeHelp = [
  "--settings <file-or-json>",
  "--session-id <uuid>",
  "--resume <uuid>",
  "--model <model>",
  "--effort <level>",
  "--permission-mode <mode> (manual, plan)",
  "--dangerously-skip-permissions",
].join("\n");

const piHelp = [
  "--session <path>",
  "--session-id <id>",
  "--session-dir <dir>",
  "--extension, -e <path>",
  "--no-extensions, -ne",
  "--model <pattern>",
  "--thinking <level>",
  "--list-models [search]",
].join("\n");

const piModels = [
  "provider       model                   context",
  "anthropic      claude-sonnet-4-5       200K",
  "openai         gpt-5.2-codex           400K",
].join("\n");

describe("managed terminal capability probes", () => {
  it("accepts the verified Codex hook contract", () => {
    expect(inspectCodexTerminalProbe(validCodex)).toMatchObject({
      cliVersion: "0.144.6",
      authMethod: "chatgpt",
      hookSchema: "cli-verified",
    });
  });

  it("rejects old, disabled, and incomplete Codex installations", () => {
    expect(() =>
      inspectCodexTerminalProbe({
        ...validCodex,
        version: { code: 0, stdout: "codex-cli 0.144.5", stderr: "" },
      }),
    ).toThrow(CODEX_TERMINAL_BASELINE_VERSION);
    expect(() =>
      inspectCodexTerminalProbe({
        ...validCodex,
        features: { code: 0, stdout: "hooks stable false", stderr: "" },
      }),
    ).toThrow("hooks");
    expect(() =>
      inspectCodexTerminalProbe({
        ...validCodex,
        resumeHelp: {
          ...validCodex.resumeHelp,
          stdout: validCodex.resumeHelp.stdout.replace("--profile", "--preset"),
        },
      }),
    ).toThrow("--profile");
    expect(() =>
      inspectCodexTerminalProbe({
        ...validCodex,
        help: {
          ...validCodex.help,
          stdout: validCodex.help.stdout.replace("--enable", "--activate"),
        },
      }),
    ).toThrow("--enable");
  });

  it("accepts authenticated Claude with manual permission mode", () => {
    expect(
      inspectClaudeTerminalProbe({
        version: { code: 0, stdout: "2.1.220 (Claude Code)", stderr: "" },
        help: { code: 0, stdout: claudeHelp, stderr: "" },
        auth: {
          code: 0,
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: "oauth_token",
            apiProvider: "firstParty",
          }),
          stderr: "",
        },
      }),
    ).toMatchObject({
      cliVersion: "2.1.220",
      authentication: "authenticated",
      authMethod: "oauth_token",
    });
    expect(() =>
      inspectClaudeTerminalProbe({
        version: { code: 0, stdout: "2.1.220 (Claude Code)", stderr: "" },
        help: {
          code: 0,
          stdout: claudeHelp.replace("manual", "default"),
          stderr: "",
        },
        auth: { code: 0, stdout: '{"loggedIn":true}', stderr: "" },
      }),
    ).toThrow("manual");
    expect(() =>
      inspectClaudeTerminalProbe({
        version: { code: 0, stdout: "2.1.220 (Claude Code)", stderr: "" },
        help: {
          code: 0,
          stdout: claudeHelp.replace("--resume", "--continue"),
          stderr: "",
        },
        auth: { code: 0, stdout: '{"loggedIn":true}', stderr: "" },
      }),
    ).toThrow("--resume");
  });

  it("accepts only an available exact Pi model", () => {
    const valid = {
      version: { code: 0, stdout: "0.80.10", stderr: "" },
      help: { code: 0, stdout: piHelp, stderr: "" },
      models: { code: 0, stdout: piModels, stderr: "" },
      modelSelection: {
        provider: "pi" as const,
        model: "anthropic/claude-sonnet-4-5",
      },
    };
    expect(inspectPiTerminalProbe(valid)).toMatchObject({
      cliVersion: "0.80.10",
      apiProvider: "anthropic",
      authentication: "authenticated",
    });
    expect(() =>
      inspectPiTerminalProbe({
        ...valid,
        models: { code: 0, stdout: "No models matching query", stderr: "" },
      }),
    ).toThrow("cannot authenticate");
    expect(() =>
      inspectPiTerminalProbe({
        ...valid,
        help: {
          code: 0,
          stdout: piHelp.replace("--session <path>", "--continue <path>"),
          stderr: "",
        },
      }),
    ).toThrow("--session");
  });
});
