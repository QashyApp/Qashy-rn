// The app entry. Headless tasks (home-screen widget refresh, opt-in background sync) must be
// registered at bundle load, before the root component, so this file runs them first and then
// hands over to Expo Router.
import "./src/features/widgets/headless";
import "./src/features/background-sync/headless";
import "expo-router/entry";
