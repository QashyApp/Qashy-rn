import * as Haptics from "expo-haptics";

// Haptics are native-only; on web every helper is a silent no-op so call
// sites never need to branch per platform.
const supportsHaptics = process.env.EXPO_OS === "android";

// The device's own switch (Gestures and Animations). Module state rather than context because
// the helpers are plain functions called from handlers, worklet callbacks and utilities.
let enabled = true;

/** Applies the device's haptics preference. Mounted once from the `hapticsEnabled` setting. */
export function setHapticsEnabled(next: boolean) {
  enabled = next;
}

type AndroidEffect = keyof typeof Haptics.AndroidHaptics;

/**
 * Plays `effect` through the platform's own haptic vocabulary (`View.performHapticFeedback`, so the
 * tuned tick the system uses for its own controls and no VIBRATE permission), and falls back to
 * the `Vibrator` waveform when the constant is missing: `Confirm` and `Reject` need Android 11,
 * and a device with no activity yet rejects the call.
 */
function trigger(effect: AndroidEffect, fallback: () => Promise<void>) {
  if (!supportsHaptics || !enabled) return;
  const constant = Haptics.AndroidHaptics?.[effect];
  const native =
    constant !== undefined &&
    typeof Haptics.performAndroidHapticsAsync === "function"
      ? Haptics.performAndroidHapticsAsync(constant)
      : Promise.reject(new Error("Android haptic constants unavailable"));
  native.catch(() => fallback().catch(() => {}));
}

/** Small tick for picking among options: chips, steppers, toggling a selection. */
export function hapticSelection() {
  trigger("Clock_Tick", () => Haptics.selectionAsync());
}

/** Light physical tap for direct actions: floating action button, entering selection mode. */
export function hapticImpactLight() {
  trigger("Context_Click", () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  );
}

/** Positive confirmation after a save, import, or milestone completes. */
export function hapticSuccess() {
  trigger("Confirm", () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );
}

/** Double-knock for an action that failed or was rejected. */
export function hapticError() {
  trigger("Reject", () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  );
}

/** Cautionary buzz when the user confirms a destructive action. */
export function hapticWarning() {
  // The platform has no "warning" constant; a long press is its heaviest single click.
  trigger("Long_Press", () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  );
}
