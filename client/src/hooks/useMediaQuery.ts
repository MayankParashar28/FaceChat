import { useEffect, useState } from "react";

/**
 * Track a CSS media query from React.
 *
 * Tailwind's responsive classes only hide an element; the component stays
 * mounted. That is fine for static chrome, but an open popover whose trigger
 * gets hidden at a breakpoint is left anchored to a zero-size element. Where
 * the breakpoint changes *which* controls exist, render off this instead.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
