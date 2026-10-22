import { act, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { BackHandler, Text } from "react-native";

import {
  CalculatorHost,
  useCalculatorHost,
  type CalculatorFieldConfig,
} from "@/components/finance/calculator-host";
import { OverlayProvider } from "@/components/ui/overlay-host";
import { classicTheme } from "@/theme/themes/classic";

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    ...(({ space, radius, tile, iconSize, motion, type }) => ({
      space,
      radius,
      tile,
      iconSize,
      motion,
      type,
    }))(jest.requireActual("@/theme/themes/classic").classicTheme),
    text: "#111111",
    textMuted: "#666666",
    accent: "#4040ff",
    scrim: "#00000066",
    surface: "#ffffff",
    surfaceMuted: "#eeeeee",
    materialControls: true,
  }),
}));

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/components/finance/amount-keypad", () => ({
  AmountKeypad: () => null,
  prefersAmountKeypad: () => true,
}));

jest.mock("@/components/ui/animation-level-context", () => ({
  useAnimationLevel: () => "off",
}));

void classicTheme;

const captured: { host: ReturnType<typeof useCalculatorHost> } = { host: null };
function Capture() {
  const api = useCalculatorHost();
  useEffect(() => {
    captured.host = api;
  }, [api]);
  return <Text>field</Text>;
}

const config = (overrides: Partial<CalculatorFieldConfig> = {}) => ({
  value: "12",
  onChange: jest.fn(),
  currency: "USD" as const,
  blur: jest.fn(),
  ...overrides,
});

async function setup() {
  await render(
    <OverlayProvider>
      <CalculatorHost>
        <Capture />
      </CalculatorHost>
    </OverlayProvider>,
  );
}

// The host holds a field's first open back while its screen is still being presented.
async function open(field: CalculatorFieldConfig) {
  await act(async () => {
    captured.host?.open("a", field);
    jest.advanceTimersByTime(600);
  });
}

const hidden = { includeHiddenElements: true };
const layer = () => screen.getByLabelText("Close", hidden).parent;

describe("CalculatorHost in the overlay host", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("draws nothing until the keypad is first opened", async () => {
    await setup();
    expect(screen.queryByText("Set amount")).toBeNull();
  });

  it("stays mounted when closed, but out of reach of touches and screen readers", async () => {
    await setup();
    const field = config();
    await open(field);
    expect(screen.getByText("Set amount", hidden)).toBeTruthy();

    await act(async () => captured.host?.dismiss());
    // Still mounted, so a reopen does not rebuild or re-measure it.
    expect(screen.getByText("Set amount", hidden)).toBeTruthy();
    let node = layer();
    while (node && node.props.pointerEvents === undefined) node = node.parent;
    expect(node?.props.pointerEvents).toBe("none");
    expect(node?.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("takes touches again as soon as it reopens", async () => {
    await setup();
    await open(config());
    await act(async () => captured.host?.dismiss());
    await open(config());
    let node = layer();
    while (node && node.props.pointerEvents === undefined) node = node.parent;
    expect(node?.props.pointerEvents).toBe("auto");
  });

  it("finishes the calculation and closes on Android back, only while visible", async () => {
    const add = jest.spyOn(BackHandler, "addEventListener");
    await setup();
    expect(add).not.toHaveBeenCalled();
    const field = config({ value: "2+3" });
    await open(field);
    expect(add).toHaveBeenCalledTimes(1);
    const handler = add.mock.calls[0][1] as () => boolean;
    let handled = false;
    await act(async () => {
      handled = handler();
    });
    expect(handled).toBe(true);
    expect(field.onChange).toHaveBeenCalledWith("5.00");
    expect(field.blur).toHaveBeenCalled();
    let node = layer();
    while (node && node.props.pointerEvents === undefined) node = node.parent;
    expect(node?.props.pointerEvents).toBe("none");
    add.mockRestore();
  });
});
