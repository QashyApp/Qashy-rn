import { CanonicalJsonError, canonicalJson } from "@/utils/canonical-json";

describe("canonicalJson refuses ambiguous shapes", () => {
  it("throws on a sparse array hole rather than encoding it like an empty slot", () => {
    const sparse = [, 1];
    expect(() => canonicalJson(sparse)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson([])).not.toThrow();
    expect(canonicalJson([])).toBe("[]");
    expect(() => canonicalJson([,])).toThrow(/sparse array hole/);
  });

  it("throws on own symbol keys instead of silently dropping them", () => {
    const withSymbol = { visible: 1, [Symbol("hidden")]: 2 };
    expect(() => canonicalJson(withSymbol)).toThrow(CanonicalJsonError);
    expect(canonicalJson({ visible: 1 })).toBe('{"visible":1}');
  });

  it("still encodes dense arrays and sorted keys", () => {
    expect(canonicalJson({ b: [1, 2], a: "x" })).toBe('{"a":"x","b":[1,2]}');
  });
});
