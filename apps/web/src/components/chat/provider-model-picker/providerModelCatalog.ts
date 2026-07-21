import { type ProviderKind } from "@agent-group/contracts";
import {
  groupProviderModelOptions,
  groupProviderModelOptionsWithFavorites,
  type ProviderModelOption,
} from "../../../providerModelOptions";
import { supportsModelFavorites, type FavoriteModelProvider } from "../../../lib/modelFavorites";
import {
  buildModelSearchText,
  SEARCHABLE_MODEL_PICKER_THRESHOLD,
} from "./providerModelPickerModel";

export function resolveProviderModelCatalog(input: {
  provider: ProviderKind;
  options: ReadonlyArray<ProviderModelOption>;
  searchQuery: string;
  favoriteModelSlugSets: Record<FavoriteModelProvider, ReadonlySet<string>>;
}) {
  const shouldShowSearch =
    (input.provider === "kilo" ||
      input.provider === "opencode" ||
      input.provider === "cursor" ||
      input.provider === "pi") &&
    input.options.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD;
  const normalizedSearchQuery = input.searchQuery.trim().toLowerCase();
  const filteredOptions =
    shouldShowSearch && normalizedSearchQuery.length > 0
      ? input.options.filter((option) =>
          buildModelSearchText(option).includes(normalizedSearchQuery),
        )
      : input.options;
  const favoriteProvider = supportsModelFavorites(input.provider) ? input.provider : null;
  const favoriteModelSlugSet =
    favoriteProvider !== null ? input.favoriteModelSlugSets[favoriteProvider] : undefined;
  const groupedOptions =
    favoriteModelSlugSet !== undefined
      ? groupProviderModelOptionsWithFavorites({
          options: filteredOptions,
          favoriteSlugs: favoriteModelSlugSet,
        })
      : groupProviderModelOptions(filteredOptions);

  return {
    favoriteModelSlugSet,
    favoriteProvider,
    filteredOptions,
    groupedOptions,
    normalizedSearchQuery,
    shouldShowSearch,
  };
}
