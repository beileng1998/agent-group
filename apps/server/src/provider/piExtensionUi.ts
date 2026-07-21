import crypto from "node:crypto";
import path from "node:path";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  ApprovalRequestId,
  RuntimeRequestId,
  type EventId,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type ThreadId,
  type TurnId,
  type UserInputQuestion,
} from "@agent-group/contracts";

import type {
  PiCodingAgentModule,
  PiSessionContext,
  PiUserInputOptionMapping,
} from "./piAdapterCore.ts";
import { PROVIDER, trimToUndefined } from "./piAdapterCore.ts";

export function makeAgentDir(
  agentDir: string | undefined,
  piSdk: Pick<PiCodingAgentModule, "getAgentDir">,
): string {
  return trimToUndefined(agentDir) ?? piSdk.getAgentDir();
}

export function extensionDisplayName(extension: {
  readonly path: string;
  readonly sourceInfo?: { readonly source?: string };
}): string {
  const source = trimToUndefined(extension.sourceInfo?.source);
  if (source) return source;
  const extensionPath = trimToUndefined(extension.path);
  return extensionPath ? path.basename(extensionPath).replace(/\.(?:ts|js)$/u, "") : "extension";
}

export function makePiUserInputOption(label: string): UserInputQuestion["options"][number] {
  const normalizedLabel = trimToUndefined(label) ?? "Option";
  return { label: normalizedLabel, description: normalizedLabel };
}

export function makePiUserInputOptions(
  labels: ReadonlyArray<string>,
): ReadonlyArray<PiUserInputOptionMapping> {
  const labelCounts = new Map<string, number>();
  return labels.map((label, index) => {
    const baseLabel = trimToUndefined(label) ?? `Option ${index + 1}`;
    const count = (labelCounts.get(baseLabel) ?? 0) + 1;
    labelCounts.set(baseLabel, count);
    const displayLabel = count === 1 ? baseLabel : `${baseLabel} (${count})`;
    return {
      value: label,
      option: { label: displayLabel, description: baseLabel },
    };
  });
}

export function firstPiUserInputAnswer(
  answers: ProviderUserInputAnswers,
  questionId: string,
): string | undefined {
  const answer = answers[questionId];
  if (typeof answer === "string") {
    return trimToUndefined(answer);
  }
  if (Array.isArray(answer)) {
    return trimToUndefined(answer.find((entry) => typeof entry === "string"));
  }
  return undefined;
}

export const PLAIN_PI_EXTENSION_THEME = {
  fg(_color: string, text: string) {
    return text;
  },
  bg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
  italic(text: string) {
    return text;
  },
  underline(text: string) {
    return text;
  },
  inverse(text: string) {
    return text;
  },
  strikethrough(text: string) {
    return text;
  },
  getFgAnsi() {
    return "";
  },
  getBgAnsi() {
    return "";
  },
  getColorMode() {
    return "truecolor";
  },
  getThinkingBorderColor() {
    return (text: string) => text;
  },
  getBashModeBorderColor() {
    return (text: string) => text;
  },
} as unknown as ExtensionUIContext["theme"];

export interface PiExtensionUiDependencies {
  readonly makeEventBase: (
    context: PiSessionContext,
    options?: { readonly includeTurnId?: boolean },
  ) => {
    readonly eventId: EventId;
    readonly provider: typeof PROVIDER;
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly turnId?: TurnId;
  };
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => void;
}

