import mongoose, { Schema, type Model } from 'mongoose';

export interface ICanteen {
  name: string;
  code: string;
  block: string;
  description?: string;
  isOpen: boolean;
  closedMessage?: string;
  acceptsOrders: boolean;
  prepTimeMins: number;
  maxConcurrentOrders: number;
  activeOrderCount: number;
  openingTime: string;
  closingTime: string;
  enforceSchedule: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const canteenSchema = new Schema<ICanteen>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
    block: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 240 },
    isOpen: { type: Boolean, default: true, index: true },
    closedMessage: { type: String, trim: true, maxlength: 200 },
    acceptsOrders: { type: Boolean, default: true },
    prepTimeMins: { type: Number, default: 12, min: 1, max: 180 },
    maxConcurrentOrders: { type: Number, default: 40, min: 1, max: 500 },
    activeOrderCount: { type: Number, default: 0 },
    openingTime: { type: String, default: '07:00' },
    closingTime: { type: String, default: '21:00' },
    enforceSchedule: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

canteenSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  return obj;
};

export const Canteen: Model<ICanteen> = mongoose.models.Canteen || mongoose.model<ICanteen>('Canteen', canteenSchema);