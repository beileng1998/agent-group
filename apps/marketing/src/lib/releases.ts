// FILE: releases.ts
// Purpose: Defines the GitHub release source used by the marketing site download flows.
// Layer: Marketing util
// Exports: repo/release URLs plus the latest-release fetch helper.

const REPO = import.meta.env.PUBLIC_GITHUB_REPOSITORY?.trim() ?? "";
export const REPO_URL = REPO ? `https://github.com/${REPO}` : null;

export const RELEASES_URL = REPO_URL ? `${REPO_URL}/releases` : null;

const API_URL = REPO ? `https://api.github.com/repos/${REPO}/releases/latest` : null;
const CACHE_KEY = "agent-group-latest-release";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  if (!API_URL) {
    throw new Error("PUBLIC_GITHUB_REPOSITORY is not configured.");
  }
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(API_URL).then((r) => r.json());

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
