// Deep import on purpose. The `@expo/vector-icons` barrel drags every font family
// it exports into the bundle — 18 TTFs, ~2.5MB — even though only Ionicons is used,
// and on web all of that lands in the offline precache too.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Text, View, type ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

import { resolveIconRender } from "@/theme/icon-sets";
import { useQashyTheme } from "@/theme/theme";
import { parseIconId } from "@/utils/icon-id";

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
}: {
  name: string;
  color: ColorValue;
  size?: number;
}) {
  const { iconSet } = useQashyTheme();
  const render = resolveIconRender(
    parseIconId(name),
    iconSet,
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
      ) : (
        <Ionicons name={render.name} size={size} color={color} />
      )}
    </View>
  );
}
