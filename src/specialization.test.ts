// Pure tests for `effectiveSpecializationMultipliers` per SPEC §9.4.
//
// Asserts each role's resolved multiplier bundle matches the catalog's
// stated buff/penalty pattern. The composition convention is:
//   effectiveRate(cat) = recipeRateByCategory[cat] × globalRecipeRate
// so for "buff category, others penalty" roles we expect:
//   buffCat   product = buffMultiplier
//   otherCat  product = penaltyMultiplier

import { describe, expect, it } from 'vitest';

import { ALL_RECIPE_CATEGORIES, type RecipeCategory } from './recipes.js';
import {
  effectiveSpecializationMultipliers,
  IDENTITY_SPECIALIZATION,
  ROLE_DEFS,
  type RoleId,
  type SpecializationMultipliers,
} from './specialization.js';

function rateFor(mul: SpecializationMultipliers, cat: RecipeCategory): number {
  return (mul.recipeRateByCategory[cat] ?? 1) * mul.globalRecipeRate;
}

describe('effectiveSpecializationMultipliers — per §9.4', () => {
  it('null role returns identity (every multiplier 1.0)', () => {
    const mul = effectiveSpecializationMultipliers(null);
    expect(mul.globalRecipeRate).toBe(1);
    expect(mul.storageCapMul).toBe(1);
    expect(mul.xpMul).toBe(1);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      expect(mul.recipeRateByCategory[cat]).toBe(1);
    }
  });

  it('IDENTITY_SPECIALIZATION constant matches null-role result', () => {
    const mul = effectiveSpecializationMultipliers(null);
    expect(IDENTITY_SPECIALIZATION.globalRecipeRate).toBe(mul.globalRecipeRate);
    expect(IDENTITY_SPECIALIZATION.storageCapMul).toBe(mul.storageCapMul);
    expect(IDENTITY_SPECIALIZATION.xpMul).toBe(mul.xpMul);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      expect(IDENTITY_SPECIALIZATION.recipeRateByCategory[cat]).toBe(
        mul.recipeRateByCategory[cat],
      );
    }
  });

  it('foundry: smelting × 1.5, all others × 0.75', () => {
    const mul = effectiveSpecializationMultipliers('foundry');
    expect(rateFor(mul, 'smelting')).toBeCloseTo(1.5, 12);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      if (cat === 'smelting') continue;
      expect(rateFor(mul, cat)).toBeCloseTo(0.75, 12);
    }
    expect(mul.storageCapMul).toBe(1);
    expect(mul.xpMul).toBe(1);
  });

  it('refinery: chemistry × 1.5, all others × 0.75', () => {
    const mul = effectiveSpecializationMultipliers('refinery');
    expect(rateFor(mul, 'chemistry')).toBeCloseTo(1.5, 12);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      if (cat === 'chemistry') continue;
      expect(rateFor(mul, cat)).toBeCloseTo(0.75, 12);
    }
    expect(mul.storageCapMul).toBe(1);
    expect(mul.xpMul).toBe(1);
  });

  it('mining: extraction × 1.75, all others × 0.50', () => {
    const mul = effectiveSpecializationMultipliers('mining');
    expect(rateFor(mul, 'extraction')).toBeCloseTo(1.75, 12);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      if (cat === 'extraction') continue;
      expect(rateFor(mul, cat)).toBeCloseTo(0.50, 12);
    }
    expect(mul.storageCapMul).toBe(1);
    expect(mul.xpMul).toBe(1);
  });

  it('logistics_hub: logistics × 2.0, others × 0.75, storageCapMul = 1.5', () => {
    const mul = effectiveSpecializationMultipliers('logistics_hub');
    expect(rateFor(mul, 'logistics')).toBeCloseTo(2.0, 12);
    for (const cat of ALL_RECIPE_CATEGORIES) {
      if (cat === 'logistics') continue;
      expect(rateFor(mul, cat)).toBeCloseTo(0.75, 12);
    }
    expect(mul.storageCapMul).toBeCloseTo(1.5, 12);
    expect(mul.xpMul).toBe(1);
  });

  it('research_beacon: all recipes × 0.75, xpMul = 1.5, no per-category buff', () => {
    const mul = effectiveSpecializationMultipliers('research_beacon');
    for (const cat of ALL_RECIPE_CATEGORIES) {
      expect(rateFor(mul, cat)).toBeCloseTo(0.75, 12);
    }
    expect(mul.xpMul).toBeCloseTo(1.5, 12);
    expect(mul.storageCapMul).toBe(1);
  });

  it('ROLE_DEFS metadata is consistent with the effective multipliers', () => {
    // Sanity: every catalog entry has the structural fields the UI consumes,
    // and the buff/penalty figures match the multipliers the economy applies.
    const roles: RoleId[] = ['foundry', 'refinery', 'mining', 'logistics_hub', 'research_beacon'];
    for (const id of roles) {
      const def = ROLE_DEFS[id];
      expect(def.id).toBe(id);
      expect(def.tierRequirement).toBe(3);
      expect(def.penaltyMultiplier).toBeGreaterThan(0);
      expect(def.penaltyMultiplier).toBeLessThanOrEqual(1);
      const mul = effectiveSpecializationMultipliers(id);
      if (def.buffCategory !== 'all') {
        expect(rateFor(mul, def.buffCategory)).toBeCloseTo(def.buffMultiplier, 12);
      }
    }
  });
});
