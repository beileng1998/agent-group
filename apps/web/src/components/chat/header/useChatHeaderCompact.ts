import { useEffect, useRef, useState } from "react";

const HEADER_COMPACT_BREAKPOINT = 700;

export function useChatHeaderCompact(isSplitPane: boolean) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const measure = () => {
      setCompact(isSplitPane || element.clientWidth < HEADER_COMPACT_BREAKPOINT);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isSplitPane]);

  return { headerRef, compact };
}
