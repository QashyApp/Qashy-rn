import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";

import { cameraSupported } from "@/components/sync/camera-support";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { FormField } from "@/components/ui/form-field";
import { TextButton } from "@/components/ui/text-button";
import { useQashyTheme } from "@/theme/theme";

/**
 * Reads a pairing code, by camera or by hand.
 *
 * One component for both platforms, because `expo-camera` genuinely does barcode scanning in
 * the browser too — through `BarcodeDetector` where it exists and a polyfill where it does
 * not. Only *availability* differs, and that is isolated in `camera-support.*`.
 *
 * **The manual field is not a fallback bolted on for tests.** A desktop browser is one of the
 * two devices in the common case, and half of them have no camera; the manual code is how
 * that pairing happens. It is also what makes the flow drivable in Playwright, but that is a
 * consequence of it being real, not the reason it exists.
 *
 * What this component must never do with what it reads: log it, put it in a URL, write it to
 * storage, or hold it after handing it over. The pairing code is a secret with a 90-second
 * life, and every one of those would outlive it.
 */
export function QrScanner({
  onCode,
  hint,
  rearm,
  error,
  onEdit,
}: {
  /** Called once per accepted code. The caller owns validation and any error message. */
  onCode: (code: string) => void;
  hint?: string;
  /**
   * Claims one more code without remounting. Bump `token` after a failed attempt. A code that was
   * spent on a handshake is cleared from the field, because the pairing secret is single use.
   * `keepManual` is for a code rejected before anything was sent (a typo): the draft stays so it
   * can be corrected, alongside `error`.
   */
  rearm?: { token: number; keepManual: boolean };
  /** Why the last code was refused, shown under the field (or under the camera) it came from. */
  error?: string | null;
  /** The typed code changed, so a refusal about the previous text no longer applies. */
  onEdit?: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  // The typed text remembers which re-arm it was typed under, so a spent code is dropped from the
  // field (derived, not an effect) while a mistyped one can be kept for correction.
  const [typed, setTyped] = useState({ text: "", token: rearm?.token });
  const manual =
    typed.token === rearm?.token || rearm?.keepManual ? typed.text : "";
  const setManual = (text: string) => {
    setTyped({ text, token: rearm?.token });
    onEdit?.();
  };
  const [showManual, setShowManual] = useState(!cameraSupported());

  /**
   * One code per mount.
   *
   * `onBarcodeScanned` fires on every frame that contains a symbol — several times a second,
   * for as long as the code is in view. Without this, a single QR triggers a dozen pairing
   * attempts against a rendezvous that is single-use, and the failures from attempts two
   * onward are what the user would see reported.
   *
   * A ref, not state: the frames arrive faster than a re-render.
   */
  const claimed = useRef(false);
  const web = process.env.EXPO_OS === "web";
  const rearmToken = rearm?.token;
  useEffect(() => {
    if (rearmToken !== undefined) claimed.current = false;
  }, [rearmToken]);
  const claim = useCallback(
    (value: string) => {
      const code = value.trim();
      if (!code || claimed.current) return;
      claimed.current = true;
      onCode(code);
    },
    [onCode],
  );

  // Coming back from the system settings page does not remount this, so the permission would
  // otherwise keep reading "denied" after it was granted there.
  const refreshPermission = useCallback(() => {
    void getPermission();
  }, [getPermission]);
  useEffect(() => {
    if (web) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshPermission();
    });
    return () => subscription.remove();
  }, [web, refreshPermission]);

  const canScan = cameraSupported() && permission?.granted === true;

  return (
    <View style={{ gap: space.md }}>
      {canScan && !showManual ? (
        <View
          style={{
            aspectRatio: 1,
            overflow: "hidden",
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            // QR only. Every other symbology is a format this app cannot act on, and
            // narrowing the list is what stops a barcode on a nearby object from firing the
            // handler and burning the one claim above.
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => claim(data)}
          />
        </View>
      ) : null}

      {cameraSupported() && !permission?.granted && !showManual ? (
        <View
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <AppText variant="label">
            Qashy needs the camera to scan the code
          </AppText>
          <AppText variant="caption" muted>
            The camera is used only to read the pairing code on your other
            device. No photo is taken and nothing is uploaded.
          </AppText>
          {permission?.canAskAgain === false && web ? (
            // A browser has no settings screen to send anyone to, and it will not prompt again.
            // The site's permission lives in the address bar, so say that and offer the code.
            <>
              <AppText variant="caption" muted>
                Camera access is blocked for this site. Allow it in your
                browser’s site settings, or enter the code instead.
              </AppText>
              <ActionButton
                title="Enter the code"
                icon="ion:keyboard-outline"
                onPress={() => setShowManual(true)}
              />
            </>
          ) : (
            <ActionButton
              title={
                permission?.canAskAgain === false
                  ? "Open settings"
                  : "Allow camera"
              }
              icon={
                permission?.canAskAgain === false
                  ? "gear"
                  : "ion:camera-outline"
              }
              // `canAskAgain: false` means the OS will not show a prompt again, so calling
              // `requestPermission` resolves instantly as denied and looks like a dead button.
              // The app's own settings page is where the permission can be turned back on; the
              // manual code stays one tap away below.
              onPress={() => {
                if (permission?.canAskAgain === false)
                  void Linking.openSettings().catch(() => setShowManual(true));
                else void requestPermission();
              }}
            />
          )}
        </View>
      ) : null}

      {showManual ? (
        <View style={{ gap: space.sm }}>
          <FormField
            label="Pairing code"
            value={manual}
            onChangeText={setManual}
            placeholder="Paste the code from your other device"
            autoCapitalize="characters"
            autoCorrect={false}
            // Never `secureTextEntry`. This is pasted from another screen and typos are
            // otherwise invisible; the protection here is the 90-second expiry and the SAS
            // comparison that follows, not hiding the characters from the person entering
            // them. Autofill is off so a password manager never records it.
            autoComplete="off"
            error={error ?? undefined}
            multiline
          />
          <ActionButton
            title="Continue"
            icon="checkmark"
            disabled={!manual.trim()}
            onPress={() => claim(manual)}
          />
        </View>
      ) : null}

      {error && !showManual ? (
        <AppText
          accessibilityRole="alert"
          variant="caption"
          style={{ color: theme.negativeText }}
        >
          {error}
        </AppText>
      ) : null}

      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}

      {cameraSupported() ? (
        <TextButton
          title={
            showManual ? "Scan a code instead" : "Can’t scan? Enter the code"
          }
          tone="muted"
          onPress={() => setShowManual((shown) => !shown)}
        />
      ) : (
        <AppText variant="caption" muted>
          This device can’t use a camera here, so enter the code shown on your
          other device.
        </AppText>
      )}
    </View>
  );
}
