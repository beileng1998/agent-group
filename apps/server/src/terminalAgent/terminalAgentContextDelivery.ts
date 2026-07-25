import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { TerminalAgentProvider, TurnId } from "@agent-group/contracts";

import { ensurePrivateDirectory } from "./terminalAgentDriverFiles";

const INLINE_CONTEXT_LIMIT: Record<TerminalAgentProvider, number> = {
  codex: 8_000,
  claudeAgent: 9_000,
  pi: 128_000,
};

export interface DeliveredTerminalAgentContext {
  readonly text: string;
  readonly checksum: string;
  readonly delivery: "inline" | "file-reference";
  readonly filePath: string | null;
}

export async function deliverTerminalAgentContext(input: {
  readonly runtimeDir: string;
  readonly provider: TerminalAgentProvider;
  readonly turnId: TurnId;
  readonly envelope: string;
}): Promise<DeliveredTerminalAgentContext> {
  const checksum = createHash("sha256").update(input.envelope).digest("hex");
  if (input.envelope.length <= INLINE_CONTEXT_LIMIT[input.provider]) {
    return {
      text: input.envelope,
      checksum,
      delivery: "inline",
      filePath: null,
    };
  }

  const contextDir = path.join(input.runtimeDir, "context");
  await ensurePrivateDirectory(contextDir);
  const turnKey = createHash("sha256").update(String(input.turnId)).digest("hex");
  const contextPath = path.join(contextDir, `${turnKey}-${checksum}.md`);
  try {
    await fs.writeFile(contextPath, input.envelope, { flag: "wx", mode: 0o600 });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const stat = await fs.lstat(contextPath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      (await fs.readFile(contextPath, "utf8")) !== input.envelope
    ) {
      throw new Error("Terminal context path contains unexpected content.");
    }
  }
  await fs.chmod(contextPath, 0o600);
  return {
    text: `Read the complete Agent Group context at ${contextPath} before acting.`,
    checksum,
    delivery: "file-reference",
    filePath: contextPath,
  };
}
