// Tiny pure seeded-RNG helpers for procedural world generation.
//
// Two pieces:
//   - `xmur3(str)` returns a 32-bit numeric-seed minter. Calling the returned
//     function once mints a single seed; this matches the canonical xmur3
//     idiom used by mulberry32-style PRNG demos. The same function is the
//     conceptual sibling of the seed-mixer already present in
//     `biomes.test.ts`'s `lcg(seed)`.
//   - `mulberry32(seed)` returns a `() => number` PRNG yielding values in
//     [0, 1). 32-bit state, ~5 lines, the canonical lightweight pure-JS
//     PRNG. Deterministic given the same seed.
//
// `makeSeededRng(stringSeed)` composes the two: mint a numeric seed from
// the string, then return the PRNG seeded with it. Pure — no globals, no
// `Math.random`.

/**
 * String → numeric seed minter. Returns a function that, each time it is
 * called, advances the internal hash and returns a fresh 32-bit seed.
 *
 * The two-call idiom in the wild (`const seed = xmur3('hello'); const a =
 * seed(); const b = seed();`) is how a string is split into multiple
 * independent numeric seeds for parallel PRNG streams. We use it once per
 * `makeSeededRng` call.
 */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * Mulberry32 PRNG. Returns a function yielding `[0, 1)` floats. Identical
 * input seed → identical output sequence; that determinism is the whole
 * point.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convenience: string seed → PRNG. Mints a single numeric seed via xmur3
 * and feeds it to mulberry32. The same string seed always yields the same
 * `() => number` sequence.
 */
export function makeSeededRng(stringSeed: string): () => number {
  const mint = xmur3(stringSeed);
  return mulberry32(mint());
}
