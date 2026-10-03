import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { useQashyTheme } from "@/theme/theme";

/**
 * The document heading for a section, on web only.
 *
 * Native deliberately renders nothing: the section stack shows a real navigation
 * header with the same title, and drawing a second one in the content would
 * stack two titles on top of each other. This is not a stub — it is the web half
 * of a heading that the platform supplies natively.
 */
export function PageHeading({
  title,
  subtitle,
  overline,
}: {
  title: string;
  subtitle?: string;
  /** A short sentence-case kicker above the title. */
  overline?: string;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  if (process.env.EXPO_OS !== "web") return null;
  const headingLevelProps = { "aria-level": 1 } as object;
  return (
    <View style={{ gap: space.xxs }}>
      {overline ? (
        <AppText
          variant="overline"
          style={{ color: theme.textMuted, paddingBottom: space.xxs }}
        >
          {overline}
        </AppText>
      ) : null}
      <AppText
        {...headingLevelProps}
        accessibilityRole="header"
        role="heading"
        variant="title"
      >
        {title}
      </AppText>
      {subtitle ? <AppText muted>{subtitle}</AppText> : null}
    </View>
  );
}
