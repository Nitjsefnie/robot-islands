// Pure-helper tests for the inventory modal panel.
//
// The panel itself is DOM and JSDOM isn't configured in this repo (per
// AGENTS.md "tests target the pure layer only"). The interesting logic is
// the resource categorisation table — verified to be complete and to honour
// the Fuel/Liquid precedence rule from the brief.

import { describe, expect, it } from 'vitest';

import {
  RESOURCE_CATEGORY,
  RESOURCE_FILTER_LABEL,
  RESOURCE_FILTER_ORDER,
} from './inventory-ui.js';
import { ALL_RESOURCES } from './recipes.js';

describe('RESOURCE_CATEGORY', () => {
  it('covers every ResourceId', () => {
    for (const r of ALL_RESOURCES) {
      expect(RESOURCE_CATEGORY[r]).toBeDefined();
    }
  });

  it('places T0 raws in the Raw bucket', () => {
    expect(RESOURCE_CATEGORY.wood).toBe('raw');
    expect(RESOURCE_CATEGORY.iron_ore).toBe('raw');
    expect(RESOURCE_CATEGORY.coal).toBe('raw');
    expect(RESOURCE_CATEGORY.stone).toBe('raw');
  });

  it('places fuels in the Fuel bucket (precedence over Raw/Refined)', () => {
    // Biofuel is a Refined T1 product AND a fuel — brief mandates Fuel wins.
    expect(RESOURCE_CATEGORY.biofuel).toBe('fuel');
    expect(RESOURCE_CATEGORY.diesel).toBe('fuel');
    expect(RESOURCE_CATEGORY.aviation_kerosene).toBe('fuel');
    expect(RESOURCE_CATEGORY.cryogenic_hydrogen).toBe('fuel');
    expect(RESOURCE_CATEGORY.plasma_charge).toBe('fuel');
  });

  it('places liquids in the Liquid bucket', () => {
    expect(RESOURCE_CATEGORY.fresh_water).toBe('liquid');
    expect(RESOURCE_CATEGORY.saltwater).toBe('liquid');
    expect(RESOURCE_CATEGORY.crude_oil).toBe('liquid');
    expect(RESOURCE_CATEGORY.hydrogen).toBe('liquid');
    expect(RESOURCE_CATEGORY.nitrogen).toBe('liquid');
  });

  it('places rare T4/T5 raws + components in the Rare bucket', () => {
    expect(RESOURCE_CATEGORY.helium_3).toBe('rare');
    expect(RESOURCE_CATEGORY.casimir_energy).toBe('rare');
    expect(RESOURCE_CATEGORY.reality_anchor).toBe('rare');
    expect(RESOURCE_CATEGORY.dark_matter).toBe('rare');
  });

  it('places refined T1 products in Refined', () => {
    expect(RESOURCE_CATEGORY.iron_ingot).toBe('refined');
    expect(RESOURCE_CATEGORY.lumber).toBe('refined');
    expect(RESOURCE_CATEGORY.glass).toBe('refined');
  });
});

describe('RESOURCE_FILTER_ORDER', () => {
  it('starts with All', () => {
    expect(RESOURCE_FILTER_ORDER[0]).toBe('all');
  });

  it('lists each chip exactly once', () => {
    const seen = new Set<string>();
    for (const c of RESOURCE_FILTER_ORDER) {
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });

  it('has a label for every chip', () => {
    for (const c of RESOURCE_FILTER_ORDER) {
      expect(RESOURCE_FILTER_LABEL[c]).toBeTruthy();
    }
  });
});
