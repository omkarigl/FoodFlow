import type { CartLineInput } from './contracts';

export type PriceableItem = {
  id: string;
  name: string;
  pricePaise: number;
  isAvailable: boolean;
};

export type PricedLine = {
  itemId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
};

export function toRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function sanitizeQuantity(quantity: number) {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.min(20, Math.floor(quantity)));
}

export function priceCart(lines: CartLineInput[], menuItems: PriceableItem[]) {
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const priced: PricedLine[] = [];

  for (const line of lines) {
    const item = byId.get(line.itemId);
    const quantity = sanitizeQuantity(line.quantity);
    if (!item || !item.isAvailable || quantity <= 0) continue;

    const lineTotalPaise = item.pricePaise * quantity;
    priced.push({
      itemId: item.id,
      name: item.name,
      quantity,
      unitPricePaise: item.pricePaise,
      lineTotalPaise,
    });
  }

  const subtotalPaise = priced.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  return { priced, subtotalPaise };
}
