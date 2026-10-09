import mongoose, { Schema, type Model, type Types } from 'mongoose';

export interface IQRLocation {
  code: string;
  label: string;
  canteen: Types.ObjectId;
  block: string;
  description?: string;
  tableHint?: string;
  isActive: boolean;
  scanCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const qrLocationSchema = new Schema<IQRLocation>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40, index: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    canteen: { type: Schema.Types.ObjectId, ref: 'Canteen', required: true, index: true },
    block: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 240 },
    tableHint: { type: String, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
    scanCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

qrLocationSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false, virtuals: true }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  return obj;
};

export const QRLocation: Model<IQRLocation> =
  mongoose.models.QRLocation || mongoose.model<IQRLocation>('QRLocation', qrLocationSchema);