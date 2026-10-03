import { router, usePathname, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useLocalization } from "@/localization/localization";

/**
 * Header back control that cannot disappear.
 *
 * The stock back button only renders while the stack holds a previous route. A
 * reload or direct visit to `/appearance`, `/csv`, a form sheet, etc. leaves the
 * screen alone in the stack (the anchor `index` route redirects away), so the
 * header came up with no way back at all. This one falls back to the owning
 * section instead of rendering nothing.
 */
/**
 * How many times the location has changed since the page loaded. On a reload or deep link the
 * router still stacks the anchor route (Overview) beneath the screen, so `router.canGoBack()` is
 * true even though the user never came from there; Back would then land on Overview for a screen
 * owned by More or Plan. Zero changes means this screen is the entry point.
 */
let locationChanges = 0;

/** Mount once, inside the navigator, so `HeaderBackButton` can tell an entry screen from a pushed one. */
export function useTrackLocationChanges() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    locationChanges += 1;
  }, [pathname]);
}

function HeaderBackButton({ fallback }: { fallback: Href }) {
  const { isRtl } = useLocalization();
  return (
    <IconButton
      label="Back"
      icon={isRtl ? "chevron.right" : "chevron.left"}
      iconSize={20}
      onPress={() => {
        if (locationChanges > 0 && router.canGoBack()) router.back();
        else router.replace(fallback);
      }}
    />
  );
}

/** Web-only: native keeps the platform back button, which is always present when a back stack exists. */
export function backFallbackOptions(fallback: Href) {
  if (process.env.EXPO_OS !== "web") return {};
  return { headerLeft: () => <HeaderBackButton fallback={fallback} /> };
}
