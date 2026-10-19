import { runHeadlessRefresh } from "@/features/widgets/headless-task";

function setup(
  overrides: Partial<Parameters<typeof runHeadlessRefresh>[0]> = {},
) {
  const order: string[] = [];
  const deps = {
    initialize: jest.fn(async () => void order.push("initialize")),
    refresh: jest.fn(async () => {
      order.push("refresh");
      return true;
    }),
    report: jest.fn((ok: boolean) => void order.push(`report:${ok}`)),
    warn: jest.fn(),
  };
  return {
    deps,
    order,
    run: () => runHeadlessRefresh({ ...deps, ...overrides }),
  };
}

describe("widget headless task", () => {
  it("reports success after a completed refresh", async () => {
    const { order, run } = setup();
    await run();
    expect(order).toEqual(["initialize", "refresh", "report:true"]);
  });

  it("reports failure when the refresh did not complete", async () => {
    const { deps, run } = setup({ refresh: async () => false });
    await run();
    expect(deps.report).toHaveBeenCalledWith(false);
  });

  it("reports failure, warns without details, and resolves when initialization throws", async () => {
    const { deps, run } = setup({
      initialize: async () => {
        throw Object.assign(new Error("Coffee $4.50"), { name: "DbError" });
      },
    });
    await expect(run()).resolves.toBeUndefined();
    expect(deps.report).toHaveBeenCalledWith(false);
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      "[widgets] Headless refresh failed (DbError)",
    );
  });

  it("still resolves when the report itself throws", async () => {
    const { run } = setup({
      report: () => {
        throw new Error("no module");
      },
    });
    await expect(run()).resolves.toBeUndefined();
  });
});
