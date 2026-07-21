import { Schema } from "effect";
import {
  DEFAULT_AUTOMATION_STOP_CONFIDENCE_THRESHOLD,
  ServerGenerateAutomationIntentResult,
  type AutomationMode,
} from "@agent-group/contracts";

import { limitSection } from "./promptInputs.ts";

// Converts an explicit composer trigger into the same automation fields the create API expects.
export function buildAutomationIntentPrompt(input: {
  readonly message: string;
  readonly defaultMode?: AutomationMode;
  readonly nowIso: string;
}) {
  const defaultMode = input.defaultMode ?? "heartbeat";
  return {
    prompt: [
      "You extract structured Agent Group automation creation intents.",
      "Return a JSON object matching the requested schema.",
      "Respond with only the JSON object, no prose and no code fences.",
      "",
      "Context:",
      "- The user already invoked /automation or @automation in the chat composer.",
      "- Still set isAutomation=false if the text is only asking a question about automations or does not request a scheduled task.",
      "- Agent Group automations run a saved prompt on a schedule.",
      `- Current timestamp for relative timers: ${input.nowIso}.`,
      "",
      "Required output fields:",
      "- isAutomation: true only when the user wants to create a scheduled automation.",
      "- confidence: number from 0 to 1.",
      "- language: detected user language, or null.",
      "- name: short automation name, <= 160 chars, or null.",
      "- taskPrompt: the detailed, self-contained recurring instruction to save, without /automation, @automation, schedule, stop, or run-count scaffolding.",
      "- Expand terse tasks into a clear saved automation prompt only using facts the user provided.",
      "- Preserve concrete user-provided workspace paths, commands, files, commit/push rules, verification steps, URLs, accounts, and constraints.",
      "- Do not invent repo-specific files, commands, services, tests, tickets, product context, credentials, or success criteria.",
      "- If the user only gave a tiny task, keep taskPrompt clear and short instead of padding it with fake details.",
      "- schedule: automation cadence, or null when missing/ambiguous.",
      "- mode: heartbeat or standalone.",
      "- maxIterations: positive integer only when the user explicitly says for N times/runs/iterations/volte; otherwise null.",
      `- completionPolicy: use {"type":"ai-evaluated","stopWhen":"...","confidenceThreshold":${DEFAULT_AUTOMATION_STOP_CONFIDENCE_THRESHOLD}} only when the user explicitly says until/stop when/if X stop/fino a quando/finche. Otherwise use {"type":"none"}.`,
      "- missingFields: include schedule, taskPrompt, name, or mode when that field is null or too unclear.",
      "- needsConfirmation: true when schedule/task/mode is missing, ambiguous, or confidence < 0.75.",
      "- reason: short explanation when isAutomation=false or needsConfirmation=true; otherwise null.",
      "",
      "Task prompt quality checklist:",
      "- Objective: state the concrete recurring task.",
      "- Source of truth: keep any user-provided URLs, accounts, APIs, commands, files, or public-source constraints.",
      "- Scope: name files, directories, branches, or repositories only when the user provided them.",
      "- Procedure: preserve user-provided commands and ordered steps.",
      "- Decision gates: include what to do when there is no change, ambiguity, failure, or conflicting evidence if the user specified it.",
      "- Verification: preserve explicit build/lint/test checks and whether they are conditional.",
      "- Publish rules: preserve explicit commit, push, branch, PR, or no-commit rules.",
      "- Non-goals: preserve constraints like do not use APIs, do not change architecture, and do not stage unrelated files.",
      "- Reporting: include concise output expectations when the user asked for them.",
      "",
      "Task prompt examples:",
      '- User: "every day update my follower count without using the API, only the static file, build, commit and push if changed"',
      '- taskPrompt: "Update the manually maintained follower count from a user-visible public source only. Do not use API credentials or existing runtime data code. Update only the specified static file when the count changes, run the requested build check, and commit/push only if there is an actual count change. Preserve unrelated working tree changes."',
      '- User: "every 6h check this product URL until the black variant is available"',
      '- taskPrompt: "Check the provided product URL and report whether the black variant is purchasable or pre-orderable. Treat conflicting page/session evidence as ambiguous instead of stopping early."',
      "",
      "Schedule rules:",
      '- For \'in N seconds/minutes/hours/days\', \'tra N secondi/minuti/ore/giorni\', or \'fra ...\', use {"type":"once","runAt":"<ISO timestamp>"} calculated from the current timestamp.',
      '- For \'every N seconds/minutes/hours/days\' or equivalents in any language, use {"type":"interval","everySeconds":N in seconds}.',
      "- Recurring intervals under 60 seconds require explicit review; keep the interval schedule, set needsConfirmation=true, and explain the fast cadence in reason.",
      "- For daily/weekdays/weekly, use HH:mm 24h timeOfDay. If the user gives no time, use 09:00.",
      "- For weekly, dayOfWeek is 0=Sunday, 1=Monday, ... 6=Saturday.",
      "- Do not invent a cadence or relative base time. If time is missing, approximate, or ambiguous, schedule=null and missingFields includes schedule.",
      "",
      "Mode rules:",
      `- Default mode is ${defaultMode}.`,
      "- heartbeat means continue/report in the current thread on each run.",
      "- standalone means create independent scheduled runs.",
      "- Use the default unless the user clearly asks for the other behavior.",
      '- Stop clauses are currently supported only for heartbeat automations; if mode is standalone, use completionPolicy {"type":"none"}.',
      "",
      "User message:",
      limitSection(input.message, 16_000),
    ].join("\n"),
    outputSchemaJson: ServerGenerateAutomationIntentResult,
  };
}

// Evaluates a heartbeat stop clause from the completed run output, separate from the
// automation agent so the agent cannot self-disable the loop.
export function buildAutomationCompletionEvaluationPrompt(input: {
  readonly automationName: string;
  readonly automationPrompt: string;
  readonly stopWhen: string;
  readonly runUserMessage: string;
  readonly runAssistantText: string;
  readonly threadContext?: string | undefined;
}) {
  return {
    prompt: [
      "You evaluate whether a completed Agent Group heartbeat automation should stop.",
      "Return a JSON object with keys: stopMatched, confidence, reason.",
      "Respond with only the JSON object, no prose and no code fences.",
      "",
      "Decision rules:",
      "- stopMatched=true only if the completed run clearly satisfies the stop condition.",
      "- If the evidence is missing, indirect, ambiguous, or only says work continues, set stopMatched=false.",
      "- confidence must be a number from 0 to 1.",
      "- reason must be one concise sentence grounded in the run output.",
      "- Do not infer from the automation prompt alone; use the completed run output as evidence.",
      "",
      `Automation: ${input.automationName}`,
      "",
      "Saved automation prompt:",
      limitSection(input.automationPrompt, 4_000),
      "",
      "Stop condition:",
      limitSection(input.stopWhen, 2_000),
      "",
      "Run user message:",
      limitSection(input.runUserMessage, 4_000),
      "",
      "Run assistant output:",
      limitSection(input.runAssistantText, 12_000),
      "",
      "Recent thread context:",
      limitSection(input.threadContext?.trim() || "(none)", 6_000),
    ].join("\n"),
    outputSchemaJson: Schema.Struct({
      stopMatched: Schema.Boolean,
      confidence: Schema.Number,
      reason: Schema.String,
    }),
  };
}
