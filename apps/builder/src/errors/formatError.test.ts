import { describe, expect, it } from "vitest";
import {
  formatErrorCopyText,
  haveResetKeysChanged,
  normalizeUiError,
  sanitizeErrorText,
} from "./formatError";

describe("sanitizeErrorText", () => {
  it("redacts API keys and bearer tokens while preserving useful messages", () => {
    const raw =
      "Request failed with Bearer eyJhbGciOiJIUzI1NiJ9.secret, key sk-ant-api03-1234567890abcdef and AIzaSyD1234567890abcdefghijk";
    const clean = sanitizeErrorText(raw);
    expect(clean).toContain("Bearer [redacted]");
    expect(clean).toContain("[redacted-key]");
    expect(clean).not.toContain("eyJhbGci");
    expect(clean).not.toContain("sk-ant-");
    expect(clean).not.toContain("AIzaSyD");
  });

  it("truncates overly long stack output", () => {
    const long = "a".repeat(3000);
    const clean = sanitizeErrorText(long);
    expect(clean.length).toBeLessThan(2500);
    expect(clean.endsWith("…")).toBe(true);
  });
});

describe("normalizeUiError", () => {
  it("extracts Error properties and sanitizes component stack", () => {
    const err = new TypeError("Cannot read properties of null (sk-proj-abcdefghijklmno)");
    const report = normalizeUiError(
      err,
      "\n    in ProjectDashboard\n    in Workspace\n",
      () => new Date("2026-11-20T12:00:00.000Z"),
    );
    expect(report.name).toBe("TypeError");
    expect(report.message).toBe("Cannot read properties of null ([redacted-key])");
    expect(report.componentStack).toBe("in ProjectDashboard\n    in Workspace");
    expect(report.timestamp).toBe("2026-11-20T12:00:00.000Z");
  });

  it("handles non-Error thrown values safely", () => {
    expect(normalizeUiError("boom").message).toBe("boom");
    expect(normalizeUiError(null).message).toBe("Unexpected application error.");
  });
});

describe("formatErrorCopyText", () => {
  it("produces a structured diagnostic summary", () => {
    const text = formatErrorCopyText(
      {
        name: "RangeError",
        message: "Invalid array length",
        stack: "RangeError: Invalid array length\n  at render",
        componentStack: "in CodeEditor",
        timestamp: "2026-11-20T12:00:00.000Z",
      },
      "Code editor",
    );
    expect(text).toContain("Scope: Code editor");
    expect(text).toContain("RangeError: Invalid array length");
    expect(text).toContain("Component stack:\nin CodeEditor");
    expect(text).toContain("Stack trace:\nRangeError");
  });
});

describe("haveResetKeysChanged", () => {
  it("compares shallow arrays using Object.is", () => {
    expect(haveResetKeysChanged(["a", 1], ["a", 1])).toBe(false);
    expect(haveResetKeysChanged(["a", 1], ["a", 2])).toBe(true);
    expect(haveResetKeysChanged(["a"], ["a", "b"])).toBe(true);
    expect(haveResetKeysChanged([NaN], [NaN])).toBe(false);
  });
});
