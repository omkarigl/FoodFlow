import type { HydratedDocument, Types } from 'mongoose';
import { MenuItem, type IMenuItem } from '../models';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export interface StockShortfall {
  menuItem: Types.ObjectId;
  name: string;
  requested: number;
  available: number | null;
}

export interface ReservationResult {
  itemId: string;
  quantity: number;
}

/**
 * Atomically decrements stock for every line of an order.
 *
 * Items with stock tracking disabled (or a null stock) are unlimited and are skipped.
 * Tracked items are decremented with a conditional `stock: { $gte: qty }` guard, so two
 * concurrent checkouts can never oversell. If any line fails, previously decremented lines
 * are restored so the order never leaves partial inventory movements behind.
 */
export async function commitStock(lines: Array<{ menuItem: Types.ObjectId; quantity: number }>): Promise<void> {
  const applied: ReservationResult[] = [];

  try {
    for (const line of lines) {
      const snapshot = await MenuItem.findById(line.menuItem).select('name stock trackStock isAvailable').lean();
      if (!snapshot) throw ApiError.notFound('One of the items in your order no longer exists.');
      if (!snapshot.isAvailable) throw ApiError.conflict(`"${snapshot.name}" just went out of stock.`);

      if (!snapshot.trackStock || snapshot.stock === null) {
        // Unlimited item – nothing to decrement.
        continue;
      }

      const result = await MenuItem.updateOne(
        { _id: line.menuItem, isAvailable: true, trackStock: true, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity } },
      );

      if (result.matchedCount === 0) {
        // Re-read: the item may have been switched to unlimited mid-checkout.
        const current = await MenuItem.findById(line.menuItem).select('name stock trackStock isAvailable').lean();
        if (current && current.isAvailable && (!current.trackStock || current.stock === null)) continue;

        throw new ApiError(
          'INSUFFICIENT_STOCK',
          `Only ${current?.stock ?? 0} portion(s) of "${snapshot.name}" left - please update your cart.`,
          { itemId: String(line.menuItem), available: current?.stock ?? 0, requested: line.quantity },
        );
      }

      applied.push({ itemId: String(line.menuItem), quantity: line.quantity });
    }
  } catch (error) {
    await releaseStock(applied);
    throw error;
  }
}

/** Returns previously committed stock (used on cancellation / rejection). */
export async function releaseStock(lines: Array<{ itemItemId?: string; itemId?: string; menuItem?: Types.ObjectId; quantity: number }>): Promise<void> {
  for (const line of lines) {
    const id = line.menuItem ?? line.itemId ?? line.itemItemId;
    if (!id) continue;
    await MenuItem.updateOne({ _id: id }, { $inc: { stock: line.quantity } }).catch((err) =>
      logger.error('inventory', `Failed to restore stock for ${String(id)}: ${(err as Error).message}`),
    );
  }
}

/** Read-only pre-check used when rendering the cart / checkout summary. */
export async function checkAvailability(
  lines: Array<{ menuItem: Types.ObjectId; quantity: number }>,
): Promise<{
  ok: boolean;
  shortfalls: StockShortfall[];
  items: Array<(IMenuItem & { _id: Types.ObjectId }) | null>;
}> {
  const ids = lines.map((l) => l.menuItem);
  const docs = await MenuItem.find({ _id: { $in: ids } }).exec();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const shortfalls: StockShortfall[] = [];

  const items = lines.map((line) => {
    const doc = byId.get(String(line.menuItem));
    if (!doc) {
      shortfalls.push({ menuItem: line.menuItem, name: 'Unavailable item', requested: line.quantity, available: null });
      return null;
    }
    if (!doc.isAvailable) {
      shortfalls.push({ menuItem: line.menuItem, name: doc.name, requested: line.quantity, available: 0 });
    } else if (doc.trackStock && doc.stock !== null && doc.stock < line.quantity) {
      shortfalls.push({ menuItem: line.menuItem, name: doc.name, requested: line.quantity, available: doc.stock });
    }
    return doc;
  });

  return { ok: shortfalls.length === 0, shortfalls, items };
}

export async function adjustStock(params: {
  itemId: string;
  mode: 'set' | 'add' | 'subtract';
  quantity: number;
  trackStock?: boolean;
}): Promise<HydratedDocument<IMenuItem>> {
  const update: Record<string, unknown> = {};
  if (params.mode === 'set') update.stock = params.quantity;
  else update.$inc = { stock: params.mode === 'add' ? params.quantity : -params.quantity };
  if (typeof params.trackStock === 'boolean') update.trackStock = params.trackStock;

  const doc = await MenuItem.findOneAndUpdate({ _id: params.itemId }, update, { new: true });
  if (!doc) throw ApiError.notFound('Menu item not found.');
  if ((doc.stock ?? 0) < 0) {
    await MenuItem.updateOne({ _id: params.itemId }, { stock: 0 });
    throw ApiError.badRequest('Stock cannot go below zero.');
  }
  return doc;
}

export async function listLowStock(canteenId?: string) {
  const filter: Record<string, unknown> = { trackStock: true, isAvailable: true };
  if (canteenId) filter.canteen = canteenId;
  return MenuItem.find(filter).exec();
}