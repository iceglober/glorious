import { describe, expect, test } from "bun:test";
import { listChrome, panelHeight } from "./chrome";

// mirrors createChrome's panelRows(), which needs a live renderer to call
const panelRows = (terminalHeight: number): number =>
  Math.max(1, Math.round(terminalHeight * (3 / 8)) - 4);

// what overlays.ts computes for a scrolling list modal
const modalHeight = (terminalHeight: number, contentLines: number): number => {
  const list = Math.max(
    1,
    Math.min(contentLines, Math.max(3, panelRows(terminalHeight) - listChrome)),
  );
  return panelHeight(list + listChrome);
};

const sizes = [24, 30, 40, 44, 50, 60, 80];

describe("modal sizing", () => {
  test("a long list settles near three eighths of the viewport", () => {
    for (const height of sizes.filter((rows) => rows >= 30)) {
      const share = modalHeight(height, 500) / height;
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.45);
    }
  });

  test("content never pushes the modal to fill the screen", () => {
    for (const height of sizes) {
      expect(modalHeight(height, 5)).toBeLessThan(height);
      expect(modalHeight(height, 5000)).toBeLessThan(height);
    }
  });

  test("more content past the cap does not make it taller", () => {
    for (const height of sizes) expect(modalHeight(height, 5000)).toBe(modalHeight(height, 200));
  });

  test("a short list stays snug rather than padding out to the cap", () => {
    expect(modalHeight(60, 2)).toBeLessThan(modalHeight(60, 200));
  });

  test("keeps a usable list even on a 24-row terminal", () => {
    expect(modalHeight(24, 500) - listChrome - 4).toBeGreaterThanOrEqual(3);
  });
});

describe("modal chrome", () => {
  test("reserves a row above and below the list for header and key legend", () => {
    expect(listChrome).toBe(4);
  });

  test("panelHeight adds the border and vertical padding", () => {
    expect(panelHeight(10)).toBe(14);
  });

  test("a list modal is its list plus header, legend, both gaps, and the frame", () => {
    const list = 9;
    expect(panelHeight(list + listChrome)).toBe(list + 4 + 4);
  });
});
