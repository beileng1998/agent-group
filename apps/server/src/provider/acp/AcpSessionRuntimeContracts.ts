import type { Cause, Deferred, Effect, Stream } from "effect";
import type * as EffectAcpClient from "effect-acp/client";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpProtocol from "effect-acp/protocol";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { AcpParsedSessionEvent, AcpSessionModeState } from "./AcpRuntimeModel.ts";

export interface AcpSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AcpSessionRuntimeOptions {
  readonly spawn: AcpSpawnInput;
  readonly cwd: string;
  readonly resumeSessionId?: string;
  readonly clientCapabilities?: EffectAcpSchema.InitializeRequest["clientCapabilities"];
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly authMethodId?: string;
  readonly resolveAuthMethodId?: (
    initializeResult: EffectAcpSchema.InitializeResponse,
  ) => Effect.Effect<string, EffectAcpErrors.AcpError>;
  readonly authenticateMeta?: Record<string, unknown>;
  readonly requestLogger?: (event: AcpSessionRequestLogEvent) => Effect.Effect<void, never>;
  readonly protocolLogging?: {
    readonly logIncoming?: boolean;
    readonly logOutgoing?: boolean;
    readonly logger?: (event: EffectAcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
  };
}

export interface AcpSessionRequestLogEvent {
  readonly method: string;
  readonly payload: unknown;
  readonly status: "started" | "succeeded" | "failed";
  readonly result?: unknown;
  readonly cause?: Cause.Cause<EffectAcpErrors.AcpError>;
}

export interface AcpSessionRuntimeStartResult {
  readonly sessionId: string;
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse;
  readonly modelConfigId: string | undefined;
  /** `session/resume` does not replay transcript updates; `session/load` may. */
  readonly sessionSetupMethod: "new" | "load" | "resume";
}

export interface AcpSessionRuntimeShape {
  readonly handleRequestPermission: EffectAcpClient.AcpClientShape["handleRequestPermission"];
  readonly handleElicitation: EffectAcpClient.AcpClientShape["handleElicitation"];
  readonly handleReadTextFile: EffectAcpClient.AcpClientShape["handleReadTextFile"];
  readonly handleWriteTextFile: EffectAcpClient.AcpClientShape["handleWriteTextFile"];
  readonly handleCreateTerminal: EffectAcpClient.AcpClientShape["handleCreateTerminal"];
  readonly handleTerminalOutput: EffectAcpClient.AcpClientShape["handleTerminalOutput"];
  readonly handleTerminalWaitForExit: EffectAcpClient.AcpClientShape["handleTerminalWaitForExit"];
  readonly handleTerminalKill: EffectAcpClient.AcpClientShape["handleTerminalKill"];
  readonly handleTerminalRelease: EffectAcpClient.AcpClientShape["handleTerminalRelease"];
  readonly handleSessionUpdate: EffectAcpClient.AcpClientShape["handleSessionUpdate"];
  readonly handleElicitationComplete: EffectAcpClient.AcpClientShape["handleElicitationComplete"];
  readonly handleUnknownExtRequest: EffectAcpClient.AcpClientShape["handleUnknownExtRequest"];
  readonly handleUnknownExtNotification: EffectAcpClient.AcpClientShape["handleUnknownExtNotification"];
  readonly handleExtRequest: EffectAcpClient.AcpClientShape["handleExtRequest"];
  readonly handleExtNotification: EffectAcpClient.AcpClientShape["handleExtNotification"];
  readonly start: () => Effect.Effect<AcpSessionRuntimeStartResult, EffectAcpErrors.AcpError>;
  readonly getEvents: () => Stream.Stream<AcpParsedSessionEvent, never>;
  readonly sessionUpdatesEnqueuedCount: Effect.Effect<number>;
  readonly supportsSessionFork: Effect.Effect<boolean, EffectAcpErrors.AcpError>;
  readonly getModeState: Effect.Effect<AcpSessionModeState | undefined>;
  readonly getConfigOptions: Effect.Effect<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>;
  readonly getAvailableCommands: Effect.Effect<ReadonlyArray<EffectAcpSchema.AvailableCommand>>;
  readonly prompt: (
    payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">,
  ) => Effect.Effect<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError>;
  readonly cancel: Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly setMode: (
    modeId: string,
  ) => Effect.Effect<EffectAcpSchema.SetSessionModeResponse, EffectAcpErrors.AcpError>;
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<EffectAcpSchema.SetSessionConfigOptionResponse, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly forkSession: (
    payload: Omit<EffectAcpSchema.ForkSessionRequest, "sessionId">,
  ) => Effect.Effect<EffectAcpSchema.ForkSessionResponse, EffectAcpErrors.AcpError>;
  readonly request: (
    method: string,
    payload: unknown,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly notify: (
    method: string,
    payload: unknown,
  ) => Effect.Effect<void, EffectAcpErrors.AcpError>;
}

export interface AcpStartedState extends AcpSessionRuntimeStartResult {}

export type AcpStartState =
  | { readonly _tag: "NotStarted" }
  | {
      readonly _tag: "Starting";
      readonly deferred: Deferred.Deferred<AcpSessionRuntimeStartResult, EffectAcpErrors.AcpError>;
    }
  | { readonly _tag: "Started"; readonly result: AcpStartedState };
