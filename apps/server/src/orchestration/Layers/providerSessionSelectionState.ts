import type {
  ModelSelection,
  OrchestrationThread,
  ProviderStartOptions,
  ThreadId,
} from "@agent-group/contracts";

/** Owns the spawn profile last applied to each live provider session. */
export class ProviderSessionSelectionState {
  private readonly modelSelections = new Map<string, ModelSelection>();
  private readonly providerOptions = new Map<string, ProviderStartOptions>();

  seed(threads: ReadonlyArray<Pick<OrchestrationThread, "id" | "modelSelection">>): void {
    for (const thread of threads) this.modelSelections.set(thread.id, thread.modelSelection);
  }

  getModelSelection(threadId: ThreadId): ModelSelection | undefined {
    return this.modelSelections.get(threadId);
  }

  hasModelSelection(threadId: ThreadId): boolean {
    return this.modelSelections.has(threadId);
  }

  setModelSelection(threadId: ThreadId, selection: ModelSelection): void {
    this.modelSelections.set(threadId, selection);
  }

  getProviderOptions(threadId: ThreadId): ProviderStartOptions | undefined {
    return this.providerOptions.get(threadId);
  }

  setProviderOptions(threadId: ThreadId, options: ProviderStartOptions): void {
    this.providerOptions.set(threadId, options);
  }

  clear(threadId: ThreadId): void {
    this.modelSelections.delete(threadId);
    this.providerOptions.delete(threadId);
  }
}
