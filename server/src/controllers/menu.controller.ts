import type { Request, Response } from 'express';
import { Canteen, MenuItem, Order, QRLocation } from '../models';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { adjustStock } from '../services/inventory.service';
import { emitToAdmins, emitToCanteen, emitToAll, SOCKET_EVENTS } from '../services/realtime.service';
import type { IMenuItem } from '../models';

const SORT_MAP: Record<string, Record<string, 1 | -1>> = {
  name: { name: 1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  newest: { createdAt: -1 },
  popular: { isPopular: -1, name: 1 },
};

function buildFilter(query: Request['query'], isAdmin: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.canteen) filter.canteen = query.canteen;
  if (query.category) filter.category = query.category;
  if (query.vegOnly === 'true') filter.isVegetarian = true;
  if (query.popular === 'true') filter.isPopular = true;
  // Spec: unavailable items stay visible but disabled. Only filter when asked.
  const onlyAvailable = query.availableOnly === 'true' || query.is_available === 'true';
  const onlyUnavailable = query.is_available === 'false';
  if (onlyAvailable) filter.isAvailable = true;
  else if (onlyUnavailable) filter.isAvailable = false;
  else if (isAdmin && query.includeUnavailable === 'false') filter.isAvailable = true;
  if (query.search) {
    const rx = new RegExp(escapeRegex(String(query.search)), 'i');
    filter.$or = [{ name: rx }, { description: rx }, { tags: rx }];
  }
  return filter;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const listMenu = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 60);
  const filter = buildFilter(req.query, isAdmin);
  const sort = SORT_MAP[String(req.query.sort ?? 'popular')] ?? SORT_MAP.popular;

  const [items, total] = await Promise.all([
    MenuItem.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('canteen', 'name code block')
      .lean({ virtuals: true }),
    MenuItem.countDocuments(filter),
  ]);

  res.json({
    items: items.map((i) => ({ ...i, id: String(i._id), _id: undefined })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

export const getMenuItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.findById(req.params.id).populate('canteen', 'name code').lean({ virtuals: true });
  if (!item) throw ApiError.notFound('Menu item not found.');
  res.json({ item: { ...item, id: String(item._id) } });
});

export const createMenuItem = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Partial<IMenuItem> & { canteen: string };
  const canteen = await Canteen.findById(body.canteen).lean();
  if (!canteen) throw ApiError.badRequest('The selected canteen does not exist.');

  const item = await MenuItem.create({ ...body, createdBy: req.user!.id });
  await emitMenuChange(item.canteen as unknown as string, 'created', item);
  res.status(201).json({ item });
});

export const updateMenuItem = asyncHandler(async (req: Request, res: Response) => {
  const patch = req.body as Record<string, unknown>;
  if (patch.stock !== undefined && patch.stock !== null && typeof patch.stock === 'number' && patch.stock < 0) {
    throw ApiError.badRequest('Stock cannot be negative.');
  }

  const item = await MenuItem.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true, runValidators: true });
  if (!item) throw ApiError.notFound('Menu item not found.');
  await emitMenuChange(item.canteen as unknown as string, 'updated', item);
  res.json({ item });
});

export const deleteMenuItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await MenuItem.findByIdAndDelete(req.params.id);
  if (!item) throw ApiError.notFound('Menu item not found.');

  // Keep historical order lines intact by never hard-deleting items referenced by paid orders.
  const referenced = await Order.exists({ 'items.menuItem': item._id });
  if (referenced) {
    await MenuItem.create({
      canteen: item.canteen,
      name: item.name,
      description: `${item.description ?? ''} (archived)`.trim(),
      price: item.price,
      category: item.category,
      isAvailable: false,
      unavailableReason: 'Archived - removed from menu',
      trackStock: false,
      tags: [...item.tags, 'archived'],
    });
  }

  await emitMenuChange(item.canteen as unknown as string, 'deleted', item);
  res.json({ success: true, message: `"${item.name}" removed from the menu.`, archived: Boolean(referenced) });
});

export const setAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { isAvailable, reason } = req.body as { isAvailable: boolean; reason?: string };
  const item = await MenuItem.findByIdAndUpdate(
    req.params.id,
    { $set: { isAvailable, unavailableReason: isAvailable ? undefined : reason ?? 'Currently unavailable' } },
    { new: true },
  );
  if (!item) throw ApiError.notFound('Menu item not found.');

  // Selling out or restocking can make existing cart lines invalid – tell the clients.
  await emitMenuChange(item.canteen as unknown as string, 'availability', item);
  emitToAll(SOCKET_EVENTS.MENU_UPDATED, { id: String(item._id), isAvailable: item.isAvailable });
  res.json({ item });
});

