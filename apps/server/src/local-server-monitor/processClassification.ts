// FILE: local-server-monitor/processClassification.ts
// Purpose: Classifies listener owners as user-facing development servers.
// Layer: Pure local-server discovery policy.

import path from "node:path";

import { normalizeCommandName } from "./processParsing";
import type { DevServerCandidateInput } from "./types";

const EXCLUDED_PROCESS_PATTERNS = [
  "airplayxpchelper",
  "controlcenter",
  "cursor helper",
  "figma",
  "google chrome",
  "linear helper",
  "logioptionsplus",
  "rapportd",
  "raycast",
  "safari",
  "spotify",
];

const EXCLUDED_PROCESS_COMMANDS = new Set([
  "electron",
  "electron helper",
  "electron helper (renderer)",
  "agent-group",
]);

// Chromium/Electron spawns child processes (renderers, GPU, utility, plugin hosts) that can hold
// a localhost port yet are app internals, never dev servers — e.g. Discord's RPC helper sits on
// :6463, inside the broad dev-port range. The `--type=` flag is Chromium's own child-process
// marker, so it's a precise signal independent of which app spawned it.
const CHROMIUM_CHILD_ARGS_PATTERN =
  /--type=(?:renderer|gpu-process|gpu|utility|zygote|plugin|ppapi|broker|crashpad-handler)\b/i;

// Electron/Chromium per-role helper executables ("Discord Helper (Renderer)", "Slack Helper
// (GPU)") — matched by name so they're filtered even when the full arg list is unavailable.
const APP_HELPER_COMMAND_PATTERN = /\bhelper\s*\((?:renderer|gpu|plugin|alerts)\)/i;

const DEV_COMMAND_LABELS = new Map<string, string>([
  ["air", "Air"],
  ["artisan", "Laravel"],
  ["astro", "Astro"],
  ["bunx", "Bun"],
  ["expo", "Expo"],
  ["flask", "Flask"],
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["parcel", "Parcel"],
  ["rails", "Rails"],
  ["serve", "Serve"],
  ["vite", "Vite"],
  ["webpack-dev-server", "Webpack"],
]);

const DATABASE_OR_SYSTEM_COMMANDS = new Set([
  "memcached",
  "mongod",
  "mysql",
  "mysqld",
  "postgres",
  "postgresql",
  "redis-server",
]);

const DEV_SCRIPT_NAME_PATTERN =
  /^(?:dev|dev[:_-].+|.+[:_-]dev|electron:dev|dev:electron|dev:desktop|desktop:dev|start:desktop)$/i;
const DEV_ARGS_PATTERN =
  /\b(astro|expo|flask|next\s+dev|nodemon|nuxt|parcel|react-scripts\s+start|remix|rsbuild|rspack|svelte-kit|turbo|vite|webpack-dev-server)\b|(?:manage\.py\s+runserver)|(?:php\s+(?:artisan\s+serve|-S\s+))|(?:rails\s+(?:s|server))|(?:uvicorn\b)|(?:webpack\s+serve)|(?:go\s+run\b)|(?:cargo\s+run\b)|(?:dotnet\s+(?:watch|run)\b)|(?:deno\s+(?:task\s+)?(?:dev|serve|run)\b)|(?:python3?\s+-m\s+http\.server\b)|(?:dev-runner\.[cm]?ts\s+dev[:_-][A-Za-z0-9:_-]+)/i;

function normalizeProcessText(command: string, args: string): string {
  return `${command} ${args}`.toLowerCase();
}

export function isIgnoredLocalServerProcess(input: DevServerCandidateInput): boolean {
  const text = normalizeProcessText(input.command, input.args);
  const commandName = normalizeCommandName(input.command, input.args);
  if (input.ports.every((port) => port < 1024)) {
    return true;
  }
  if (DATABASE_OR_SYSTEM_COMMANDS.has(commandName)) {
    return true;
  }
  if (
    CHROMIUM_CHILD_ARGS_PATTERN.test(input.args) ||
    APP_HELPER_COMMAND_PATTERN.test(input.command)
  ) {
    return true;
  }
  if (EXCLUDED_PROCESS_COMMANDS.has(commandName)) {
    return true;
  }
  return EXCLUDED_PROCESS_PATTERNS.some((pattern) => text.includes(pattern));
}

