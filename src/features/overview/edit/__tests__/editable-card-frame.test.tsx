import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { EditableCardFrame } from "@/features/overview/edit/editable-card-frame";

// A minimal stand-in theme: only the tokens `materialStyle`/`AppText`/`IconButton` actually
// read for the materials this frame uses (`raised`, `sunken` is not used here).
jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    // The real classic scales: components destructure `space`/`radius` from the theme.
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
    surface: "#ffffff",
    surfaceMuted: "#eeeeee",
    accent: "#4040ff",
    onAccent: "#ffffff",
    shadowRaised: "none",
    shadowCard: "none",
    shadowOverlay: "none",
    shadowControl: "none",
    shadowControlPressed: "none",
    surfaceGradient: undefined,
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

jest.mock("@/utils/haptics", () => ({
  hapticSelection: jest.fn(),
}));

describe("EditableCardFrame", () => {
  const baseProps = {
    title: "Budget pulse",
    total: 3,
    sizes: ["compact", "regular", "wide"] as const,
    showSizeControl: true,
    hasConfigSheet: false,
    configOpen: false,
    onMoveUp: jest.fn(),
    onMoveDown: jest.fn(),
    onCycleSize: jest.fn(),
    onRemove: jest.fn(),
  };

  it("renders the toolbar with accessible labels for each action", async () => {
    await render(
      <EditableCardFrame {...baseProps} index={1}>
        <Text>Card content</Text>
      </EditableCardFrame>,
    );

    expect(screen.getByLabelText("Move Budget pulse up")).toBeTruthy();
    expect(screen.getByLabelText("Move Budget pulse down")).toBeTruthy();
    expect(screen.getByLabelText("Change Budget pulse size")).toBeTruthy();
    expect(screen.getByLabelText("Remove Budget pulse")).toBeTruthy();
  });

  it('disables "move up" at the first position', async () => {
    await render(
      <EditableCardFrame {...baseProps} index={0}>
        <Text>Card content</Text>
      </EditableCardFrame>,
    );

    const moveUp = screen.getByLabelText("Move Budget pulse up");
    expect(moveUp.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables "move down" at the last position', async () => {
    await render(
      <EditableCardFrame {...baseProps} index={2}>
        <Text>Card content</Text>
      </EditableCardFrame>,
    );

    const moveDown = screen.getByLabelText("Move Budget pulse down");
    expect(moveDown.props.accessibilityState?.disabled).toBe(true);
  });

  it("calls onRemove when the remove button is pressed", async () => {
    const onRemove = jest.fn();
    await render(
      <EditableCardFrame {...baseProps} index={1} onRemove={onRemove}>
        <Text>Card content</Text>
      </EditableCardFrame>,
    );

    await fireEvent.press(screen.getByLabelText("Remove Budget pulse"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does not show a size control when the widget only has one size", async () => {
    await render(
      <EditableCardFrame
        {...baseProps}
        index={1}
        sizes={["regular"] as const}
        showSizeControl={false}
      >
        <Text>Card content</Text>
      </EditableCardFrame>,
    );

    expect(screen.queryByLabelText("Change Budget pulse size")).toBeNull();
  });
});
