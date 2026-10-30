import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { FormField } from "@/components/ui/form-field";

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

describe("FormField locked state", () => {
  it("announces a locked field as disabled", async () => {
    await render(<FormField label="Currency" value="USD" editable={false} />);

    const input = screen.getByDisplayValue("USD");
    expect(input.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("leaves an editable field enabled", async () => {
    await render(<FormField label="Currency" value="USD" />);

    const input = screen.getByDisplayValue("USD");
    expect(input.props.accessibilityState?.disabled).toBeUndefined();
  });

  it("dims a locked field unless asked not to", async () => {
    const view = await render(
      <FormField label="Currency" value="USD" editable={false} />,
    );
    const dimmed = StyleSheet.flatten(
      screen.getByDisplayValue("USD").props.style,
    );
    expect(dimmed.opacity).toBe(0.38);

    await view.rerender(
      <FormField
        label="Currency"
        value="USD"
        editable={false}
        dimWhenLocked={false}
      />,
    );
    const input = screen.getByDisplayValue("USD");
    expect(StyleSheet.flatten(input.props.style).opacity).toBe(1);
    expect(input.props.accessibilityState).toMatchObject({ disabled: true });
  });
});
