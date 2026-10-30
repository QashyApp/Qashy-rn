import { AccessibilityInfo, type HostInstance } from "react-native";

/**
 * Moves the screen reader's focus (and, on web, keyboard focus) to `node`, for a control that
 * takes the place of the one that was just used. Does nothing when the node is not mounted.
 */
export function moveAccessibilityFocus(
  node: HostInstance | null | undefined,
): void {
  if (!node) return;
  if (process.env.EXPO_OS === "web") {
    // react-native-web hands out the DOM element itself.
    (node as unknown as { focus?: () => void }).focus?.();
    return;
  }
  if (typeof AccessibilityInfo.sendAccessibilityEvent === "function") {
    AccessibilityInfo.sendAccessibilityEvent(node, "focus");
  }
}
