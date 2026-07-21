// FILE: useComposerReferenceSelectionController.ts
// Purpose: Own selected composer skills and mentions across prompt/provider changes.
// Layer: Web composer controller

import {
  type MessageMentionReference,
  type ProviderKind,
  type ProviderSkillReference,
  type ThreadId,
} from "@agent-group/contracts";
import { isSessionMentionReference } from "@agent-group/shared/messageMentions";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  filterPromptMentionReferences,
  filterPromptSkillReferences,
  mentionReferencesEqual,
  providerSkillReferencesEqual,
} from "../lib/composerMentions";

type SelectionUpdate<Value> = Value[] | ((existing: Value[]) => Value[]);

export function useComposerReferenceSelectionController(input: {
  threadId: ThreadId;
  prompt: string;
  provider: ProviderKind;
  persistedSkills: ProviderSkillReference[];
  persistedMentions: MessageMentionReference[];
  persistSkills: (threadId: ThreadId, skills: ProviderSkillReference[]) => void;
  persistMentions: (threadId: ThreadId, mentions: MessageMentionReference[]) => void;
}) {
  const [skills, setSkillsState] = useState<ProviderSkillReference[]>(() => input.persistedSkills);
  const [mentions, setMentionsState] = useState<MessageMentionReference[]>(
    () => input.persistedMentions,
  );
  const skillsRef = useRef(skills);
  const mentionsRef = useRef(mentions);
  const previousProviderRef = useRef<{
    threadId: ThreadId;
    provider: ProviderKind;
  } | null>(null);
  skillsRef.current = skills;
  mentionsRef.current = mentions;

  const setSkills = useCallback(
    (next: SelectionUpdate<ProviderSkillReference>) => {
      const existing = skillsRef.current;
      const resolved = typeof next === "function" ? next(existing) : next;
      skillsRef.current = resolved;
      setSkillsState(resolved);
      input.persistSkills(input.threadId, resolved);
    },
    [input.persistSkills, input.threadId],
  );
  const setMentions = useCallback(
    (next: SelectionUpdate<MessageMentionReference>) => {
      const existing = mentionsRef.current;
      const resolved = typeof next === "function" ? next(existing) : next;
      mentionsRef.current = resolved;
      setMentionsState(resolved);
      input.persistMentions(input.threadId, resolved);
    },
    [input.persistMentions, input.threadId],
  );

  useLayoutEffect(() => {
    setSkills(input.persistedSkills);
    setMentions(input.persistedMentions);
  }, [input.persistedMentions, input.persistedSkills, input.threadId, setMentions, setSkills]);

  useEffect(() => {
    setSkills((existing) => {
      const next = filterPromptSkillReferences(input.prompt, existing, input.provider);
      return providerSkillReferencesEqual(existing, next) ? existing : next;
    });
  }, [input.prompt, input.provider, setSkills]);

  useEffect(() => {
    setMentions((existing) => {
      const next = filterPromptMentionReferences(input.prompt, existing);
      return mentionReferencesEqual(existing, next) ? existing : next;
    });
  }, [input.prompt, setMentions]);

  useEffect(() => {
    const previous = previousProviderRef.current;
    previousProviderRef.current = {
      threadId: input.threadId,
      provider: input.provider,
    };
    if (!previous || previous.threadId !== input.threadId || previous.provider === input.provider) {
      return;
    }
    setSkills([]);
    setMentions((existing) => existing.filter(isSessionMentionReference));
  }, [input.provider, input.threadId, setMentions, setSkills]);

  return { mentions, mentionsRef, setMentions, setSkills, skills, skillsRef };
}
