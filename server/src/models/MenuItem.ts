import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const MENU_CATEGORIES = [
  'Breakfast',
  'Snacks',
  'Chaat',
  'Main Course',
  'Rice & Biryani',
  'Bread & Bakery',
  'Beverages',
  'Desserts',
  'Combos',
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export interface IMenuItem {
  canteen: Types.ObjectId;
  name: string;
  description?: string;
  price: number;
  category: string;
  imageUrl?: string;
  emoji?: string;
  isAvailable: boolean;
  unavailableReason?: string;
  isVegetarian: boolean;
  isSpicy: boolean;
  isPopular: boolean;
  prepTimeMins: number;
  /** `null` means unlimited / stock not tracked. */
  stock: number | null;
  lowStockThreshold: number;
  trackStock: boolean;
  tags: string[];
  /** Supabase `users.id` of the creating admin (UUID string). */
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const menuItemSchema = new Schema<IMenuItem>(
  {
    canteen: { type: Schema.Types.ObjectId, ref: 'Canteen', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 90 },
    description: { type: String, trim: true, maxlength: 300 },
    price: { type: Number, required: true, min: 0, max: 100000 },
    category: { type: String, required: true, trim: true, maxlength: 40, index: true },
    imageUrl: { type: String, trim: true, maxlength: 500 },
    emoji: { type: String, trim: true, maxlength: 8 },
    isAvailable: { type: Boolean, default: true, index: true },
    unavailableReason: { type: String, trim: true, maxlength: 160 },
    isVegetarian: { type: Boolean, default: false },
    isSpicy: { type: Boolean, default: false },
    isPopular: { type: Boolean, default: false, index: true },
    prepTimeMins: { type: Number, default: 10, min: 1, max: 180 },
    stock: { type: Number, default: null, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    trackStock: { type: Boolean, default: true },
    tags: { type: [String], default: [] },
    createdBy: { type: String },
  },
  { timestamps: true },
);

menuItemSchema.index({ canteen: 1, name: 1 });
menuItemSchema.index({ canteen: 1, category: 1, isAvailable: 1 });
menuItemSchema.index({ name: 'text', description: 'text', tags: 'text' });

menuItemSchema.virtual('inStock').get(function inStock(this: IMenuItem) {
  if (!this.isAvailable) return false;
  if (!this.trackStock || this.stock === null) return true;
  return this.stock > 0;
});

menuItemSchema.virtual('isLowStock').get(function isLowStock(this: IMenuItem) {
  return this.trackStock && this.stock !== null && this.stock <= this.lowStockThreshold;
});

menuItemSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false, virtuals: true }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  if (obj.canteen && typeof obj.canteen === 'object') {
    const c = obj.canteen as Record<string, unknown>;
    if (c._id) {
      obj.canteen = { id: String(c._id), name: c.name, code: c.code };
      delete (obj.canteen as Record<string, unknown>)._id;
    }
  }
  return obj;
};

export const MenuItem: Model<IMenuItem> = mongoose.models.MenuItem || mongoose.model<IMenuItem>('MenuItem', menuItemSchema);