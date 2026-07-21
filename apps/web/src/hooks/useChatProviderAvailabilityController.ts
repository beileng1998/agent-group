// FILE: useChatProviderAvailabilityController.ts
// Purpose: Own provider health normalization, custom-binary confirmation, and send preflight.
// Layer: Web provider controller

import {
  type ProviderKind,
  type ProviderStartOptions,
  type ServerProviderStatus,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AppSettings, getCustomBinaryPathForProvider } from "../appSettings";
import {
  loadConfirmedCustomBinaryPaths,
  saveConfirmedCustomBinaryPaths,
} from "../confirmedCustomBinaryPathStore";
import {
  DISMISSED_PROVIDER_HEALTH_BANNERS_KEY,
  DismissedProviderHealthBannersSchema,
} from "../components/ChatView.environmentModel";
import {
  EMPTY_PROVIDER_STATUSES,
  getConfirmedCustomBinarySessionKey,
  getProviderHealthBannerDismissalKey,
  getProviderStartOptionsCustomBinaryPath,
  getThreadProviderCustomBinaryPathKey,
  MAX_DISMISSED_PROVIDER_HEALTH_BANNERS,
} from "../components/chat/chatViewProviderValues";
import { useChatSendPreflightController } from "./useChatSendPreflightController";
import { useLocalStorage } from "./useLocalStorage";
import { useRefreshProviderStatusesNow } from "./useProviderStatusRefresh";
import {
  findProviderStatus,
  normalizeProviderStatusForLocalConfig,
} from "../lib/providerAvailability";
import { shouldConsumePendingCustomBinaryConfirmation } from "../components/ChatView.logic";
import type { Thread } from "../types";

export function useChatProviderAvailabilityController(input: {
  rawStatuses: readonly ServerProviderStatus[] | undefined;
  settings: AppSettings;
  activeThread: Thread | undefined;
  selectedProvider: ProviderKind;
}) {
  const [confirmedPaths, setConfirmedPaths] = useState<Partial<Record<ProviderKind, string>>>(
    loadConfirmedCustomBinaryPaths,
  );
  const confirmedSessionKeysRef = useRef<Set<string>>(new Set());
  const pendingPathsRef = useRef<Map<string, string>>(new Map());
  const [dismissedBannerKeys, setDismissedBannerKeys] = useLocalStorage(
    DISMISSED_PROVIDER_HEALTH_BANNERS_KEY,
    [],
    DismissedProviderHealthBannersSchema,
  );

  const rememberCustomBinaryPathForDispatch = useCallback(
    (request: {
      threadId: ThreadId;
      provider: ProviderKind;
      providerOptions: ProviderStartOptions | undefined;
    }) => {
      const pendingKey = getThreadProviderCustomBinaryPathKey(request.threadId, request.provider);
      const customBinaryPath = getProviderStartOptionsCustomBinaryPath(
        request.providerOptions,
        request.provider,
      );
      if (!customBinaryPath) {
        pendingPathsRef.current.delete(pendingKey);
        return;
      }
      pendingPathsRef.current.set(pendingKey, customBinaryPath);
    },
    [],
  );

  useEffect(() => {
    const provider = input.activeThread?.session?.provider;
    if (!input.activeThread || !provider) return;
    const sessionKey = getConfirmedCustomBinarySessionKey(input.activeThread, provider);
    if (!sessionKey) {
      confirmedSessionKeysRef.current.delete(
        getThreadProviderCustomBinaryPathKey(input.activeThread.id, provider),
      );
      return;
    }
    const customBinaryPath = pendingPathsRef.current.get(sessionKey) ?? null;
    if (
      !shouldConsumePendingCustomBinaryConfirmation({
        sessionAlreadyChecked: confirmedSessionKeysRef.current.has(sessionKey),
        pendingCustomBinaryPath: customBinaryPath,
      })
    ) {
      return;
    }
    confirmedSessionKeysRef.current.add(sessionKey);
    pendingPathsRef.current.delete(sessionKey);
    if (!customBinaryPath) return;
    setConfirmedPaths((existing) =>
      existing[provider] === customBinaryPath
        ? existing
        : { ...existing, [provider]: customBinaryPath },
    );
  }, [
    input.activeThread,
    input.activeThread?.id,
    input.activeThread?.session?.provider,
    input.activeThread?.session?.status,
  ]);
  useEffect(() => saveConfirmedCustomBinaryPaths(confirmedPaths), [confirmedPaths]);

  const providerStatuses = useMemo(
    () =>
      (input.rawStatuses ?? EMPTY_PROVIDER_STATUSES)
        .map((status) =>
          normalizeProviderStatusForLocalConfig({
            provider: status.provider,
            status,
            customBinaryPath: getCustomBinaryPathForProvider(input.settings, status.provider),
            confirmedCustomBinaryPath: confirmedPaths[status.provider],
          }),
        )
        .flatMap((status) => (status ? [status] : [])),
    [confirmedPaths, input.rawStatuses, input.settings],
  );
  const activeProviderStatus = useMemo(
    () => findProviderStatus(providerStatuses, input.selectedProvider),
    [input.selectedProvider, providerStatuses],
  );
  const activeBannerKey = useMemo(
    () => getProviderHealthBannerDismissalKey(activeProviderStatus),
    [activeProviderStatus],
  );
  const visibleActiveProviderStatus =
    activeBannerKey && dismissedBannerKeys.includes(activeBannerKey) ? null : activeProviderStatus;
  const voiceProviderStatus = useMemo(
    () => findProviderStatus(providerStatuses, "codex"),
    [providerStatuses],
  );
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const sendPreflight = useChatSendPreflightController({
    providerStatuses,
    refreshProviderStatuses,
  });
  const dismissActiveProviderHealthBanner = useCallback(() => {
    if (!activeBannerKey) return;
    setDismissedBannerKeys((current) =>
      current.includes(activeBannerKey)
        ? current
        : [activeBannerKey, ...current].slice(0, MAX_DISMISSED_PROVIDER_HEALTH_BANNERS),
    );
  }, [activeBannerKey, setDismissedBannerKeys]);

  return {
    activeProviderStatus,
    dismissActiveProviderHealthBanner,
    isSendPreflightInFlight: sendPreflight.isInFlight,
    providerStatuses,
    refreshProviderStatuses,
    rememberCustomBinaryPathForDispatch,
    runSendPreflight: sendPreflight.run,
    visibleActiveProviderStatus,
    voiceProviderStatus,
  };
}
