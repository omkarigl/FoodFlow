import { Counter, MenuItem, Order, QRLocation, WalletTransaction, Canteen } from '../models';
import { countSignupsByDay, countUsersByRole, mapUsersById, attachUserProfiles } from './userStore';
import { round2 } from '../utils/money';
import type { OrderStatus } from '../constants';

const REVENUE_STATUSES: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'];

/**
 * Aggregations bucket days with `$dateToString`, which resolves in UTC. Rolling the window in
 * UTC as well keeps the generated series keys and the query bounds in the same frame, otherwise
 * every bucket lands on a neighbouring key and the totals read as zero.
 */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getDashboardStats(canteenId?: string) {
  const canteenFilter = canteenId ? { canteen: canteenId } : {};
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(new Date(now.getTime() - 86_400_000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayAgg, yesterdayAgg, monthAgg, statusCounts, activeOrders, lowStock, usersAgg, topItems, recentOrders, canteens] =
    await Promise.all([
      Order.aggregate([
        { $match: { ...canteenFilter, createdAt: { $gte: todayStart } } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$total', 0] } },
            items: { $sum: { $sum: '$items.quantity' } },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, createdAt: { $gte: yesterdayStart, $lt: todayStart } } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$total', 0] } },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$total', 0] } },
          },
        },
      ]),
      Order.aggregate([
        { $match: canteenFilter },
        { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MenuItem.countDocuments({ ...(canteenId ? { canteen: canteenId } : {}), trackStock: true, stock: { $ne: null }, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
      // Accounts live in Supabase — same shape the Mongo aggregation returned.
      countUsersByRole(),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: REVENUE_STATUSES } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { quantity: -1 } },
        { $limit: 6 },
      ]),
      Order.find({ ...canteenFilter, status: { $in: ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'] } })
        .sort({ placedAt: 1 })
        .limit(10)
        .populate('canteen', 'name code')
        .lean()
        .then((rows) => attachUserProfiles(rows)),
      Canteen.find(canteenId ? { _id: canteenId } : {}).lean(),
    ]);

  const today = todayAgg[0] ?? { orders: 0, revenue: 0, items: 0 };
  const yesterday = yesterdayAgg[0] ?? { orders: 0, revenue: 0 };
  const month = monthAgg[0] ?? { orders: 0, revenue: 0 };

  const byStatus: Record<string, { count: number; revenue: number }> = {};
  for (const row of statusCounts) byStatus[row._id] = { count: row.count, revenue: round2(row.revenue) };

  const active: Record<string, number> = {};
  for (const row of activeOrders) active[row._id] = row.count;

  const revenueDelta = yesterday.revenue > 0 ? round2(((today.revenue - yesterday.revenue) / yesterday.revenue) * 100) : null;
  const ordersDelta = yesterday.orders > 0 ? round2(((today.orders - yesterday.orders) / yesterday.orders) * 100) : null;

  return {
    generatedAt: now.toISOString(),
    today: {
      orders: today.orders,
      revenue: round2(today.revenue),
      itemsSold: today.items,
      avgOrderValue: today.orders > 0 ? round2(today.revenue / today.orders) : 0,
      revenueDeltaPercent: revenueDelta,
      ordersDeltaPercent: ordersDelta,
    },
    month: { orders: month.orders, revenue: round2(month.revenue) },
    totals: {
      orders: byStatus ? Object.values(byStatus).reduce((s, r) => s + r.count, 0) : 0,
      revenue: round2(Object.values(byStatus).reduce((s, r) => s + r.revenue, 0)),
    },
    byStatus,
    active,
    activeOrderCount: Object.values(active).reduce((s, c) => s + c, 0),
    lowStockCount: lowStock,
    users: {
      students: usersAgg.find((u) => u._id === 'student')?.count ?? 0,
      admins: usersAgg.find((u) => u._id === 'admin')?.count ?? 0,
      blocked: usersAgg.reduce((s, u) => s + (u.blocked ?? 0), 0),
    },
    topItems: topItems.map((t) => ({ name: t._id, quantity: t.quantity, revenue: round2(t.revenue) })),
    recentOrders: recentOrders.map((o) => ({ ...o, id: String(o._id) })),
    canteens: canteens.map((c) => ({ id: String(c._id), name: c.name, code: c.code, isOpen: c.isOpen, activeOrderCount: c.activeOrderCount })),
  };
}

export async function getAnalytics(days: number, canteenId?: string) {
  const now = new Date();
  const from = startOfDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const canteenFilter = canteenId ? { canteen: canteenId } : {};
  const revenueStatuses = REVENUE_STATUSES;

  const [dailyAgg, categoryAgg, statusAgg, paymentAgg, hourlyAgg, topItems, topCustomers, qrAgg, menuAgg, userGrowth, walletAgg, counter] =
    await Promise.all([
      Order.aggregate([
        { $match: { ...canteenFilter, createdAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $in: ['$status', revenueStatuses] }, '$total', 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $in: ['$status', ['CANCELLED', 'REJECTED']] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: revenueStatuses }, createdAt: { $gte: from } } },
        { $unwind: '$items' },
        { $lookup: { from: 'menuitems', localField: 'items.menuItem', foreignField: '_id', as: 'item' } },
        { $unwind: { path: '$item', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$item.category', 'Other'] },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, createdAt: { $gte: from } } },
        { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, 'payment.status': 'PAID', createdAt: { $gte: from } } },
        { $group: { _id: '$payment.method', count: { $sum: 1 }, total: { $sum: '$total' } } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: revenueStatuses }, createdAt: { $gte: from } } },
        { $group: { _id: { $hour: '$createdAt' }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: revenueStatuses }, createdAt: { $gte: from } } },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate([
        { $match: { ...canteenFilter, status: { $in: revenueStatuses }, createdAt: { $gte: from } } },
        {
          $group: {
            _id: '$user',
            orders: { $sum: 1 },
            spend: { $sum: '$total' },
          },
        },
        { $sort: { spend: -1 } },
        { $limit: 8 },
        // Owner ids are Supabase account ids now — profiles are attached in Node.
      ]).then(async (rows) => {
        const ids = rows.map((r) => r._id).filter((id): id is string => typeof id === 'string' && id.length > 0);
        const profiles = await mapUsersById(ids);
        return rows.map((r) => ({ ...r, user: typeof r._id === 'string' ? (profiles.get(r._id) ?? null) : null }));
      }),
      QRLocation.aggregate([
        { $match: canteenId ? { canteen: canteenId } : {} },
        { $sort: { scanCount: -1 } },
        { $limit: 8 },
        { $lookup: { from: 'canteens', localField: 'canteen', foreignField: '_id', as: 'canteen' } },
        { $unwind: { path: '$canteen', preserveNullAndEmptyArrays: true } },
      ]),
      MenuItem.aggregate([
        { $match: canteenId ? { canteen: canteenId } : {} },
        {
          $group: {
            _id: '$category',
            total: { $sum: 1 },
            available: { $sum: { $cond: ['$isAvailable', 1, 0] } },
            avgPrice: { $avg: '$price' },
          },
        },
        { $sort: { total: -1 } },
      ]),
      // Signups live in Supabase — same shape the Mongo aggregation returned.
      countSignupsByDay(from),
      WalletTransaction.aggregate([
        { $match: { createdAt: { $gte: from } } },
        {
          $group: {
            _id: '$reason',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
      ]),
      Counter.findOne({ key: 'order' }).lean(),
    ]);

  const byDay = new Map(dailyAgg.map((d) => [d._id as string, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(from.getTime() + i * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    return {
      date: key,
      orders: row?.orders ?? 0,
      revenue: round2(row?.revenue ?? 0),
      completed: row?.completed ?? 0,
      cancelled: row?.cancelled ?? 0,
    };
  });

  const totalOrders = series.reduce((s, d) => s + d.orders, 0);
  const totalRevenue = round2(series.reduce((s, d) => s + d.revenue, 0));
  const totalCancelled = series.reduce((s, d) => s + d.cancelled, 0);
  const firstHalf = series.slice(0, Math.floor(series.length / 2)).reduce((s, d) => s + d.revenue, 0);
  const secondHalf = series.slice(Math.floor(series.length / 2)).reduce((s, d) => s + d.revenue, 0);

  return {
    range: { days, from: from.toISOString(), to: now.toISOString() },
    summary: {
      totalOrders,
      totalRevenue,
      avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
      cancellationRate: totalOrders > 0 ? round2((totalCancelled / totalOrders) * 100) : 0,
      growthPercent: firstHalf > 0 ? round2(((secondHalf - firstHalf) / firstHalf) * 100) : null,
      lifetimeOrders: counter?.value ?? totalOrders,
    },
    daily: series,
    hourly: Array.from({ length: 24 }, (_, h) => {
      const row = hourlyAgg.find((x) => x._id === h);
      return { hour: h, orders: row?.orders ?? 0, revenue: round2(row?.revenue ?? 0) };
    }),
    byCategory: categoryAgg.map((c) => ({ category: c._id, quantity: c.quantity, revenue: round2(c.revenue) })),
    byStatus: statusAgg.map((s) => ({ status: s._id, count: s.count, revenue: round2(s.revenue) })),
    byPaymentMethod: paymentAgg.map((p) => ({ method: p._id, count: p.count, total: round2(p.total) })),
    topItems: topItems.map((t) => ({ name: t._id, quantity: t.quantity, revenue: round2(t.revenue) })),
    topCustomers: topCustomers.map((c) => ({
      id: String(c._id),
      name: c.user?.name ?? 'Unknown user',
      email: c.user?.email ?? '',
      orders: c.orders,
      spend: round2(c.spend),
    })),
    qrLocations: qrAgg.map((q) => ({
      id: String(q._id),
      code: q.code,
      label: q.label,
      block: q.block,
      canteen: q.canteen?.name ?? '',
      scanCount: q.scanCount ?? 0,
    })),
    menuByCategory: menuAgg.map((m) => ({
      category: m._id,
      total: m.total,
      available: m.available,
      avgPrice: round2(m.avgPrice ?? 0),
    })),
    userGrowth: userGrowth.map((u) => ({ date: u._id, count: u.count })),
    walletFlow: walletAgg.map((w) => ({ reason: w._id, count: w.count, amount: round2(w.amount) })),
  };
}