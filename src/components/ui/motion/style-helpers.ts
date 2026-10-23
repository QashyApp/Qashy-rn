import { StyleSheet, type ViewProps, type ViewStyle } from "react-native";

// Mirrored onto the wrapper but kept on the pressable, so the wrapper cannot
// shrink below an explicitly sized control and a percentage size still resolves
// against the real parent. The min/max pair matters the same way: a capped node
// centred by `alignSelf` would otherwise left-align inside a full-width wrapper.
const mirroredStyleKeys = [
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
] as const satisfies readonly (keyof ViewStyle)[];

// Moved onto the animated wrapper: box-model and flex participation belong to
// the outer element, otherwise the wrapper collapses to content size and a
// `flex: 1` pressable has nothing to fill.
const wrapperStyleKeys = [
  "alignSelf",
  "bottom",
  "display",
  "end",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "left",
  "margin",
  "marginBlock",
  "marginBlockEnd",
  "marginBlockStart",
  "marginBottom",
  "marginEnd",
  "marginHorizontal",
  "marginInline",
  "marginInlineEnd",
  "marginInlineStart",
  "marginLeft",
  "marginRight",
  "marginStart",
  "marginTop",
  "marginVertical",
  "position",
  "right",
  "start",
  "top",
  "zIndex",
] as const satisfies readonly (keyof ViewStyle)[];

export const wrapperStyleKeySet: ReadonlySet<string> = new Set<string>(
  wrapperStyleKeys,
);

/**
 * `StyleSheet.flatten` for plain styles. RN 0.88 types the parameter with its imprecise
 * *animated* style union, which lags `ViewStyle` (`transitionDuration` gained `string[]`),
 * so a plain style no longer satisfies it even though it is exactly what the runtime wants.
 */
export function flattenViewStyle(style: ViewProps["style"]): ViewStyle {
  return (StyleSheet.flatten(
    style as unknown as Parameters<typeof StyleSheet.flatten>[0],
  ) ?? {}) as ViewStyle;
}

export function splitWrapperStyle(style: ViewProps["style"]) {
  const flattenedStyle = flattenViewStyle(style);
  const wrapperStyle: ViewStyle = {};
  const contentStyle: ViewStyle = { ...flattenedStyle };
  wrapperStyleKeys.forEach((key) => {
    const value = flattenedStyle[key];
    if (value === undefined) return;
    Object.assign(wrapperStyle, { [key]: value });
    delete contentStyle[key];
  });
  mirroredStyleKeys.forEach((key) => {
    const value = flattenedStyle[key];
    if (value === undefined) return;
    Object.assign(wrapperStyle, { [key]: value });
  });
  return { wrapperStyle, contentStyle };
}

/**
 * Reanimated can only carry primitives across to the UI thread. A PlatformColor
 * (Material You) is an opaque object, so a style that swaps one on press has to
 * stay on the JS thread.
 */
export function isWorkletSafe(value: unknown) {
  return typeof value === "number" || typeof value === "string";
}