export function makePiExtensionUi(dependencies: PiExtensionUiDependencies) {
  const { makeEventBase, offerRuntimeEvent } = dependencies;
  const resolvePiExtensionUserInput = (
    context: PiSessionContext,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => {
    const pending = context.pendingUserInputs.get(requestId);
    if (!pending) return false;
    pending.resolve(answers);
    return true;
  };

  const requestPiExtensionUserInput = (
    context: PiSessionContext,
    input: {
      readonly method: string;
      readonly question: UserInputQuestion;
      readonly opts?: Parameters<ExtensionUIContext["select"]>[2];
      readonly rawPayload?: Record<string, unknown>;
    },
  ): Promise<ProviderUserInputAnswers> => {
    if (context.stopped || input.opts?.signal?.aborted) {
      return Promise.resolve({});
    }

    const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
    const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);

    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => undefined;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        input.opts?.signal?.removeEventListener("abort", abort);
      };
      const finish = (answers: ProviderUserInputAnswers) => {
        if (settled) return;
        settled = true;
        cleanup();
        context.pendingUserInputs.delete(requestId);
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "user-input.resolved",
          requestId: runtimeRequestId,
          payload: { answers },
          raw: {
            source: "pi.sdk.event",
            method: `${input.method}/answered`,
            payload: { requestId, answers },
          },
        } satisfies ProviderRuntimeEvent);
        resolve(answers);
      };
      abort = () => finish({});

      context.pendingUserInputs.set(requestId, { resolve: finish });
      if (typeof input.opts?.timeout === "number" && input.opts.timeout > 0) {
        timeoutId = setTimeout(abort, input.opts.timeout);
      }
      input.opts?.signal?.addEventListener("abort", abort, { once: true });

      offerRuntimeEvent({
        ...makeEventBase(context),
        type: "user-input.requested",
        requestId: runtimeRequestId,
        payload: { questions: [input.question] },
        raw: {
          source: "pi.sdk.event",
          method: input.method,
          payload: input.rawPayload ?? { requestId, question: input.question },
        },
      } satisfies ProviderRuntimeEvent);
    });
  };

  // Bridges the common Pi extension UI primitives onto Agent Group's existing
  // pending user-input flow; terminal/TUI-only APIs remain no-op by design.
  const makePiExtensionUIContext = (context: PiSessionContext): ExtensionUIContext => {
    const unsupportedWarnings = new Set<string>();
    const statusTexts = new Map<string, string>();
    let workingMessage: string | undefined;
    const warnUnsupported = (method: string) => {
      if (unsupportedWarnings.has(method)) return;
      unsupportedWarnings.add(method);
      offerRuntimeEvent({
        ...makeEventBase(context, { includeTurnId: false }),
        type: "runtime.warning",
        payload: {
          message: `Pi extension UI API '${method}' is not supported in Agent Group yet.`,
          detail: { method },
        },
        raw: {
          source: "pi.sdk.event",
          method: "extension/ui-unsupported",
          payload: { method },
        },
      } satisfies ProviderRuntimeEvent);
    };
    const emitPluginProgress = (summary: string) => {
      const normalized = trimToUndefined(summary);
      if (!normalized) return;
      offerRuntimeEvent({
        ...makeEventBase(context),
        type: "tool.progress",
        payload: { toolName: "Pi plugin", summary: normalized },
        raw: {
          source: "pi.sdk.event",
          method: "extension/ui-progress",
          payload: { summary: normalized },
        },
      } satisfies ProviderRuntimeEvent);
    };

    const uiContext: ExtensionUIContext = {
      async select(title, options, opts) {
        const questionId = "selection";
        const optionMappings = makePiUserInputOptions(options);
        const answers = await requestPiExtensionUserInput(context, {
          method: "extension/ui/select",
          opts,
          question: {
            id: questionId,
            header: trimToUndefined(title) ?? "Pi plugin",
            question: trimToUndefined(title) ?? "Choose an option.",
            options: optionMappings.map((mapping) => mapping.option),
          },
          rawPayload: { title, options },
        });
        const answer = firstPiUserInputAnswer(answers, questionId);
        return optionMappings.find((mapping) => mapping.option.label === answer)?.value;
      },
      async confirm(title, message, opts) {
        const questionId = "confirmation";
        const answers = await requestPiExtensionUserInput(context, {
          method: "extension/ui/confirm",
          opts,
          question: {
            id: questionId,
            header: trimToUndefined(title) ?? "Pi plugin",
            question: trimToUndefined(message) ?? trimToUndefined(title) ?? "Confirm this action?",
            options: [makePiUserInputOption("Yes"), makePiUserInputOption("No")],
          },
          rawPayload: { title, message },
        });
        return firstPiUserInputAnswer(answers, questionId) === "Yes";
      },
      async input(title, placeholder, opts) {
        const questionId = "input";
        const answers = await requestPiExtensionUserInput(context, {
          method: "extension/ui/input",
          opts,
          question: {
            id: questionId,
            header: trimToUndefined(title) ?? "Pi plugin",
            question: trimToUndefined(placeholder) ?? trimToUndefined(title) ?? "Type a response.",
            options: [],
          },
          rawPayload: { title, placeholder },
        });
        return firstPiUserInputAnswer(answers, questionId);
      },
      notify(message, type) {
        const normalized = trimToUndefined(message);
        if (!normalized) return;
        if (type === "warning" || type === "error") {
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "runtime.warning",
            payload: { message: normalized, detail: { type: type ?? "info" } },
            raw: {
              source: "pi.sdk.event",
              method: "extension/ui/notify",
              payload: { message: normalized, type },
            },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        emitPluginProgress(normalized);
      },
      onTerminalInput() {
        warnUnsupported("onTerminalInput");
        return () => undefined;
      },
      setStatus(key, text) {
        const normalizedKey = trimToUndefined(key) ?? "status";
        const normalizedText = trimToUndefined(text);
        if (!normalizedText) {
          statusTexts.delete(normalizedKey);
          return;
        }
        if (statusTexts.get(normalizedKey) === normalizedText) return;
        statusTexts.set(normalizedKey, normalizedText);
        emitPluginProgress(`${normalizedKey}: ${normalizedText}`);
      },
      setWorkingMessage(message) {
        const normalizedMessage = trimToUndefined(message);
        if (!normalizedMessage || normalizedMessage === workingMessage) return;
        workingMessage = normalizedMessage;
        emitPluginProgress(normalizedMessage);
      },
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setHiddenThinkingLabel() {},
      setWidget() {
        warnUnsupported("setWidget");
      },
      setFooter() {
        warnUnsupported("setFooter");
      },
      setHeader() {
        warnUnsupported("setHeader");
      },
      setTitle(title) {
        if (title) emitPluginProgress(title);
      },
      async custom() {
        warnUnsupported("custom");
        return undefined as never;
      },
      pasteToEditor() {
        warnUnsupported("pasteToEditor");
      },
      setEditorText() {
        warnUnsupported("setEditorText");
      },
      getEditorText() {
        return "";
      },
      editor(title, prefill) {
        return uiContext.input(title, prefill);
      },
      addAutocompleteProvider() {
        warnUnsupported("addAutocompleteProvider");
      },
      setEditorComponent() {
        warnUnsupported("setEditorComponent");
      },
      getEditorComponent() {
        return undefined;
      },
      theme: PLAIN_PI_EXTENSION_THEME,
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return { success: false, error: "Agent Group does not expose Pi themes." };
      },
      getToolsExpanded() {
        return false;
      },
      setToolsExpanded() {},
    };
    return uiContext;
  };

  return { makePiExtensionUIContext, resolvePiExtensionUserInput };
}
