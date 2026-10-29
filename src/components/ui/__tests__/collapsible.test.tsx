import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { TestInstance } from "test-renderer";

import { Collapsible } from "@/components/ui/collapsible";

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

/** A shared value that rests at `value`; Reanimated's Jest mock has no `makeMutable().get`. */
const resting = (value: number) =>
  ({
    get: () => value,
    set: () => {},
    value,
  }) as unknown as SharedValue<number>;

/** The nearest ancestor of `node` (or `node` itself) that carries the prop. */
function withProp(node: TestInstance, name: string) {
  let current: TestInstance | null = node;
  while (current && !(name in current.props)) current = current.parent;
  return current?.props[name];
}

describe("Collapsible", () => {
  it("keeps what is folded out of reach of touches and screen readers", async () => {
    const collapse = resting(1);
    await render(
      <Collapsible collapse={collapse} folded>
        <Text>Chips</Text>
      </Collapsible>,
    );
    // Hidden from the accessibility tree, so the default queries do not see it.
    expect(screen.queryByText("Chips")).toBeNull();
    const chips = screen.getByText("Chips", { includeHiddenElements: true });
    expect(withProp(chips, "pointerEvents")).toBe("none");
    expect(withProp(chips, "importantForAccessibility")).toBe(
      "no-hide-descendants",
    );
  });

  it("gives it back when it opens", async () => {
    const collapse = resting(1);
    const { rerender } = await render(
      <Collapsible collapse={collapse} folded>
        <Text>Chips</Text>
      </Collapsible>,
    );
    await rerender(
      <Collapsible collapse={collapse} folded={false}>
        <Text>Chips</Text>
      </Collapsible>,
    );
    const chips = screen.getByText("Chips");
    expect(withProp(chips, "pointerEvents")).toBe("auto");
    expect(withProp(chips, "importantForAccessibility")).toBe("auto");
  });
});
