export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "assets/prod/agent-group-macos-1024.png",
  productionMacLegacyIconPng: "assets/prod/agent-group-macos-legacy-1024.png",
  productionLinuxIconPng: "assets/prod/agent-group-universal-1024.png",
  productionWindowsIconIco: "assets/prod/agent-group-windows.ico",
  productionWebFaviconIco: "assets/prod/agent-group-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/agent-group-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/agent-group-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/agent-group-web-apple-touch-180.png",
  developmentWindowsIconIco: "assets/dev/agent-group-dev-windows.ico",
  developmentWebFaviconIco: "assets/dev/agent-group-dev-web-favicon.ico",
  developmentWebFavicon16Png: "assets/dev/agent-group-dev-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/dev/agent-group-dev-web-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/dev/agent-group-dev-web-apple-touch-180.png",
} as const;

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];
