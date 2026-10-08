import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { BackHandler, Keyboard, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  resolveSheetRelease,
  sheetSpring,
} from "@/components/navigation/sheet-snap";
import {
  SheetShellContext,
  type SheetShell,
} from "@/components/navigation/sheet-shell-context";
import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { useQashyTheme } from "@/theme/theme";

/**
 * Route options for a creation/editing sheet on Android.
 *
 * Android's native form sheet cannot be restyled or re-timed without modifying react-native-screens,
 * which this project does not do. The route is presented as a transparent modal with no native
 * transition instead, and `AndroidSheet` (mounted by the root stack's `screenLayout`) draws and
 * animates the sheet itself.
 */
export const ANDROID_SHEET_OPTIONS = {
  headerShown: false,
  presentation: "transparentModal" as const,
  animation: "none" as const,
  contentStyle: { backgroundColor: "transparent" },
};

/** Whether a screen's resolved options are the Android sheet's. */
export function hasAndroidSheetOptions(options: {
  presentation?: string;
  animation?: string;
}) {
  return (
    options.presentation === ANDROID_SHEET_OPTIONS.presentation &&
    options.animation === ANDROID_SHEET_OPTIONS.animation
  );
}

/** The sheet's resting heights as fractions of the screen; the larger is reached by dragging up. */
const COLLAPSED_FRACTION = 0.72;
/** Material 3 caps a modal bottom sheet at 640dp wide. */
const MAX_WIDTH = 640;

/** Rises like a flung sheet: off the mark at once, then settling softly (about 0.56 s). */
const enterSpring = {
  ...sheetSpring(0.86, 560),
  reduceMotion: ReduceMotion.System,
};
/** Leaves by accelerating away (Material's emphasized-accelerate), faster than it arrived. */
const EXIT_MS = 240;
const exitEasing = Easing.bezier(0.3, 0, 0.8, 0.15);
const settleSpring = {
  mass: 1,
  stiffness: 400,
  damping: 36,
  reduceMotion: ReduceMotion.System,
} as const;

interface SheetNavigation {
  goBack: () => void;
  isFocused: () => boolean;
}

/**
 * A bottom sheet for Android's creation/editing routes: a scrim, a rounded panel with a grabber and
 * a title row, and the screen inside. It opens at 72% of the screen and can be dragged up to full
 * height or down to close; the scrim, the close button and the hardware back button close it too.
 *
 * What the native sheet did for free and this keeps: the grabber, the two heights, swipe-to-close,
 * keeping the panel above the keyboard, and the confirmation for unsaved work (`useFormSheet`).
 */
