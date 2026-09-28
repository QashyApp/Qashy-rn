import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { MotionView } from '@/components/ui/motion';
import { LanguageSelector } from '@/components/ui/language-selector';
import { WelcomeHero } from '@/features/onboarding/steps/welcome-hero';
import { space } from '@/theme/tokens';

/**
 * The first screen. One mark, one line of promise, and the only choice that
 * has to come before everything else: which language the rest of setup
 * speaks. Everything else waits for the steps that need it.
 */
export function WelcomeStep({ locale, onLocale }: { locale: string; onLocale: (locale: string) => void }) {
  const headingLevelProps = process.env.EXPO_OS === 'web' ? ({ 'aria-level': 1 } as object) : {};
  return (
    <View style={{ gap: space.xxl, alignItems: 'center' }}>
      <MotionView variant="zoom" duration={360}>
        <WelcomeHero />
      </MotionView>
      <MotionView variant="up" delay={120} style={{ gap: space.sm, alignItems: 'center' }}>
        <AppText {...headingLevelProps} accessibilityRole="header" variant="title" style={{ textAlign: 'center', fontSize: 34, lineHeight: 40 }}>
          Money, made calmer.
        </AppText>
        <AppText muted style={{ textAlign: 'center', maxWidth: 360 }}>
          Budgets, goals and everyday spending — kept private on your own devices.
        </AppText>
      </MotionView>
      <MotionView variant="up" delay={220} style={{ width: '100%', maxWidth: 280, gap: space.sm }}>
        <LanguageSelector value={locale} onChange={onLocale} />
      </MotionView>
    </View>
  );
}
