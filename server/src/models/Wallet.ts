import mongoose, { Schema, type Model } from 'mongoose';

export interface IWallet {
  /** Supabase `users.id` (UUID string). Wallets stay in MongoDB, keyed by account id. */
  user: string;
  balance: number;
  lifetimeCredited: number;
  lifetimeDebited: number;
  pendingTopup?: {
    amount: number;
    gatewayOrderId: string;
    createdAt: Date;
  };
  lastTransactionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    user: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    lifetimeCredited: { type: Number, default: 0, min: 0 },
    lifetimeDebited: { type: Number, default: 0, min: 0 },
    pendingTopup: {
      amount: { type: Number },
      gatewayOrderId: { type: String },
      createdAt: { type: Date },
    },
    lastTransactionAt: { type: Date },
  },
  { timestamps: true },
);

walletSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  delete obj.pendingTopup;
  return obj;
};

export const Wallet: Model<IWallet> = mongoose.models.Wallet || mongoose.model<IWallet>('Wallet', walletSchema);