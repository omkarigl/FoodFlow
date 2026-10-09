import { Router } from 'express';
import { optionalAuth, requireAdmin } from '../middleware/auth';
import { validate, validateAll } from '../middleware/validate';
import {
  bulkAvailabilitySchema,
  idParamSchema,
  inventoryAdjustSchema,
  inventoryBulkSchema,
  menuItemAvailabilitySchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  menuQuerySchema,
} from '../validation/schemas';
import {
  adjustInventory,
  adminMenuOverview,
  bulkAvailability,
  bulkInventory,
  createMenuItem,
  deleteMenuItem,
  getMenuItem,
  inventoryHistory,
  listInventory,
  listMenu,
  setAvailability,
  updateMenuItem,
} from '../controllers/menu.controller';

const router = Router();

/* --------------------------------------------------- student + admin read */
router.get('/', optionalAuth, validate(menuQuerySchema, 'query'), listMenu);
router.get('/inventory', requireAdmin, listInventory);
router.get('/overview', requireAdmin, adminMenuOverview);
router.get('/:id', optionalAuth, validate(idParamSchema, 'params'), getMenuItem);
router.get('/:id/inventory-history', requireAdmin, validate(idParamSchema, 'params'), inventoryHistory);

/* ------------------------------------------------------------------ admin */
router.post('/', requireAdmin, validate(menuItemCreateSchema), createMenuItem);
router.put('/:id', requireAdmin, validateAll({ params: idParamSchema, body: menuItemUpdateSchema }), updateMenuItem);
router.patch('/:id', requireAdmin, validateAll({ params: idParamSchema, body: menuItemUpdateSchema }), updateMenuItem);
router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), deleteMenuItem);
router.patch('/:id/availability', requireAdmin, validateAll({ params: idParamSchema, body: menuItemAvailabilitySchema }), setAvailability);
router.post('/bulk/availability', requireAdmin, validate(bulkAvailabilitySchema), bulkAvailability);
router.post('/inventory/adjust', requireAdmin, validate(inventoryAdjustSchema), adjustInventory);
router.post('/inventory/bulk-set', requireAdmin, validate(inventoryBulkSchema), bulkInventory);

export default router;