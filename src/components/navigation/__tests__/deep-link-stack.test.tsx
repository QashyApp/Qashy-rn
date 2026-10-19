import {
  act,
  renderRouter,
  screen as routerScreen,
} from "expo-router/testing-library";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { Text } from "react-native";

import { CloseTo } from "@/components/navigation/close-to";
import { AnchorRoute } from "@/components/navigation/anchor-route";

let mockComplete = true;
jest.mock("@/providers/finance-provider", () => ({
  useFinanceSettings: () => ({ onboardingComplete: mockComplete }),
}));

const tree = () => ({
  _layout: {
    unstable_settings: { anchor: "index" },
    default: () => (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!mockComplete}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={mockComplete}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="transaction" />
          <Stack.Screen name="widgets" />
        </Stack.Protected>
      </Stack>
    ),
  },
  index: AnchorRoute,
  onboarding: () => <Text>ONBOARDING</Text>,
  "(tabs)/_layout": () => (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="overview" />
      <Tabs.Screen name="transactions" />
      <Tabs.Screen name="plan" />
      <Tabs.Screen name="more" />
    </Tabs>
  ),
  "(tabs)/overview/index": () => <Text>OVERVIEW</Text>,
  "(tabs)/transactions/index": () => <Text>TRANSACTIONS</Text>,
  "(tabs)/plan/index": () => <Text>PLAN</Text>,
  "(tabs)/more/index": () => <Text>MORE</Text>,
  transaction: function TransactionRoute() {
    const { id } = useLocalSearchParams<{ id?: string }>();
    // The real form closes itself over an id that is not in the data.
    return id === "unknown" ? (
      <CloseTo href="/transactions" />
    ) : (
      <Text>SHEET</Text>
    );
  },
  widgets: () => <Text>WIDGETS</Text>,
});

// The typings of the router testing library lag behind its runtime helpers.
const typedScreen = () =>
  routerScreen as unknown as {
    getRouterState(): {
      routes: {
        state: {
          routes: {
            name: string;
            state?: { index: number; routes: { name: string }[] };
          }[];
        };
      }[];
    };
    getPathname(): string;
    getSearchParams(): Record<string, string>;
  };

const rootRoutes = () =>
  typedScreen()
    .getRouterState()
    .routes[0].state.routes.map(
      (route: {
        name: string;
        state?: { index: number; routes: { name: string }[] };
      }) =>
        route.state
          ? `${route.name}:${route.state.routes[route.state.index].name.split("/")[0]}`
          : route.name,
    );

const settle = () => act(async () => undefined);

describe("deep links over the root stack", () => {
  beforeEach(() => {
    mockComplete = true;
  });

  it.each([
    ["/", ["(tabs):overview"]],
    ["/overview", ["(tabs):overview"]],
    ["/transactions", ["(tabs):transactions"]],
    ["/transaction", ["(tabs):overview", "transaction"]],
    ["/transaction?id=abc", ["(tabs):overview", "transaction"]],
    ["/widgets?widgetId=5", ["(tabs):overview", "widgets"]],
  ])("cold start %s", async (url, expected) => {
    await renderRouter(tree(), { initialUrl: url });
    await settle();
    expect(rootRoutes()).toEqual(expected);
  });

  it("an unknown transaction id lands on the list over a single set of tabs", async () => {
    await renderRouter(tree(), { initialUrl: "/transaction?id=unknown" });
    await settle();
    expect(rootRoutes()).toEqual(["(tabs):transactions"]);
  });

  it("closing a linked sheet returns to the tabs", async () => {
    await renderRouter(tree(), { initialUrl: "/transaction?id=abc" });
    await settle();
    await act(async () => router.back());
    await settle();
    expect(rootRoutes()).toEqual(["(tabs):overview"]);
    expect(typedScreen().getPathname()).toBe("/overview");
  });

  it("an unfinished setup still lands on onboarding", async () => {
    mockComplete = false;
    await renderRouter(tree(), { initialUrl: "/" });
    await settle();
    expect(typedScreen().getPathname()).toBe("/onboarding");
  });

  // A warm start delivers the URL as a `NAVIGATE_TO_HREF` intent (expo-router's `useLinking.native`),
  // which is what `router.navigate` enqueues too; the OS-level `url` event itself is not simulated.
  it("warm start pushes the sheet over the tabs the user is on", async () => {
    await renderRouter(tree(), { initialUrl: "/transactions" });
    await settle();
    await act(async () => router.navigate("/transaction"));
    await settle();
    expect(rootRoutes()).toEqual(["(tabs):transactions", "transaction"]);
  });

  it("warm start on a sheet that is already open keeps one sheet", async () => {
    await renderRouter(tree(), { initialUrl: "/transactions" });
    await settle();
    await act(async () => router.navigate("/transaction?id=1"));
    await settle();
    await act(async () => router.navigate("/transaction?id=2"));
    await settle();
    expect(rootRoutes()).toEqual(["(tabs):transactions", "transaction"]);
    expect(typedScreen().getSearchParams()).toEqual({ id: "2" });
  });

  it("warm start on / leaves one set of tabs", async () => {
    await renderRouter(tree(), { initialUrl: "/transactions" });
    await settle();
    await act(async () => router.navigate("/"));
    await settle();
    expect(rootRoutes()).toEqual(["(tabs):transactions"]);
  });
});
