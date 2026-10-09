import { Router } from 'express';
import { optionalAuth, requireAdmin, requireAuth, requireStudent } from '../middleware/auth';
import { validate, validateAll } from '../middleware/validate';
import {
  createPaymentOrderSchema,
  idParamSchema,
  verifyPaymentSchema,
  walletTopupSchema,
  walletTopupVerifySchema,
} from '../validation/schemas';
import { writeLimiter } from '../middleware/rateLimit';
import {
  createGuestPaymentOrder,
  createPaymentOrder,
  getConfig,
  getWallet,
  listWalletTransactions,
  sandboxCheckout,
  sandboxVerifyOnly,
  verifyGuestPayment,
  verifyPayment,
  verifyWalletTopup,
  walletTopup,
} from '../controllers/payment.controller';

const router = Router();

/* --------------------------------------------------------- configuration */
router.get('/config', getConfig);

/* -------------------------------------------------------------- checkout */
/* Spec: the SAME create-order/verify endpoints serve guests (claim token in
   body, no auth header) and students (auth header). Controllers branch. */
router.post('/create-order', optionalAuth, writeLimiter, validate(createPaymentOrderSchema), createPaymentOrder);
router.post('/verify', optionalAuth, writeLimiter, validate(verifyPaymentSchema), verifyPayment);

/* -------------------------------------------------------- guest checkout */
router.post('/guest/create-order', writeLimiter, createGuestPaymentOrder);
router.post('/guest/verify', writeLimiter, verifyGuestPayment);

/* -------------------------------------------------- sandbox gateway (dev) */
router.post('/sandbox/checkout', requireAuth, sandboxCheckout);
router.post('/sandbox/verify', requireAuth, sandboxVerifyOnly);

/* ---------------------------------------------------------------- wallet */
router.get('/wallet', requireAuth, getWallet);
router.get('/wallet/transactions', requireAuth, listWalletTransactions);
router.post('/wallet/topup', requireAuth, requireStudent, writeLimiter, validate(walletTopupSchema), walletTopup);
router.post('/wallet/topup/verify', requireAuth, requireStudent, writeLimiter, validate(walletTopupVerifySchema), verifyWalletTopup);

export default router;