import {
  type ModelSlug,
  type ProviderKind,
  type ServerProviderStatus,
} from "@agent-group/contracts";
import { resolveSelectableModel } from "@agent-group/shared/model";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import {
  FAVORITE_MODEL_STORAGE_KEYS,
  type FavoriteModelProvider,
} from "../../../lib/modelFavorites";
import { type ProviderModelOption } from "../../../providerModelOptions";
import { compareProvidersByOrder } from "../../../providerOrdering";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../../ProviderIcon";
import { MenuItem, MenuSeparator, MenuSub, MenuSubTrigger } from "../../ui/menu";
import { ComposerPickerMenuSubPopup } from "../ComposerPickerMenuPopup";
import { COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME } from "../composerPickerStyles";
import { ProviderModelOptionList } from "./ProviderModelOptionList";
import { resolveProviderModelCatalog } from "./providerModelCatalog";
import {
  AVAILABLE_PROVIDER_OPTIONS,
  FavoriteModelSlugs,
  filterProviderOptionsByVisibility,
  providerIconClassName,
  resolveLiveProviderAvailability,
  toggleFavoriteModelSlug,
  UNAVAILABLE_PROVIDER_OPTIONS,
} from "./providerModelPickerModel";

type ProviderModelMenuItemsProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  onAfterSelection?: () => void;
};

export const ProviderModelMenuItems = memo(function ProviderModelMenuItems(
  props: ProviderModelMenuItemsProps,
) {
  const { onAfterSelection } = props;
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const [kiloFavoriteModelSlugs, setKiloFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.kilo,
    [],
    FavoriteModelSlugs,
  );
  const [cursorFavoriteModelSlugs, setCursorFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.cursor,
    [],
    FavoriteModelSlugs,
  );
  const [openCodeFavoriteModelSlugs, setOpenCodeFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.opencode,
    [],
    FavoriteModelSlugs,
  );
  const [piFavoriteModelSlugs, setPiFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.pi,
    [],
    FavoriteModelSlugs,
  );
  const activeProvider = props.lockedProvider ?? props.provider;
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(props.hiddenProviders ?? []),
    [props.hiddenProviders],
  );
  const protectedProviderSet = useMemo(() => {
    const set = new Set<ProviderKind>([props.provider]);
    if (props.lockedProvider !== null) {
      set.add(props.lockedProvider);
    }
    return set;
  }, [props.provider, props.lockedProvider]);
  const visibleAvailableProviderOptions = useMemo(
    () =>
      filterProviderOptionsByVisibility(
        [...AVAILABLE_PROVIDER_OPTIONS].sort((left, right) =>
          compareProvidersByOrder(props.providerOrder ?? [], left.value, right.value),
        ),
        hiddenProviderSet,
        protectedProviderSet,
      ),
    [hiddenProviderSet, protectedProviderSet, props.providerOrder],
  );
  const visibleUnavailableProviderOptions = useMemo(
    () =>
      filterProviderOptionsByVisibility(
        [...UNAVAILABLE_PROVIDER_OPTIONS].sort((left, right) =>
          compareProvidersByOrder(props.providerOrder ?? [], left.value, right.value),
        ),
        hiddenProviderSet,
        protectedProviderSet,
      ),
    [hiddenProviderSet, protectedProviderSet, props.providerOrder],
  );
  const favoriteModelSlugSets = useMemo(
    () => ({
      cursor: new Set(cursorFavoriteModelSlugs),
      kilo: new Set(kiloFavoriteModelSlugs),
      opencode: new Set(openCodeFavoriteModelSlugs),
      pi: new Set(piFavoriteModelSlugs),
    }),
    [
      cursorFavoriteModelSlugs,
      kiloFavoriteModelSlugs,
      openCodeFavoriteModelSlugs,
      piFavoriteModelSlugs,
    ],
  );

  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled || !value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    onAfterSelection?.();
  };
  const toggleFavoriteModel = useCallback(
    (provider: FavoriteModelProvider, slug: string) => {
      const setFavoriteModelSlugs =
        provider === "cursor"
          ? setCursorFavoriteModelSlugs
          : provider === "kilo"
            ? setKiloFavoriteModelSlugs
            : provider === "pi"
              ? setPiFavoriteModelSlugs
              : setOpenCodeFavoriteModelSlugs;
      setFavoriteModelSlugs((current) => toggleFavoriteModelSlug(current, slug));
    },
    [
      setCursorFavoriteModelSlugs,
      setKiloFavoriteModelSlugs,
      setOpenCodeFavoriteModelSlugs,
      setPiFavoriteModelSlugs,
    ],
  );

  const renderModelList = (provider: ProviderKind) => (
    <ProviderModelOptionList
      provider={provider}
      activeProvider={activeProvider}
      model={props.model}
      loading={props.loadingModelProviders?.[provider] ?? false}
      searchQuery={modelSearchQuery}
      onSearchQueryChange={setModelSearchQuery}
      catalog={resolveProviderModelCatalog({
        provider,
        options: props.modelOptionsByProvider[provider],
        searchQuery: deferredModelSearchQuery,
        favoriteModelSlugSets,
      })}
      onModelChange={(value) => handleModelChange(provider, value)}
      onToggleFavorite={toggleFavoriteModel}
      {...(onAfterSelection ? { onAfterSelection } : {})}
    />
  );

  if (props.lockedProvider !== null) {
    return <>{renderModelList(props.lockedProvider)}</>;
  }

  return (
    <>
      {visibleAvailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        const liveProvider = props.providers?.find((entry) => entry.provider === option.value);
        const availability = resolveLiveProviderAvailability(liveProvider);
        if (availability.disabled) {
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 opacity-80",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80">
                {availability.label}
              </span>
            </MenuItem>
          );
        }
        return (
          <MenuSub key={option.value}>
            <MenuSubTrigger>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              {option.label}
            </MenuSubTrigger>
            <ComposerPickerMenuSubPopup
              fixedWidth
              className={COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME}
            >
              {renderModelList(option.value)}
            </ComposerPickerMenuSubPopup>
          </MenuSub>
        );
      })}
      {visibleUnavailableProviderOptions.length > 0 && <MenuSeparator />}
      {visibleUnavailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        return (
          <MenuItem key={option.value} disabled>
            <OptionIcon
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground/85 opacity-80"
            />
            <span>{option.label}</span>
            <span className="ms-auto text-[11px] text-muted-foreground/80">Coming soon</span>
          </MenuItem>
        );
      })}
    </>
  );
});
