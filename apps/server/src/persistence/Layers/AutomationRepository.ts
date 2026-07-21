import { Layer } from "effect";

import { AutomationRepository } from "../Services/AutomationRepository.ts";
import { makeAutomationRepository } from "./automation-repository/serviceAssembly.ts";

export const AutomationRepositoryLive = Layer.effect(
  AutomationRepository,
  makeAutomationRepository,
);
