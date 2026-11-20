import { describe, expect, it } from "vitest";
import { locales } from "@ladestack/i18n";
import { dashboardStrings } from "./dashboard";

describe("dashboard strings", () => {
  it("cover all eight locales, translated", () => {
    expect(Object.keys(dashboardStrings).sort()).toEqual([...locales].sort());
    for (const l of locales) {
      for (const [k, v] of Object.entries(dashboardStrings[l])) {
        expect(v.trim(), `${l}.${k}`).not.toBe("");
        const en = dashboardStrings.en[k as keyof typeof dashboardStrings.en];
        if (l !== "en" && k !== "profileReact" && en.length >= 12)
          expect(v, `${l}.${k}`).not.toBe(en);
      }
    }
  });
});
