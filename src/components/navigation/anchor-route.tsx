import { Redirect, useNavigation, useRoute } from "expo-router";
import { useEffect, useState } from "react";

import { useFinanceSettings } from "@/providers/finance-provider";

/**
 * The root stack's anchor on Android: it only redirects, to the tabs or to onboarding. (The web
 * keeps the plain `<Redirect>` in `src/app/index.tsx`: its stack follows the browser history.)
 *
 * `<Redirect>` fires when this screen is focused, so it covers a plain launch, where this is the only
 * route. A deep link is different: Expo Router seeds the stack as `[index, <linked screen>]`
 * (cold start), or pushes `index` on top of the tabs (a warm `qashy:///`). Left alone, the form
 * sheet a widget opens would sit over an empty screen, closing it would land on this redirect, and
 * Back from a linked tab would bounce through it. So when other routes are stacked, this screen
 * removes itself instead (putting the tabs in its place if the link did not bring them), which
 * leaves `[tabs, <linked screen>]`: the sheet over the tabs, closing back to them.
 */
export function AnchorRoute() {
  const settings = useFinanceSettings();
  const navigation = useNavigation();
  const { key } = useRoute();
  const onboardingComplete = settings.onboardingComplete;
  // Decided in an effect, once: during the first render the navigator may not list this route yet
  // (a warm `qashy:///` renders it before the push commits).
  const [redirect, setRedirect] = useState(false);

  useEffect(() => {
    let handled = false;
    // Returns false while the navigator's committed state does not list this route yet.
    const settle = (): boolean => {
      const state = navigation.getState();
      if (handled || !state) return false;
      if (!state.routes.some((route) => route.key === key)) return false;
      if (!onboardingComplete || state.routes.length < 2) {
        handled = true;
        setRedirect(true);
        return true;
      }
      const others = state.routes.filter((route) => route.key !== key);
      const withTabs = others.some((route) => route.name === "(tabs)")
        ? others
        : [
            { name: "(tabs)", state: { routes: [{ name: "overview" }] } },
            ...others,
          ];
      const focusedKey = state.routes[state.index]?.key;
      const focused = withTabs.findIndex(
        (route) => "key" in route && route.key === focusedKey,
      );
      handled = true;
      // Removing the focused route (a warm `qashy:///`) hands focus to the route beneath it.
      navigation.dispatch({
        type: "RESET",
        payload: {
          ...state,
          routes: withTabs,
          index: focused >= 0 ? focused : withTabs.length - 1,
        },
      });
      return true;
    };
    if (settle()) return;
    return navigation.addListener("state", () => {
      settle();
    });
  }, [key, navigation, onboardingComplete]);

  if (!redirect) return null;
  return <Redirect href={onboardingComplete ? "/overview" : "/onboarding"} />;
}
