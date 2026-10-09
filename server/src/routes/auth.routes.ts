import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/ApiError';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { emailExists } from '../services/userStore';
import {
  changePassword,
  deleteAccount,
  login,
  logout,
  me,
  refresh,
  register,
  updateProfile,
} from '../controllers/auth.controller';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validation/schemas';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { name: 'RateLimited', message: 'Too many sign-in attempts. Please try again in 15 minutes.' } },
});

router.post('/register', loginLimiter, validate(registerSchema), asyncHandler(register));
// Spec alias: POST /api/auth/signup
router.post('/signup', loginLimiter, validate(registerSchema), asyncHandler(register));
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.post('/refresh', requireAuth, asyncHandler(refresh));
router.get('/me', requireAuth, asyncHandler(me));
router.patch('/me', requireAuth, validate(updateProfileSchema), asyncHandler(updateProfile));
router.patch('/me/password', requireAuth, validate(changePasswordSchema), asyncHandler(changePassword));
router.delete('/me', requireAuth, asyncHandler(deleteAccount));

/** Live username/email availability probe used by the register form. */
router.get(
  '/check-email',
  asyncHandler(async (req, res) => {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email) return res.json({ available: null });
    const exists = await emailExists(email);
    res.json({ available: !exists });
  }),
);

export default router;