import { describe, expect, test } from "bun:test";
import { listChrome, sheetHeight } from "./chrome";

// mirrors createChrome's sheetRows(), which needs a live renderer to call
const sheetRows = (terminalHeight: number): number =>
  Math.max(3, Math.round(terminalHeight * (1 / 2)) - 2);

// what overlays.ts computes for a scrolling list sheet
const menuHeight = (terminalHeight: number, contentLines: number): number => {
  const list = Math.max(
    1,
    Math.min(contentLines, Math.max(3, sheetRows(terminalHeight) - listChrome)),
  );
  return sheetHeight(list + listChrome);
};

// the sheet shares the footer with the waterline and the two status rows
const footerChrome = 3;

const sizes = [24, 30, 40, 44, 50, 60, 80];

describe("sheet sizing", () => {
  test("a long list settles near half the viewport", () => {
    for (const height of sizes.filter((rows) => rows >= 30)) {
      const share = menuHeight(height, 500) / height;
      expect(share).toBeGreaterThan(0.4);
      expect(share).toBeLessThan(0.6);
    }
  });

  test("it is taller than the three-eighths modal it replaced", () => {
    const asPanel = (terminalHeight: number): number => {
      const rows = Math.max(1, Math.round(terminalHeight * (3 / 8)) - 4);
      return Math.max(1, Math.min(500, Math.max(3, rows - listChrome))) + listChrome + 4;
    };
    for (const height of sizes.filter((rows) => rows >= 30))
      expect(menuHeight(height, 500)).toBeGreaterThan(asPanel(height));
  });

  test("it still leaves the transcript and the status rows on screen", () => {
    for (const height of sizes) {
      expect(menuHeight(height, 5000) + footerChrome).toBeLessThan(height);
    }
  });

  test("more content past the cap does not make it taller", () => {
    for (const height of sizes) expect(menuHeight(height, 5000)).toBe(menuHeight(height, 200));
  });

  test("a short list stays snug rather than padding out to the cap", () => {
    expect(menuHeight(60, 2)).toBeLessThan(menuHeight(60, 200));
  });

  test("keeps a usable list even on a 24-row terminal", () => {
    expect(sheetRows(24) - listChrome).toBeGreaterThanOrEqual(3);
  });
});

describe("sheet chrome", () => {
  test("reserves a row above and below the list for header and key legend", () => {
    expect(listChrome).toBe(4);
  });

  test("sheetHeight adds the title row and the row of top padding, and no border", () => {
    expect(sheetHeight(10)).toBe(12);
  });

  test("a list sheet is its list plus legend, both gaps, title and padding", () => {
    const list = 9;
    expect(sheetHeight(list + listChrome)).toBe(list + 4 + 2);
  });
});
