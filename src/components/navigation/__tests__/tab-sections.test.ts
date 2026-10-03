import { sectionOfPathname } from "@/components/navigation/tab-sections";

describe("sectionOfPathname", () => {
  it("maps a path to its section, however deep", () => {
    expect(sectionOfPathname("/overview")).toBe("overview");
    expect(sectionOfPathname("/transactions/abc")).toBe("transactions");
    expect(sectionOfPathname("/more")).toBe("more");
  });

  it("returns null outside the tabs", () => {
    expect(sectionOfPathname("/")).toBeNull();
    expect(sectionOfPathname("/appearance")).toBeNull();
  });
});
