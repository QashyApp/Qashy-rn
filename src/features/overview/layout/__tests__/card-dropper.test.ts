import type { OverviewCard } from "@/domain/overview-layout";
import { createCardDropper } from "@/features/overview/layout/card-dropper";
import type { PlaceCardAction } from "@/features/overview/layout/layout-actions";

const card = (id: string): OverviewCard => ({
  id,
  type: "accounts",
  size: "regular",
  config: {},
});
const cards = [card("a"), card("b"), card("c")];

function setup() {
  const saves: PlaceCardAction[] = [];
  const drop = createCardDropper({
    getCards: () => cards,
    save: (action) => {
      saves.push(action);
      return Promise.resolve(true);
    },
  });
  return { drop, saves };
}

describe("createCardDropper", () => {
  it("saves a move to the front, anchored on the card it now sits before", async () => {
    const { drop, saves } = setup();
    await expect(drop("c", 0)).resolves.toBe(true);
    expect(saves).toEqual([
      { type: "place", id: "c", toIndex: 0, beforeId: "a" },
    ]);
  });

  it("anchors a move to the end on the end of the list", () => {
    const { drop, saves } = setup();
    drop("a", 2);
    expect(saves).toEqual([
      { type: "place", id: "a", toIndex: 2, beforeId: null },
    ]);
  });

  it("anchors a move into the middle on the card after it", () => {
    const { drop, saves } = setup();
    drop("a", 1);
    expect(saves).toEqual([
      { type: "place", id: "a", toIndex: 1, beforeId: "c" },
    ]);
  });

  it("returns null for a drop that changes nothing, and saves nothing", () => {
    const { drop, saves } = setup();
    expect(drop("b", 1)).toBeNull();
    expect(drop("zzz", 0)).toBeNull();
    expect(saves).toEqual([]);
  });

  it("returns the save's outcome so the caller can tell when it settled", async () => {
    const drop = createCardDropper({
      getCards: () => cards,
      save: () => Promise.resolve(false),
    });
    await expect(drop("a", 2)).resolves.toBe(false);
  });
});
