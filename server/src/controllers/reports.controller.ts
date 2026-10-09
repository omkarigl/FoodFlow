import type { Request, Response } from 'express';
import { Order } from '../models';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { round2 } from '../utils/money';
import { attachUserProfiles } from '../services/userStore';
import type { OrderStatus } from '../constants';

const REVENUE_STATUSES: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'];

function parseBound(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`Invalid date for "${name}". Use YYYY-MM-DD.`);
  return d;
}

/**
 * Spec endpoint: GET /api/reports/revenue?from=&to=
 * Admin-only. Returns summary totals, best-selling items and the detailed
 * order log for the window so the admin report + browser print flow use real data.
 */
export const revenueReport = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let from = parseBound(req.query.from, 'from') ?? monthStart;
  let to = parseBound(req.query.to, 'to') ?? now;
  if (from > to) throw ApiError.badRequest('"from" must be earlier than "to".');
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw ApiError.badRequest('Date range is too large. Keep it within a year.');
  }
  // Include the whole `to` day when only a date part was supplied.
  if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
    to = new Date(to.getTime() + 86_400_000 - 1);
  }

  const canteen = typeof req.query.canteen === 'string' && req.query.canteen ? req.query.canteen : undefined;
  const baseMatch: Record<string, unknown> = { placedAt: { $gte: from, $lte: to } };
  if (canteen) baseMatch.canteen = canteen;

  const [summaryAgg, bestSellers, orders] = await Promise.all([
    Order.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          paidOrders: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$total', 0] } },
          itemsSold: { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...baseMatch, status: { $in: REVENUE_STATUSES } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
      { $sort: { quantity: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, name: '$_id', quantity: 1, revenue: { $round: ['$revenue', 2] } } },
    ]),
    Order.find(baseMatch)
      .sort({ placedAt: -1 })
      .limit(500)
      .populate('canteen', 'name code')
      .lean()
      .then((rows) => attachUserProfiles(rows)),
  ]);

  const s = summaryAgg[0] ?? { orders: 0, paidOrders: 0, revenue: 0, itemsSold: 0 };
  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    summary: {
      orders: s.orders,
      paidOrders: s.paidOrders,
      revenue: round2(s.revenue),
      itemsSold: s.itemsSold,
      avgOrderValue: s.paidOrders > 0 ? round2(s.revenue / s.paidOrders) : 0,
    },
    bestSellers,
    orders,
  });
});
