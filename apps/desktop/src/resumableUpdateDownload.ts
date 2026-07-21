// Resumable, stall-aware replacement for electron-updater's macOS download.
//
// This compatibility facade preserves the original public surface while the
// request policy, attempt lifecycle, file verification, and updater wiring are
// owned by focused modules under resumable-update-download/.

export {
  DEFAULT_RESUMABLE_DOWNLOAD_CONFIG,
  type ResumableDownloadCallOptions,
  type ResumableDownloadConfig,
  type ResumableDownloaderTarget,
  type ResumableDownloadLogger,
  type ResumableProgressInfo,
  type UpdaterHttpExecutorLike,
} from "./resumable-update-download/contracts";
export { installResumableUpdateDownloader } from "./resumable-update-download/installerAdapter";
export { installIdleTimeout } from "./resumable-update-download/requestAttempt";
export {
  buildDownloadHeaders,
  classifyDownloadResponse,
  computeProgressInfo,
  computeRetryDelayMs,
  type DownloadResponseAction,
  isCrossOrigin,
  parseContentRangeTotal,
  selectSha512Encoding,
  shouldGiveUp,
} from "./resumable-update-download/responsePolicy";
