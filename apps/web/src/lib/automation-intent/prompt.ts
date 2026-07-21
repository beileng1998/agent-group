import {
  BARE_INTERVAL_LEADING_REMAINDER_PATTERN,
  BARE_INTERVAL_UNIT_PATTERN,
  CRON_FIELD_PATTERN,
  INTERVAL_PATTERN,
  TIME_PATTERN,
  WEEKDAY_STRIP_PATTERN,
} from "./constants";
import { normalizeInlineText } from "./text";

const MAX_NAME_LENGTH = 120;

export function stripAutomationScaffold(value: string): string {
  let cleaned = normalizeInlineText(value);
  cleaned = cleaned
    .replace(
      /^(?:please\s+)?(?:make|create|set up|setup|add|start|build)\s+(?:an?\s+)?automation\s*(?:for\s+(?:me|myself)\b\s*)?(?:where|that|to|which)?\s*/i,
      "",
    )
    .replace(
      /^(?:please\s+)?(?:crea|creare|aggiungi|imposta|fai)\s+(?:un[' ]?)?(?:automazione|task|controllo|monitoraggio)\s*(?:per\s+(?:me|noi)\b\s*)?(?:che|per|dove)?\s*/i,
      "",
    )
    .replace(
      /^(?:please\s+)?schedule\s+(?:an?\s+)?(?:automation|task|job|check|monitor|reminder)\s*(?:for\s+(?:me|myself)\b\s*)?(?:to|that)?\s*/i,
      "",
    )
    .replace(/^(?:please\s+)?automate\s+(?:this|that|it)?\s*/i, "")
    .replace(/^(?:where|that|to|for|che|per|dove)\s+/i, "");

  cleaned = cleaned
    .replace(
      new RegExp(
        `\\b(?:you\\s+)?wake\\s+up\\s+(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:you\\s+)?run\\s+(?:it|this)?\\s*(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(`\\b(?:every|each)\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`, "i"),
      "",
    )
    .replace(
      new RegExp(
        `^(?:every|each)\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`\\b(?:every|each)\\s+${BARE_INTERVAL_UNIT_PATTERN}$`, "i"), "")
    .replace(new RegExp(`\\bogni\\s+${INTERVAL_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*`, "i"), "")
    .replace(
      new RegExp(
        `^ogni\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`\\bogni\\s+${BARE_INTERVAL_UNIT_PATTERN}$`, "i"), "")
    .replace(new RegExp(`\\bin\\s+${INTERVAL_PATTERN}\\b\\s*(?:and|to|then|,)?\\s*`, "i"), "")
    .replace(
      new RegExp(`\\b(?:tra|fra)\\s+${INTERVAL_PATTERN}\\b\\s*(?:e|poi|per|,)?\\s*`, "i"),
      "",
    )
    .replace(
      new RegExp(
        `\\bcron\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:daily|every day)(?:\\s+(?:at|around)\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:ogni giorno|tutti i giorni)(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:weekdays|every weekday|workdays)(?:\\s+at\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:giorni lavorativi|ogni giorno lavorativo)(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\bevery\\s+(?:${WEEKDAY_STRIP_PATTERN})(?:\\s+at\\s+${TIME_PATTERN})?\\s*(?:and|to|then|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\bogni\\s+(?:${WEEKDAY_STRIP_PATTERN})(?:\\s+(?:alle|a)\\s+${TIME_PATTERN})?\\s*(?:e|poi|per|,)?\\s*`,
        "i",
      ),
      "",
    )
    .replace(/^(?:please)\s+/i, "")
    .replace(/^(?:and|then|to|e|poi|che|di|per)\s+/i, "");

  return normalizeInlineText(cleaned);
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, " ");
}

function truncateName(value: string): string {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= MAX_NAME_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}...`;
}

function sentenceCase(value: string): string {
  const trimmed = normalizeInlineText(value);
  if (!trimmed) {
    return "Chat automation";
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function deriveAutomationIntentName(prompt: string): string {
  const withoutUrls = stripUrls(prompt);
  const availabilitySubject = withoutUrls.match(
    /\b(?:check|verify|monitor|watch|controlla|verifica|monitora)\s+(?:if|whether|se)?\s*(.+?)\s+(?:is|are|e|available|disponibile|disponibili|in stock)\b/i,
  );
  if (availabilitySubject?.[1]) {
    return truncateName(`Check ${sentenceCase(availabilitySubject[1])} availability`);
  }

  const actionSeed = withoutUrls.replace(
    /^(?:please\s+)?(?:check|verify|monitor|watch|notify|remind|tell me|controlla|verifica|monitora|avvisami|ricordami)\s+(?:me\s+)?/i,
    "",
  );
  return truncateName(sentenceCase(actionSeed));
}
