// Applies app-owned learning metadata without changing context.md.

import type { AgentGroupUpdateSessionInput } from "@agent-group/contracts";

import type { StoredSessionState } from "./state";

type LearningUpdate = Pick<
  AgentGroupUpdateSessionInput,
  "knowledgeAcknowledgement" | "learningOrigin"
>;

export function applySessionLearningUpdate(
  session: StoredSessionState,
  input: LearningUpdate,
): boolean {
  let changed = false;
  const acknowledgement = input.knowledgeAcknowledgement;
  if (
    acknowledgement &&
    !session.knowledgeAcknowledgements.some(
      (item) =>
        item.cardKey === acknowledgement.cardKey &&
        item.cardMarkdown === acknowledgement.cardMarkdown,
    )
  ) {
    if (session.knowledgeAcknowledgements.length >= 2_048) {
      throw new Error("Knowledge progress history is full");
    }
    session.knowledgeAcknowledgements.push({ ...acknowledgement });
    changed = true;
  }

  if (input.learningOrigin) {
    if (session.learningOrigin && !sameLearningOrigin(session.learningOrigin, input.learningOrigin)) {
      throw new Error("Learning origin cannot be changed");
    }
    if (!session.learningOrigin) {
      session.learningOrigin = { ...input.learningOrigin };
      changed = true;
    }
  }
  return changed;
}

function sameLearningOrigin(
  left: NonNullable<StoredSessionState["learningOrigin"]>,
  right: NonNullable<AgentGroupUpdateSessionInput["learningOrigin"]>,
): boolean {
  return (
    left.sourceSessionId === right.sourceSessionId &&
    left.sourceContextRevision === right.sourceContextRevision &&
    left.cardKey === right.cardKey &&
    left.cardTitle === right.cardTitle &&
    left.cardMarkdown === right.cardMarkdown &&
    left.selectedText === right.selectedText
  );
}
