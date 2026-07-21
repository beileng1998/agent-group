import {
  DEFAULT_RESUMABLE_DOWNLOAD_CONFIG,
  type ResumableDownloadConfig,
  type ResumableDownloaderTarget,
  type ResumableDownloadLogger,
} from "./contracts";
import { runResumableDownload } from "./downloadLifecycle";
import { installIdleTimeout } from "./requestAttempt";

export function installResumableUpdateDownloader(
  updater: ResumableDownloaderTarget,
  overrides: Partial<ResumableDownloadConfig> = {},
  logger: ResumableDownloadLogger = console,
): boolean {
  const executor = updater.httpExecutor;
  if (executor == null) {
    return false;
  }
  const config: ResumableDownloadConfig = { ...DEFAULT_RESUMABLE_DOWNLOAD_CONFIG, ...overrides };
  const createRequest = executor.createRequest.bind(executor);
  executor.download = (url, destination, options) =>
    options.cancellationToken.createPromise<string>((resolve, reject, onCancel) => {
      runResumableDownload({
        url,
        destination,
        options,
        createRequest,
        config,
        logger,
        registerCancel: onCancel,
      }).then(() => resolve(destination), reject);
    });
  executor.addTimeOutHandler = (request, callback, timeout) => {
    const idleMs = timeout > 0 ? Math.min(timeout, config.idleTimeoutMs) : config.idleTimeoutMs;
    installIdleTimeout(request, callback, idleMs);
  };
  return true;
}
