import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  View,
  type HostInstance,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  resolveSheetRelease,
  sheetDismissTiming,
  sheetSpring,
} from "@/components/navigation/sheet-snap";
import {
  SheetBodyContext,
  type SheetBody,
} from "@/components/navigation/sheet-body-context";
import {
  SheetShellContext,
  type SheetShell,
} from "@/components/navigation/sheet-shell-context";
import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { motionCurves, useMotionPreference } from "@/components/ui/motion";
import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { useQashyTheme } from "@/theme/theme";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";

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

/** Rises like a flung sheet: off the mark at once, then settling softly (about 0.38 s). */
const enterSpring = {
  ...sheetSpring(0.9, 380),
  reduceMotion: ReduceMotion.System,
};
/** Leaves by accelerating away (Material's emphasized-accelerate), faster than it arrived. */
const EXIT_MS = 240;
const exitEasing = Easing.bezier(0.3, 0, 0.8, 0.15);
/** The panel following the keyboard (or the window resizing around it): a short glide, no spring. */
const KEYBOARD_MS = 240;
/** Below the full animation level the sheet only fades in and out. */
const FADE_MS = 120;
/** Snapping to a detent (or springing back). Animations Off is added where it is used (`settle`). */
const settleSpring = {
  mass: 1,
  stiffness: 400,
  damping: 36,
} as const;

/** A body drag starts once the finger has moved this far vertically (px), like the header's pan. */
const BODY_ACTIVE_OFFSET = 10;
/** A mostly horizontal swipe (a chip row, a slider) is not a sheet drag: the body pan gives up. */
const BODY_FAIL_OFFSET = 24;
/** Within this many px of the top detent the sheet counts as fully open. */
const DETENT_EPSILON = 1;

