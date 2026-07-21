import type { ProviderKind, ServerProviderStatus, ServerSettings } from "@agent-group/contracts";
import { PROVIDER_COMMAND_TIMEOUT_DETAIL } from "../../providerCliOutput";
import { orderProviderStatuses } from "../../providerStatusCache";
import {
  DISABLED_PROVIDER_STATUS_MESSAGE,
  PROVIDERS,
  type ProviderStatuses,
} from "./providerHealthConstants";

function comparableProviderVersionAdvisory(
  advisory: ServerProviderStatus["versionAdvisory"] | undefined,
): Omit<NonNullable<ServerProviderStatus["versionAdvisory"]>, "checkedAt"> | null {
  if (!advisory) return null;
  const { checkedAt: _checkedAt, ...comparableAdvisory } = advisory;
  return comparableAdvisory;
}

export function providerStatusesEqual(
  left: ReadonlyArray<ServerProviderStatus>,
  right: ReadonlyArray<ServerProviderStatus>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((status, index) => {
    const next = right[index];
    return (
      next !== undefined &&
      status.provider === next.provider &&
      status.status === next.status &&
      status.available === next.available &&
      status.authStatus === next.authStatus &&
      (status.authType ?? null) === (next.authType ?? null) &&
      (status.authLabel ?? null) === (next.authLabel ?? null) &&
      status.voiceTranscriptionAvailable === next.voiceTranscriptionAvailable &&
      (status.version ?? null) === (next.version ?? null) &&
      (status.message ?? null) === (next.message ?? null) &&
      JSON.stringify(comparableProviderVersionAdvisory(status.versionAdvisory)) ===
        JSON.stringify(comparableProviderVersionAdvisory(next.versionAdvisory)) &&
      JSON.stringify(status.updateState ?? null) === JSON.stringify(next.updateState ?? null)
    );
  });
}

function isTransientProviderCommandTimeout(status: ServerProviderStatus): boolean {
  return (
    status.status !== "ready" &&
    status.authStatus === "unknown" &&
    (status.message ?? "").includes(PROVIDER_COMMAND_TIMEOUT_DETAIL)
  );
}

export function stabilizeProviderStatusesAgainstTransientTimeouts(
  previousStatuses: ReadonlyArray<ServerProviderStatus>,
  nextStatuses: ReadonlyArray<ServerProviderStatus>,
): ReadonlyArray<ServerProviderStatus> {
  if (previousStatuses.length === 0) return nextStatuses;
  const previousByProvider = new Map(
    previousStatuses.map((status) => [status.provider, status] as const),
  );
  return nextStatuses.map((status) => {
    const previous = previousByProvider.get(status.provider);
    if (
      !previous ||
      !previous.available ||
      previous.status !== "ready" ||
      !isTransientProviderCommandTimeout(status)
    ) {
      return status;
    }
    return {
      ...previous,
      checkedAt: status.checkedAt,
      ...(status.updateState !== undefined ? { updateState: status.updateState } : {}),
    };
  });
}

export function isProviderEnabledForSettings(
  provider: ProviderKind,
  settings: ServerSettings,
): boolean {
  return (
    settings.providers[provider]?.enabled !== false && settings.providers[provider] !== undefined
  );
}

export function makeDisabledProviderStatus(
  provider: ProviderKind,
  checkedAt = new Date().toISOString(),
): ServerProviderStatus {
  return {
    provider,
    status: "warning",
    available: false,
    authStatus: "unknown",
    checkedAt,
    message: DISABLED_PROVIDER_STATUS_MESSAGE,
  } satisfies ServerProviderStatus;
}

export function isDisabledProviderStatusOverlay(status: ServerProviderStatus): boolean {
  return status.message === DISABLED_PROVIDER_STATUS_MESSAGE && status.available === false;
}

export function mergeProviderStatusUpdates(
  previousStatuses: ReadonlyArray<ServerProviderStatus>,
  updatedStatuses: ReadonlyArray<ServerProviderStatus>,
): ProviderStatuses {
  const statusByProvider = new Map(
    previousStatuses.map((status) => [status.provider, status] as const),
  );
  for (const status of updatedStatuses) statusByProvider.set(status.provider, status);
  return orderProviderStatuses([...statusByProvider.values()]);
}

export function makeSuppressedProviderVersionAdvisory(
  status: ServerProviderStatus,
  currentVersion?: string | null,
): NonNullable<ServerProviderStatus["versionAdvisory"]> {
  return {
    status: "unknown",
    currentVersion: currentVersion ?? status.version ?? null,
    latestVersion: null,
    updateCommand: null,
    canUpdate: false,
    checkedAt: status.checkedAt,
    message: null,
  };
}

export function suppressProviderVersionAdvisory(
  status: ServerProviderStatus,
): ServerProviderStatus {
  return { ...status, versionAdvisory: makeSuppressedProviderVersionAdvisory(status) };
}

export function projectProviderStatusesForSettings(
  statuses: ReadonlyArray<ServerProviderStatus>,
  settings: ServerSettings,
  checkedAt = new Date().toISOString(),
): ProviderStatuses {
  const statusByProvider = new Map(statuses.map((status) => [status.provider, status] as const));
  const projected: ServerProviderStatus[] = [];
  for (const provider of PROVIDERS) {
    const status = statusByProvider.get(provider);
    if (!isProviderEnabledForSettings(provider, settings)) {
      const disabledStatus = makeDisabledProviderStatus(provider, status?.checkedAt ?? checkedAt);
      const withAdvisory = {
        ...disabledStatus,
        versionAdvisory: makeSuppressedProviderVersionAdvisory(disabledStatus, status?.version),
      } satisfies ServerProviderStatus;
      projected.push(
        status?.updateState ? { ...withAdvisory, updateState: status.updateState } : withAdvisory,
      );
      continue;
    }
    if (status && !isDisabledProviderStatusOverlay(status)) {
      projected.push(
        settings.enableProviderUpdateChecks ? status : suppressProviderVersionAdvisory(status),
      );
    }
  }
  return orderProviderStatuses(projected);
}
