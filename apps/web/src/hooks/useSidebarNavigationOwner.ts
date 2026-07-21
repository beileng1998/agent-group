import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

export function useSidebarNavigationOwner() {
  const navigate = useNavigate();
  const navigateToWorkspace = useCallback(
    (workspaceId: string, options?: { replace?: boolean }) => {
      void navigate({
        to: "/workspace/$workspaceId",
        params: { workspaceId },
        ...(options?.replace ? { replace: true } : {}),
      });
    },
    [navigate],
  );
  const openUsageSettings = useCallback(() => {
    void navigate({
      to: "/settings",
      search: { section: "usage" },
    });
  }, [navigate]);

  return { navigate, navigateToWorkspace, openUsageSettings };
}
