/**
 * IdStrategy — how new object/relation/request/approval ids are derived. The
 * type lives in the domain (`domain/step.ts`) because the pure settle
 * functions consume it; it is re-exported here as the port surface for
 * composition roots. The default `derivedIdStrategy` is a pure function of
 * the introducing event id, so determinism needs no id state at all.
 */
export type { IdStrategy } from "../domain/step";
export { derivedIdStrategy } from "../domain/step";
