import fs from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

function assertContained(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Terminal runtime cleanup target is outside its managed root.");
  }
}

export async function retireTerminalRuntimeDirectory(
  stateDir: string,
  runtimeDir: string,
): Promise<void> {
  const root = path.join(stateDir, "terminal-agent");
  assertContained(root, runtimeDir);
  let stat;
  try {
    stat = await fs.lstat(runtimeDir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Terminal runtime cleanup target is not a managed directory.");
  }
  await fs.rm(runtimeDir, { recursive: true, force: true });
}

export async function retireTerminalContextFile(
  runtimeDir: string,
  contextPath: string | null,
): Promise<void> {
  if (contextPath === null) return;
  assertContained(path.join(runtimeDir, "context"), contextPath);
  let stat;
  try {
    stat = await fs.lstat(contextPath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Terminal context cleanup target is not a managed file.");
  }
  await fs.rm(contextPath);
}

export function makeTerminalRuntimeRetirer(stateDir: string) {
  return (runtime: TerminalAgentRuntimeRecord) =>
    Effect.tryPromise(() =>
      retireTerminalRuntimeDirectory(stateDir, runtime.runtimeDir),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("managed terminal runtime cleanup failed", {
          threadId: runtime.threadId,
          runtimeDir: runtime.runtimeDir,
          cause,
        }),
      ),
    );
}
