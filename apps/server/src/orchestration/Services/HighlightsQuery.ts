import type { HighlightsListInput, HighlightsListOutput } from "@agent-group/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface HighlightsQueryShape {
  readonly list: (
    input: HighlightsListInput,
  ) => Effect.Effect<HighlightsListOutput, ProjectionRepositoryError>;
}

export class HighlightsQuery extends ServiceMap.Service<HighlightsQuery, HighlightsQueryShape>()(
  "agent-group/orchestration/Services/HighlightsQuery",
) {}
