import {
  Effect,
  FileSystem,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { GitCommandError } from "../../Errors.ts";
import type {
  ExecuteGitInput,
  ExecuteGitProgress,
  ExecuteGitResult,
  GitCoreShape,
} from "../../Services/GitCore.ts";
import type { ExecuteGitOptions } from "./gitCoreTypes.ts";
import {
  commandLabel,
  createGitCommandError,
  quoteGitCommand,
  toGitCommandError,
} from "./gitCoreValues.ts";
import { decodeJsonResult } from "@agent-group/shared/schemaJson";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

type TraceTailState = { processedChars: number; remainder: string };
interface Trace2Monitor {
  readonly env: NodeJS.ProcessEnv;
  readonly flush: Effect.Effect<void, never>;
}

function trace2ChildKey(record: Record<string, unknown>): string | null {
  const childId = record.child_id;
  if (typeof childId === "number" || typeof childId === "string") return String(childId);
  const hookName = record.hook_name;
  return typeof hookName === "string" && hookName.trim().length > 0 ? hookName.trim() : null;
}

const Trace2Record = Schema.Record(Schema.String, Schema.Unknown);

const createTrace2Monitor = Effect.fn(function* (
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  progress: ExecuteGitProgress | undefined,
) {
  if (!progress?.onHookStarted && !progress?.onHookFinished) {
    return { env: {}, flush: Effect.void } satisfies Trace2Monitor;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const traceFilePath = yield* fs.makeTempFileScoped({
    prefix: `agent-group-git-trace2-${process.pid}-`,
    suffix: ".json",
  });
  const hookStartByChildKey = new Map<string, { hookName: string; startedAtMs: number }>();
  const traceTailState = yield* Ref.make<TraceTailState>({ processedChars: 0, remainder: "" });
  const handleTraceLine = (line: string) =>
    Effect.gen(function* () {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) return;
      const traceRecord = decodeJsonResult(Trace2Record)(trimmedLine);
      if (Result.isFailure(traceRecord)) {
        yield* Effect.logDebug(
          `GitCore.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}`,
          traceRecord.failure,
        );
        return;
      }
      if (traceRecord.success.child_class !== "hook") return;
      const event = traceRecord.success.event;
      const childKey = trace2ChildKey(traceRecord.success);
      if (childKey === null) return;
      const started = hookStartByChildKey.get(childKey);
      const hookNameFromEvent =
        typeof traceRecord.success.hook_name === "string"
          ? traceRecord.success.hook_name.trim()
          : "";
      const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : (started?.hookName ?? "");
      if (hookName.length === 0) return;
      if (event === "child_start") {
        hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() });
        if (progress.onHookStarted) yield* progress.onHookStarted(hookName);
        return;
      }
      if (event === "child_exit") {
        hookStartByChildKey.delete(childKey);
        if (progress.onHookFinished) {
          const code = traceRecord.success.code;
          yield* progress.onHookFinished({
            hookName: started?.hookName ?? hookName,
            exitCode: typeof code === "number" && Number.isInteger(code) ? code : null,
            durationMs: started ? Math.max(0, Date.now() - started.startedAtMs) : null,
          });
        }
      }
    });
  const deltaMutex = yield* Semaphore.make(1);
  const readTraceDelta = deltaMutex.withPermit(
    fs.readFileString(traceFilePath).pipe(
      Effect.flatMap((contents) =>
        Effect.uninterruptible(
          Ref.modify(traceTailState, ({ processedChars, remainder }) => {
            if (contents.length <= processedChars) return [[], { processedChars, remainder }];
            const appended = contents.slice(processedChars);
            const combined = remainder + appended;
            const lines = combined.split("\n");
            const nextRemainder = lines.pop() ?? "";
            return [
              lines.map((line) => line.replace(/\r$/, "")),
              { processedChars: contents.length, remainder: nextRemainder },
            ];
          }).pipe(
            Effect.flatMap((lines) => Effect.forEach(lines, handleTraceLine, { discard: true })),
          ),
        ),
      ),
      Effect.ignore({ log: true }),
    ),
  );
  const traceFileName = path.basename(traceFilePath);
  yield* Stream.runForEach(fs.watch(traceFilePath), (event) => {
    const eventPath = event.path;
    const isTargetTraceEvent =
      eventPath === traceFilePath ||
      eventPath === traceFileName ||
      path.basename(eventPath) === traceFileName;
    return isTargetTraceEvent ? readTraceDelta : Effect.void;
  }).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* readTraceDelta;
      const finalLine = yield* Ref.modify(traceTailState, ({ processedChars, remainder }) => [
        remainder.trim(),
        { processedChars, remainder: "" },
      ]);
      if (finalLine.length > 0) yield* handleTraceLine(finalLine);
    }),
  );
  return {
    env: { GIT_TRACE2_EVENT: traceFilePath },
    flush: readTraceDelta,
  } satisfies Trace2Monitor;
});

