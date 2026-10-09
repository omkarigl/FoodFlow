import mongoose from 'mongoose';
import { Canteen, MenuItem, QRLocation, Settings, Wallet, Counter, Order, WalletTransaction } from '../models';
import { countAllUsers, deleteAllUsers, upsertUserByEmail } from '../services/userStore';
import { hashPassword } from '../utils/auth';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { MENU_CATEGORIES } from '../models/MenuItem';

interface CanteenSeed {
  canteen: string;
  code: string;
  block: string;
  description: string;
  prepTimeMins: number;
}

const CANTEENS: CanteenSeed[] = [
  {
    canteen: 'Main Canteen',
    code: 'MAIN',
    block: 'Central Block',
    description: 'Full service main canteen serving breakfast, meals and beverages all day.',
    prepTimeMins: 12,
  },
  {
    canteen: 'Hostel Mess',
    code: 'HOSTEL',
    block: 'North Hostel',
    description: 'Fast grab-and-go counter for hostel students.',
    prepTimeMins: 8,
  },
  {
    canteen: 'Coffee Point',
    code: 'COFFEE',
    block: 'Library Wing',
    description: 'Beverages, bakery and light snacks.',
    prepTimeMins: 5,
  },
];

interface ItemSeed {
  name: string;
  description: string;
  price: number;
  category: string;
  emoji: string;
  isAvailable: boolean;
  isVegetarian: boolean;
  isSpicy: boolean;
  isPopular: boolean;
  prepTimeMins: number;
  stock: number | null;
  lowStockThreshold: number;
  trackStock: boolean;
  tags: string[];
}

