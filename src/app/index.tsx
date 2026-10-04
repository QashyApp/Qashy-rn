import { Redirect } from "expo-router";

import { useFinanceSettings } from "@/providers/finance-provider";

export default function IndexRoute() {
  const settings = useFinanceSettings();
  return (
    <Redirect
      href={settings.onboardingComplete ? "/overview" : "/onboarding"}
    />
  );
}
