export const DEFAULT_DAILY_TIME = "09:00";
export const GENERATED_INTENT_CONFIDENCE_THRESHOLD = 0.75;
export const PROMPT_ENRICHMENT_MAX_WORDS = 10;
export const PROMPT_ENRICHMENT_MAX_LENGTH = 80;
export const CRON_FIELD_PATTERN = "[*/0-9,-]+";

export const PLAIN_INVOCATION_QUESTION_PREFIX_PATTERN =
  /^(?:what|why|how|who|when|where|which|can|could|would|should|do|does|did|is|are|am|will|qual|quale|quali|cosa|come|perche|dove|quando|chi|posso|puoi|potresti|dovrei)\b/;
export const PLAIN_INVOCATION_POLITE_REQUEST_PATTERN =
  /^(?:(?:can|could|would|will|should)\s+you(?:\s+please)?|(?:puoi|potresti)(?:\s+per favore)?)\s+/i;
export const PLAIN_INVOCATION_ACTION_PREFIX_PATTERN =
  /^(?:check|verify|monitor|watch|remind(?:\s+me)?|notify(?:\s+me)?|alert(?:\s+me)?|tell\s+me|controlla|verifica|monitora|avvisami|ricordami)\b/i;
export const PLAIN_INVOCATION_POLITE_ACTION_PREFIX_PATTERN =
  /^(?:check|verify|monitor|watch|say|remind(?:\s+me)?|notify(?:\s+me)?|alert(?:\s+me)?|tell\s+me|controlla|verifica|monitora|avvisami|ricordami)\b/i;
export const PLAIN_INVOCATION_AUTOMATION_CREATION_PREFIX_PATTERN = new RegExp(
  [
    "^(?:please\\s+)?(?:",
    "(?:make|create|set up|setup|add|start|build)\\s+(?:an?\\s+)?automation\\b",
    "|schedule\\s+(?:an?\\s+)?(?:automation|task|job|check|monitor)\\b",
    "|(?:crea|creare|aggiungi|imposta|fai)\\s+(?:un[' ]?)?",
    "(?:automazione|task|controllo|monitoraggio)\\b",
    ")",
  ].join(""),
  "i",
);

export const WEEKDAY_BY_TOKEN: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domenica: 0,
  monday: 1,
  mon: 1,
  lunedi: 1,
  tuesday: 2,
  tue: 2,
  martedi: 2,
  wednesday: 3,
  wed: 3,
  mercoledi: 3,
  thursday: 4,
  thu: 4,
  giovedi: 4,
  friday: 5,
  fri: 5,
  venerdi: 5,
  saturday: 6,
  sat: 6,
  sabato: 6,
};

export const WEEKDAY_STRIP_PATTERN = [
  ...Object.keys(WEEKDAY_BY_TOKEN),
  "lunedi",
  "lunedì",
  "martedi",
  "martedì",
  "mercoledi",
  "mercoledì",
  "giovedi",
  "giovedì",
  "venerdi",
  "venerdì",
].join("|");

export const TIME_PATTERN = "((?:[01]?\\d|2[0-3])(?::[0-5]\\d)?\\s*(?:am|pm)?)";
export const INTERVAL_UNIT_PATTERN =
  "(?:seconds|second|secs|sec|secondi|secondo|minutes|minute|mins|minuti|minuto|min|hours|hour|hrs|hr|ore|ora|days|day|giorni|giorno|s|m|h|d|g)";
export const BARE_INTERVAL_UNIT_PATTERN =
  "(?:seconds|second|secs|sec|secondi|secondo|minutes|minute|mins|minuti|minuto|min|hours|hour|hrs|hr|ore|ora|s|m|h)";
export const INTERVAL_PATTERN = `(\\d{1,4})\\s*(${INTERVAL_UNIT_PATTERN})`;
export const BARE_INTERVAL_LEADING_REMAINDER_PATTERN =
  "(?=$|\\s*(?:,|and\\b|to\\b|then\\b)|\\s+(?:check|verify|monitor|watch|remind|notify|alert|tell|controlla|verifica|monitora|avvisami|ricordami)\\b)";
export const BARE_INTERVAL_LEADING_ACTION_PATTERN = new RegExp(
  `^(?:every|each|ogni)\\s+${BARE_INTERVAL_UNIT_PATTERN}\\b\\s+(?:check|verify|monitor|watch|remind|notify|alert|tell|controlla|verifica|monitora|avvisami|ricordami)\\b`,
  "i",
);
