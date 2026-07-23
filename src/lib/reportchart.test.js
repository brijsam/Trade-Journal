/**
 * The exported reports' charts. These builders are strings in, strings out —
 * no React, no DOM — so the assertions are on the markup: that the geometry is
 * finite and inside the viewBox, that P&L keeps its colour meaning, that free
 * text is escaped, and that the degenerate inputs a real journal produces
 * (empty, single point, all-equal, all-zero) render something rather than a
 * broken path.
 */
import { describe, it, expect } from "vitest";
import {
  niceStep, axisTicks, axisLabel, svgLineChart, svgBarChart, svgDonut, chartLegend, htmlBarRows, REPORT_COLORS,
} from "./reportchart";

const pt = (label, value) => ({ label, value });

describe("axis scaling", () => {
  it("rounds the step to a 1/2/5 × power of ten", () => {
    // 100 over 4 lines wants 25 a line, which is not a 1/2/5 value — it rounds
    // up to 50 rather than labelling the axis 25, 50, 75.
    expect(niceStep(100)).toBe(50);
    expect(niceStep(1000)).toBe(500);
    expect(niceStep(80)).toBe(20);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });

  it("snaps the first and last gridline outward to whole steps", () => {
    const ticks = axisTicks(-137, 842);
    expect(ticks[0]).toBeLessThanOrEqual(-137);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(842);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it("still draws an axis for a flat series", () => {
    const ticks = axisTicks(500, 500);
    expect(ticks.length).toBeGreaterThan(1);
    expect(Math.min(...ticks)).toBeLessThan(500);
    expect(Math.max(...ticks)).toBeGreaterThan(500);
  });

  it("shortens money for the axis", () => {
    expect(axisLabel(12500)).toBe("12.5k");
    expect(axisLabel(-2400000)).toBe("-2.4M");
    expect(axisLabel(42)).toBe("42");
  });
});

describe("svgLineChart — equity curve", () => {
  const points = [pt("Start", 1000), pt("Jul 10", 1100), pt("Jul 12", 1050), pt("Jul 15", 1300)];

  it("draws a line and a filled area over the points", () => {
    const svg = svgLineChart(points);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("stroke-width=\"2\"");
    expect(svg).toContain("fill-opacity=\"0.12\"");
    // One vertex per point in the line path.
    const line = svg.match(/d="(M[^"]+)"/g).pop();
    expect(line.match(/\d+(\.\d+)?,/g).length).toBeGreaterThanOrEqual(points.length);
  });

  it("labels only the first and last point", () => {
    const svg = svgLineChart(points);
    expect(svg).toContain(">Start<");
    expect(svg).toContain(">Jul 15<");
    expect(svg).not.toContain(">Jul 12<");
  });

  it("keeps every coordinate finite and inside the viewBox", () => {
    const svg = svgLineChart(points, { width: 400, height: 200 });
    const coords = [...svg.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    expect(coords.length).toBeGreaterThan(0);
    coords.forEach(([, x, y]) => {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(400);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(200);
    });
    expect(svg).not.toContain("NaN");
  });

  it("says so rather than drawing an empty frame with nothing to plot", () => {
    expect(svgLineChart([])).toContain("chart-empty");
    expect(svgLineChart([pt("Start", 1000)])).toContain("chart-empty");
  });

  it("survives a perfectly flat curve", () => {
    const svg = svgLineChart([pt("a", 500), pt("b", 500), pt("c", 500)]);
    expect(svg).not.toContain("NaN");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("escapes a label instead of letting it close the tag", () => {
    expect(svgLineChart([pt("<script>", 1), pt("b", 2)])).toContain("&lt;script&gt;");
  });
});

describe("svgBarChart — signed P&L bars", () => {
  it("colours by sign, never by the caller", () => {
    const svg = svgBarChart([pt("Jan", 400), pt("Feb", -250)]);
    expect(svg).toContain(REPORT_COLORS.profit);
    expect(svg).toContain(REPORT_COLORS.loss);
  });

  it("hangs losses below the same zero baseline profits sit on", () => {
    const svg = svgBarChart([pt("Jan", 400), pt("Feb", -400)], { width: 400, height: 200 });
    const rects = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" fill="(#[0-9A-Fa-f]{6})"/g)];
    expect(rects).toHaveLength(2);
    const [win, loss] = rects;
    // The profit bar's bottom edge and the loss bar's top edge meet at zero.
    expect(Number(win[1]) + Number(win[2])).toBeCloseTo(Number(loss[1]), 1);
    expect(win[3]).toBe(REPORT_COLORS.profit);
    expect(loss[3]).toBe(REPORT_COLORS.loss);
  });

  it("gives a zero month a visible tick rather than nothing", () => {
    const svg = svgBarChart([pt("Jan", 0)]);
    expect(svg).toMatch(/height="[1-9]/);
  });

  it("rotates the labels only once the slots get tight", () => {
    expect(svgBarChart([pt("Jan", 1), pt("Feb", 2)], { width: 720 })).not.toContain("rotate(-40");
    expect(svgBarChart(Array.from({ length: 24 }, (_, i) => pt(`M${i}`, i - 12)), { width: 720 })).toContain("rotate(-40");
  });

  it("says so rather than drawing an empty frame", () => {
    expect(svgBarChart([])).toContain("chart-empty");
  });
});

describe("svgDonut — win/loss split", () => {
  const slices = [
    { label: "Wins", value: 6, color: REPORT_COLORS.profit },
    { label: "Losses", value: 4, color: REPORT_COLORS.loss },
  ];

  it("splits the circumference in proportion to the values", () => {
    const svg = svgDonut(slices, { size: 200 });
    const dashes = [...svg.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(dashes).toHaveLength(2);
    expect(dashes[0] / (dashes[0] + dashes[1])).toBeCloseTo(0.6, 2);
  });

  it("carries the headline figure in the hole", () => {
    const svg = svgDonut(slices, { centerLabel: "60.0%", centerSub: "10 trades" });
    expect(svg).toContain(">60.0%<");
    expect(svg).toContain(">10 trades<");
  });

  it("skips empty slices and still draws a single-outcome journal", () => {
    const svg = svgDonut([{ label: "Wins", value: 3, color: "#0F9D52" }, { label: "Losses", value: 0, color: "#D63A50" }]);
    expect([...svg.matchAll(/stroke-dasharray/g)]).toHaveLength(1);
    expect(svg).not.toContain("NaN");
  });

  it("says so when nothing is closed yet", () => {
    expect(svgDonut([{ label: "Wins", value: 0, color: "#0F9D52" }])).toContain("chart-empty");
  });

  it("legends only the slices that exist", () => {
    const legend = chartLegend([...slices, { label: "Breakeven", value: 0, color: "#888" }]);
    expect(legend).toContain("Wins");
    expect(legend).not.toContain("Breakeven");
    expect(chartLegend([])).toBe("");
  });
});

describe("htmlBarRows — the Word report's bars", () => {
  it("scales every bar against the widest absolute value", () => {
    const html = htmlBarRows([pt("ICT", 500), pt("Scalping", -250)]);
    const widths = [...html.matchAll(/width="(\d+)%" bgcolor/g)].map((m) => Number(m[1]));
    expect(widths).toEqual([100, 50]);
  });

  it("keeps the P&L colour meaning Word can actually render", () => {
    const html = htmlBarRows([pt("Loss", -10)]);
    expect(html).toContain(`bgcolor="${REPORT_COLORS.loss}"`);
    // No SVG on this path — Word drops it silently.
    expect(html).not.toContain("<svg");
  });

  it("formats the value with the caller's formatter", () => {
    expect(htmlBarRows([pt("ICT", 1234.5)], { format: (v) => `$${v.toFixed(2)}` })).toContain("$1234.50");
  });

  it("escapes the row label", () => {
    expect(htmlBarRows([pt("<b>x</b>", 1)])).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("does not divide by zero when every value is zero", () => {
    const html = htmlBarRows([pt("Jan", 0), pt("Feb", 0)]);
    expect(html).not.toContain("NaN");
    expect(html).toContain("width=\"1%\"");
  });

  it("says so rather than rendering an empty table", () => {
    expect(htmlBarRows([])).toContain("chart-empty");
  });
});
