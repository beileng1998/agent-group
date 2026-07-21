/**
 * Compatibility entry point for provider health probes and the live service.
 * Domain implementations live in `provider-health/`.
 */
export { parseClaudeAuthStatusFromOutput } from "../claudeAuthStatus";
export type { CommandResult } from "../providerCliOutput";

export { parseAuthStatusFromOutput } from "./provider-health/providerAuthParsing";
export {
  checkCodexProviderStatus,
  hasCustomModelProvider,
  makeCheckCodexProviderStatus,
  readCodexConfigModelProvider,
} from "./provider-health/codexProviderProbe";
export {
  checkClaudeProviderStatus,
  makeCheckClaudeProviderStatus,
} from "./provider-health/claudeProviderProbe";
export {
  checkAntigravityProviderStatus,
  checkCursorProviderStatus,
  makeCheckCursorProviderStatus,
} from "./provider-health/acpProviderProbes";
export {
  checkDroidProviderStatus,
  checkGrokProviderStatus,
  checkKiloProviderStatus,
  checkOpenCodeProviderStatus,
  checkPiProviderStatus,
  makeCheckDroidProviderStatus,
  makeCheckGrokProviderStatus,
  makeCheckKiloProviderStatus,
  makeCheckOpenCodeProviderStatus,
} from "./provider-health/simpleProviderProbes";
export {
  isProviderEnabledForSettings,
  makeDisabledProviderStatus,
  projectProviderStatusesForSettings,
  providerStatusesEqual,
  stabilizeProviderStatusesAgainstTransientTimeouts,
} from "./provider-health/providerStatusProjection";
export { PACKAGE_MANAGED_PROVIDER_UPDATES } from "./provider-health/providerUpdateDefinitions";
export { PROVIDER_UPDATE_TIMEOUT_MS } from "./provider-health/providerHealthConstants";
export { makeProviderHealthLive, ProviderHealthLive } from "./provider-health/providerHealthLayer";
