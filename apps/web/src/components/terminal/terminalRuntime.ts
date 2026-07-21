// Compatibility facade for the persistent terminal runtime implementation.

export { createRuntimeEntry } from "./runtime/terminalRuntimeCreation";
export {
  attachRuntimeToContainer,
  detachRuntimeFromContainer,
  disposeRuntimeEntry,
  syncRuntimeConfig,
  updateRuntimeViewState,
} from "./runtime/terminalRuntimeLifecycle";
