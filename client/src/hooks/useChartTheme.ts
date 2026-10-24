import { useCallback, useEffect, useState } from "react";

/**
 * Chart colours taken from the theme's CSS variables.
 *
 * Recharts wants concrete colour strings: it passes `stroke` and `fill`
 * straight through as SVG presentation attributes, where `var()` is not
 * resolved. So the variables are read here and handed over already resolved,
 * and re-read whenever the light/dark class on <html> changes.
 *
 * The alternative — hardcoding values — is what the charts did before, and
 * every one of them assumed a dark background: white gridlines and black
 * tooltips, both invisible or jarring on the light theme.
 */
export interface ChartTheme {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  cursor: string;
}

function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // The theme stores bare HSL triplets ("240 5.9% 90%"), not full colours.
  return value ? `hsl(${value})` : fallback;
}

export function useChartTheme(): ChartTheme {
  const read = useCallback(
    (): ChartTheme => ({
      grid: cssColor("--border", "#e4e4e7"),
      axis: cssColor("--muted-foreground", "#71717a"),
      tooltipBg: cssColor("--popover", "#ffffff"),
      tooltipBorder: cssColor("--border", "#e4e4e7"),
      tooltipText: cssColor("--popover-foreground", "#09090b"),
      cursor: cssColor("--accent", "#f4f4f5"),
    }),
    []
  );

  const [theme, setTheme] = useState<ChartTheme>(read);

  useEffect(() => {
    const update = () => setTheme(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [read]);

  return theme;
}
