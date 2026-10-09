import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { revenueReport } from '../controllers/reports.controller';

const router = Router();

router.get('/revenue', requireAdmin, revenueReport);

export default router;
