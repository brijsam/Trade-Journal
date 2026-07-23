/**
 * Display formatting. Small functions, but every figure the app and the
 * exported reports show goes through them, and each one has the same contract:
 * a missing value renders as an em dash rather than "NaN" or "$null". These
 * pin that contract, the sign handling, and the overloads' narrowing behaviour
 * at runtime (num(x, 0) never returning null is what lets the call sites skip
 * their own null checks).
 */
import { describe, it, expect } from "vitest";
import {
  num, round, fmtCurrency, fmtPercent, fmtNum, fmtProfitFactor, fmtSignedCurrency, fmtSignedPercent,
} from "./format";

describe("num", () => {
  it("parses what a form field or a CSV cell actually holds", () => {
    expect(num("65000")).toBe(65000);
    expect(num("  -12.5 ")).toBe(-12.5);
    expect(num(42)).toBe(42);
    // parseFloat's leading-number behaviour, relied on by CSV imports that
    // carry a unit ("1.5 BTC").
    expect(num("1.5 BTC")).toBe(1.5);
  });

  it("falls back rather than handing NaN onward", () => {
    expect(num("", 0)).toBe(0);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num("abc")).toBeNull();
    expect(num({}, 7)).toBe(7);
    expect(num(Infinity, 0)).toBe(0);
  });
});

describe("round", () => {
  it("rounds to the requested places, six by default", () => {
    expect(round(1.23456789)).toBe(1.234568);
    expect(round(1234.5678, 2)).toBe(1234.57);
    expect(round(-2.345, 1)).toBe(-2.3);
  });

  // Binary floats: 1.005 is stored slightly under 1.005, so ×100 lands on
  // 100.49999999999999 and rounds down. Pinned rather than "fixed" — an epsilon
  // nudge here would shift every derived P&L figure in the journal, and the
  // display digits it feeds are two places on values that are already rounded.
  it("rounds a half-way binary float down, as multiply-and-round does", () => {
    expect(round(1.005, 2)).toBe(1);
    // …and 2.675 stores slightly over, so the same operation rounds it up. The
    // direction follows the stored float, not the decimal that was typed.
    expect(round(2.675, 2)).toBe(2.68);
  });

  it("passes a non-number through untouched instead of coercing it", () => {
    expect(round(null)).toBeNull();
    expect(round(undefined)).toBeUndefined();
    expect(round(Infinity)).toBe(Infinity);
    expect(round(NaN)).toBeNaN();
  });
});

describe("currency, percent and number", () => {
  it("keeps the minus outside the dollar sign", () => {
    expect(fmtCurrency(1234.5)).toBe("$1,234.50");
    expect(fmtCurrency(-1234.5)).toBe("-$1,234.50");
    expect(fmtCurrency(0)).toBe("$0.00");
  });

  it("takes Intl options for the odd caller that needs them", () => {
    expect(fmtCurrency(1234.5678, { maximumFractionDigits: 4, minimumFractionDigits: 4 })).toBe("$1,234.5678");
  });

  it("formats percentages and plain numbers to the digits asked for", () => {
    expect(fmtPercent(66.6666)).toBe("66.67%");
    expect(fmtPercent(66.6666, 1)).toBe("66.7%");
    expect(fmtNum(2)).toBe("2.00");
    expect(fmtNum(2.345, 1)).toBe("2.3");
  });

  it("renders a missing value as an em dash, never NaN", () => {
    [fmtCurrency, fmtPercent, fmtNum, fmtProfitFactor, fmtSignedCurrency, fmtSignedPercent].forEach((fn) => {
      expect(fn(null)).toBe("—");
      expect(fn(undefined)).toBe("—");
      expect(fn(NaN)).toBe("—");
    });
  });
});

describe("signed and infinite forms", () => {
  it("marks a gain with a plus and leaves a loss with its own minus", () => {
    expect(fmtSignedCurrency(120)).toBe("+$120.00");
    expect(fmtSignedCurrency(-120)).toBe("-$120.00");
    expect(fmtSignedCurrency(0)).toBe("$0.00");
  });

  it("does the same for percentages, one decimal by default", () => {
    expect(fmtSignedPercent(12.34)).toBe("+12.3%");
    expect(fmtSignedPercent(-12.34)).toBe("-12.3%");
    expect(fmtSignedPercent(0)).toBe("0.0%");
    expect(fmtSignedPercent(12.34, 2)).toBe("+12.34%");
  });

  // An unbeaten run has no gross loss to divide by; summarize() reports that as
  // Infinity on purpose, and it has to read as ∞ rather than "Infinity".
  it("shows an unbeaten profit factor as ∞", () => {
    expect(fmtProfitFactor(Infinity)).toBe("∞");
    expect(fmtProfitFactor(2.5)).toBe("2.50");
  });
});
