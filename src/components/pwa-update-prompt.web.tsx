import { useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/app-text";
import { GlassSurface } from "@/components/ui/glass-surface";
import { MotionView } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { useQashyTheme } from "@/theme/theme";

/** How long Reload waits for the new worker to take control before reloading anyway. */
const SKIP_WAITING_FALLBACK_MS = 3000;

export function PwaUpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const compact = width < 768;
  useEffect(() => {
    const canRegister =
      "serviceWorker" in navigator &&
      (location.protocol === "https:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1");
    if (!canRegister) return;
    // Nothing reloads uninvited: reloading would discard whatever the user is in the
    // middle of typing. The prompt only announces a worker that is waiting, and the
    // Reload button decides, at press time, whether that worker must be promoted first.
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let watched: ServiceWorker | undefined;
    const announce = () => {
      if (!disposed) setVisible(true);
    };
    const onStateChange = () => {
      if (watched?.state === "installed" && navigator.serviceWorker.controller)
        announce();
    };
    const onUpdateFound = () => {
      const worker = registration?.installing;
      if (!worker) return;
      watched?.removeEventListener("statechange", onStateChange);
      watched = worker;
      worker.addEventListener("statechange", onStateChange);
    };
    navigator.serviceWorker
      .register("/sw.js")
      .then((next) => {
        if (disposed) return;
        registration = next;
        registrationRef.current = next;
        if (next.waiting) announce();
        next.addEventListener("updatefound", onUpdateFound);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      watched?.removeEventListener("statechange", onStateChange);
      registrationRef.current = null;
    };
  }, []);
  if (!visible) return null;
  return (
    <MotionView
      accessibilityLabel="App update available"
      accessibilityLiveRegion="polite"
      exit
      role="status"
      style={
        compact
          ? {
              // On a phone this is a normal layout row below the navigator. A floating
              // snackbar sits directly over form actions and bottom navigation, so a
              // waiting worker could make the control beneath it impossible to press
              // until the notice was dismissed.
              width: "100%",
              paddingTop: 8,
              paddingRight: 12 + insets.right,
              paddingBottom: Math.max(8, insets.bottom),
              paddingLeft: 12 + insets.left,
              zIndex: 1000,
            }
          : {
              position: "absolute",
              right: 12 + insets.right,
              bottom: 20 + insets.bottom,
              maxWidth: 380,
              zIndex: 1000,
            }
      }
    >
      <GlassSurface
        style={{
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: theme.border,
          padding: space.lg,
        }}
      >
        <View style={{ gap: 10 }}>
          <AppText variant="label">A fresh version is ready</AppText>
          <AppText variant="caption" muted>
            Reload when you’re ready. Your finance data stays in IndexedDB.
          </AppText>
          <View
            style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}
          >
            <TextButton
              title="Later"
              tone="muted"
              onPress={() => setVisible(false)}
            />
            <TextButton
              title="Reload"
              onPress={() => {
                // Read the registration at press time. If a worker is still waiting, it
                // must be promoted before a reload can pick it up. If none is waiting (it
                // was already promoted, by this tab or another), the page is on the live
                // worker and a plain reload is enough.
                const waiting = registrationRef.current?.waiting;
                if (!waiting) {
                  window.location.reload();
                  return;
                }
                let reloaded = false;
                let fallback: ReturnType<typeof setTimeout> | undefined;
                const reloadOnce = () => {
                  if (reloaded) return;
                  reloaded = true;
                  if (fallback !== undefined) clearTimeout(fallback);
                  window.location.reload();
                };
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  reloadOnce,
                  { once: true },
                );
                // If control never moves (e.g. the worker was superseded), reload anyway
                // rather than leaving the prompt stuck.
                fallback = setTimeout(reloadOnce, SKIP_WAITING_FALLBACK_MS);
                waiting.postMessage({ type: "SKIP_WAITING" });
              }}
            />
          </View>
        </View>
      </GlassSurface>
    </MotionView>
  );
}
