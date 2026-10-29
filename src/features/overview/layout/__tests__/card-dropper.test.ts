import type { OverviewCard } from "@/domain/overview-layout";
import { createCardDropper } from "@/features/overview/layout/card-dropper";

const card = (id: string): OverviewCard => ({
  id,
  type: "accounts",
  size: "regular",
  config: {},
});
const cards = [card("a"), card("b"), card("c")];

function setup() {
  const pending: (readonly string[] | null)[] = [];
  const saves: {
    action: unknown;
    settle: (saved: boolean) => void;
  }[] = [];
  const drop = createCardDropper({
    getCards: () => cards,
    setPendingOrder: (order) => pending.push(order),
    save: (action) =>
      new Promise<boolean>((resolve) => {
        saves.push({ action, settle: resolve });
      }),
  });
  return { drop, pending, saves };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createCardDropper", () => {
  it("shows the new order at once and clears it when the save lands", async () => {
    const { drop, pending, saves } = setup();
    expect(drop("c", 0)).toBe(true);
    expect(pending).toEqual([["c", "a", "b"]]);
    expect(saves[0].action).toEqual({ type: "move", id: "c", toIndex: 0 });

    saves[0].settle(true);
    await flush();
    expect(pending).toEqual([["c", "a", "b"], null]);
  });

  it("reverts to the saved order when the save fails", async () => {
    const { drop, pending, saves } = setup();
    drop("a", 2);
    saves[0].settle(false);
    await flush();
    expect(pending).toEqual([["b", "c", "a"], null]);
  });

  it("reports a drop that changes nothing and leaves the order alone", () => {
    const { drop, pending, saves } = setup();
    expect(drop("b", 1)).toBe(false);
    expect(pending).toEqual([]);
    expect(saves).toEqual([]);
  });

  it("lets only the newest drop clear the pending order", async () => {
    const { drop, pending, saves } = setup();
    drop("c", 0);
    drop("a", 2);
    saves[0].settle(false);
    await flush();
    expect(pending[pending.length - 1]).not.toBeNull();

    saves[1].settle(true);
    await flush();
    expect(pending[pending.length - 1]).toBeNull();
  });
});