export function AndroidSheet({
  title,
  navigation,
  children,
}: {
  title: string | undefined;
  navigation: SheetNavigation;
  children: ReactNode;
}) {
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const insets = useSafeAreaInsets();
  const level = useAnimationLevel();

  const [area, setArea] = useState(0);
  // The keyboard is measured against the sheet's own window frame, not by its raw height. With
  // adjustResize (or an edge-to-edge resize) the window has already shrunk to the keyboard's top
  // edge, so the overlap is 0; when the window is not resized, the overlap is the part of the
  // frame the keyboard covers. Subtracting the raw height would count that space twice in the
  // resized case.
  const frameRef = useRef<View>(null);
  const [frameBottom, setFrameBottom] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow((_x, y, _width, height) =>
      setFrameBottom(y + height),
    );
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
      measureFrame();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardTop(null),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measureFrame]);
  const keyboard =
    keyboardTop === null ? 0 : Math.max(0, frameBottom - keyboardTop);

  const expandedHeight = Math.max(0, area - keyboard - insets.top);
  const collapsedHeight = Math.min(
    Math.round(area * COLLAPSED_FRACTION),
    expandedHeight,
  );

  // 0 = off the bottom edge, 1 = in place.
  const progress = useSharedValue(0);
  // The panel's resting height, and how far a drag in progress has moved it (positive is down).
  const detentHeight = useSharedValue(0);
  const drag = useSharedValue(0);
  const maxHeight = useSharedValue(0);
  const collapsedShared = useSharedValue(0);
  const guardedShared = useSharedValue(false);

  // Flags the gesture and the close paths share; none of them is rendered, so they are shared values.
  const expandedFlag = useSharedValue(false);
  const closingFlag = useSharedValue(false);
  const shownFlag = useSharedValue(false);

  useEffect(() => {
    maxHeight.set(expandedHeight);
    collapsedShared.set(collapsedHeight);
    detentHeight.set(expandedFlag.get() ? expandedHeight : collapsedHeight);
  }, [
    expandedHeight,
    collapsedHeight,
    maxHeight,
    collapsedShared,
    detentHeight,
    expandedFlag,
  ]);

  const animate = useCallback(
    (show: boolean, done?: () => void) => {
      const finish = (finished?: boolean) => {
        "worklet";
        if (finished && done) runOnJS(done)();
      };
      if (level === "off") {
        progress.set(show ? 1 : 0);
        done?.();
        return;
      }
      if (level === "minimal") {
        progress.set(
          withTiming(
            show ? 1 : 0,
            { duration: 120, reduceMotion: ReduceMotion.System },
            finish,
          ),
        );
        return;
      }
      progress.set(
        show
          ? withSpring(1, enterSpring, finish)
          : withTiming(
              0,
              {
                duration: EXIT_MS,
                easing: exitEasing,
                reduceMotion: ReduceMotion.System,
              },
              finish,
            ),
      );
    },
    [level, progress],
  );

  // The slide starts once the panel's height is known, so none of it plays out unmeasured.
  useEffect(() => {
    if (area > 0 && !shownFlag.get()) {
      shownFlag.set(true);
      animate(true);
    }
  }, [area, animate, shownFlag]);

  const exit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        closingFlag.set(true);
        animate(false, resolve);
      }),
    [animate, closingFlag],
  );

  const requestClose = useCallback(() => {
    if (closingFlag.get()) return;
    // Unsaved work: the screen asks first, and leaves through `exit` if the answer is to discard.
    if (guardedShared.get()) {
      navigation.goBack();
      return;
    }
    void exit().then(() => navigation.goBack());
  }, [exit, navigation, closingFlag, guardedShared]);

  const latestClose = useRef(requestClose);
  useEffect(() => {
    latestClose.current = requestClose;
  }, [requestClose]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!navigation.isFocused()) return false;
        latestClose.current();
        return true;
      },
    );
    return () => subscription.remove();
  }, [navigation]);

  const shell = useMemo<SheetShell>(
    () => ({
      exit,
      setGuarded: (next) => {
        guardedShared.set(next);
      },
    }),
    [exit, guardedShared],
  );

  // Leaves for good once a swipe has carried the sheet off screen.
  const dismissNow = useCallback(() => {
    closingFlag.set(true);
    navigation.goBack();
  }, [navigation, closingFlag]);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      drag.set(event.translationY);
    })
    .onEnd((event) => {
      const base = detentHeight.get();
      const top = maxHeight.get();
      const height = Math.min(top, Math.max(0, base - Math.min(drag.get(), 0)));
      const visible = height - Math.max(drag.get(), 0);
      const release = resolveSheetRelease({
        visible,
        velocityY: event.velocityY,
        collapsed: collapsedShared.get(),
        expanded: top,
      });
      if (release.kind === "dismiss") {
        if (guardedShared.get()) {
          // The screen confirms first; until it says so the sheet stays where it was.
          drag.set(withSpring(0, settleSpring));
          runOnJS(requestClose)();
          return;
        }
        drag.set(
          withTiming(height, { duration: EXIT_MS, easing: exitEasing }, () => {
            runOnJS(dismissNow)();
          }),
        );
        return;
      }
      // Fold the drag into the resting height without moving anything, then settle on the detent.
      detentHeight.set(height);
      drag.set(0);
      const target =
        release.detent === "expanded" ? top : collapsedShared.get();
      detentHeight.set(withSpring(target, settleSpring));
      expandedFlag.set(release.detent === "expanded");
    });

  const scrimStyle = useAnimatedStyle(() => {
    const height = Math.max(detentHeight.get(), 1);
    const pulled = Math.min(Math.max(drag.get() / height, 0), 1);
    return { opacity: progress.get() * (1 - pulled) };
  });
  const panelStyle = useAnimatedStyle(() => {
    const height = Math.min(
      maxHeight.get(),
      Math.max(0, detentHeight.get() - Math.min(drag.get(), 0)),
    );
    return {
      height,
      opacity: height === 0 ? 0 : 1,
      transform: [
        {
          translateY: Math.max(drag.get(), 0) + (1 - progress.get()) * height,
        },
      ],
    };
  });

  return (
    <SheetShellContext value={shell}>
      <View
        ref={frameRef}
        style={{ flex: 1 }}
        onLayout={(event) => {
          setArea(event.nativeEvent.layout.height);
          measureFrame();
        }}
      >
        <Animated.View
          style={[
            { position: "absolute", inset: 0, backgroundColor: theme.scrim },
            scrimStyle,
          ]}
        >
          {/* A pointer-only target: the close button is the one labeled control for screen readers. */}
          <Pressable
            testID="android-sheet-scrim"
            accessible={false}
            importantForAccessibility="no"
            accessibilityElementsHidden
            onPress={requestClose}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            justifyContent: "flex-end",
            alignItems: "center",
            paddingBottom: keyboard,
          }}
        >
          <Animated.View
            role="dialog"
            accessibilityLabel={title || undefined}
            accessibilityViewIsModal
            importantForAccessibility="yes"
            style={[
              {
                width: "100%",
                maxWidth: MAX_WIDTH,
                borderTopLeftRadius: radius.sheet,
                borderTopRightRadius: radius.sheet,
                borderCurve: "continuous",
                overflow: "hidden",
              },
              { backgroundColor: theme.background },
              panelStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View
                collapsable={false}
                style={{
                  alignItems: "center",
                  paddingTop: space.sm,
                  paddingHorizontal: space.lg,
                  paddingBottom: space.xs,
                  gap: space.xs,
                }}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: radius.pill,
                    backgroundColor: theme.border,
                  }}
                />
                <View
                  style={{
                    alignSelf: "stretch",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: space.sm,
                    minHeight: 48,
                  }}
                >
                  <AppText
                    literal
                    variant="title"
                    accessibilityRole="header"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {title ?? ""}
                  </AppText>
                  <IconButton
                    label="Close"
                    icon="xmark"
                    onPress={requestClose}
                  />
                </View>
              </View>
            </GestureDetector>
            <View
              style={{
                flex: 1,
                paddingBottom: keyboard > 0 ? 0 : insets.bottom,
              }}
            >
              {children}
            </View>
          </Animated.View>
        </View>
      </View>
    </SheetShellContext>
  );
}

/**
 * The root stack's `screenLayout`: puts the creation/editing screens in the Android sheet and leaves
 * every other screen, on every platform, as it was.
 */
export function sheetScreenLayout({
  options,
  navigation,
  children,
}: {
  options: { presentation?: string; animation?: string; title?: string };
  navigation: SheetNavigation;
  children: ReactElement;
}): ReactElement {
  if (process.env.EXPO_OS !== "android" || !hasAndroidSheetOptions(options))
    return children;
  return (
    <AndroidSheet title={options.title} navigation={navigation}>
      {children}
    </AndroidSheet>
  );
}
