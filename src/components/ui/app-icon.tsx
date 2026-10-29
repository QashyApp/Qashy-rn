// Deep import on purpose. The `@expo/vector-icons` barrel drags every font family
// it exports into the bundle — 18 TTFs, ~2.5MB — even though only Ionicons is used,
// and on web all of that lands in the offline precache too.
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, View, type ColorValue } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { useLocalization } from "@/localization/localization";
import { resolveIconRenderById } from "@/theme/icon-sets";
import { useQashyTheme } from "@/theme/theme";

// Not in react-native-svg's Path typings; the web shim forwards it as the SVG attribute, native ignores it.
const CRISP = { shapeRendering: "crispEdges" } as object;
const MIRROR = { transform: [{ scaleX: -1 }] } as const;

type AppIconProps = {
  name: string;
  color: ColorValue;
  size?: number;
  /**
   * `ui` draws chrome (navigation, buttons, menus) with the theme's UI icon set; `category`
   * draws an entity's own icon (category, account, goal) with the category set.
   */
  role?: "ui" | "category";
  /** Draw with this registered set instead of the theme's (the appearance pickers' previews). */
  iconSetId?: string;
  /**
   * Flip the glyph horizontally in a right-to-left language. Set it on a *directional* icon that
   * is drawn in a fixed pointing direction (a forward chevron or arrow); leave it off for
   * symmetric icons and for icons whose name is already swapped by direction.
   */
  mirrorInRtl?: boolean;
};

/**
 * The stored icon id (`ion:<glyph>`, `emoji:<char>`, a legacy name) is replicated data and never
 * changes. Which glyph set DRAWS it is a per-device theme choice: `emoji:` ids always render the
 * emoji, and any glyph the active set does not cover falls back to Ionicons.
 */
export function AppIcon({ mirrorInRtl = false, ...props }: AppIconProps) {
  // Only a directional icon reads the language, so the many symmetric icons stay context-free.
  return mirrorInRtl ? (
    <RtlMirroredIcon {...props} />
  ) : (
    <GlyphIcon {...props} />
  );
}

function RtlMirroredIcon(props: Omit<AppIconProps, "mirrorInRtl">) {
  const { isRtl } = useLocalization();
  return <GlyphIcon {...props} mirror={isRtl} />;
}

function GlyphIcon({
  name,
  color,
  size = 20,
  role = "ui",
  iconSetId,
  mirror: flip = false,
}: Omit<AppIconProps, "mirrorInRtl"> & { mirror?: boolean }) {
  const { iconSet, categoryIconSet } = useQashyTheme();
  const mirror = flip ? MIRROR : undefined;
  const render = resolveIconRenderById(
    name,
    iconSetId ? iconSetId : role === "category" ? categoryIconSet : iconSet,
  );
  if (render.kind === "emoji") {
    // Emoji carry their own colors, so the tint is deliberately ignored.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          ...mirror,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: size * 0.85,
            lineHeight: size,
            textAlign: "center",
          }}
        >
          {render.emoji}
        </Text>
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        ...mirror,
      }}
    >
      {render.kind === "svg" ? (
        <Svg width={size} height={size} viewBox={render.viewBox}>
          {render.paths.map((path) => (
            <Path
              key={path.d}
              d={path.d}
              fill={color}
              fillRule={path.fillRule}
              {...CRISP}
            />
          ))}
        </Svg>
      ) : render.kind === "color-svg" ? (
        <Svg width={size} height={size} viewBox={render.viewBox}>
          {render.shapes.map((shape, index) => {
            const { fill, opacity } = shape.a;
            const common = { fill, opacity };
            switch (shape.t) {
              case "circle":
                return (
                  <Circle
                    key={index}
                    cx={shape.a.cx}
                    cy={shape.a.cy}
                    r={shape.a.r}
                    {...common}
                  />
                );
              case "ellipse":
                return (
                  <Ellipse
                    key={index}
                    cx={shape.a.cx}
                    cy={shape.a.cy}
                    rx={shape.a.rx}
                    ry={shape.a.ry}
                    {...common}
                  />
                );
              case "rect":
                return (
                  <Rect
                    key={index}
                    x={shape.a.x}
                    y={shape.a.y}
                    width={shape.a.width}
                    height={shape.a.height}
                    rx={shape.a.rx}
                    ry={shape.a.ry}
                    {...common}
                  />
                );
              default:
                return (
                  <Path
                    key={index}
                    d={shape.a.d}
                    fillRule={
                      shape.a["fill-rule"] === "evenodd" ? "evenodd" : undefined
                    }
                    {...common}
                  />
                );
            }
          })}
        </Svg>
      ) : render.kind === "material" ? (
        <MaterialIcons name={render.name} size={size} color={color as string} />
      ) : (
        <Ionicons name={render.name} size={size} color={color as string} />
      )}
    </View>
  );
}
