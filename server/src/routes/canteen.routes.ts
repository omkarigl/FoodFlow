import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { validate, validateAll } from '../middleware/validate';
import {
  canteenCreateSchema,
  canteenIdParamSchema,
  canteenStatusUpdateSchema,
  idParamSchema,
  qrLocationCreateSchema,
  qrLocationUpdateSchema,
  resolveQrSchema,
} from '../validation/schemas';
import {
  createCanteen,
  createQrLocation,
  deleteQrLocation,
  getOneStatus,
  getStatus,
  listCategories,
  listCanteens,
  listQrLocations,
  resolveQr,
  updateQrLocation,
  updateStatus,
} from '../controllers/canteen.controller';

const router = Router();

/* ------------------------------------------------------------- public */
router.get('/status', getStatus);
router.get('/categories', listCategories);
router.get('/qr-locations', listQrLocations);
router.get('/resolve', validate(resolveQrSchema, 'query'), resolveQr);
router.get('/resolve/:code', resolveQr);
router.get('/:canteenId/status', validate(canteenIdParamSchema, 'params'), getOneStatus);

/* -------------------------------------------------------------- admin */
router.get('/', requireAdmin, listCanteens);
router.post('/', requireAdmin, validate(canteenCreateSchema), createCanteen);
router.patch(
  '/status/:canteenId',
  requireAdmin,
  validateAll({ params: canteenIdParamSchema, body: canteenStatusUpdateSchema }),
  updateStatus,
);
router.post('/qr-locations', requireAdmin, validate(qrLocationCreateSchema), createQrLocation);
router.patch('/qr-locations/:id', requireAdmin, validateAll({ params: idParamSchema, body: qrLocationUpdateSchema }), updateQrLocation);
router.delete('/qr-locations/:id', requireAdmin, validate(idParamSchema, 'params'), deleteQrLocation);

export default router;