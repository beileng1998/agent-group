// FILE: Sidebar.tsx
// Purpose: Renders the project/thread sidebar from its controller and presentation owners.
// Exports: Sidebar

import { SidebarPresentation } from "./sidebar/SidebarPresentation";
import { useSidebarController, type SidebarController } from "./sidebar/useSidebarController";

export { useSidebarController };
export type { SidebarController };

export default function Sidebar() {
  return <SidebarPresentation controller={useSidebarController()} />;
}
