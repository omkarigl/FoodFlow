import assert from 'node:assert/strict';
import test from 'node:test';
import { priceCart, sanitizeQuantity } from './pricing';

test('sanitizeQuantity bounds quantities', () => {
  assert.equal(sanitizeQuantity(-4), 0);
  assert.equal(sanitizeQuantity(3.9), 3);
  assert.equal(sanitizeQuantity(99), 20);
});

test('priceCart includes only available known items', () => {
  const result = priceCart(
    [
      { itemId: 'a', quantity: 2 },
      { itemId: 'b', quantity: 5 },
      { itemId: 'missing', quantity: 1 },
    ],
    [
      { id: 'a', name: 'Poha', pricePaise: 3500, isAvailable: true },
      { id: 'b', name: 'Tea', pricePaise: 1000, isAvailable: false },
    ]
  );

  assert.equal(result.priced.length, 1);
  assert.equal(result.priced[0].itemId, 'a');
  assert.equal(result.priced[0].lineTotalPaise, 7000);
  assert.equal(result.subtotalPaise, 7000);
});
