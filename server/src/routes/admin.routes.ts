import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { validate, validateAll } from '../middleware/validate';
import {
  adminUserUpdateSchema,
  adminUsersQuerySchema,
  analyticsQuerySchema,
  createStaffSchema,
  userIdParamSchema,
  settingsUpdateSchema,
  walletAdjustSchema,
} from '../validation/schemas';
import {
  adjustWallet,
  analytics,
  createStaff,
  dashboard,
  deleteUser,
  getSettingsHandler,
  getUser,
  listUsers,
  patchSettings,
  syncCounters,
  systemHealth,
  tokenManagement,
  updateUser,
} from '../controllers/admin.controller';

const router = Router();

// Every route in this router requires an authenticated admin (requireAdmin enforces auth).
router.use(requireAdmin);

router.get('/dashboard', dashboard);
router.get('/analytics', validate(analyticsQuerySchema, 'query'), analytics);
router.get('/health', systemHealth);
router.post('/sync-counters', syncCounters);

router.get('/users', validate(adminUsersQuerySchema, 'query'), listUsers);
router.post('/users/staff', validate(createStaffSchema), createStaff);
router.get('/users/:id', validate(userIdParamSchema, 'params'), getUser);
router.patch('/users/:id', validateAll({ params: userIdParamSchema, body: adminUserUpdateSchema }), updateUser);
router.delete('/users/:id', validate(userIdParamSchema, 'params'), deleteUser);

router.get('/settings', getSettingsHandler);
router.patch('/settings', validate(settingsUpdateSchema), patchSettings);
router.get('/tokens', tokenManagement);

router.post('/wallet/adjust', validate(walletAdjustSchema), adjustWallet);

export default router;