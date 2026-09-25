import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { MotionView } from '@/components/ui/motion';
import { StickyFooterLayout } from '@/components/ui/sticky-footer';
import { SETUP_STEPS } from '@/features/onboarding/use-onboarding-flow';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

/**
 * The frame every onboarding step sits in: a quiet top bar (back, progress),
 * one centred column of content, and the step's actions pinned to the bottom
 * where a thumb already is — never scrolled away under the keyboard.
 */
export function OnboardingShell({
  stepKey,
  direction,
  progress,
  onBack,
  footer,
  children,
}: {
  /** Changes whenever the step does, so the content slides. */
  stepKey: string;
  direction: 'forward' | 'back';
  /** 1-based position among the numbered steps, or 0 to hide the progress bar. */
  progress: number;
  onBack?: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const theme = useQashyTheme();
  const { isRtl, t } = useLocalization();
  const insets = useSafeAreaInsets();
  // Content arrives from the side it is heading toward: forward pushes in from
  // the trailing edge, which is the left edge in a right-to-left language.
  const fromTrailing = (direction === 'forward') !== isRtl;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, gap: space.sm, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        <View style={{ width: 44 }}>
          {onBack ? (
            <IconButton label="Back" icon={isRtl ? 'chevron.right' : 'chevron.left'} iconSize={20} onPress={onBack} enteringVariant="fade" />
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          {progress > 0 ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={t(`Step ${progress} of ${SETUP_STEPS.length}`)}
              accessibilityValue={{ min: 1, max: SETUP_STEPS.length, now: progress }}
              style={{ flexDirection: 'row', gap: space.xs, width: '100%', maxWidth: 220 }}>
              {SETUP_STEPS.map((step, index) => (
                <View key={step} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: theme.surfaceMuted, overflow: 'hidden' }}>
                  {index < progress ? (
                    <MotionView key={`${step}-${index < progress}`} variant="fade" style={{ flex: 1, backgroundColor: theme.accent }} />
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <View style={{ width: 44, alignItems: 'flex-end' }}>
          {progress > 0 ? (
            <AppText literal variant="caption" muted numeric>{`${progress}/${SETUP_STEPS.length}`}</AppText>
          ) : null}
        </View>
      </View>

      <StickyFooterLayout footer={footer}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xxl, paddingVertical: space.xl }}>
          <MotionView
            key={stepKey}
            variant={fromTrailing ? 'right' : 'left'}
            exit
            style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: space.xxl }}>
            {children}
          </MotionView>
        </ScrollView>
      </StickyFooterLayout>
    </View>
  );
}

/** A step's heading block. One title, one sentence of why. */
export function StepHeading({ title, body }: { title: string; body?: string }) {
  const headingLevelProps = process.env.EXPO_OS === 'web' ? ({ 'aria-level': 1 } as object) : {};
  return (
    <View style={{ gap: space.sm }}>
      <AppText {...headingLevelProps} accessibilityRole="header" variant="title">{title}</AppText>
      {body ? <AppText muted>{body}</AppText> : null}
    </View>
  );
}