// How the body pan stands in the drag in progress (a shared value, read on the UI thread).
/** Not dragging the sheet: the scroll view has the touch. */
const BODY_IDLE = 0;
/** Active, but the first movement has not been seen yet, so the mode is not chosen. */
const BODY_PENDING = 1;
/** Sheet fully open: it only follows a pull down that starts (or arrives) at the top of the content. */
const BODY_CLAMPED = 2;
/** Sheet below its top detent: it follows the finger both ways, like the header. */
const BODY_FREE = 3;

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
  const { instant, travel } = useMotionPreference();

  const [area, setArea] = useState(0);
  // The keyboard is measured against the sheet's own window frame, not by its raw height. With
  // adjustResize (or an edge-to-edge resize) the window has already shrunk to the keyboard's top
  // edge, so the overlap is 0; when the window is not resized, the overlap is the part of the
  // frame the keyboard covers. Subtracting the raw height would count that space twice in the
  // resized case.
  const frameRef = useRef<HostInstance>(null);
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

  // The body's scroll hand-off (see `SheetBody`): its content offset, whether a scroll view has
  // registered, and the state of the body pan.
  const scrollY = useSharedValue(0);
  const scrollRegistered = useSharedValue(false);
  const bodyMode = useSharedValue(BODY_IDLE);
  const bodyOrigin = useSharedValue(0);
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  // Mirrors `expandedFlag` for rendering: the scroll view only scrolls once the sheet is fully open.
  const [expandedState, setExpandedState] = useState(false);

  // Flags the gesture and the close paths share; none of them is rendered, so they are shared values.
  const expandedFlag = useSharedValue(false);
  const closingFlag = useSharedValue(false);
  const shownFlag = useSharedValue(false);

  // How far the panel is lifted for the keyboard, and the safe-area padding under its content.
  // Both glide to their target rather than jump when the keyboard opens or closes.
  const keyboardLift = useSharedValue(0);
  const bottomPadding = useSharedValue(insets.bottom);

  // The panel's heights follow the keyboard (or the window resizing around it) with a short timed
  // glide. The first measurement (nothing laid out yet) and reduced motion apply at once. A
  // drag-settle spring in flight is simply replaced.
  //
  // A keyboard that has just opened is the exception. `keyboardDidShow` only fires once the
  // keyboard is fully up, so a glide started then would trail it by its whole duration; the panel
  // lifts and shrinks at once instead. (A window that resizes around the keyboard reports no
  // overlap at all, and keeps the glide: the OS has already moved the frame.)
  const lastKeyboard = useRef(0);
  useEffect(() => {
    const rising = keyboard > lastKeyboard.current;
    lastKeyboard.current = keyboard;
    const glide = (value: SharedValue<number>, target: number) => {
      const immediate =
        instant || rising || value.get() === 0 || !shownFlag.get();
      value.set(
        immediate
          ? target
          : withTiming(target, {
              duration: KEYBOARD_MS,
              easing: motionCurves.standard,
              reduceMotion: ReduceMotion.System,
            }),
      );
    };
    glide(maxHeight, expandedHeight);
    glide(collapsedShared, collapsedHeight);
    glide(detentHeight, expandedFlag.get() ? expandedHeight : collapsedHeight);
    // The lift and the padding under the content start from nothing, so zero is a real value.
    const glideLift = (value: SharedValue<number>, target: number) => {
      const immediate = instant || rising || !shownFlag.get();
      value.set(
        immediate
          ? target
          : withTiming(target, {
              duration: KEYBOARD_MS,
              easing: motionCurves.standard,
              reduceMotion: ReduceMotion.System,
            }),
      );
    };
    glideLift(keyboardLift, keyboard);
    glideLift(bottomPadding, keyboard > 0 ? 0 : insets.bottom);
  }, [
    expandedHeight,
    collapsedHeight,
    keyboard,
    insets.bottom,
    instant,
    maxHeight,
    collapsedShared,
    detentHeight,
    keyboardLift,
    bottomPadding,
    expandedFlag,
    shownFlag,
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
        // The panel does not travel at this level (see `panelStyle`): progress is its opacity.
        progress.set(
          withTiming(
            show ? 1 : 0,
            { duration: FADE_MS, reduceMotion: ReduceMotion.System },
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

  // Set on the JS thread the moment the sheet starts leaving by any path. `closingFlag` is written
  // on the UI thread by a throw, and a JS-side read of it can lag a frame, so a back press, a scrim
  // or close tap in that frame would start a second exit and a second `goBack`. Every path that
  // leaves checks and sets this one. A closure cell rather than a ref: the gesture below captures
  // the callbacks that use it, which a ref may not be.
  const [departing] = useState(() => {
    let left = false;
    return {
      has: () => left,
      set: () => {
        left = true;
      },
    };
  });

  const exit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        departing.set();
        closingFlag.set(true);
        animate(false, resolve);
      }),
    [animate, closingFlag, departing],
  );

  const requestClose = useCallback(() => {
    if (departing.has() || closingFlag.get()) return;
    // Unsaved work: the screen asks first, and leaves through `exit` if the answer is to discard.
    if (guardedShared.get()) {
      navigation.goBack();
      return;
    }
    hapticImpactLight();
    void exit().then(() => navigation.goBack());
  }, [exit, navigation, closingFlag, guardedShared, departing]);

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

  // The body's scroll view scrolls once the sheet is fully open (or has no lower detent to expand
  // from, as with the keyboard up); below that an upward drag expands the sheet.
  const scrollEnabled =
    expandedState || collapsedHeight >= expandedHeight - DETENT_EPSILON;
  const body = useMemo<SheetBody>(
    () => ({
      scrollGesture,
      scrollEnabled,
      reportOffset: (offsetY) => {
        scrollY.set(offsetY);
      },
      register: () => {
        scrollRegistered.set(true);
        return () => {
          scrollRegistered.set(false);
          scrollY.set(0);
        };
      },
    }),
    [scrollGesture, scrollEnabled, scrollY, scrollRegistered],
  );

  // Leaves for good once a swipe has carried the sheet off screen.
  const dismissNow = useCallback(() => {
    if (departing.has()) return;
    departing.set();
    closingFlag.set(true);
    navigation.goBack();
  }, [navigation, closingFlag, departing]);

  // Animations Off (or the system's own setting) snaps to the detent at once, like every other
  // animation here.
  const settle = {
    ...settleSpring,
    reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
  };

  // The drag's two halves, shared by the header's pan and the body's: follow the finger, then
  // decide on release between dismissing and a detent. Worklets, so both gestures run them on the
  // UI thread.
  const dragMove = (translationY: number) => {
    "worklet";
    // Already leaving (a throw or a fade is under way): a second finger must not move the sheet.
    if (closingFlag.get()) return;
    drag.set(translationY);
  };

  const dragRelease = (velocityY: number) => {
    "worklet";
    // A second release while the first is still leaving would start another exit, and a second
    // `goBack` with it.
    if (closingFlag.get()) return;
    const base = detentHeight.get();
    const top = maxHeight.get();
    const height = Math.min(top, Math.max(0, base - Math.min(drag.get(), 0)));
    const visible = height - Math.max(drag.get(), 0);
    const release = resolveSheetRelease({
      visible,
      velocityY,
      collapsed: collapsedShared.get(),
      expanded: top,
    });
    if (release.kind === "dismiss") {
      if (guardedShared.get()) {
        // The screen confirms first; until it says so the sheet stays where it was.
        drag.set(withSpring(0, settle));
        runOnJS(requestClose)();
        return;
      }
      runOnJS(hapticImpactLight)();
      if (!travel) {
        // It stays where the finger left it and fades away (at once when motion is off).
        closingFlag.set(true);
        if (instant) {
          runOnJS(dismissNow)();
          return;
        }
        progress.set(
          withTiming(0, { duration: FADE_MS }, (finished) => {
            if (finished) runOnJS(dismissNow)();
          }),
        );
        return;
      }
      // Leaves at the speed it was let go of: a throw is not slowed to the exit curve's start.
      const timing = sheetDismissTiming(visible, velocityY);
      // The throw is under way: the scrim, the close button and back must not close it again.
      closingFlag.set(true);
      drag.set(
        withTiming(
          height,
          {
            duration: timing.duration,
            easing: timing.linear ? Easing.linear : exitEasing,
          },
          (finished) => {
            if (finished) {
              runOnJS(dismissNow)();
              return;
            }
            // Cut short (nothing here does that while the sheet is mounted; an unmount does and
            // then there is nothing to restore): never leave the sheet part-way off screen with
            // the closing flag set and nobody left to finish the exit.
            closingFlag.set(false);
            drag.set(withSpring(0, settle));
          },
        ),
      );
      return;
    }
    // Fold the drag into the resting height without moving anything, then settle on the detent.
    detentHeight.set(height);
    drag.set(0);
    const target = release.detent === "expanded" ? top : collapsedShared.get();
    // The spring takes over at the speed the finger let go of (up is positive height).
    detentHeight.set(
      withSpring(target, {
        ...settle,
        velocity: -velocityY,
        overshootClamping: true,
      }),
    );
    // Only a change of detent ticks; settling back where it was stays silent.
    if ((release.detent === "expanded") !== expandedFlag.get()) {
      runOnJS(hapticSelection)();
    }
    expandedFlag.set(release.detent === "expanded");
    runOnJS(setExpandedState)(release.detent === "expanded");
  };

  const headerPan = Gesture.Pan()
    .withTestId("android-sheet-pan")
    .onUpdate((event) => {
      dragMove(event.translationY);
    })
    .onEnd((event) => {
      dragRelease(event.velocityY);
    });

  // The body's pan runs beside the scroll view's own (`scrollGesture`), and only takes the touch
  // when the scroll view has nothing to do with it:
  // - sheet fully open: a pull down while the content is at its top (offset <= 0). The sheet only
  //   moves while the content is at the top, so a drag that scrolls the content to the top carries
  //   straight on into closing the sheet, and one that turns back up hands the touch back to the
  //   scroll view.
  // - sheet below its top detent: a drag either way. The scroll view is switched off there
  //   (`scrollEnabled` in the body context), so an upward drag expands the sheet.
  // Once it has the touch it feeds the same move/release as the header, guards included.
  const bodyPan = Gesture.Pan()
    .withTestId("android-sheet-body-pan")
    .activeOffsetY([-BODY_ACTIVE_OFFSET, BODY_ACTIVE_OFFSET])
    .failOffsetX([-BODY_FAIL_OFFSET, BODY_FAIL_OFFSET])
    .simultaneousWithExternalGesture(scrollGesture)
    .onStart(() => {
      // A body that never registered a scroll view is not ours to drag: its content may scroll
      // where the sheet cannot see it.
      bodyMode.set(
        scrollRegistered.get() && !closingFlag.get() ? BODY_PENDING : BODY_IDLE,
      );
    })
    .onUpdate((event) => {
      let mode = bodyMode.get();
      if (mode === BODY_IDLE) return;
      const translation = event.translationY;
      if (mode === BODY_PENDING) {
        mode =
          detentHeight.get() >= maxHeight.get() - DETENT_EPSILON
            ? BODY_CLAMPED
            : BODY_FREE;
        bodyMode.set(mode);
        // The pan activates after a few px of travel; the sheet starts from where the finger is.
        bodyOrigin.set(translation);
      }
      if (mode === BODY_FREE) {
        dragMove(translation - bodyOrigin.get());
        return;
      }
      // Fully open: the content is scrolling, or being dragged back up, until it is at the top.
      if (scrollY.get() > 0 || translation < bodyOrigin.get()) {
        bodyOrigin.set(translation);
      }
      dragMove(translation - bodyOrigin.get());
    })
    .onEnd((event) => {
      const mode = bodyMode.get();
      bodyMode.set(BODY_IDLE);
      if (mode === BODY_IDLE || mode === BODY_PENDING) return;
      // The sheet never left its place: this was the scroll view's gesture (a fling to the top
      // must not read as a throw at the sheet).
      if (mode === BODY_CLAMPED && drag.get() <= 0) return;
      dragRelease(event.velocityY);
    })
    .onFinalize((_event, success) => {
      // Cancelled by the system or by another handler: put the sheet down where it belongs.
      if (success) return;
      const mode = bodyMode.get();
      bodyMode.set(BODY_IDLE);
      if (mode === BODY_IDLE || mode === BODY_PENDING) return;
      if (drag.get() !== 0) dragRelease(0);
    });

  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardLift.get(),
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    paddingBottom: bottomPadding.get(),
  }));

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
    // Below the full level the sheet fades in place instead of travelling from the bottom edge.
    return {
      height,
      opacity: height === 0 ? 0 : travel ? 1 : progress.get(),
      transform: [
        {
          translateY:
            Math.max(drag.get(), 0) +
            (travel ? (1 - progress.get()) * height : 0),
        },
      ],
    };
  });

  return (
    <SheetShellContext value={shell}>
      <View
        ref={frameRef}
        testID="android-sheet-frame"
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
        <Animated.View
          pointerEvents="box-none"
          style={[
            {
              flex: 1,
              justifyContent: "flex-end",
              alignItems: "center",
            },
            liftStyle,
          ]}
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
            <GestureDetector gesture={headerPan}>
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
            <Animated.View style={[{ flex: 1 }, bodyStyle]}>
              <SheetBodyContext value={body}>
                <GestureDetector gesture={bodyPan}>
                  <View collapsable={false} style={{ flex: 1 }}>
                    {children}
                  </View>
                </GestureDetector>
              </SheetBodyContext>
            </Animated.View>
          </Animated.View>
        </Animated.View>
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
