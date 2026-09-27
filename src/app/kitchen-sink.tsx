import { Redirect } from 'expo-router';

import { KitchenSinkScreen } from '@/features/dev/kitchen-sink-screen';

// Dev-only component gallery. Never reachable in a production build: __DEV__
// is false in a release/export bundle, so this redirects home instead of
// rendering the gallery (which pokes at real repository settings — see the
// comment in kitchen-sink-screen.tsx).
export default function KitchenSinkRoute() {
  if (!__DEV__) return <Redirect href="/overview" />;
  return <KitchenSinkScreen />;
}
