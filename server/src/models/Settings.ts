import mongoose, { Schema, type Model } from 'mongoose';

/** Single document holding app-wide configuration editable from the admin UI. */
export interface ISettings {
  key: string;
  appName: string;
  currency: string;
  currencySymbol: string;
  taxPercent: number;
  taxLabel: string;
  minOrderValue: number;
  maxItemsPerOrder: number;
  tokenLength: number;
  tokenPrefix: string;
  autoAcceptOrders: boolean;
  receiptFooter: string;
  receiptHeaderNote: string;
  supportEmail: string;
  supportPhone: string;
  lowStockAlerts: boolean;
  /** Supabase `users.id` of the last editing admin (UUID string). */
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, default: 'global', unique: true, index: true },
    appName: { type: String, default: 'FoodFlow' },
    currency: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '\u20b9' },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxLabel: { type: String, default: 'GST' },
    minOrderValue: { type: Number, default: 0, min: 0 },
    maxItemsPerOrder: { type: Number, default: 25, min: 1, max: 100 },
    tokenLength: { type: Number, default: 4, min: 3, max: 6 },
    tokenPrefix: { type: String, default: '', maxlength: 4 },
    autoAcceptOrders: { type: Boolean, default: false },
    receiptFooter: { type: String, default: 'Thank you! Please collect your order at the counter.' },
    receiptHeaderNote: { type: String, default: '' },
    supportEmail: { type: String, default: 'support@foodflow.app' },
    supportPhone: { type: String, default: '' },
    lowStockAlerts: { type: Boolean, default: true },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

settingsSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  return obj;
};

export const Settings: Model<ISettings> = mongoose.models.Settings || mongoose.model<ISettings>('Settings', settingsSchema);