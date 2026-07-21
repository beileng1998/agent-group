// FILE: useComposerVoiceController.ts
// Purpose: Own the composer voice-note state machine for recording, cancellation, and transcription.
// Layer: Chat composer hook
// Depends on: useVoiceRecorder, ChatView voice helper logic, and the native API voice endpoint.

import {
  type ProviderKind,
  type ServerProviderStatus,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "../../types";
import { formatVoiceRecordingDuration, useVoiceRecorder } from "../../lib/voiceRecorder";
import { readNativeApi } from "../../nativeApi";
import { toastManager } from "../ui/toast";
import {
  deriveComposerVoiceState,
  describeVoiceRecordingStartError,
  isVoiceAuthExpiredMessage,
  sanitizeVoiceErrorMessage,
} from "../ChatView.voiceAttachments";
import { warnVoiceGuard } from "./chatViewComposerValues";

interface UseComposerVoiceControllerOptions {
  activeProject: Project | undefined;
  activeThreadId: ThreadId | null;
  threadId: ThreadId;
  selectedProvider: ProviderKind;
  activeProviderStatus: ServerProviderStatus | null;
  pendingUserInputCount: number;
  onTranscriptReady: (transcript: string) => void;
  refreshVoiceStatus: () => void | Promise<unknown>;
  actionArmDelayMs?: number;
  transcriptionFailureTitle?: string;
}

export interface UseComposerVoiceControllerResult {
  isVoiceRecording: boolean;
  isVoiceTranscribing: boolean;
  voiceWaveformLevels: readonly number[];
  voiceRecordingDurationLabel: string;
  showVoiceNotesControl: boolean;
  startComposerVoiceRecording: () => Promise<void>;
  submitComposerVoiceRecording: () => Promise<void>;
  cancelComposerVoiceRecording: () => void;
  toggleComposerVoiceRecording: () => void;
}

// Keeps the async transcription lifecycle out of ChatView so the component can stay UI-focused.
export function useComposerVoiceController(
  options: UseComposerVoiceControllerOptions,
): UseComposerVoiceControllerResult {
  const {
    activeProject,
    activeThreadId,
    threadId,
    selectedProvider,
    activeProviderStatus,
    pendingUserInputCount,
    onTranscriptReady,
    refreshVoiceStatus,
    actionArmDelayMs = 0,
    transcriptionFailureTitle = "Voice transcription failed",
  } = options;
  const {
    isRecording: isVoiceRecording,
    durationMs: voiceRecordingDurationMs,
    waveformLevels: voiceWaveformLevels,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
    cancelRecording: cancelVoiceRecording,
  } = useVoiceRecorder();
  const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
  const voiceTranscriptionRequestIdRef = useRef(0);
  const voiceThreadIdRef = useRef(threadId);
  const voiceProviderRef = useRef<ProviderKind>(selectedProvider);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  voiceThreadIdRef.current = threadId;
  voiceProviderRef.current = selectedProvider;

  const voiceRecordingDurationLabel = useMemo(
    () => formatVoiceRecordingDuration(voiceRecordingDurationMs),
    [voiceRecordingDurationMs],
  );
  const { canStartVoiceNotes, showVoiceNotesControl } = useMemo(
    () =>
      deriveComposerVoiceState({
        authStatus: activeProviderStatus?.authStatus,
        voiceTranscriptionAvailable: activeProviderStatus?.voiceTranscriptionAvailable,
        isRecording: isVoiceRecording,
        isTranscribing: isVoiceTranscribing,
      }),
    [
      activeProviderStatus?.authStatus,
      activeProviderStatus?.voiceTranscriptionAvailable,
      isVoiceRecording,
      isVoiceTranscribing,
    ],
  );

  useEffect(() => {
    voiceTranscriptionRequestIdRef.current += 1;
    voiceRecordingStartedAtRef.current = null;
    void cancelVoiceRecording();
    setIsVoiceTranscribing(false);
  }, [cancelVoiceRecording, threadId]);

  useEffect(() => {
    if (canStartVoiceNotes || !isVoiceRecording) {
      return;
    }
    warnVoiceGuard("cancelled active voice recording because voice became unavailable", {
      authStatus: activeProviderStatus?.authStatus ?? null,
      voiceTranscriptionAvailable: activeProviderStatus?.voiceTranscriptionAvailable ?? null,
      isVoiceRecording,
    });
    voiceTranscriptionRequestIdRef.current += 1;
    voiceRecordingStartedAtRef.current = null;
    void cancelVoiceRecording();
    setIsVoiceTranscribing(false);
  }, [
    activeProviderStatus?.authStatus,
    activeProviderStatus?.voiceTranscriptionAvailable,
    canStartVoiceNotes,
    cancelVoiceRecording,
    isVoiceRecording,
  ]);

  const startComposerVoiceRecording = useCallback(async () => {
    if (!activeProject) {
      return;
    }
    if (activeProviderStatus?.authStatus === "unauthenticated") {
      toastManager.add({
        type: "error",
        title: "Sign in to ChatGPT in Codex before using voice notes.",
      });
      return;
    }
    if (!canStartVoiceNotes) {
      toastManager.add({
        type: "error",
        title: "Voice notes require a ChatGPT-authenticated Codex session.",
      });
      return;
    }
    if (pendingUserInputCount > 0) {
      toastManager.add({
        type: "error",
        title: "Answer plan questions before recording a voice note.",
      });
      return;
    }

    try {
      await startVoiceRecording();
      voiceRecordingStartedAtRef.current = performance.now();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: describeVoiceRecordingStartError(error),
      });
    }
  }, [
    activeProject,
    activeProviderStatus?.authStatus,
    canStartVoiceNotes,
    pendingUserInputCount,
    startVoiceRecording,
  ]);

  const submitComposerVoiceRecording = useCallback(async () => {
    if (!activeProject || !isVoiceRecording) {
      return;
    }
    const recordedForMs =
      voiceRecordingStartedAtRef.current === null
        ? null
        : Math.round(performance.now() - voiceRecordingStartedAtRef.current);
    if (recordedForMs !== null && recordedForMs >= 0 && recordedForMs < actionArmDelayMs) {
      warnVoiceGuard("ignored recorder action immediately after start", {
        recordedForMs,
      });
      return;
    }

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Voice transcription is unavailable right now.",
      });
      void cancelVoiceRecording();
      return;
    }

    setIsVoiceTranscribing(true);
    const requestId = voiceTranscriptionRequestIdRef.current + 1;
    voiceTranscriptionRequestIdRef.current = requestId;
    const requestThreadId = threadId;
    const requestProvider = selectedProvider;
    const isCurrentVoiceRequest = () =>
      voiceTranscriptionRequestIdRef.current === requestId &&
      voiceThreadIdRef.current === requestThreadId &&
      voiceProviderRef.current === requestProvider;

    try {
      const payload = await stopVoiceRecording();
      if (!isCurrentVoiceRequest()) {
        return;
      }
      if (!payload) {
        toastManager.add({
          type: "warning",
          title: "No audio was captured.",
        });
        return;
      }
      const result = await api.server.transcribeVoice({
        provider: "codex",
        cwd: activeProject.cwd,
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        ...payload,
      });
      if (!isCurrentVoiceRequest()) {
        return;
      }
      onTranscriptReady(result.text);
    } catch (error) {
      if (!isCurrentVoiceRequest()) {
        return;
      }

      const description =
        error instanceof Error
          ? sanitizeVoiceErrorMessage(error.message)
          : "The voice note could not be transcribed.";
      const authExpired = isVoiceAuthExpiredMessage(description);
      if (authExpired) {
        void refreshVoiceStatus();
      }
      toastManager.add({
        type: "error",
        title: authExpired ? "Sign in to ChatGPT again" : transcriptionFailureTitle,
        description: authExpired
          ? "Voice transcription uses your ChatGPT session in Codex. That session was rejected, so sign in again there and retry."
          : description,
        ...(authExpired
          ? {
              actionProps: {
                children: "Refresh status",
                onClick: () => {
                  void refreshVoiceStatus();
                },
              },
            }
          : {}),
      });
    } finally {
      if (isCurrentVoiceRequest()) {
        voiceRecordingStartedAtRef.current = null;
        setIsVoiceTranscribing(false);
      }
    }
  }, [
    activeProject,
    activeThreadId,
    actionArmDelayMs,
    cancelVoiceRecording,
    isVoiceRecording,
    onTranscriptReady,
    refreshVoiceStatus,
    selectedProvider,
    stopVoiceRecording,
    threadId,
    transcriptionFailureTitle,
  ]);

  const cancelComposerVoiceRecording = useCallback(() => {
    const recordedForMs =
      voiceRecordingStartedAtRef.current === null
        ? null
        : Math.round(performance.now() - voiceRecordingStartedAtRef.current);
    if (recordedForMs !== null && recordedForMs >= 0 && recordedForMs < actionArmDelayMs) {
      warnVoiceGuard("ignored recorder action immediately after start", {
        recordedForMs,
      });
      return;
    }
    voiceTranscriptionRequestIdRef.current += 1;
    voiceRecordingStartedAtRef.current = null;
    setIsVoiceTranscribing(false);
    void cancelVoiceRecording();
  }, [actionArmDelayMs, cancelVoiceRecording]);

  const toggleComposerVoiceRecording = useCallback(() => {
    if (isVoiceTranscribing) {
      return;
    }
    if (isVoiceRecording) {
      void submitComposerVoiceRecording();
      return;
    }
    void startComposerVoiceRecording();
  }, [
    isVoiceRecording,
    isVoiceTranscribing,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
  ]);

  return {
    isVoiceRecording,
    isVoiceTranscribing,
    voiceWaveformLevels,
    voiceRecordingDurationLabel,
    showVoiceNotesControl,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
    toggleComposerVoiceRecording,
  };
}
