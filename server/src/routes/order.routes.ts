import { Router } from 'express';
import { optionalAuth, requireAdmin, requireAuth, requireStudent } from '../middleware/auth';
import { validate, validateAll } from '../middleware/validate';
import { createOrderSchema, idParamSchema, orderQuerySchema, updateStatusSchema } from '../validation/schemas';
import { writeLimiter } from '../middleware/rateLimit';
import {
  adminOrders,
  cancelGuestOrder,
  cancelOrder,
  checkoutContext,
  currentOrders,
  getGuestOrder,
  getOrder,
  liveQueue,
  myOrders,
  payWithWallet,
  placeGuestOrder,
  placeOrder,
  updateStatus,
  validateCart,
  verifyGuestPaymentController,
} from '../controllers/order.controller';

const router = Router();

/* ------------------------------------------------------------- student */
/* Spec: POST /api/orders serves BOTH flows — auth header when logged in,
   omitted entirely for guests (controller branches on req.user). */
router.post('/', optionalAuth, writeLimiter, validate(createOrderSchema), placeOrder);
router.get('/my', requireAuth, myOrders);
// Spec alias: GET /api/orders/my-history
router.get('/my-history', requireAuth, myOrders);
router.get('/current', requireAuth, currentOrders);
// Public for guests (QR flow has no account).
router.post('/validate-cart', writeLimiter, validateCart);
router.get('/checkout-context', checkoutContext);

/* --------------------------------------------------------------- guest */
router.post('/guest', writeLimiter, validate(createOrderSchema), placeGuestOrder);
router.get('/guest/:id', validate(idParamSchema, 'params'), getGuestOrder);
router.post('/guest/:id/verify', writeLimiter, validate(idParamSchema, 'params'), verifyGuestPaymentController);
router.post('/guest/:id/cancel', writeLimiter, validate(idParamSchema, 'params'), cancelGuestOrder);

/* ----------------------------------------------- admin queue (no clash) */
router.get('/admin', requireAuth, requireAdmin, validate(orderQuerySchema, 'query'), adminOrders);
// Spec aliases for the admin dashboard.
router.get('/', requireAuth, requireAdmin, validate(orderQuerySchema, 'query'), adminOrders);
router.get('/queue', requireAuth, requireAdmin, liveQueue);

/* -------------------------------------------------------------- shared */
/* Spec: GET /api/orders/:id is polled for tracking — guests present ?claim=. */
router.get('/:id', optionalAuth, validate(idParamSchema, 'params'), getOrder);
router.patch('/:id/status', requireAuth, validateAll({ params: idParamSchema, body: updateStatusSchema }), updateStatus);
// Spec alias: PUT /api/orders/:id/status
router.put('/:id/status', requireAuth, validateAll({ params: idParamSchema, body: updateStatusSchema }), updateStatus);
router.post('/:id/cancel', requireAuth, cancelOrder);
router.post('/:id/pay-with-wallet', requireAuth, requireStudent, payWithWallet);

export default router;