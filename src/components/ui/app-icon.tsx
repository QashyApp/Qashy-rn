// Deep import on purpose. The `@expo/vector-icons` barrel drags every font family
// it exports into the bundle — 18 TTFs, ~2.5MB — even though only Ionicons is used,
// and on web all of that lands in the offline precache too.
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { Text, View, type ColorValue } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { resolveIconRenderById } from "@/theme/icon-sets";
import { useQashyTheme } from "@/theme/theme";

// Not in react-native-svg's Path typings; the web shim forwards it as the SVG attribute, native ignores it.
const CRISP = { shapeRendering: "crispEdges" } as object;

/**
 * The stored icon id (`ion:<glyph>`, `emoji:<char>`, a legacy name) is replicated data and never
 * changes. Which glyph set DRAWS it is a per-device theme choice: `emoji:` ids always render the
 * emoji, and any glyph the active set does not cover falls back to Ionicons.
 */
export function AppIcon({
  name,
  color,
  size = 20,
  role = "ui",
  iconSetId,
}: {
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
}) {
  const { iconSet, categoryIconSet } = useQashyTheme();
  const render = resolveIconRenderById(
    name,
    iconSetId ? iconSetId : role === "category" ? categoryIconSet : iconSet,
    process.env.EXPO_OS === "ios",
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
  if (render.kind === "sf") {
    return (
      <Image
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        source={`sf:${render.name}`}
        tintColor={color as string}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
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
        <MaterialIcons name={render.name} size={size} color={color} />
      ) : (
        <Ionicons name={render.name} size={size} color={color} />
      )}
    </View>
  );
}
