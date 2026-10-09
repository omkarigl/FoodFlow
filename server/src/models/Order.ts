import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, type OrderStatus } from '../constants';

export interface IOrderItem {
  menuItem: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  isVegetarian: boolean;
  notes?: string;
}

export interface IOrderPayment {
  method: (typeof PAYMENT_METHODS)[number];
  provider: 'razorpay' | 'sandbox' | 'wallet';
  status: (typeof PAYMENT_STATUSES)[number];
  amount: number;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  gatewaySignature?: string;
  paidAt?: Date;
  refundedAt?: Date;
  refundReason?: string;
  failureReason?: string;
}

export interface IOrderEvent {
  status: OrderStatus;
  at: Date;
  /** Supabase `users.id` of the actor (UUID string). */
  by?: string;
  byRole?: 'student' | 'admin' | 'system';
  note?: string;
}

export interface IOrder {
  orderNumber: number;
  token: string;
  /** Supabase `users.id` of the owner (UUID string). Absent for guest orders. */
  user?: string;
  /** True for guest/QR orders placed without an account. */
  isGuest: boolean;
  /** Bearer secret proving ownership of a guest order. Never log or broadcast. */
  guestClaimToken?: string;
  guestLabel?: string;
  canteen: Types.ObjectId;
  qrLocation?: Types.ObjectId;
  qrLocationCode?: string;
  items: IOrderItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: OrderStatus;
  payment: IOrderPayment;
  statusHistory: IOrderEvent[];
  note?: string;
  placedAt: Date;
  estimatedReadyAt?: Date;
  acceptedAt?: Date;
  preparingAt?: Date;
  readyAt?: Date;
  completedAt?: Date;
  closedAt?: Date;
  closeReason?: string;
  inventoryCommitted: boolean;
  inventoryRestored: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    menuItem: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 50 },
    subtotal: { type: Number, required: true, min: 0 },
    isVegetarian: { type: Boolean, default: false },
    notes: { type: String, maxlength: 140 },
  },
  { _id: false },
);

const orderEventSchema = new Schema<IOrderEvent>(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: String },
    byRole: { type: String, enum: ['student', 'admin', 'system'], default: 'system' },
    note: { type: String, maxlength: 240 },
  },
  { _id: false },
);

const paymentSchema = new Schema<IOrderPayment>(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    provider: { type: String, enum: ['razorpay', 'sandbox', 'wallet'], required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING' },
    amount: { type: Number, required: true, min: 0 },
    gatewayOrderId: { type: String },
    gatewayPaymentId: { type: String },
    gatewaySignature: { type: String },
    paidAt: { type: Date },
    refundedAt: { type: Date },
    refundReason: { type: String },
    failureReason: { type: String },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: Number, required: true, unique: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    user: { type: String, required: false, index: true },
    isGuest: { type: Boolean, default: false, index: true },
    guestClaimToken: { type: String, select: false, index: true },
    guestLabel: { type: String, maxlength: 80 },
    canteen: { type: Schema.Types.ObjectId, ref: 'Canteen', required: true, index: true },
    qrLocation: { type: Schema.Types.ObjectId, ref: 'QRLocation' },
    qrLocationCode: { type: String },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'PENDING_PAYMENT', index: true },
    payment: { type: paymentSchema, required: true },
    statusHistory: { type: [orderEventSchema], default: [] },
    note: { type: String, maxlength: 300 },
    placedAt: { type: Date, default: Date.now, index: true },
    estimatedReadyAt: { type: Date },
    acceptedAt: { type: Date },
    preparingAt: { type: Date },
    readyAt: { type: Date },
    completedAt: { type: Date },
    closedAt: { type: Date },
    closeReason: { type: String, maxlength: 240 },
    inventoryCommitted: { type: Boolean, default: false },
    inventoryRestored: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ canteen: 1, status: 1, placedAt: -1 });
orderSchema.index({ 'payment.gatewayOrderId': 1 });
orderSchema.index(
  { 'payment.gatewayPaymentId': 1 },
  { unique: true, partialFilterExpression: { 'payment.gatewayPaymentId': { $type: 'string' } } },
);
orderSchema.index({ 'payment.gatewayOrderId': 1, user: 1 });

orderSchema.virtual('isOpen').get(function isOpen(this: IOrder) {
  return !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(this.status);
});

orderSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ versionKey: false, virtuals: true }) as Record<string, unknown>;
  obj.id = String(obj._id);
  delete obj._id;
  return obj;
};

export const Order: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>('Order', orderSchema);