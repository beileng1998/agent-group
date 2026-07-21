import * as OriginalFS from "original-fs";
import { app } from "electron";
import {
  bundleSignatureFromStats,
  isWatchableBundlePath,
  type BundleSignature,
} from "../bundleSwapDetection";

export interface BundleIdentity {
  readonly path: string;
  readonly signature: BundleSignature | null;
}

export class BundleChangedDuringStartupError extends Error {
  readonly bundlePath: string;
  readonly baseline: BundleSignature | null;
  readonly current: BundleSignature | null;

  constructor(input: {
    bundlePath: string;
    baseline: BundleSignature | null;
    current: BundleSignature | null;
  }) {
    super("The packaged application changed while its static assets were being prepared.");
    this.name = "BundleChangedDuringStartupError";
    this.bundlePath = input.bundlePath;
    this.baseline = input.baseline;
    this.current = input.current;
  }
}

export function readBundleSignature(bundlePath: string): BundleSignature | null {
  try {
    return bundleSignatureFromStats(OriginalFS.statSync(bundlePath));
  } catch {
    return null;
  }
}

export function captureStartupBundleIdentity(): BundleIdentity | null {
  if (!app.isPackaged) return null;
  const bundlePath = app.getAppPath();
  if (!isWatchableBundlePath(bundlePath)) return null;
  return { path: bundlePath, signature: readBundleSignature(bundlePath) };
}
