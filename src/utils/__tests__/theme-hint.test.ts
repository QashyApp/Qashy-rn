import { createHash } from "crypto";

import { THEME_HINT_SCRIPT_HASH } from "@/utils/csp";
import {
  parseThemeHint,
  THEME_HINT_KEY,
  THEME_HINT_SCRIPT,
} from "@/utils/theme-hint";

describe("theme hint", () => {
  it("accepts only a scheme with two plain hex colors", () => {
    const ok = { scheme: "dark", background: "#0E0F13", accent: "#5966E9" };
    expect(parseThemeHint(JSON.stringify(ok))).toEqual(ok);
    for (const bad of [
      null,
      "",
      "not json",
      JSON.stringify({ ...ok, scheme: "sepia" }),
      JSON.stringify({ ...ok, background: "rgb(0,0,0)" }),
      JSON.stringify({ ...ok, accent: "#FFF" }),
      JSON.stringify({ scheme: "dark" }),
      JSON.stringify([ok]),
    ]) {
      expect(parseThemeHint(bad)).toBeNull();
    }
  });

  it("pins the inline script's hash in the content security policy", () => {
    const hash = `sha256-${createHash("sha256").update(THEME_HINT_SCRIPT).digest("base64")}`;
    expect(THEME_HINT_SCRIPT_HASH).toBe(hash);
  });

  it("reads only the hint key and never throws", () => {
    expect(THEME_HINT_SCRIPT).toContain(THEME_HINT_KEY);
    const values: Record<string, string> = {};
    const style = {
      setProperty: (name: string, value: string) => {
        values[name] = value;
      },
      colorScheme: "",
    };
    const run = (stored: string | null) =>
      new Function("localStorage", "document", THEME_HINT_SCRIPT)(
        { getItem: () => stored },
        { documentElement: { style } },
      );
    run(
      JSON.stringify({
        scheme: "dark",
        background: "#0E0F13",
        accent: "#000000",
      }),
    );
    expect(values["--qashy-bg"]).toBe("#0E0F13");
    expect(style.colorScheme).toBe("dark");
    for (const key of Object.keys(values)) delete values[key];
    run("{not json");
    run(JSON.stringify({ scheme: "dark", background: "red" }));
    expect(values).toEqual({});
  });
});
