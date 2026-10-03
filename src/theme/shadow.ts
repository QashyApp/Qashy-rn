import { mixHex, type BaseTokens } from "@/theme/tokens";

/**
 * One layer of a CSS `box-shadow`. RN 0.86's `boxShadow` style prop and
 * react-native-web both take the serialized string, so a theme can describe
 * shadows as data and never hand-write the string.
 */
export interface ShadowLayer {
  inset?: boolean;
  x: number;
  y: number;
  /** 0 for a hard (pixel/bevel) edge. */
  blur: number;
  spread?: number;
  color: string;
}

export function serializeShadow(layers: readonly ShadowLayer[]): string {
  return layers
    .map(
      ({ inset, x, y, blur, spread = 0, color }) =>
        `${inset ? "inset " : ""}${x}px ${y}px ${blur}px ${spread}px ${color}`,
    )
    .join(", ");
}

/** Splits on commas that are not inside parentheses (`rgba(0,0,0,.3)` stays whole). */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      out.push(value.slice(start, index));
      start = index + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((layer) => layer.trim()).filter(Boolean);
}

/** The blur radius of every layer in a serialized shadow, in order. Used by tests and the theme validator. */
export function shadowBlurs(value: string): number[] {
  return splitLayers(value)
    .filter((layer) => layer !== "none")
    .map((layer) => {
      const withoutColor = layer
        .replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/g, "")
        .replace("inset", "");
      const lengths = withoutColor.match(/-?\d*\.?\d+/g) ?? [];
      return lengths.length >= 3 ? Number(lengths[2]) : 0;
    });
}

const HIGHLIGHT_BLEND = { light: 0.55, dark: 0.18 } as const;
const LOWLIGHT_BLEND = { light: 0.22, dark: 0.5 } as const;
const EDGE_BLEND = { light: 0.4, dark: 0.7 } as const;

export interface BevelShadowSet {
  shadowCard: string;
  shadowRaised: string;
  shadowControl: string;
  shadowControlPressed: string;
  shadowSunken: string;
  shadowOverlay: string;
  shadowFab: string;
  scrim: string;
}

/**
 * The "bevel" material engine: every shadow has a 0px blur, so a surface reads
 * as a chunky pressed-pixel block — a light top-left edge, a dark bottom-right
 * edge and a solid drop edge — instead of soft light. Derived from the palette so
 * a theme only supplies colors.
 *
 * @param depth bevel thickness in px (2 or 3 for a pixel look)
 */
export function bevelShadowSet(
  base: BaseTokens,
  scheme: "light" | "dark",
  depth: number,
): BevelShadowSet {
  const highlight = mixHex(base.surface, "#FFFFFF", HIGHLIGHT_BLEND[scheme]);
  const lowlight = mixHex(base.surface, "#000000", LOWLIGHT_BLEND[scheme]);
  const edge = mixHex(base.background, "#000000", EDGE_BLEND[scheme]);
  const d = depth;
  const bevel: ShadowLayer[] = [
    { inset: true, x: d, y: d, blur: 0, color: highlight },
    { inset: true, x: -d, y: -d, blur: 0, color: lowlight },
  ];
  const pressed: ShadowLayer[] = [
    { inset: true, x: d, y: d, blur: 0, color: lowlight },
    { inset: true, x: -d, y: -d, blur: 0, color: highlight },
  ];
  return {
    shadowCard: serializeShadow([
      ...bevel,
      { x: 0, y: d, blur: 0, color: edge },
    ]),
    shadowRaised: serializeShadow([
      ...bevel,
      { x: 0, y: d * 2, blur: 0, color: edge },
    ]),
    shadowControl: serializeShadow([
      ...bevel,
      { x: 0, y: d, blur: 0, color: edge },
    ]),
    shadowControlPressed: serializeShadow(pressed),
    shadowSunken: serializeShadow(pressed),
    shadowOverlay: serializeShadow([
      ...bevel,
      { x: d * 2, y: d * 2, blur: 0, color: edge },
    ]),
    shadowFab: serializeShadow([
      ...bevel,
      { x: 0, y: d * 2, blur: 0, color: edge },
    ]),
    scrim: scheme === "dark" ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.55)",
  };
}

/** The accent-filled control's hard-edged shadow for the bevel engine. */
export function bevelAccentShadow(accent: string, depth: number): string {
  const d = depth;
  return serializeShadow([
    { inset: true, x: d, y: d, blur: 0, color: mixHex(accent, "#FFFFFF", 0.4) },
    {
      inset: true,
      x: -d,
      y: -d,
      blur: 0,
      color: mixHex(accent, "#000000", 0.35),
    },
    { x: 0, y: d, blur: 0, color: mixHex(accent, "#000000", 0.6) },
  ]);
}
