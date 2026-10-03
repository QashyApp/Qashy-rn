/**
 * Texture overlays that let adjacent donut slices differ by more than color, for
 * themes with `charts.patterns` on. Kept pure so the cycle can be tested without
 * rendering SVG.
 */
export type SlicePatternKind = "hatch" | "dots" | "crosshatch" | "diagonal";

const SLICE_PATTERNS: readonly SlicePatternKind[] = [
  "hatch",
  "dots",
  "crosshatch",
  "diagonal",
];

/** The pattern for the slice at `index`, cycling so neighbouring slices never match. */
export function slicePattern(index: number): SlicePatternKind {
  const length = SLICE_PATTERNS.length;
  return SLICE_PATTERNS[((Math.trunc(index) % length) + length) % length];
}