const MENU: Record<string, ItemSeed[]> = {
  MAIN: [
    { name: 'Poha', description: 'Flattened rice poha with peanuts, curry leaves and lemon.', price: 25, category: 'Breakfast', emoji: '\ud83e\udd5e', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 6, stock: 120, lowStockThreshold: 25, trackStock: true, tags: ['veg', 'breakfast'] },
    { name: 'Masala Dosa', description: 'Crisp dosa served with potato palya and coconut chutney.', price: 55, category: 'Breakfast', emoji: '\ud83e\udd5f', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 9, stock: 60, lowStockThreshold: 15, trackStock: true, tags: ['veg', 'south'] },
    { name: 'Veg Thali', description: 'Two sabzi, dal, rice, four roti, salad and a sweet.', price: 90, category: 'Main Course', emoji: '\ud83c\udf7d', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 10, stock: 40, lowStockThreshold: 10, trackStock: true, tags: ['veg', 'meal'] },
    { name: 'Chicken Biryani', description: 'Hyderabadi dum biryani with bone-in chicken.', price: 140, category: 'Rice & Biryani', emoji: '\ud83c\udf5b', isAvailable: true, isVegetarian: false, isSpicy: true, isPopular: true, prepTimeMins: 15, stock: 35, lowStockThreshold: 8, trackStock: true, tags: ['nonveg', 'spicy'] },
    { name: 'Veg Biryani', description: 'Fragrant basmati rice cooked with seasonal vegetables.', price: 100, category: 'Rice & Biryani', emoji: '\ud83c\udf5b', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 14, stock: 30, lowStockThreshold: 8, trackStock: true, tags: ['veg'] },
    { name: 'Rajma Chawal', description: 'Slow cooked kidney bean curry with steamed rice.', price: 70, category: 'Main Course', emoji: '\ud83c\udf68', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 8, stock: 45, lowStockThreshold: 10, trackStock: true, tags: ['veg'] },
    { name: 'Chole Bhature', description: 'Chole curry with two fluffy bhature breads.', price: 80, category: 'Main Course', emoji: '\ud83c\udf5e', isAvailable: true, isVegetarian: true, isSpicy: true, isPopular: true, prepTimeMins: 10, stock: 25, lowStockThreshold: 6, trackStock: true, tags: ['veg', 'spicy'] },
    { name: 'Samosa (2 pcs)', description: 'Hot and crisp aloo samosa with chutney.', price: 20, category: 'Snacks', emoji: '\ud83e\udd60', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 3, stock: 200, lowStockThreshold: 40, trackStock: true, tags: ['veg', 'snack'] },
    { name: 'Vada Pav', description: 'Spiced potato fritter in a soft bun.', price: 30, category: 'Snacks', emoji: '\ud83c\udf54', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 4, stock: 120, lowStockThreshold: 30, trackStock: true, tags: ['veg', 'snack'] },
    { name: 'Papdi Chaat', description: 'Crisp papdi, chickpeas, yoghurt and chutneys.', price: 45, category: 'Chaat', emoji: '\ud83e\udd6a', isAvailable: true, isVegetarian: true, isSpicy: true, isPopular: false, prepTimeMins: 5, stock: 60, lowStockThreshold: 12, trackStock: true, tags: ['veg', 'chaat'] },
    { name: 'Pani Puri Shots (6 pcs)', description: 'Six shot sized pani puri with three flavours.', price: 35, category: 'Chaat', emoji: '\ud83e\uddb4', isAvailable: true, isVegetarian: true, isSpicy: true, isPopular: true, prepTimeMins: 4, stock: 80, lowStockThreshold: 15, trackStock: true, tags: ['veg', 'chaat'] },
    { name: 'Veg Sandwich', description: 'Grilled sandwich with cheese and vegetables.', price: 55, category: 'Snacks', emoji: '\ud83e\udd6a', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 7, stock: 40, lowStockThreshold: 10, trackStock: true, tags: ['veg'] },
    { name: 'Egg Fried Rice', description: 'Wok tossed rice with egg and spring onion.', price: 85, category: 'Rice & Biryani', emoji: '\ud83c\udf5b', isAvailable: true, isVegetarian: false, isSpicy: false, isPopular: false, prepTimeMins: 11, stock: 30, lowStockThreshold: 8, trackStock: true, tags: ['nonveg'] },
    { name: 'Gulab Jamun (2 pcs)', description: 'Warm khoya dumplings soaked in sugar syrup.', price: 35, category: 'Desserts', emoji: '\ud83c\udf70', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 2, stock: 50, lowStockThreshold: 10, trackStock: true, tags: ['veg', 'sweet'] },
    { name: 'Masala Chai', description: 'Ginger cardamom tea brewed with milk.', price: 15, category: 'Beverages', emoji: '\ud83c\udf75', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 3, stock: 300, lowStockThreshold: 60, trackStock: true, tags: ['veg', 'hot'] },
    { name: 'Fresh Lime Soda', description: 'Sweet or salted lime soda.', price: 25, category: 'Beverages', emoji: '\ud83e\udd5c', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: 150, lowStockThreshold: 30, trackStock: true, tags: ['veg', 'cold'] },
    { name: 'Cold Coffee', description: 'Blended cold coffee with milk and chocolate.', price: 45, category: 'Beverages', emoji: '\ud83e\udd5b', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 4, stock: 80, lowStockThreshold: 15, trackStock: true, tags: ['veg', 'cold'] },
    { name: 'Veg Fried Rice + Coke', description: 'Veg fried rice served with a 250ml can.', price: 130, category: 'Combos', emoji: '\ud83c\udf7d', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 13, stock: 25, lowStockThreshold: 5, trackStock: true, tags: ['veg', 'combo'] },
    { name: 'Butter Roti (2 pcs)', description: 'Fresh tandoori rotis with white butter.', price: 20, category: 'Bread & Bakery', emoji: '\ud83e\udd5e', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: null, lowStockThreshold: 0, trackStock: false, tags: ['veg'] },
    { name: 'Filter Coffee', description: 'South Indian filter coffee with chicory.', price: 20, category: 'Beverages', emoji: '\ud83c\udf75', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 4, stock: 90, lowStockThreshold: 20, trackStock: true, tags: ['veg', 'hot'] },
  ],
  HOSTEL: [
    { name: 'Idli Sambar (2 pcs)', description: 'Steamed idli with sambar and coconut chutney.', price: 30, category: 'Breakfast', emoji: '\ud83e\udd5e', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 5, stock: 150, lowStockThreshold: 30, trackStock: true, tags: ['veg'] },
    { name: 'Poha + Egg', description: 'Vegetable poha served with a boiled egg.', price: 45, category: 'Breakfast', emoji: '\ud83e\udd5e', isAvailable: true, isVegetarian: false, isSpicy: false, isPopular: true, prepTimeMins: 7, stock: 90, lowStockThreshold: 20, trackStock: true, tags: ['nonveg'] },
    { name: 'Toast & Omelette', description: 'Two buttered toasts with a masala omelette.', price: 55, category: 'Breakfast', emoji: '\ud83e\udd5f', isAvailable: true, isVegetarian: false, isSpicy: false, isPopular: true, prepTimeMins: 8, stock: 70, lowStockThreshold: 15, trackStock: true, tags: ['nonveg'] },
    { name: 'Grilled Cheese Sandwich', description: 'Cheese grilled sandwich with butter.', price: 60, category: 'Snacks', emoji: '\ud83e\udd6a', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 6, stock: 60, lowStockThreshold: 15, trackStock: true, tags: ['veg'] },
    { name: 'Momos (6 pcs)', description: 'Steamed vegetable momos with red chutney.', price: 50, category: 'Snacks', emoji: '\ud83e\udd5f', isAvailable: true, isVegetarian: true, isSpicy: true, isPopular: true, prepTimeMins: 9, stock: 45, lowStockThreshold: 10, trackStock: true, tags: ['veg'] },
    { name: 'Maggi Noodles', description: 'Classic masala noodles with a herby note.', price: 35, category: 'Main Course', emoji: '\ud83c\udf5c', isAvailable: true, isVegetarian: true, isSpicy: true, isPopular: true, prepTimeMins: 8, stock: 100, lowStockThreshold: 20, trackStock: true, tags: ['veg'] },
    { name: 'Boiled Chana Salad', description: 'Protein rich boiled chickpea salad.', price: 40, category: 'Snacks', emoji: '\ud83e\udd57', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: 60, lowStockThreshold: 12, trackStock: true, tags: ['veg', 'healthy'] },
    { name: 'Masala Chai', description: 'Ginger cardamom tea brewed with milk.', price: 12, category: 'Beverages', emoji: '\ud83c\udf75', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 3, stock: 300, lowStockThreshold: 60, trackStock: true, tags: ['veg'] },
    { name: 'Roasted Chana', description: 'Crunchy roasted chana.', price: 20, category: 'Snacks', emoji: '\ud83e\udd57', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 1, stock: 180, lowStockThreshold: 40, trackStock: true, tags: ['veg', 'healthy'] },
    { name: 'Fruit Salad', description: 'Seasonal fruit with honey and chia seeds.', price: 45, category: 'Desserts', emoji: '\ud83e\udd53', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: 40, lowStockThreshold: 8, trackStock: true, tags: ['veg', 'healthy'] },
  ],
  COFFEE: [
    { name: 'Espresso', description: 'Single origin double shot espresso.', price: 60, category: 'Beverages', emoji: '\u2615', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: null, lowStockThreshold: 0, trackStock: false, tags: ['coffee'] },
    { name: 'Cappuccino', description: 'Espresso with steamed milk and foam.', price: 90, category: 'Beverages', emoji: '\u2615', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 4, stock: null, lowStockThreshold: 0, trackStock: false, tags: ['coffee'] },
    { name: 'Cold Brew', description: '18 hour cold steeped brew.', price: 110, category: 'Beverages', emoji: '\ud83e\udd5b', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 3, stock: 40, lowStockThreshold: 10, trackStock: true, tags: ['coffee', 'cold'] },
    { name: 'Masala Chai', description: 'Ginger cardamom tea brewed with milk.', price: 20, category: 'Beverages', emoji: '\ud83c\udf75', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 3, stock: 250, lowStockThreshold: 50, trackStock: true, tags: ['veg', 'hot'] },
    { name: 'Blueberry Muffin', description: 'Warm bakery muffin with blueberry compote.', price: 55, category: 'Bread & Bakery', emoji: '\ud83e\udd50', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 2, stock: 25, lowStockThreshold: 5, trackStock: true, tags: ['veg', 'bakery'] },
    { name: 'Chocolate Croissant', description: 'Laminated croissant filled with dark chocolate.', price: 85, category: 'Bread & Bakery', emoji: '\ud83e\udd50', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: true, prepTimeMins: 2, stock: 20, lowStockThreshold: 5, trackStock: true, tags: ['veg', 'bakery'] },
    { name: 'Veg Puff', description: 'Flaky puff pastry with spiced potato filling.', price: 35, category: 'Snacks', emoji: '\ud83e\udd60', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 3, stock: 60, lowStockThreshold: 12, trackStock: true, tags: ['veg', 'bakery'] },
    { name: 'Cookies (2 pcs)', description: 'Chocolate chip cookies, baked in house.', price: 50, category: 'Desserts', emoji: '\ud83c\udf6a', isAvailable: true, isVegetarian: true, isSpicy: false, isPopular: false, prepTimeMins: 2, stock: 35, lowStockThreshold: 8, trackStock: true, tags: ['veg', 'bakery'] },
  ],
};

