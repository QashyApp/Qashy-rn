import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";

import { useSheetShell } from "@/components/navigation/sheet-shell-context";
import { confirmDestructive } from "@/utils/confirm";
import { stableSerialize } from "@/utils/form-state";

export type OwnerRoute = "/overview" | "/transactions" | "/plan" | "/more";

/**
 * Shared behaviour for the create/edit sheets.
 *
 * Two things every one of them needs and only one of them used to do:
 *
 * 1. Closing back to the owning section. `dismissTo` alone leaves the web history
 *    entry pointing at the sheet, so the projection behind it can render against a
 *    stale URL; replacing on the next frame settles it. Only the transaction sheet
 *    carried this, and the other six shared the gap.
 * 2. Guarding unsaved work. Every sheet is swipe-dismissible, and nothing asked
 *    before throwing a half-typed entry away.
 *
 * On Android the sheet is `AndroidSheet`, not a native one. It animates away before the route is
 * removed (a native removal has no exit to play), so leaving goes through its `exit()`.
 *
 * `values` is the form's current field state. Its first serialization is the
 * baseline; anything different afterwards counts as dirty. Pass plain,
 * JSON-serializable state, and pass it on every render.
 */
export function useFormSheet({
  ownerRoute,
  values,
}: {
  ownerRoute: OwnerRoute;
  values: unknown;
}) {
  const navigation = useNavigation();
  const shell = useSheetShell();
  const serialized = stableSerialize(values);
  const [baseline] = useState(() => serialized);
  const dirty = baseline !== serialized;

  // Set once the screen is leaving deliberately — a save, a delete, or a discard
  // the user already confirmed — so the guard stops blocking its own exit.
  const [leaving, setLeaving] = useState(false);

  // `params` carries view state for the owner, never finance data — for example
  // the month the transaction list should open on after a save.
  const closeToOwner = useCallback(
    (params?: Record<string, string>) => {
      setLeaving(true);
      const href = params ? { pathname: ownerRoute, params } : ownerRoute;
      const leave = () => {
        router.dismissTo(href);
        if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
          window.requestAnimationFrame(() => router.replace(href));
        }
      };
      if (shell) void shell.exit().then(leave);
      else leave();
    },
    [ownerRoute, shell],
  );

  // Lets a screen leave by a route of its own (the account sheet returns to the
  // transaction sheet that opened it) without tripping the guard.
  const allowLeave = useCallback(() => {
    setLeaving(true);
  }, []);

  // A plain `beforeRemove` listener can only call `event.preventDefault()`
  // after native-stack's interactive swipe-to-dismiss has already torn the
  // screen down natively, which desyncs JS navigation state and logs "was
  // removed natively but didn't get removed from JS state." While the sheet is
  // dirty, `usePreventRemove` sets `preventNativeDismiss` on iOS: the sheet
  // springs back and native-stack dispatches a POP instead, so a swipe-down
  // reaches the confirmation below rather than bypassing it (it is not
  // disabled — a clean sheet still swipes closed directly). On Android the
  // sheet is `AndroidSheet`: a swipe, the scrim, the close button and hardware
  // back all ask to close it, and while this sheet is dirty it tells the shell
  // not to animate away first, so they reach the confirmation below too.
  usePreventRemove(dirty && !leaving, (event) => {
    void confirmDestructive({
      title: "Discard changes?",
      message: "This form has unsaved changes.",
      confirmLabel: "Discard",
    }).then(async (confirmed) => {
      if (!confirmed) return;
      setLeaving(true);
      await shell?.exit();
      navigation.dispatch(event.data.action);
    });
  });

  const guarded = dirty && !leaving;
  useEffect(() => {
    shell?.setGuarded(guarded);
  }, [shell, guarded]);

  // A hand-off (transaction sheet -> recurring sheet) disables the guard only while
  // the sheet is buried; coming back to it re-arms the guard.
  useEffect(
    () => navigation.addListener("focus", () => setLeaving(false)),
    [navigation],
  );

  return { closeToOwner, allowLeave, dirty };
}
