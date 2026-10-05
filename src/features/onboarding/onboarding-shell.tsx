import { type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalculatorHost } from "@/components/finance/calculator-host";
import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { MotionView } from "@/components/ui/motion";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StickyFooterLayout } from "@/components/ui/sticky-footer";
import { SETUP_STEPS } from "@/features/onboarding/use-onboarding-flow";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";

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
  direction: "forward" | "back";
  /** 1-based position among the numbered steps, or 0 to hide the progress bar. */
  progress: number;
  onBack?: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { isRtl, t } = useLocalization();
  const insets = useSafeAreaInsets();
  // Content arrives from the side it is heading toward: forward pushes in from
  // the trailing edge, which is the left edge in a right-to-left language.
  const fromTrailing = (direction === "forward") !== isRtl;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top,
      }}
    >
      <View
        style={{
          paddingTop: space.sm,
          paddingHorizontal: space.sm,
          gap: space.xs,
          width: "100%",
          maxWidth: 600,
          alignSelf: "center",
        }}
      >
        <View
          style={{
            height: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          <View style={{ width: 44 }}>
            {onBack ? (
              <IconButton
                label="Back"
                icon={isRtl ? "chevron.right" : "chevron.left"}
                iconSize={20}
                onPress={onBack}
                enteringVariant="fade"
              />
            ) : null}
          </View>
          <View style={{ flex: 1, alignItems: "center" }}>
            {progress > 0 ? (
              <View style={{ width: "100%", maxWidth: 260 }}>
                <ProgressBar
                  value={progress / SETUP_STEPS.length}
                  segments={SETUP_STEPS.length}
                  size="thin"
                  label={t(`Step ${progress} of ${SETUP_STEPS.length}`)}
                />
              </View>
            ) : null}
          </View>
          <View style={{ width: 44 }} />
        </View>
        {progress > 0 ? (
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center" }}
          >{`Step ${progress} of ${SETUP_STEPS.length}`}</AppText>
        ) : null}
      </View>

      <StickyFooterLayout footer={footer}>
        <CalculatorHost>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingHorizontal: space.xxl,
              paddingVertical: space.xl,
            }}
          >
            <MotionView
              key={stepKey}
              variant={fromTrailing ? "right" : "left"}
              exit
              style={{
                width: "100%",
                maxWidth: 520,
                alignSelf: "center",
                gap: space.xxl,
              }}
            >
              {children}
            </MotionView>
          </ScrollView>
        </CalculatorHost>
      </StickyFooterLayout>
    </View>
  );
}

/** A step's heading block. One title, one sentence of why. */
export function StepHeading({ title, body }: { title: string; body?: string }) {
  const { space } = useQashyTheme();
  const headingLevelProps =
    process.env.EXPO_OS === "web" ? ({ "aria-level": 1 } as object) : {};
  return (
    <View style={{ gap: space.sm }}>
      <AppText
        {...headingLevelProps}
        accessibilityRole="header"
        variant="title"
      >
        {title}
      </AppText>
      {body ? <AppText muted>{body}</AppText> : null}
    </View>
  );
}
