import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import type { ServerReadiness } from "./server/readiness";
import { authEffectRouteLayer } from "./http/authRoutes";
import {
  editorIconEffectRouteLayer,
  projectFaviconEffectRouteLayer,
  siteFaviconEffectRouteLayer,
} from "./http/faviconRoutes";
import {
  attachmentsEffectRouteLayer,
  codexVisualizationEffectRouteLayer,
  localImageEffectRouteLayer,
  threadExportEffectRouteLayer,
} from "./http/fileRoutes";
import { staticAndDevEffectRouteLayer } from "./http/staticRoutes";

export { isLegacyTokenAuthorized } from "./http/authRoutes";
export {
  attachmentsEffectRouteLayer,
  codexVisualizationEffectRouteLayer,
  localImageEffectRouteLayer,
} from "./http/fileRoutes";
export { createHttpRequestHandler, type HttpRequestHandlerOptions } from "./http/legacyHandler";

export function makeEffectHttpRouteLayer(readiness: ServerReadiness) {
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/health",
      readiness.getSnapshot.pipe(
        Effect.map((snapshot) =>
          HttpServerResponse.jsonUnsafe(
            {
              status: "ok",
              startupReady: snapshot.startupReady,
              pushBusReady: snapshot.pushBusReady,
              keybindingsReady: snapshot.keybindingsReady,
              terminalSubscriptionsReady: snapshot.terminalSubscriptionsReady,
              orchestrationSubscriptionsReady: snapshot.orchestrationSubscriptionsReady,
            },
            { status: 200 },
          ),
        ),
      ),
    ),
    authEffectRouteLayer,
    projectFaviconEffectRouteLayer,
    threadExportEffectRouteLayer,
    siteFaviconEffectRouteLayer,
    editorIconEffectRouteLayer,
    localImageEffectRouteLayer,
    codexVisualizationEffectRouteLayer,
    attachmentsEffectRouteLayer,
    staticAndDevEffectRouteLayer,
  );
}
