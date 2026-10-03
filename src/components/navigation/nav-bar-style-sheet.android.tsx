import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import type { ModalBottomSheetRef } from "@expo/ui/jetpack-compose";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

import { NavBarStyleCard } from "@/components/navigation/nav-bar-style-card";
import {
  NavBarStyleSheetContext,
  type NavBarStyleSheetControls,
} from "@/components/navigation/nav-bar-style-sheet-context";
import { AppText } from "@/components/ui/app-text";
import type { NavBarStyle } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { hapticSelection } from "@/utils/haptics";

/** Material 3 caps a modal bottom sheet at 640dp wide. */
const SHEET_MAX_WIDTH = 640;

/**
 * Owns the "Navigation bar style" bottom sheet so both bars (via long press) and the Appearance row can
 * open the same one. The sheet is a Material 3 `ModalBottomSheet` inside a Compose `Host`; its content
 * is ordinary React Native, hosted through `RNHostView`. Choosing a style applies at once and closes it.
 */
export function NavBarStyleSheetProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const controls = useMemo<NavBarStyleSheetControls>(
    () => ({ available: true, open: () => setVisible(true) }),
    [],
  );
  return (
    <NavBarStyleSheetContext value={controls}>
      {children}
      {visible ? (
        <NavBarStyleSheetContent onClose={() => setVisible(false)} />
      ) : null}
    </NavBarStyleSheetContext>
  );
}

function NavBarStyleSheetContent({ onClose }: { onClose: () => void }) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t, isRtl } = useLocalization();
  const repository = useFinanceRepository();
  const { settings } = useFinanceState();
  const { width: windowWidth } = useWindowDimensions();
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  const current: NavBarStyle = settings.navBarStyle ?? "native";

  const choose = async (next: NavBarStyle) => {
    if (next !== current) {
      hapticSelection();
      try {
        await repository.updateSettings({ navBarStyle: next });
      } catch (reason) {
        showError(
          "Couldn’t apply this setting",
          errorMessage(reason, "Try again."),
        );
        return;
      }
    }
    try {
      await sheetRef.current?.hide();
    } finally {
      onClose();
    }
  };

  return (
    <Host
      matchContents
      layoutDirection={isRtl ? "rightToLeft" : "leftToRight"}
      style={{ position: "absolute" }}
    >
      <ModalBottomSheet
        ref={sheetRef}
        onDismissRequest={onClose}
        containerColor={theme.surface}
        skipPartiallyExpanded
      >
        <RNHostView matchContents>
          <View
            style={{
              // `matchContents` measures the hosted view without a width bound, so the text never
              // wraps and the content overflows the sheet. Pin it to the sheet's width instead.
              width: Math.min(windowWidth, SHEET_MAX_WIDTH),
              gap: space.lg,
              paddingHorizontal: space.lg,
              paddingBottom: space.xxl,
            }}
          >
            <View style={{ gap: space.xs }}>
              <AppText variant="headline" accessibilityRole="header">
                Navigation bar style
              </AppText>
              <AppText variant="caption" muted>
                Choose how the bottom bar looks. Press and hold the bar any time
                to change it.
              </AppText>
            </View>
            <View
              accessibilityLabel={t("Navigation bar style")}
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", gap: space.md }}
            >
              <NavBarStyleCard
                style="native"
                label="Native"
                caption="Docked to the bottom edge, drawn by Android."
                selected={current === "native"}
                onPress={() => void choose("native")}
              />
              <NavBarStyleCard
                style="floating"
                label="Floating"
                caption="A rounded bar that floats above your content."
                selected={current === "floating"}
                onPress={() => void choose("floating")}
              />
            </View>
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
