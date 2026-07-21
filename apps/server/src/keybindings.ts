/**
 * Keybindings - Keybinding configuration service definitions.
 *
 * Owns parsing, validation, merge, and persistence of user keybinding
 * configuration consumed by the server runtime.
 *
 * @module Keybindings
 */
import { Layer } from "effect";
import { makeKeybindings } from "./keybindings/runtime";
import { Keybindings } from "./keybindings/serviceContracts";

export { DEFAULT_KEYBINDINGS } from "./keybindings/defaults";
export {
  compileResolvedKeybindingRule,
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
  ResolvedKeybindingFromConfig,
  ResolvedKeybindingsFromConfig,
} from "./keybindings/parserSchema";
export {
  Keybindings,
  KeybindingsConfigError,
  type KeybindingsChangeEvent,
  type KeybindingsConfigState,
  type KeybindingsShape,
} from "./keybindings/serviceContracts";

export const KeybindingsLive = Layer.effect(Keybindings, makeKeybindings);
