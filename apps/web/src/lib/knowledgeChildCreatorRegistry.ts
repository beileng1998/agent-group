// FILE: knowledgeChildCreatorRegistry.ts
// Purpose: Bridge the composer's thread context to Knowledge cards' "Ask in Side".
// Layer: Chat capability registry
// Exports: register/get for a per-thread knowledge-child creator.
//
// Knowledge "Ask in Side" creates a durable, Learning-initialized child session (never a
// temporary Side). The composer (inside ChatView) owns the thread/project context the
// creation command needs, so it publishes a creator keyed by its own thread id; Knowledge
// panels rendered anywhere (chat, terminal, dock) invoke it for their session.

import type { AgentGroupLearningOrigin, ThreadId } from "@agent-group/contracts";

export interface KnowledgeChildCreatorOptions {
  origin: AgentGroupLearningOrigin;
  onCreated?: (threadId: ThreadId) => void;
}

export type KnowledgeChildCreator = (options: KnowledgeChildCreatorOptions) => Promise<unknown>;

const creatorsByThreadId = new Map<ThreadId, KnowledgeChildCreator>();

export function registerKnowledgeChildCreator(
  threadId: ThreadId,
  creator: KnowledgeChildCreator,
): () => void {
  creatorsByThreadId.set(threadId, creator);
  return () => {
    if (creatorsByThreadId.get(threadId) === creator) {
      creatorsByThreadId.delete(threadId);
    }
  };
}

export function getKnowledgeChildCreator(threadId: ThreadId): KnowledgeChildCreator | undefined {
  return creatorsByThreadId.get(threadId);
}
