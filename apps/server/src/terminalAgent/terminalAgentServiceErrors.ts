import type { ServerSettings } from "@agent-group/contracts";
import { Effect } from "effect";

import {
  TerminalAgentServiceError,
} from "./Services/TerminalAgentService";

export const terminalAgentServiceError = (
  reason: TerminalAgentServiceError["reason"],
  message: string,
  cause?: unknown,
) =>
  new TerminalAgentServiceError({
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

export const terminalAgentCauseMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const managedTerminalPlatformSupported = (
  platform: NodeJS.Platform = process.platform,
): boolean => platform !== "win32";

export const requireManagedTerminalEnabled = (
  settings: ServerSettings,
  platform: NodeJS.Platform = process.platform,
) =>
  !settings.enableManagedAgentTerminal
    ? Effect.fail(
        terminalAgentServiceError(
          "disabled",
          "Managed Agent Terminal is disabled in server settings.",
        ),
      )
    : !managedTerminalPlatformSupported(platform)
      ? Effect.fail(
          terminalAgentServiceError(
            "unsupported-provider",
            "Managed Agent Terminal is unavailable on Windows until process-tree ownership can be verified.",
          ),
        )
      : Effect.void;
