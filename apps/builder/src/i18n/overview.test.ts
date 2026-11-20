import { describe, expect, it } from "vitest";
import { locales } from "@ladestack/i18n";
import { overviewStrings } from "./overview";

describe("overview strings", () => {
  it("cover all eight locales, translated", () => {
    expect(Object.keys(overviewStrings).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      for (const [key, value] of Object.entries(overviewStrings[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
        const en = overviewStrings.en[key as keyof typeof overviewStrings.en];
        if (locale !== "en" && en.length >= 12) {
          expect(value, `${locale}.${key}`).not.toBe(en);
        }
      }
    }
  });
});
