export type UserRole = 'student' | 'admin';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'verified' | 'failed';

export type MenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
};

export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isAvailable: boolean;
};

export type CartLineInput = {
  itemId: string;
  quantity: number;
};

export type CheckoutRequest = {
  lines: CartLineInput[];
  guestName?: string;
  guestPhone?: string;
  note?: string;
  idempotencyKey: string;
};
