// FILE: useComposerPickerOpenController.ts
// Purpose: Keep composer model and traits pickers mutually exclusive.
// Layer: Web composer controller

import { useCallback, useState } from "react";

export function useComposerPickerOpenController() {
  const [modelOpen, setModelOpenState] = useState(false);
  const [traitsOpen, setTraitsOpenState] = useState(false);

  const setModelOpen = useCallback((open: boolean) => {
    setModelOpenState(open);
    if (open) setTraitsOpenState(false);
  }, []);
  const setTraitsOpen = useCallback((open: boolean) => {
    setTraitsOpenState(open);
    if (open) setModelOpenState(false);
  }, []);
  const closeAll = useCallback(() => {
    setModelOpenState(false);
    setTraitsOpenState(false);
  }, []);
  const setCombinedOpen = useCallback(
    (open: boolean) => {
      if (open) setModelOpen(true);
      else closeAll();
    },
    [closeAll, setModelOpen],
  );

  return {
    closeAll,
    combinedOpen: modelOpen || traitsOpen,
    modelOpen,
    setCombinedOpen,
    setModelOpen,
    setTraitsOpen,
    traitsOpen,
  };
}
