import type { ProjectId } from "@agent-group/contracts";
import { create } from "zustand";

interface GroupSettingsStore {
  readonly groupId: ProjectId | null;
  readonly open: (groupId: ProjectId) => void;
  readonly close: () => void;
}

export const useGroupSettingsStore = create<GroupSettingsStore>((set) => ({
  groupId: null,
  open: (groupId) => set({ groupId }),
  close: () => set({ groupId: null }),
}));
