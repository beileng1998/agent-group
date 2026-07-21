import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { isWindowsShellCommandMissingResult } from "../../../shell-command-detection";
import {
  buildCursorAgentCommand,
  buildCursorAgentHeadlessEnv,
  DEFAULT_CURSOR_AGENT_BINARY,
} from "../../acp/CursorAcpCommand";
import { buildClaudeProcessEnv } from "../../claudeProcessEnv";
import type { CommandResult } from "../../providerCliOutput";

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

export const runProviderCommand = (
  executable: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const prepared = prepareWindowsSafeProcess(executable, args, { env });
    const command = ChildProcess.make(prepared.command, prepared.args, {
      shell: prepared.shell,
      ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      env,
      stdin: "ignore",
    });
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

const rejectMissingWindowsCommand = (executable: string) =>
  Effect.flatMap((result: CommandResult) =>
    isWindowsShellCommandMissingResult({ code: result.code, stderr: result.stderr })
      ? Effect.fail(new Error(`spawn ${executable} ENOENT`))
      : Effect.succeed(result),
  );

export const runCodexCommand = (
  args: ReadonlyArray<string>,
  executable = "codex",
  env: NodeJS.ProcessEnv = process.env,
) => runProviderCommand(executable, args, env).pipe(rejectMissingWindowsCommand(executable));

export const runClaudeCommand = (
  args: ReadonlyArray<string>,
  executable = "claude",
  env: NodeJS.ProcessEnv = buildClaudeProcessEnv(),
) => runProviderCommand(executable, args, env).pipe(rejectMissingWindowsCommand(executable));

export const runGrokCommand = (args: ReadonlyArray<string>, executable = "grok") =>
  runProviderCommand(executable, args).pipe(rejectMissingWindowsCommand(executable));

export const runOpenCodeCommand = (args: ReadonlyArray<string>, executable = "opencode") =>
  runProviderCommand(executable, args).pipe(rejectMissingWindowsCommand(executable));

export const runKiloCommand = (args: ReadonlyArray<string>, executable = "kilo") =>
  runProviderCommand(executable, args).pipe(rejectMissingWindowsCommand(executable));

export const runCursorCommand = (
  args: ReadonlyArray<string>,
  executable = DEFAULT_CURSOR_AGENT_BINARY,
) => {
  const command = buildCursorAgentCommand(executable, args);
  return runProviderCommand(command.command, command.args, buildCursorAgentHeadlessEnv()).pipe(
    rejectMissingWindowsCommand(command.command),
  );
};

export const runPiCommand = (args: ReadonlyArray<string>, executable = "pi") =>
  runProviderCommand(executable, args).pipe(rejectMissingWindowsCommand(executable));

export const runAntigravityCommand = (args: ReadonlyArray<string>, executable = "agy") =>
  runProviderCommand(executable, args).pipe(rejectMissingWindowsCommand(executable));

export const runDroidCommand = (args: ReadonlyArray<string>, executable = "droid") =>
  runProviderCommand(executable, args);
