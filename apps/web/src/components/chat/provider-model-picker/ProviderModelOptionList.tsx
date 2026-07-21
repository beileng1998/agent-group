import { type ModelSlug, type ProviderKind } from "@agent-group/contracts";
import { cn } from "~/lib/utils";
import { type FavoriteModelProvider } from "../../../lib/modelFavorites";
import { shouldUseCollapsibleModelGroups } from "../../../providerModelOptions";
import { MenuRadioGroup } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { PickerPanelShell } from "../PickerPanelShell";
import { ProviderModelOptionGroupList } from "../ProviderModelOptionGroupList";
import {
  COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
  COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
} from "../composerPickerStyles";
import { type resolveProviderModelCatalog } from "./providerModelCatalog";
import { SEARCHABLE_MODEL_PICKER_THRESHOLD } from "./providerModelPickerModel";

type ProviderModelCatalog = ReturnType<typeof resolveProviderModelCatalog>;

type ProviderModelOptionListProps = {
  provider: ProviderKind;
  activeProvider: ProviderKind;
  model: ModelSlug;
  loading: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  catalog: ProviderModelCatalog;
  onModelChange: (value: string) => void;
  onToggleFavorite: (provider: FavoriteModelProvider, slug: string) => void;
  onAfterSelection?: () => void;
};

export function ProviderModelOptionList(props: ProviderModelOptionListProps) {
  if (props.loading) {
    return (
      <div className="space-y-2 px-2 py-2" aria-label="Loading models">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-32")} />
          </div>
        ))}
      </div>
    );
  }

  const content =
    props.catalog.groupedOptions.length > 0 ? (
      <MenuRadioGroup
        value={props.activeProvider === props.provider ? props.model : ""}
        onValueChange={props.onModelChange}
      >
        <ProviderModelOptionGroupList
          groupedOptions={props.catalog.groupedOptions}
          provider={props.provider}
          activeModel={props.model}
          isSearching={props.catalog.normalizedSearchQuery.length > 0}
          favoriteProvider={props.catalog.favoriteProvider}
          favoriteModelSlugSet={props.catalog.favoriteModelSlugSet}
          onToggleFavorite={props.onToggleFavorite}
          {...(props.onAfterSelection ? { onAfterSelection: props.onAfterSelection } : {})}
        />
      </MenuRadioGroup>
    ) : (
      <div className="px-2 py-2 text-muted-foreground text-sm">
        {props.provider === "pi" && props.catalog.normalizedSearchQuery.length === 0
          ? "No Pi models found"
          : "No matches"}
      </div>
    );

  if (!props.catalog.shouldShowSearch) {
    const needsScrollContainer =
      props.catalog.filteredOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD ||
      shouldUseCollapsibleModelGroups(props.catalog.groupedOptions.length, false);
    if (needsScrollContainer) {
      return (
        <div
          className={cn(
            "overflow-y-auto overscroll-contain py-0.5",
            COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
            COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
          )}
        >
          {content}
        </div>
      );
    }
    return content;
  }

  return (
    <PickerPanelShell
      searchPlaceholder="Search models or providers"
      query={props.searchQuery}
      onQueryChange={props.onSearchQueryChange}
      stopSearchKeyPropagation
      autoFocusSearch
      widthClassName="w-full"
      bleedParentPadding
      listMaxHeightClassName={COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME}
    >
      {content}
    </PickerPanelShell>
  );
}
