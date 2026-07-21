import type {
  MessageMentionReference,
  ProviderMentionReference,
  SessionMentionReference,
} from "@agent-group/contracts";

export function isSessionMentionReference(
  mention: MessageMentionReference,
): mention is SessionMentionReference {
  return "kind" in mention && mention.kind === "session";
}

export function isProviderMentionReference(
  mention: MessageMentionReference,
): mention is ProviderMentionReference {
  return !isSessionMentionReference(mention);
}