const QR_LOCATIONS: Array<{ code: string; label: string; canteenCode: string; block: string; tableHint: string; description: string }> = [
  { code: 'PILLAR_01', label: 'Pillar 1 - Main Hall', canteenCode: 'MAIN', block: 'Central Block', tableHint: 'Ground floor', description: 'Scan to order from the pillar seating near the main hall.' },
  { code: 'PILLAR_02', label: 'Pillar 2 - Garden Side', canteenCode: 'MAIN', block: 'Central Block', tableHint: 'Garden side', description: 'Outdoor seating on the garden side.' },
  { code: 'COUNTER_01', label: 'Front Counter', canteenCode: 'MAIN', block: 'Central Block', tableHint: 'Pickup counter', description: 'Order and collect at the front counter.' },
  { code: 'HOSTEL_MESS_01', label: 'Hostel Mess Counter', canteenCode: 'HOSTEL', block: 'North Hostel', tableHint: 'Mess hall', description: 'Scan at the hostel mess serving counter.' },
  { code: 'COFFEE_BAR_01', label: 'Coffee Bar', canteenCode: 'COFFEE', block: 'Library Wing', tableHint: 'Library cafe', description: 'Scan at the coffee bar seating.' },
  { code: 'LIBRARY_02', label: 'Library Reading Hall', canteenCode: 'COFFEE', block: 'Library Wing', tableHint: 'Reading hall', description: 'Reading hall seating, quiet zone.' },
];

