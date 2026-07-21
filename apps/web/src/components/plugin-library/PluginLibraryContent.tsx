import { SearchIcon } from "~/lib/icons";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { Skeleton } from "../ui/skeleton";
import { EmptyPanel, InlineWarning, SectionHeader } from "./PluginLibraryControls";
import { PluginGridItem, SkillGridItem } from "./PluginLibraryItems";
import type { PluginLibraryCatalog } from "./usePluginLibraryCatalog";
import { pluginEntryKey, sectionTitle } from "./pluginLibraryValues";

export function PluginLibraryContent({ catalog }: { catalog: PluginLibraryCatalog }) {
  const {
    canListPlugins,
    canListSkills,
    discoveredSkills,
    discoveryCwd,
    filteredPluginEntries,
    filteredSkills,
    marketplaceSections,
    pluginEntries,
    pluginSearch,
    pluginsQuery,
    providerLabel,
    selectedTab,
    setPluginSearch,
    setSkillSearch,
    skillSearch,
    skillsQuery,
  } = catalog;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 py-10 text-center">
        <h1 className="text-[28px] font-semibold text-foreground">
          Make {providerLabel} work your way
        </h1>
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-6">
        <InputGroup className="rounded-xl bg-background/70 shadow-xs">
          <InputGroupAddon>
            <InputGroupText>
              <SearchIcon className="size-4 text-muted-foreground/60" />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={selectedTab === "plugins" ? pluginSearch : skillSearch}
            onChange={(event) => {
              if (selectedTab === "plugins") setPluginSearch(event.target.value);
              else setSkillSearch(event.target.value);
            }}
            placeholder={selectedTab === "plugins" ? "Search plugins" : "Search skills"}
            className="text-sm"
          />
        </InputGroup>
      </div>

      {((!discoveryCwd && selectedTab === "skills") ||
        (selectedTab === "plugins" && !!pluginsQuery.data?.remoteSyncError) ||
        (selectedTab === "plugins" &&
          (pluginsQuery.data?.marketplaceLoadErrors.length ?? 0) > 0)) && (
        <div className="mx-auto max-w-2xl space-y-1.5 px-6 pb-4">
          {!discoveryCwd && selectedTab === "skills" ? (
            <InlineWarning>
              Skills need a workspace path. Open a project or thread first.
            </InlineWarning>
          ) : null}
          {selectedTab === "plugins" && pluginsQuery.data?.remoteSyncError ? (
            <InlineWarning>{pluginsQuery.data.remoteSyncError}</InlineWarning>
          ) : null}
          {selectedTab === "plugins" &&
          (pluginsQuery.data?.marketplaceLoadErrors.length ?? 0) > 0 ? (
            <InlineWarning>
              {pluginsQuery.data?.marketplaceLoadErrors
                .map((error) => `${sectionTitle(error.marketplacePath)}: ${error.message}`)
                .join(" • ")}
            </InlineWarning>
          ) : null}
        </div>
      )}

      <div className="px-3 pb-10 sm:px-5">
        {selectedTab === "plugins" ? (
          <>
            {!canListPlugins ? (
              <div className="mx-auto max-w-2xl">
                <EmptyPanel
                  title={`Plugins unavailable for ${providerLabel}`}
                  description="This provider does not expose plugin discovery."
                />
              </div>
            ) : pluginsQuery.isLoading && pluginEntries.length === 0 ? (
              <div className="space-y-1">
                {["1", "2", "3", "4", "5", "6"].map((key) => (
                  <Skeleton key={key} className="h-[68px] w-full rounded-xl" />
                ))}
              </div>
            ) : filteredPluginEntries.length === 0 ? (
              <EmptyPanel
                title="No installed plugins found"
                description="This view only shows plugins already available in your Codex setup."
              />
            ) : (
              <div className="space-y-6">
                {marketplaceSections.map((section) => (
                  <div key={section.key}>
                    <SectionHeader title={section.title} />
                    <div className="grid grid-cols-1 sm:grid-cols-2">
                      {section.entries.map((entry) => (
                        <PluginGridItem key={pluginEntryKey(entry)} entry={entry} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {!canListSkills ? (
              <div className="mx-auto max-w-2xl">
                <EmptyPanel
                  title={`Skills unavailable for ${providerLabel}`}
                  description="This provider does not expose skill discovery."
                />
              </div>
            ) : skillsQuery.isLoading && discoveredSkills.length === 0 ? (
              <div className="space-y-1">
                {["1", "2", "3", "4", "5", "6"].map((key) => (
                  <Skeleton key={key} className="h-[68px] w-full rounded-xl" />
                ))}
              </div>
            ) : filteredSkills.length === 0 ? (
              <EmptyPanel title="No skills found" description="No skills match this search." />
            ) : (
              <div>
                <SectionHeader title="Skills" />
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {filteredSkills.map((skill) => (
                    <SkillGridItem key={skill.path} skill={skill} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