const collectOutput = Effect.fn(function* <E>(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
  onLine: ((line: string) => Effect.Effect<void, never>) | undefined,
): Effect.fn.Return<string, GitCommandError> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  let lineBuffer = "";
  const emitCompleteLines = (flush: boolean) =>
    Effect.gen(function* () {
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line.length > 0 && onLine) yield* onLine(line);
        newlineIndex = lineBuffer.indexOf("\n");
      }
      if (flush) {
        const trailing = lineBuffer.replace(/\r$/, "");
        lineBuffer = "";
        if (trailing.length > 0 && onLine) yield* onLine(trailing);
      }
    });
  yield* Stream.runForEach(stream, (chunk) =>
    Effect.gen(function* () {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        return yield* new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${quoteGitCommand(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
        });
      }
      const decoded = decoder.decode(chunk, { stream: true });
      text += decoded;
      lineBuffer += decoded;
      yield* emitCompleteLines(false);
    }),
  ).pipe(Effect.mapError(toGitCommandError(input, "output stream failed.")));
  const remainder = decoder.decode();
  text += remainder;
  lineBuffer += remainder;
  yield* emitCompleteLines(true);
  return text;
});

export const makeGitExecution = Effect.fn(function* (
  options: { executeOverride?: GitCoreShape["execute"] } | undefined,
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
) {
  let execute: GitCoreShape["execute"];
  if (options?.executeOverride) {
    execute = options.executeOverride;
  } else {
    const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    execute = Effect.fnUntraced(function* (input) {
      const commandInput = { ...input, args: [...input.args] } as const;
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      const commandEffect = Effect.gen(function* () {
        const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(
          Effect.provideService(Path.Path, path),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.mapError(toGitCommandError(commandInput, "failed to create trace2 monitor.")),
        );
        const child = yield* commandSpawner
          .spawn(
            ChildProcess.make("git", commandInput.args, {
              cwd: commandInput.cwd,
              env: { ...process.env, ...input.env, ...trace2Monitor.env },
            }),
          )
          .pipe(Effect.mapError(toGitCommandError(commandInput, "failed to spawn.")));
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectOutput(commandInput, child.stdout, maxOutputBytes, input.progress?.onStdoutLine),
            collectOutput(commandInput, child.stderr, maxOutputBytes, input.progress?.onStderrLine),
            child.exitCode.pipe(
              Effect.map(Number),
              Effect.mapError(toGitCommandError(commandInput, "failed to report exit code.")),
            ),
          ],
          { concurrency: "unbounded" },
        );
        yield* trace2Monitor.flush;
        if (!input.allowNonZeroExit && exitCode !== 0) {
          const trimmedStderr = stderr.trim();
          return yield* new GitCommandError({
            operation: commandInput.operation,
            command: quoteGitCommand(commandInput.args),
            cwd: commandInput.cwd,
            detail:
              trimmedStderr.length > 0
                ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
                : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`,
          });
        }
        return { code: exitCode, stdout, stderr } satisfies ExecuteGitResult;
      });
      return yield* commandEffect.pipe(
        Effect.scoped,
        Effect.timeoutOption(timeoutMs),
        Effect.flatMap((result) =>
          Option.match(result, {
            onNone: () =>
              Effect.fail(
                new GitCommandError({
                  operation: commandInput.operation,
                  command: quoteGitCommand(commandInput.args),
                  cwd: commandInput.cwd,
                  detail: `${quoteGitCommand(commandInput.args)} timed out.`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
    });
  }
  const executeGit = (
    operation: string,
    cwd: string,
    args: readonly string[],
    commandOptions: ExecuteGitOptions = {},
  ) =>
    execute({
      operation,
      cwd,
      args,
      allowNonZeroExit: true,
      ...(commandOptions.timeoutMs !== undefined ? { timeoutMs: commandOptions.timeoutMs } : {}),
      ...(commandOptions.env ? { env: commandOptions.env } : {}),
      ...(commandOptions.progress ? { progress: commandOptions.progress } : {}),
    }).pipe(
      Effect.flatMap((result) => {
        if (commandOptions.allowNonZeroExit || result.code === 0) return Effect.succeed(result);
        const stderr = result.stderr.trim();
        if (stderr.length > 0)
          return Effect.fail(createGitCommandError(operation, cwd, args, stderr));
        if (commandOptions.fallbackErrorMessage) {
          return Effect.fail(
            createGitCommandError(operation, cwd, args, commandOptions.fallbackErrorMessage),
          );
        }
        return Effect.fail(
          createGitCommandError(
            operation,
            cwd,
            args,
            `${commandLabel(args)} failed: code=${result.code ?? "null"}`,
          ),
        );
      }),
    );
  const runGit = (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit = false,
  ) => executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.asVoid);
  const runGitStdout = (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit = false,
  ) =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(
      Effect.map((result) => result.stdout),
    );
  return { execute, executeGit, runGit, runGitStdout };
});
