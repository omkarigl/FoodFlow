import type { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { round2 } from '../utils/money';
import { Wallet, WalletTransaction, type WalletTxnReason } from '../models';
import { logger } from '../utils/logger';

export async function getOrCreateWallet(userId: Types.ObjectId | string) {
  return Wallet.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId, balance: 0 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
}

export async function getWalletSummary(userId: Types.ObjectId | string) {
  const wallet = await getOrCreateWallet(userId);
  const [credits, debits] = await Promise.all([
    WalletTransaction.aggregate([{ $match: { user: wallet.user, type: 'CREDIT' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    WalletTransaction.aggregate([{ $match: { user: wallet.user, type: 'DEBIT' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);
  return {
    id: String(wallet._id),
    balance: round2(wallet.balance),
    totalCredited: round2(credits[0]?.total ?? 0),
    totalDebited: round2(debits[0]?.total ?? 0),
    lastTransactionAt: wallet.lastTransactionAt ?? null,
  };
}

export async function listTransactions(userId: Types.ObjectId | string, page = 1, limit = 20, type?: 'CREDIT' | 'DEBIT') {
  const filter: Record<string, unknown> = { user: userId };
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('order', 'token orderNumber total')
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

interface MoveParams {
  userId: Types.ObjectId | string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: WalletTxnReason;
  description: string;
  reference: string;
  orderId?: Types.ObjectId | string;
  performedBy?: Types.ObjectId | string;
  /** When false the balance is clamped at 0 and the shortfall is returned instead of throwing. */
  requireSufficientBalance?: boolean;
}

export interface WalletMoveResult {
  balance: number;
  alreadyApplied: boolean;
}

/**
 * Atomic, idempotent wallet movement.
 * `reference` is unique in the DB so a replayed payment or a double-submitted order can
 * never move the balance twice.
 */
export async function applyWalletMovement(params: MoveParams): Promise<WalletMoveResult> {
  const amount = round2(params.amount);
  if (!(amount > 0)) throw ApiError.badRequest('Wallet amount must be greater than zero.');

  const existing = await WalletTransaction.findOne({ reference: params.reference }).lean();
  if (existing) {
    const wallet = await getOrCreateWallet(params.userId);
    return { balance: round2(wallet.balance), alreadyApplied: true };
  }

  const update =
    params.type === 'CREDIT'
      ? { $inc: { balance: amount, lifetimeCredited: amount } }
      : params.requireSufficientBalance === false
        ? { $inc: { balance: -Math.min(amount, 0), lifetimeDebited: 0 } }
        : { $inc: { balance: -amount, lifetimeDebited: amount } };

  if (params.type === 'DEBIT' && params.requireSufficientBalance !== false) {
    const result = await Wallet.findOneAndUpdate(
      { user: params.userId, balance: { $gte: amount } },
      update,
      { new: true },
    );
    if (!result) {
      const wallet = await getOrCreateWallet(params.userId);
      throw new ApiError('INSUFFICIENT_BALANCE', `Insufficient wallet balance. Available: ${round2(wallet.balance).toFixed(2)}.`, {
        balance: round2(wallet.balance),
        required: amount,
      });
    }
    await recordTransaction(params, amount, result.balance);
    return { balance: round2(result.balance), alreadyApplied: false };
  }

  const wallet = await Wallet.findOneAndUpdate({ user: params.userId }, update, { new: true, upsert: true, setDefaultsOnInsert: true });
  await recordTransaction(params, amount, wallet.balance);
  return { balance: round2(wallet.balance), alreadyApplied: false };
}

async function recordTransaction(params: MoveParams, amount: number, balanceAfter: number): Promise<void> {
  try {
    await WalletTransaction.create({
      wallet: (await getOrCreateWallet(params.userId))._id,
      user: params.userId,
      type: params.type,
      reason: params.reason,
      amount,
      balanceAfter: round2(balanceAfter),
      description: params.description.slice(0, 200),
      reference: params.reference,
      ...(params.orderId ? { order: params.orderId } : {}),
      ...(params.performedBy ? { performedBy: params.performedBy } : {}),
    });
    await Wallet.updateOne({ _id: (await getOrCreateWallet(params.userId))._id }, { lastTransactionAt: new Date() });
  } catch (error) {
    // A duplicate reference means a concurrent request already recorded this movement.
    if ((error as { code?: number }).code === 11000) {
      logger.warn('wallet', `Duplicate wallet movement ignored for reference ${params.reference}`);
      return;
    }
    throw error;
  }
}