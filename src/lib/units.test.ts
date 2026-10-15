import { describe, expect, it } from 'vitest';
import { amountOf, defaultPortion, isApprox, measureGroups, measureOf, portionFor, portionLabel, qtyIn } from './units';

const milk = { unit: 'ml' as const, servingSize: 200 };
const oats = { unit: 'g' as const };
const nutella = { unit: 'g' as const, servingSize: 15 };

describe('amountOf', () => {
  it('turns a quantity of any measure into the food’s own unit', () => {
    expect(amountOf(milk, { measure: 'l', qty: 0.5 })).toBe(500);
    expect(amountOf(milk, { measure: 'glass', qty: 1 })).toBe(250);
    expect(amountOf(milk, { measure: 'cup', qty: 2 })).toBe(480);
    expect(amountOf(milk, { measure: 'serving', qty: 1.5 })).toBe(300);
    expect(amountOf(oats, { measure: 'kg', qty: 0.125 })).toBe(125);
    expect(amountOf(oats, { measure: 'tbsp', qty: 2 })).toBe(30);
    expect(amountOf(oats, { measure: 'tsp', qty: 1 })).toBe(5);
  });

  it('is zero for an empty quantity or a serving the food lacks', () => {
    expect(amountOf(milk, { measure: 'ml', qty: undefined })).toBe(0);
    expect(amountOf(milk, { measure: 'ml', qty: -5 })).toBe(0);
    expect(amountOf(oats, { measure: 'serving', qty: 1 })).toBe(0);
  });

  it('does not leak floating-point noise into the amount', () => {
    expect(amountOf(milk, { measure: 'l', qty: 0.7 })).toBe(700);
    expect(amountOf(oats, { measure: 'kg', qty: 0.3 })).toBe(300);
  });
});

describe('measures', () => {
  it('lists the serving first, then the food’s own kind of unit', () => {
    expect(measureGroups(milk).map((g) => g.label)).toEqual(['Porción', 'Volumen', 'Peso']);
    expect(measureGroups(oats).map((g) => g.label)).toEqual(['Peso', 'Volumen']);
    expect(measureGroups(milk)[0].measures[0].option).toBe('Porción (200 ml)');
    expect(measureGroups(milk)[1].measures.map((m) => m.option)).toEqual([
      'Mililitros (ml)',
      'Litros (l)',
      'Vaso (250 ml)',
      'Taza (240 ml)',
      'Cucharada (15 ml)',
      'Cucharadita (5 ml)',
    ]);
  });

  it('flags volume on a weighed food (and the reverse) as approximate', () => {
    expect(isApprox(oats, 'tbsp')).toBe(true);
    expect(isApprox(milk, 'g')).toBe(true);
    expect(isApprox(milk, 'glass')).toBe(false);
    expect(isApprox(oats, 'kg')).toBe(false);
    expect(isApprox(nutella, 'serving')).toBe(false);
  });
});

describe('qtyIn', () => {
  it('keeps the amount when switching between metric units', () => {
    expect(qtyIn(milk, 'l', 250)).toBe(0.25);
    expect(qtyIn(milk, 'ml', 250)).toBe(250);
    expect(qtyIn(oats, 'kg', 1234)).toBe(1.234);
    // Same 0,1 g resolution as grams: switching never changes the amount.
    expect(amountOf(oats, { measure: 'kg', qty: qtyIn(oats, 'kg', 12.5) })).toBe(12.5);
    expect(amountOf(milk, { measure: 'l', qty: qtyIn(milk, 'l', 0.4) })).toBe(0.4);
  });

  it('keeps the amount in household units only when it reads well', () => {
    expect(qtyIn(milk, 'glass', 500)).toBe(2);
    expect(qtyIn(milk, 'glass', 125)).toBe(0.5);
    expect(qtyIn(nutella, 'tbsp', 30)).toBe(2);
    expect(qtyIn(milk, 'glass', 100)).toBe(1); // not 0,4 vasos
    expect(qtyIn(milk, 'serving', 210)).toBe(1);
  });
});

describe('defaultPortion', () => {
  it('offers the last portion, else one serving, else 100 g/ml', () => {
    expect(defaultPortion({ ...milk, lastPortion: { measure: 'glass', qty: 2 } })).toEqual({ measure: 'glass', qty: 2 });
    expect(defaultPortion(milk)).toEqual({ measure: 'serving', qty: 1 });
    expect(defaultPortion(oats)).toEqual({ measure: 'g', qty: 100 });
    expect(defaultPortion({ unit: 'ml' })).toEqual({ measure: 'ml', qty: 100 });
  });

  it('ignores a last portion the food can no longer use', () => {
    expect(defaultPortion({ ...oats, lastPortion: { measure: 'serving', qty: 2 } })).toEqual({ measure: 'g', qty: 100 });
    expect(defaultPortion({ ...oats, lastPortion: { measure: 'bucket' as never, qty: 2 } })).toEqual({ measure: 'g', qty: 100 });
    expect(defaultPortion({ ...oats, lastPortion: { measure: 'kg', qty: 0 } })).toEqual({ measure: 'g', qty: 100 });
  });
});

describe('portionFor and portionLabel', () => {
  it('uses the saved portion when it adds up to the amount', () => {
    expect(portionFor(milk, 250, { measure: 'glass', qty: 1 })).toEqual({ measure: 'glass', qty: 1 });
    expect(portionLabel(milk, 250, { measure: 'glass', qty: 1 })).toBe('1 vaso · 250 ml');
    expect(portionLabel(milk, 500, { measure: 'glass', qty: 2 })).toBe('2 vasos · 500 ml');
    expect(portionLabel(milk, 500, { measure: 'l', qty: 0.5 })).toBe('0,5 l');
    expect(portionLabel(oats, 15, { measure: 'tbsp', qty: 1 })).toBe('1 cucharada · 15 g');
    expect(portionLabel(oats, 2500, { measure: 'kg', qty: 2.5 })).toBe('2,5 kg');
    expect(portionLabel(oats, 120, { measure: 'ml', qty: 120 })).toBe('120 ml');
  });

  it('falls back to servings or plain g/ml when the saved portion no longer matches', () => {
    // An older version of the app changed the amount and kept the portion.
    expect(portionFor(milk, 310, { measure: 'glass', qty: 1 })).toEqual({ measure: 'ml', qty: 310 });
    expect(portionLabel(nutella, 30, { measure: 'glass', qty: 1 })).toBe('2 porciones · 30 g');
  });

  it('reads entries without a saved portion like before', () => {
    expect(portionLabel(nutella, 30)).toBe('2 porciones · 30 g');
    expect(portionLabel(nutella, 15)).toBe('1 porción · 15 g');
    expect(portionLabel(nutella, 3.75)).toBe('0,25 porciones · 3,8 g');
    expect(portionLabel(nutella, 22)).toBe('22 g');
    expect(portionLabel(oats, 80)).toBe('80 g');
    expect(portionLabel(milk, 330)).toBe('330 ml');
  });

  it('every measure has a label', () => {
    for (const g of measureGroups(milk)) for (const m of g.measures) expect(measureOf(milk, m.id)).toBeDefined();
  });
});
