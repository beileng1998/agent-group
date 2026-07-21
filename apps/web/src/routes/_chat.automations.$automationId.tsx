import { createFileRoute } from "@tanstack/react-router";

import { AutomationDetailPage } from "./-automation-detail/AutomationDetailPage";

export const Route = createFileRoute("/_chat/automations/$automationId")({
  component: AutomationDetailRoute,
});

function AutomationDetailRoute() {
  const { automationId } = Route.useParams();
  return <AutomationDetailPage automationId={automationId} />;
}