const DEMO_STUDENTS = [
  { name: 'Aarav Sharma', email: 'aarav@college.edu', studentId: 'CS21B1042' },
  { name: 'Diya Patel', email: 'diya@college.edu', studentId: 'EC21B1107' },
  { name: 'Rohan Mehta', email: 'rohan@college.edu', studentId: 'ME21B1233' },
];

function normalizeCategory(category: string): string {
  return MENU_CATEGORIES.includes(category as never) ? category : 'Snacks';
}

async function seedAll(connection: typeof mongoose): Promise<void> {
  logger.info('seed', `Connected to database "${connection.connection.name}".`);
  const reset = process.argv.includes('--reset') || process.argv.includes('-r');

  if (reset) {
    logger.warn('seed', '--reset supplied: clearing existing FoodFlow collections.');
    await Promise.all([
      Order.deleteMany({}),
      MenuItem.deleteMany({}),
      QRLocation.deleteMany({}),
      Canteen.deleteMany({}),
      deleteAllUsers(),
      Wallet.deleteMany({}),
      WalletTransaction.deleteMany({}),
      Counter.deleteMany({}),
    ]);
  }

  await Settings.findOneAndUpdate(
    { key: 'global' },
    {
      $setOnInsert: {
        key: 'global',
        appName: 'FoodFlow',
        currency: 'INR',
        currencySymbol: '\u20b9',
        taxPercent: 5,
        taxLabel: 'GST',
        minOrderValue: 20,
        maxItemsPerOrder: 25,
        tokenLength: 4,
        tokenPrefix: '',
        autoAcceptOrders: false,
        receiptFooter: 'Thank you! Please collect your order at the counter.',
        receiptHeaderNote: '',
        supportEmail: 'canteen@foodflow.app',
        supportPhone: '+91 90000 00000',
        lowStockAlerts: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const canteenDocs = new Map<string, mongoose.Types.ObjectId>();
  for (const seed of CANTEENS) {
    const canteen = await Canteen.findOneAndUpdate(
      { code: seed.code },
      {
        $set: {
          name: seed.canteen,
          block: seed.block,
          description: seed.description,
          prepTimeMins: seed.prepTimeMins,
          isOpen: true,
          acceptsOrders: true,
          isActive: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    canteenDocs.set(seed.code, canteen._id as mongoose.Types.ObjectId);
  }
  logger.info('seed', `Upserted ${canteenDocs.size} canteen(s).`);

  let menuCount = 0;
  for (const [code, items] of Object.entries(MENU)) {
    const canteenId = canteenDocs.get(code);
    if (!canteenId) continue;
    for (const item of items) {
      await MenuItem.findOneAndUpdate(
        { canteen: canteenId, name: item.name },
        { $set: { ...item, category: normalizeCategory(item.category) } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      menuCount += 1;
    }
  }
  logger.info('seed', `Upserted ${menuCount} menu item(s).`);

  for (const qr of QR_LOCATIONS) {
    const canteenId = canteenDocs.get(qr.canteenCode);
    if (!canteenId) continue;
    await QRLocation.findOneAndUpdate(
      { code: qr.code },
      { $set: { label: qr.label, canteen: canteenId, block: qr.block, tableHint: qr.tableHint, description: qr.description, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  logger.info('seed', `Upserted ${QR_LOCATIONS.length} QR location(s).`);

  // Accounts live in Supabase — upsert there, wallets stay in MongoDB keyed by account id.
  const adminPasswordHash = await hashPassword(config.admin.password);
  const admin = await upsertUserByEmail({
    name: config.admin.name,
    email: config.admin.email,
    passwordHash: adminPasswordHash,
    phone: config.admin.phone,
    role: 'admin',
    isBlocked: false,
  });
  await Wallet.findOneAndUpdate({ user: admin.id }, { $setOnInsert: { user: admin.id, balance: 0 } }, { upsert: true });

  const demoPassword = await hashPassword('Student@123');
  for (const student of DEMO_STUDENTS) {
    const user = await upsertUserByEmail({
      name: student.name,
      email: student.email,
      passwordHash: demoPassword,
      studentId: student.studentId,
      role: 'student',
      isBlocked: false,
    });
    const wallet = await Wallet.findOneAndUpdate(
      { user: user.id },
      { $setOnInsert: { user: user.id, balance: 0 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (wallet.balance === 0) {
      await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: 250, lifetimeCredited: 250 } });
      await WalletTransaction.findOneAndUpdate(
        { reference: `seed:welcome:${user.id}` },
        {
          $setOnInsert: {
            wallet: wallet._id,
            user: user.id,
            type: 'CREDIT',
            reason: 'ADMIN_CREDIT',
            amount: 250,
            balanceAfter: 250,
            description: 'Welcome wallet credit',
            reference: `seed:welcome:${user.id}`,
          },
        },
        { upsert: true },
      );
    }
  }
  logger.info('seed', `Upserted ${DEMO_STUDENTS.length} student account(s).`);

  const [canteens, items, users, locations] = await Promise.all([
    Canteen.countDocuments(),
    MenuItem.countDocuments(),
    countAllUsers(),
    QRLocation.countDocuments(),
  ]);

  logger.info('seed', '------------------------------------------------');
  logger.info('seed', `Canteens: ${canteens} | Menu items: ${items} | Users: ${users} | QR locations: ${locations}`);
  logger.info('seed', `Admin login   -> ${config.admin.email} / ${config.admin.password}`);
  logger.info('seed', 'Student login  -> aarav@college.edu / Student@123');
  logger.info('seed', 'QR entry links ->');
  for (const qr of QR_LOCATIONS) logger.info('seed', `   ${config.clientUrl}/order?location=${qr.code}`);
  logger.info('seed', `Payment provider -> ${config.paymentProvider}`);
  logger.info('seed', '------------------------------------------------');
}

/** CLI entry point: connect using MONGODB_URI and seed. */
export async function runSeedCli(): Promise<void> {
  const uri = config.useLocalDb ? await startLocalForSeed() : config.mongoUri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  await seedAll(mongoose);
  await mongoose.disconnect();
}

async function startLocalForSeed(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MongoMemoryServer } = require('mongodb-memory-server') as typeof import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'foodflow' } });
  process.stdout.write(`Using temporary local MongoDB at ${mongod.getUri()}\n`);
  return mongod.getUri();
}

/** Called by the server on boot when `--seed` is passed. */
export async function seedIfEmpty(connection: typeof mongoose): Promise<void> {
  const canteenCount = await Canteen.countDocuments();
  if (canteenCount > 0) {
    logger.info('seed', 'Database already contains data - skipping seed.');
    return;
  }
  logger.info('seed', 'Empty database detected - seeding canteens, menu, QR codes and accounts...');
  await seedAll(connection);
}

if (require.main === module) {
  runSeedCli().catch((error) => {
    logger.error('seed', `Seeding failed: ${(error as Error).message}`, error);
    process.exit(1);
  });
}