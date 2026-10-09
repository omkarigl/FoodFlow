import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const WALLET_TXN_TYPES = ['CREDIT', 'DEBIT'] as const;
export const WALLET_TXN_REASONS = [
  'ORDER_PAYMENT',
  'GATEWAY_TOPUP',
  'ADMIN_CREDIT',
  'ADMIN_DEBIT',
  'ORDER_REFUND',
] as const;

export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];
export type WalletTxnReason = (typeof WALLET_TXN_REASONS)[number];

export interface IWalletTransaction {
  wallet: Types.ObjectId;
  /** Supabase `users.id` (UUID string). */
  user: string;
  type: WalletTxnType;
  reason: WalletTxnReason;
  amount: number;
  balanceAfter: number;
  description: string;
  order?: Types.ObjectId;
  /** Idempotency key – guarantees a gateway payment can only settle once. */
  reference: string;
  /** Supabase `users.id` of the acting admin (UUID string). */
  performedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    wallet: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    user: { type: String, required: true, index: true },
    type: { type: String, enum: WALLET_TXN_TYPES, required: true },
    reason: { type: String, enum: WALLET_TXN_REASONS, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    balanceAfter: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, maxlength: 200 },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    reference: { type: String, required: true, unique: true },
    performedBy: { type: String },
  },
  { timestamps: true },
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });

walletTransactionSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  if (obj.order && typeof obj.order === 'object') {
    const o = obj.order as Record<string, unknown>;
    if (o._id) {
      obj.order = { id: String(o._id), token: o.token, orderNumber: o.orderNumber, total: o.total };
      delete (obj.order as Record<string, unknown>)._id;
    }
  }
  return obj;
};

export const WalletTransaction: Model<IWalletTransaction> =
  mongoose.models.WalletTransaction || mongoose.model<IWalletTransaction>('WalletTransaction', walletTransactionSchema);