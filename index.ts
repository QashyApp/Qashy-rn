// The app entry. Headless tasks (home-screen widget refresh) must be registered at bundle load,
// before the root component, so this file runs them first and then hands over to Expo Router.
import "./src/features/widgets/headless";
import "expo-router/entry";
