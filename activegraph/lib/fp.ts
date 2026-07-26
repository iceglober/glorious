/**
 * The FP kernel — the entire non-zod dependency surface of the domain layer.
 *
 * Deliberately tiny and local (no fp-ts): a `Result` tagged union matching the
 * repo's `{ ok: true } | { ok: false }` house style, an overloaded `pipe` for
 * left-to-right composition, `fold` (the projection primitive), and `Brand`
 * for nominal typing of ids. Everything here is pure and synchronous.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const mapResult = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

export const andThen = <T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> =>
  r.ok ? f(r.value) : r;

/** First error wins; on all-ok returns the values in input order. */
export const collectResults = <T, E>(rs: readonly Result<T, E>[]): Result<readonly T[], E> => {
  const values: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
};

/** Unwrap for contexts where an error is a programming bug, not a domain outcome. */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(`unwrap of err: ${JSON.stringify(r.error)}`);
  return r.value;
};

export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): G;
export function pipe(a: unknown, ...fns: readonly ((x: unknown) => unknown)[]): unknown {
  return fns.reduce((acc, f) => f(acc), a);
}

/** Left fold — `project` and every other log consumer is an instance of this. */
export const fold = <A, B>(f: (acc: B, item: A) => B, init: B, items: Iterable<A>): B => {
  let acc = init;
  for (const item of items) acc = f(acc, item);
  return acc;
};

/** Nominal typing: `Brand<string, "ObjectId">` is not assignable from a bare string. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
