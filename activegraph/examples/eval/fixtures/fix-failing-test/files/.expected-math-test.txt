import { expect, test } from "bun:test";
import { total } from "./math";

test("total sums the list", () => {
  expect(total([1, 2, 3])).toBe(6);
});

test("total of nothing is zero", () => {
  expect(total([])).toBe(0);
});