function isDevScriptName(scriptName: string): boolean {
  return DEV_SCRIPT_NAME_PATTERN.test(scriptName);
}

function devScriptNameFromArgs(args: string): string | null {
  const match = /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9:_-]+)\b/i.exec(args);
  return match?.[1] ?? null;
}

function detectDevServerKindFromText(input: DevServerCandidateInput): string | null {
  const commandName = normalizeCommandName(input.command, input.args);
  const directToolLabel = DEV_COMMAND_LABELS.get(commandName);
  if (directToolLabel) {
    if (commandName === "next" && !/\bnext\s+dev\b/i.test(input.args)) return null;
    return directToolLabel;
  }

  const text = normalizeProcessText(input.command, input.args);
  if (/(^|[\s/\\])vite(?:\.js|\.mjs|\.cjs)?(?:\s|$)/i.test(text)) return "Vite";
  if (/\bnext\s+dev\b/i.test(text)) return "Next.js";
  if (/\bnuxt\b/i.test(text)) return "Nuxt";
  if (/\bastro\b/i.test(text)) return "Astro";
  if (/\bexpo\b/i.test(text)) return "Expo";
  if (/\bwebpack(?:-dev-server|\s+serve)\b/i.test(text)) return "Webpack";
  if (/\bparcel\b/i.test(text)) return "Parcel";
  if (/\buvicorn\b/i.test(text)) return "Uvicorn";
  if (/\bflask\b/i.test(text)) return "Flask";
  if (/(?:manage\.py\s+runserver)|\bdjango\b/i.test(text)) return "Django";
  if (/(?:php\s+artisan\s+serve)|\blaravel\b/i.test(text)) return "Laravel";
  if (/\brails\s+(?:s|server)\b/i.test(text)) return "Rails";
  if (/\bgo\s+run\b/i.test(text)) return "Go";
  if (/\bcargo\s+run\b/i.test(text)) return "Cargo";
  if (/\bdotnet\s+(?:watch|run)\b/i.test(text)) return "Dotnet";
  if (/\bdeno\s+(?:task\s+)?(?:dev|serve|run)\b/i.test(text)) return "Deno";
  if (/\bpython3?\s+-m\s+http\.server\b/i.test(text)) return "Python";
  if (/\bphp\s+-S\s+/i.test(text)) return "PHP";
  if (/\breact-scripts\s+start\b/i.test(text)) return "React";

  const scriptName = devScriptNameFromArgs(input.args);
  if (scriptName && isDevScriptName(scriptName)) {
    return "Dev Server";
  }

  if (DEV_ARGS_PATTERN.test(text)) return "Dev Server";
  return null;
}

export function isLikelyDevServerProcess(input: DevServerCandidateInput): boolean {
  return !isIgnoredLocalServerProcess(input) && detectDevServerKindFromText(input) !== null;
}

export function formatDisplayName(command: string, args: string): string {
  const textKind = detectDevServerKindFromText({ command, args, ports: [] });
  if (textKind) return textKind;
  const text = normalizeProcessText(command, args);
  if (/\bvite\b/.test(text)) return "Vite";
  if (/\bnext\b/.test(text)) return "Next.js";
  if (/\bnuxt\b/.test(text)) return "Nuxt";
  if (/\bastro\b/.test(text)) return "Astro";
  if (/\bexpo\b/.test(text)) return "Expo";
  if (/\bwebpack\b/.test(text)) return "Webpack";
  if (/\bparcel\b/.test(text)) return "Parcel";
  if (/\buvicorn\b/.test(text)) return "Uvicorn";
  if (/\bflask\b/.test(text)) return "Flask";
  if (/(?:manage\.py\s+runserver)|\bdjango\b/.test(text)) return "Django";
  if (/(?:php\s+artisan\s+serve)|\blaravel\b/.test(text)) return "Laravel";
  if (/\brails\b/.test(text)) return "Rails";
  return path.basename(command).replace(/\.[cm]?js$/i, "") || command;
}
