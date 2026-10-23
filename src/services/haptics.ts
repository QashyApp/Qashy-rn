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

function trigger(effect: () => Promise<void>) {
  if (!supportsHaptics || !enabled) return;
  effect().catch(() => {});
}

/** Small tick for picking among options: chips, steppers, toggling a selection. */
export function hapticSelection() {
  trigger(() => Haptics.selectionAsync());
}

/** Light physical tap for direct actions: floating action button, entering selection mode. */
export function hapticImpactLight() {
  trigger(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Positive confirmation after a save, import, or milestone completes. */
export function hapticSuccess() {
  trigger(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );
}

/** Double-knock for an action that failed or was rejected. */
export function hapticError() {
  trigger(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  );
}

/** Cautionary buzz when the user confirms a destructive action. */
export function hapticWarning() {
  trigger(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  );
}
