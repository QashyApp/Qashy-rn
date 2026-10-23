import { Platform } from "react-native";

export type Role = "host" | "join";

export type Stage = "role" | "code" | "confirm" | "done";

/**
 * A code is no longer safe to offer once its handshake has failed, even if its wall-clock
 * deadline has not arrived yet. Keep that fact in the screen state so a failed attempt cannot
 * look like a retryable QR for the rest of its 90-second countdown.
 */
export interface DisplayedPairingCode {
  readonly value: string;
  readonly expiresAt: number;
  readonly unusable?: boolean;
}

export const STAGES: readonly Stage[] = ["role", "code", "confirm", "done"];

/** `HostPairingDeps.now` is unix **seconds**, unlike everything else in the app. */
export const unixSeconds = () => Math.floor(Date.now() / 1000);

/** A first guess at a device name, so nobody has to invent one to get past the first screen. */
export function defaultDeviceName() {
  switch (Platform.OS) {
    case "android":
      return "My Android";
    default:
      return "My browser";
  }
}

/** Whatever is currently in flight, so it can be closed exactly once. */
export interface Session {
  readonly close: () => void;
  readonly abort: AbortController;
}
