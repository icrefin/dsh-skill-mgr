/**
 * Published type surface of `dsh-skill-mgr` (`exports["./types"]`).
 *
 * Both halves import their payload types from here; the values live in
 * `wire.ts` (the zod schemas that define them). Re-exported as types only so a
 * consumer that only needs the shapes never pulls zod in.
 *
 * @module dsh-skill-mgr/types
 */

export type * from './wire.ts'