export const bulkAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { itemIds, isAvailable, reason } = req.body as { itemIds: string[]; isAvailable: boolean; reason?: string };
  const result = await MenuItem.updateMany(
    { _id: { $in: itemIds } },
    { $set: { isAvailable, unavailableReason: isAvailable ? undefined : reason ?? 'Currently unavailable' } },
  );
  const canteens = await MenuItem.distinct('canteen', { _id: { $in: itemIds } });
  for (const canteenId of canteens) await emitMenuChange(String(canteenId), 'bulk-availability', null);
  emitToAll(SOCKET_EVENTS.MENU_UPDATED, { isAvailable });
  res.json({ success: true, updated: result.modifiedCount });
});

async function emitMenuChange(canteenId: string, action: string, payload: unknown): Promise<void> {
  emitToCanteen(canteenId, SOCKET_EVENTS.MENU_UPDATED, { action, payload: payload ? JSON.parse(JSON.stringify(payload)) : null });
  emitToAdmins(SOCKET_EVENTS.MENU_UPDATED, { action, canteen: canteenId });
}

/* ------------------------------------------------------------- inventory */

export const listInventory = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.canteen) filter.canteen = req.query.canteen;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    filter.$or = [{ name: rx }, { category: rx }];
  }
  if (req.query.stock === 'out') filter.$expr = { $eq: ['$stock', 0] };
  if (req.query.stock === 'low') filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };

  const items = await MenuItem.find(filter)
    .sort({ category: 1, name: 1 })
    .populate('canteen', 'name code')
    .lean({ virtuals: true });

  const summary = {
    total: items.length,
    tracked: items.filter((i) => i.trackStock && i.stock !== null).length,
    outOfStock: items.filter((i) => i.isAvailable && i.trackStock && i.stock === 0).length,
    lowStock: items.filter((i) => i.isAvailable && i.trackStock && i.stock !== null && i.stock <= i.lowStockThreshold && i.stock > 0).length,
    unavailable: items.filter((i) => !i.isAvailable).length,
    stockValue: Math.round(items.reduce((s, i) => s + (i.trackStock && i.stock !== null ? i.stock * i.price : 0), 0) * 100) / 100,
  };

  res.json({ items: items.map((i) => ({ ...i, id: String(i._id) })), summary });
});

export const adjustInventory = asyncHandler(async (req: Request, res: Response) => {
  const { itemId, mode, quantity, trackStock, reason } = req.body as {
    itemId: string;
    mode: 'set' | 'add' | 'subtract';
    quantity: number;
    trackStock?: boolean;
    reason?: string;
  };
  const item = await adjustStock({ itemId, mode, quantity, trackStock });
  await emitMenuChange(item.canteen as unknown as string, 'inventory', item);
  emitToAdmins(SOCKET_EVENTS.INVENTORY_UPDATED, { id: String(item._id), stock: item.stock });
  res.json({ item, message: reason ? `Stock updated (${reason}).` : 'Stock updated.' });
});

export const bulkInventory = asyncHandler(async (req: Request, res: Response) => {
  const { updates } = req.body as { updates: Array<{ itemId: string; quantity: number; trackStock?: boolean }> };
  const results: Array<{ id: string; name: string; stock: number | null }> = [];
  for (const update of updates) {
    const item = await adjustStock({ itemId: update.itemId, mode: 'set', quantity: update.quantity, trackStock: update.trackStock });
    results.push({ id: String(item._id), name: item.name, stock: item.stock });
  }
  emitToAdmins(SOCKET_EVENTS.INVENTORY_UPDATED, { bulk: true, count: results.length });
  res.json({ updated: results, message: `${results.length} item(s) updated.` });
});

export const inventoryHistory = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({
    'items.menuItem': req.params.id,
    status: { $in: ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] },
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('user', 'name studentId')
    .lean();

  const movements = orders.flatMap((order) =>
    order.items
      .filter((i) => String(i.menuItem) === req.params.id)
      .map((i) => ({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        token: order.token,
        student: (order.user as unknown as { name?: string })?.name ?? 'Unknown',
        quantity: i.quantity,
        at: order.createdAt,
      })),
  );

  res.json({ movements });
});

/** Everything the admin menu screen needs in a single round trip. */
export const adminMenuOverview = asyncHandler(async (_req: Request, res: Response) => {
  const [canteens, items, qrLocations] = await Promise.all([
    Canteen.find().sort({ name: 1 }).lean(),
    MenuItem.find().populate('canteen', 'name code').sort({ category: 1, name: 1 }).lean({ virtuals: true }),
    QRLocation.find().populate('canteen', 'name code').sort({ code: 1 }).lean(),
  ]);
  res.json({
    canteens: canteens.map((c) => ({ ...c, id: String(c._id) })),
    items: items.map((i) => ({ ...i, id: String(i._id) })),
    qrLocations: qrLocations.map((q) => ({ ...q, id: String(q._id) })),
  });
});