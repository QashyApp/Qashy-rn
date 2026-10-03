import { Platform, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion';
import { StatusPill } from '@/components/ui/status-pill';
import { TextButton } from '@/components/ui/text-button';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { accentTokens, useQashyTheme } from '@/theme/theme';
import { listAvailableThemes } from '@/theme/themes/registry';
import type { ThemeDefinition } from '@/theme/themes/types';
import { fontStyle } from '@/theme/typography';
import { hapticSelection } from '@/utils/haptics';

/**
 * One-line descriptions of the built-in themes, keyed by `theme.id`. They are English UI copy,
 * translated through `t` like every other string; a custom theme has no entry and shows its name only.
 * Keep these free of the words "light"/"dark" so a theme is never confused with the mode radios.
 */
const THEME_DESCRIPTIONS: Record<string, string> = {
  classic: 'Soft, tactile surfaces with a calm indigo accent.',
  'material-you': 'Rounded Material surfaces that follow your Android system colors.',
  'high-contrast': 'Maximum contrast and bold edges for easy reading.',
};

/**
 * Whether the user's accent choice applies to `theme`. `system` only differs from `fixed` on
 * Android, where the platform supplies the accent; anywhere else it falls back to the theme's own.
 */
export function effectiveAccentMode(theme: ThemeDefinition, os: string = Platform.OS): 'user' | 'fixed' | 'system' {
  if (theme.accent.mode === 'system' && os !== 'android') return 'fixed';
  return theme.accent.mode;
}

export function themeDescription(theme: ThemeDefinition): string | undefined {
  return THEME_DESCRIPTIONS[theme.id];
}

/**
 * A theme drawn from its own data, without switching the app: a mini page, a raised card and an
 * accent button built from `accentTokens(theme.accent.default, dark, theme)`, set in the theme's own
 * type face and corner radius. No icons: `AppIcon` always reads the *active* theme.
 */
export function ThemePreviewCard({
  theme,
  selected,
  dark,
  onPress,
  custom = false,
  stacked = false,
}: {
  theme: ThemeDefinition;
  selected: boolean;
  dark: boolean;
  onPress: () => void;
  /** A user-authored theme: its name is data (shown as written) and it carries a "Custom" badge. */
  custom?: boolean;
  /** The card sits in a column wrapper (with actions beneath) instead of directly in the wrapping row. */
  stacked?: boolean;
}) {
  const app = useQashyTheme();
  const { t } = useLocalization();
  const preview = accentTokens(theme.accent.default, dark, theme);
  const description = themeDescription(theme);
  const name = t(theme.name);
  const label = [name, custom ? t('Custom') : undefined, description ? t(description) : undefined].filter(Boolean).join('. ');
  return (
    <MotionPressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      active={selected}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      pressedScale={0.97}
      hoverScale={1.02}
      style={{
        flexGrow: stacked ? 0 : 1,
        flexBasis: stacked ? 'auto' : 150,
        minWidth: stacked ? 0 : 140,
        minHeight: 44,
        padding: app.space.sm,
        gap: app.space.sm,
        borderRadius: app.radius.card,
        borderCurve: 'continuous',
        // Selection is a thicker accent border plus the checkmark below, never color alone.
        borderWidth: selected ? 3 : 1,
        borderColor: selected ? app.accent : app.border,
        backgroundColor: app.surface,
      }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          backgroundColor: preview.background,
          padding: app.space.sm,
          gap: app.space.sm,
          borderRadius: theme.radius.card,
          borderCurve: 'continuous',
        }}>
        <View style={[{ padding: app.space.sm, gap: 2, borderRadius: theme.radius.control, borderCurve: 'continuous' }, materialStyle(preview, 'card')]}>
          <Text selectable={false} style={[fontStyle('semibold', theme.type), { fontSize: 14, color: preview.text }]}>{name}</Text>
          <Text selectable={false} style={[fontStyle('regular', theme.type), { fontSize: 11, color: preview.textMuted }]}>$1,284.35</Text>
        </View>
        <View
          style={[
            { alignSelf: 'flex-start', minHeight: 22, paddingHorizontal: app.space.md, justifyContent: 'center', borderRadius: theme.radius.pill, borderCurve: 'continuous', backgroundColor: preview.accent },
            { boxShadow: preview.shadowAccent },
          ]}>
          <Text selectable={false} style={[fontStyle('medium', theme.type), { fontSize: 11, color: preview.onAccent }]}>Aa</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: app.space.xs }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="label" literal>{name}</AppText>
          {description ? <AppText variant="caption" muted>{description}</AppText> : null}
          {custom ? <View style={{ alignSelf: 'flex-start' }}><StatusPill label="Custom" icon="paintbrush" /></View> : null}
        </View>
        <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <AppIcon name="checkmark" color={app.accent} size={18} /> : null}
        </View>
      </View>
    </MotionPressable>
  );
}

/** The theme choice: a radiogroup of live preview cards. Used by Appearance and onboarding. */
export function ThemePicker({
  value,
  onChange,
  themes,
  dark,
  customIds,
  onDelete,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Defaults to every theme this platform offers. */
  themes?: readonly ThemeDefinition[];
  /** Which scheme to preview; defaults to the app's current one. */
  dark?: boolean;
  /** Ids of user-authored themes: they get a "Custom" badge, and a Delete action when `onDelete` is set. */
  customIds?: readonly string[];
  onDelete?: (id: string) => void;
}) {
  const app = useQashyTheme();
  const { t } = useLocalization();
  const list = themes ?? listAvailableThemes();
  const previewDark = dark ?? app.mode === 'dark';
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Theme')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: app.space.md }}>
      {list.map((theme) => {
        const custom = customIds?.includes(theme.id) ?? false;
        const card = (
          <ThemePreviewCard
            key={theme.id}
            theme={theme}
            selected={theme.id === value}
            dark={previewDark}
            custom={custom}
            stacked={custom && Boolean(onDelete)}
            onPress={() => onChange(theme.id)}
          />
        );
        if (!custom || !onDelete) return card;
        return (
          <View key={theme.id} style={{ flexGrow: 1, flexBasis: 150, minWidth: 140, gap: app.space.xs }}>
            {card}
            <TextButton
              title="Delete theme"
              icon="trash"
              tone="danger"
              accessibilityLabel={`${t('Delete theme')}: ${theme.name}`}
              onPress={() => onDelete(theme.id)}
              style={{ alignSelf: 'flex-start' }}
            />
          </View>
        );
      })}
    </View>
  );
}
