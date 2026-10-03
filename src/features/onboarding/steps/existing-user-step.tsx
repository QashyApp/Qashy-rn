import { router } from 'expo-router';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion';
import { StepHeading } from '@/features/onboarding/onboarding-shell';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';

/**
 * "I already use Qashy". There is no account to sign in to — the data lives on
 * the user's other device or in a backup file they made — so the two honest
 * options are to fetch it from one of those.
 */
export function ExistingUserStep() {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.xxl }}>
      <StepHeading
        title="Welcome back"
        body="Your data isn’t stored anywhere but your own devices, so bring it over from one of them."
      />
      <View style={{ gap: space.md }}>
        <Option
          icon="qrcode.viewfinder"
          title="Pair with another device"
          body="Scan a code shown on a phone or computer that already has Qashy set up."
          onPress={() => router.push({ pathname: '/sync-pair', params: { onboarding: '1' } })}
        />
        <Option
          icon="square.and.arrow.down"
          title="Restore from a backup file"
          body="Open a .qashyvault file you saved earlier."
          onPress={() => router.push({ pathname: '/sync-transfer', params: { onboarding: '1' } })}
        />
      </View>
    </View>
  );
}

function Option({ icon, title, body, onPress }: { icon: string; title: string; body: string; onPress: () => void }) {
  const theme = useQashyTheme();
  const { radius, space, tile } = theme;
  const { isRtl, t } = useLocalization();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={t(title)}
      accessibilityHint={t(body)}
      onPress={onPress}
      pressedScale={0.98}
      hoverScale={1.01}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.lg,
        padding: space.lg,
        borderRadius: radius.card,
        borderCurve: 'continuous',
        ...materialStyle(theme, 'card'),
        opacity: pressed ? 0.8 : 1,
      })}>
      <View style={{ width: tile.size + 4, height: tile.size + 4, borderRadius: radius.tile, borderCurve: 'continuous', backgroundColor: theme.accentContainer, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name={icon} color={theme.onAccentContainer} size={tile.icon + 2} />
      </View>
      <View style={{ flex: 1, gap: space.xxs }}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" muted>{body}</AppText>
      </View>
      <AppIcon name={isRtl ? 'chevron.left' : 'chevron.right'} color={theme.textMuted} size={18} />
    </MotionPressable>
  );
}
