import { useRouter, type Href } from "expo-router";
import { useEffect } from "react";

/**
 * Leaves the screen for `href`, closing it rather than stacking a second copy of the destination.
 *
 * A sheet is opened over the tabs, so `<Redirect>` (a `replace`) would swap the sheet for another
 * `(tabs)` route and leave two sets of tabs in the stack. `dismissTo` pops back to the tabs that
 * are already there and points them at `href`. The web keeps `<Redirect>` (see `close-to.web.tsx`).
 */
export function CloseTo({ href }: { href: Href }) {
  const router = useRouter();
  useEffect(() => {
    router.dismissTo(href);
  }, [router, href]);
  return null;
}
