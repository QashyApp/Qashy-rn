/**
 * The thin light line along the top edge of a raised fill (a pill, a progress bar, a filled
 * button), drawn as an inset shadow. It is white at `lightAlpha` in light mode and much fainter in
 * dark mode, where a full-strength highlight reads as a glare on a dark surface.
 *
 * Decorative and theme-independent, so it lives here rather than in each component.
 */
export function insetHighlight(
  mode: "light" | "dark",
  lightAlpha = 0.35,
): string {
  const alpha =
    mode === "dark" ? Math.round(lightAlpha * 0.17 * 100) / 100 : lightAlpha;
  return `inset 0 1px 0 rgba(255,255,255,${alpha})`;
}
