// FILE: -settingsRoute.generalPanel.tsx
// Purpose: Render general defaults and sidebar/environment visibility settings.
// Layer: Settings route panel

import { PROVIDER_DISPLAY_NAMES } from "@agent-group/contracts";
import type { RefObject } from "react";

import type { AppSettings } from "../appSettings";
import { ProviderOptionLabel } from "../components/ProviderIcon";
import { SettingResetButton, SettingsSelectControl } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { SelectItem } from "../components/ui/select";
import { SETTINGS_TARGETS } from "../settingsNavigation";
import { SettingsBooleanRow } from "./-settingsRoute.booleanRow";
import {
  PROVIDER_SELECT_OPTIONS,
  SIDEBAR_PROJECT_SORT_ORDER_LABELS,
  SIDEBAR_THREAD_SORT_ORDER_LABELS,
  isProviderSelectOption,
} from "./-settingsRoute.options";

export interface SettingsGeneralPanelProps {
  settings: AppSettings;
  defaults: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  environmentPanelRef: RefObject<HTMLDivElement | null>;
}

export function SettingsGeneralPanel(props: SettingsGeneralPanelProps) {
  const { defaults, environmentPanelRef, settings, updateSettings } = props;
  const booleanRowProps = { settings, defaults, updateSettings };

  return (
    <div className="space-y-6">
      <SettingsSection title="Core defaults">
        <SettingsRow
          title="Default provider"
          description="Choose the provider used for new chats."
          resetAction={
            settings.defaultProvider !== defaults.defaultProvider ? (
              <SettingResetButton
                label="default provider"
                onClick={() => updateSettings({ defaultProvider: defaults.defaultProvider })}
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultProvider}
              onValueChange={(value) => {
                if (!isProviderSelectOption(value)) return;
                updateSettings({ defaultProvider: value });
              }}
              ariaLabel="Default provider"
              valueContent={
                <ProviderOptionLabel
                  provider={settings.defaultProvider}
                  label={PROVIDER_DISPLAY_NAMES[settings.defaultProvider]}
                />
              }
            >
              {PROVIDER_SELECT_OPTIONS.map((provider) => (
                <SelectItem hideIndicator key={provider} value={provider}>
                  <ProviderOptionLabel
                    provider={provider}
                    label={PROVIDER_DISPLAY_NAMES[provider]}
                  />
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value !== "local" && value !== "worktree") return;
                updateSettings({
                  defaultThreadEnvMode: value,
                });
              }}
              ariaLabel="Default thread mode"
              valueContent={settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
            >
              <SelectItem hideIndicator value="local">
                Local
              </SelectItem>
              <SelectItem hideIndicator value="worktree">
                New worktree
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title="Sidebar organization">
        <SettingsRow
          title="Project order"
          description="Controls how projects are arranged in the main sidebar."
          resetAction={
            settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder ? (
              <SettingResetButton
                label="project order"
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: defaults.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at" && value !== "manual") {
                  return;
                }
                updateSettings({ sidebarProjectSortOrder: value });
              }}
              ariaLabel="Project sort order"
              valueContent={SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder]}
            >
              <SelectItem hideIndicator value="updated_at">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.created_at}
              </SelectItem>
              <SelectItem hideIndicator value="manual">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.manual}
              </SelectItem>
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          title="Thread order"
          description="Controls how threads are arranged inside each project in the main sidebar."
          resetAction={
            settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder ? (
              <SettingResetButton
                label="thread order"
                onClick={() =>
                  updateSettings({
                    sidebarThreadSortOrder: defaults.sidebarThreadSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarThreadSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at") {
                  return;
                }
                updateSettings({ sidebarThreadSortOrder: value });
              }}
              ariaLabel="Thread sort order"
              valueContent={SIDEBAR_THREAD_SORT_ORDER_LABELS[settings.sidebarThreadSortOrder]}
            >
              <SelectItem hideIndicator value="updated_at">
                {SIDEBAR_THREAD_SORT_ORDER_LABELS.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {SIDEBAR_THREAD_SORT_ORDER_LABELS.created_at}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title="Sidebar sections">
        <SettingsBooleanRow
          {...booleanRowProps}
          settingKey="showChatsSection"
          title="Chats"
          description="Show the standalone Chats list in the sidebar footer (chats not tied to a project)."
          resetLabel="chats section"
          ariaLabel="Show the Chats section in the sidebar"
        />

        <SettingsBooleanRow
          {...booleanRowProps}
          settingKey="showStudioSection"
          title="Studio"
          description="Show the Studio tab in the sidebar switcher."
          resetLabel="studio section"
          ariaLabel="Show the Studio section in the sidebar"
        />

        <SettingsBooleanRow
          {...booleanRowProps}
          settingKey="showWorkspaceSection"
          title="Workspace"
          description="Show the Workspace tab in the sidebar switcher. The Threads tab always stays visible."
          resetLabel="workspace section"
          ariaLabel="Show the Workspace section in the sidebar"
        />
      </SettingsSection>

      <div ref={environmentPanelRef} id={SETTINGS_TARGETS.environmentPanel}>
        <SettingsSection title="Environment panel">
          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="environmentPanelDefaultOpen"
            title="Open by default"
            description="Open the chat Environment panel automatically on normal threads. When off, the panel stays closed until you open it. Your last open/close also updates this preference."
            resetLabel="environment panel default open"
            ariaLabel="Open the Environment panel by default on normal threads"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentUsage"
            title="Usage"
            description="Show the provider usage row in the chat Environment panel."
            resetLabel="usage section"
            ariaLabel="Show the Usage section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentRepository"
            title="Repository"
            description="Show the GitHub repository link in the chat Environment panel. The git block (Changes, Worktree, branch, Commit and Push) always stays visible."
            resetLabel="repository section"
            ariaLabel="Show the Repository section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentPullRequest"
            title="Pull request"
            description="Show the open pull request (CI checks and review comments) for the current branch in the chat Environment panel."
            resetLabel="pull request section"
            ariaLabel="Show the Pull request section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentEditor"
            title="Editor"
            description="Show the Editor section (in-app editor view and Open in editor picker) in the chat Environment panel."
            resetLabel="editor section"
            ariaLabel="Show the Editor section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentRecap"
            title="Recap"
            description="Show the auto-generated chat recap in the Environment panel."
            resetLabel="recap section"
            ariaLabel="Show the Recap section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentPinned"
            title="Pinned messages"
            description="Show the pinned-messages checklist in the Environment panel."
            resetLabel="pinned messages section"
            ariaLabel="Show the Pinned messages section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentMarkers"
            title="Highlights"
            description="Show highlighted and underlined transcript text in the Environment panel."
            resetLabel="text markers section"
            ariaLabel="Show the Highlights section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentInstructions"
            title="Project instructions"
            description="Show project-level instructions in the Environment panel."
            resetLabel="project instructions section"
            ariaLabel="Show the Project instructions section in the Environment panel"
          />

          <SettingsBooleanRow
            {...booleanRowProps}
            settingKey="showEnvironmentNotepad"
            title="Notepad"
            description="Show the per-thread notepad in the Environment panel."
            resetLabel="notepad section"
            ariaLabel="Show the Notepad section in the Environment panel"
          />
        </SettingsSection>
      </div>
    </div>
  );
}
