import { describe, expect, test } from "bun:test";
import { andThen, collectResults, err, fold, mapResult, ok, pipe, UnwrapError, unwrap } from "./fp";

describe("Result", () => {
  test("mapResult transforms ok values and passes errors through untouched", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(mapResult(err("boom"), (n: number) => n * 3)).toEqual(err("boom"));
  });

  test("andThen chains ok results and short-circuits on the first error", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("odd" as const));
    expect(andThen(ok(4), half)).toEqual(ok(2));
    expect(andThen(ok(3), half)).toEqual(err("odd"));
    expect(andThen(err("early"), half)).toEqual(err("early"));
  });

  test("collectResults gathers values in order and returns the first error", () => {
    expect(collectResults([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(collectResults([ok(1), err("a"), err("b")])).toEqual(err("a"));
  });

  test("unwrap returns the value and throws UnwrapError carrying the typed error", () => {
    expect(unwrap(ok("v"))).toBe("v");
    try {
      unwrap(err({ reason: "nope" }));
      throw new Error("should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(UnwrapError);
      expect((thrown as UnwrapError).error).toEqual({ reason: "nope" });
      expect((thrown as UnwrapError).message).toMatch(/unwrap of err/);
    }
  });

  test("unwrap also accepts a Promise<Result> — `await unwrap(call())` works", async () => {
    expect(await unwrap(Promise.resolve(ok(42)))).toBe(42);
    expect(unwrap(Promise.resolve(err("boom")))).rejects.toBeInstanceOf(UnwrapError);
  });
});

describe("pipe and fold", () => {
  test("pipe threads a value through functions left to right", () => {
    const result = pipe(
      2,
      (n) => n + 1,
      (n) => n * 10,
      (n) => `${n}!`,
    );
    expect(result).toBe("30!");
  });

  test("fold reduces an iterable with an explicit initial value", () => {
    expect(fold((acc: number, n: number) => acc + n, 0, [1, 2, 3, 4])).toBe(10);
    expect(fold((acc: string, s: string) => acc + s, "", ["a", "b"])).toBe("ab");
  });

  test("fold of a concatenation equals fold composed — the projection law", () => {
    const add = (acc: number, n: number) => acc + n;
    const xs = [1, 2, 3];
    const ys = [4, 5];
    expect(fold(add, 0, [...xs, ...ys])).toBe(fold(add, fold(add, 0, xs), ys));
  });
});
