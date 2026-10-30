import { fireEvent, render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { ChoiceListField } from "@/components/ui/choice-list-field";
import type { AnimationLevel } from "@/domain/models";

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

jest.mock("@/services/haptics", () => ({ hapticSelection: jest.fn() }));

const field = (level: AnimationLevel = "all") => (
  <AnimationLevelContext.Provider value={level}>
    <ChoiceListField
      label="Budget"
      value="b"
      onChange={jest.fn()}
      options={[
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ]}
    />
  </AnimationLevelContext.Provider>
);

describe("ChoiceListField", () => {
  it("marks the chosen option as the checked radio, not merely selected", async () => {
    await render(field());
    await fireEvent.press(screen.getByLabelText("Budget"));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(radios[1].props.accessibilityState).toMatchObject({ checked: true });
  });

  it("names the close control once: the scrim is decorative", async () => {
    await render(field());
    await fireEvent.press(screen.getByLabelText("Budget"));
    expect(screen.getAllByLabelText("Close budget choices")).toHaveLength(1);
  });

  const modalAnimation = async (level: AnimationLevel) => {
    await render(field(level));
    await fireEvent.press(screen.getByLabelText("Budget"));
    let node: TestInstance | null = screen.getAllByRole("radio")[0];
    while (node && node.props.animationType === undefined) node = node.parent;
    return node?.props.animationType;
  };

  it("fades in at the full level and appears at once with animations off", async () => {
    expect(await modalAnimation("all")).toBe("fade");
    expect(await modalAnimation("off")).toBe("none");
  });
});
