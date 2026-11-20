import { describe, expect, it } from "vitest";
import { locales } from "@ladestack/i18n";
import { errorBoundaryStrings } from "./errorBoundary";

describe("errorBoundary strings", () => {
  it("cover all eight locales, translated", () => {
    expect(Object.keys(errorBoundaryStrings).sort()).toEqual([...locales].sort());
    for (const l of locales) {
      const entry = errorBoundaryStrings[l];
      const en = errorBoundaryStrings.en;
      for (const [k, v] of Object.entries(entry)) {
        if (k === "scopes") continue;
        const str = v as string;
        expect(str.trim(), `${l}.${k}`).not.toBe("");
        const enStr = en[k as Exclude<keyof typeof en, "scopes">];
        if (l !== "en" && enStr.length >= 12) expect(str, `${l}.${k}`).not.toBe(enStr);
      }
      for (const [sk, sv] of Object.entries(entry.scopes)) {
        expect(sv.trim(), `${l}.scopes.${sk}`).not.toBe("");
      }
    }
  });
});
