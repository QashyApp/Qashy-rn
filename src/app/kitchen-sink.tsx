import { Redirect } from "expo-router";

// Dev-only component gallery. Never reachable in a production build: __DEV__
// is false in a release/export bundle, so this redirects home instead of
// rendering the gallery (which pokes at real repository settings — see the
// comment in kitchen-sink-screen.tsx).
//
// The screen is `require`d under `__DEV__` rather than imported, so Metro folds the branch away
// in a release/export bundle and the gallery's code never ships.
const KitchenSinkScreen: (() => React.JSX.Element) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/features/dev/kitchen-sink-screen").KitchenSinkScreen
  : null;

export default function KitchenSinkRoute() {
  if (!KitchenSinkScreen) return <Redirect href="/overview" />;
  return <KitchenSinkScreen />;
}
