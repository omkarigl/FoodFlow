import type { Request, Response } from 'express';
import { Canteen, MenuItem, QRLocation } from '../models';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { evaluateCanteen } from '../services/order.service';
import { emitToAdmins, emitToAll, SOCKET_EVENTS } from '../services/realtime.service';
import { MENU_CATEGORIES } from '../models/MenuItem';

function decorate(canteen: Record<string, unknown>) {
  const state = evaluateCanteen({
    isOpen: canteen.isOpen as boolean,
    isActive: canteen.isActive as boolean,
    acceptsOrders: canteen.acceptsOrders as boolean,
    enforceSchedule: canteen.enforceSchedule as boolean,
    openingTime: canteen.openingTime as string,
    closingTime: canteen.closingTime as string,
  });
  return { ...canteen, canOrder: state.canOrder, reason: state.reason, withinSchedule: state.withinSchedule };
}

/** Public endpoint consumed by the landing page / QR entry. */
export const getStatus = asyncHandler(async (_req: Request, res: Response) => {
  const canteens = await Canteen.find({ isActive: true }).sort({ name: 1 }).lean();
  res.json({
    canteens: canteens.map((c) => decorate({ ...c, id: String(c._id), _id: undefined })),
    categories: MENU_CATEGORIES,
    at: new Date().toISOString(),
  });
});

export const getOneStatus = asyncHandler(async (req: Request, res: Response) => {
  const canteen = await Canteen.findById(req.params.canteenId).lean();
  if (!canteen) throw ApiError.notFound('Canteen not found.');
  res.json({ canteen: decorate({ ...canteen, id: String(canteen._id) }) });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const canteen = await Canteen.findById(req.params.canteenId);
  if (!canteen) throw ApiError.notFound('Canteen not found.');

  const body = req.body as Partial<Record<'isOpen' | 'acceptsOrders' | 'closedMessage' | 'isActive' | 'enforceSchedule' | 'openingTime' | 'closingTime' | 'prepTimeMins' | 'maxConcurrentOrders', unknown>>;
  Object.assign(canteen, body);
  await canteen.save();

  const payload = { canteen: decorate(canteen.toJSON()), updatedBy: req.user!.name };
  emitToAll(SOCKET_EVENTS.CANTEEN_STATUS, payload);
  emitToAdmins(SOCKET_EVENTS.CANTEEN_STATUS, payload);

  res.json(payload);
});

export const listCanteens = asyncHandler(async (_req: Request, res: Response) => {
  const canteens = await Canteen.find().sort({ name: 1 }).lean();
  res.json({ canteens: canteens.map((c) => decorate({ ...c, id: String(c._id) })) });
});

export const createCanteen = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const canteen = await Canteen.create(body);
  res.status(201).json({ canteen });
});

export const listQrLocations = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.canteen) filter.canteen = req.query.canteen;
  const locations = await QRLocation.find(filter).populate('canteen', 'name code block isOpen').sort({ code: 1 }).lean();
  res.json({ locations });
});

/** Resolves a scanned QR code such as `?location=PILLAR_01`. */
export const resolveQr = asyncHandler(async (req: Request, res: Response) => {
  const code = String(req.query.location ?? req.params.code ?? '').trim().toUpperCase();
  if (!code) throw ApiError.badRequest('A location code is required.');

  const location = await QRLocation.findOne({ code }).populate('canteen').lean();
  if (!location) throw ApiError.notFound(`No QR location found for code "${code}".`);
  if (!location.isActive) throw ApiError.badRequest('This QR code is no longer in use. Please scan a valid code.');

  await QRLocation.updateOne({ _id: location._id }, { $inc: { scanCount: 1 } });

  const canteen = location.canteen as unknown as Record<string, unknown>;
  res.json({
    location: {
      id: String(location._id),
      code: location.code,
      label: location.label,
      block: location.block,
      description: location.description,
      tableHint: location.tableHint,
    },
    canteen: decorate({ ...canteen, id: String((canteen as { _id: unknown })._id) }),
  });
});

export const createQrLocation = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const canteenExists = await Canteen.exists({ _id: body.canteen });
  if (!canteenExists) throw ApiError.badRequest('The selected canteen does not exist.');
  const location = await QRLocation.create(body);
  res.status(201).json({ location });
});

export const updateQrLocation = asyncHandler(async (req: Request, res: Response) => {
  const location = await QRLocation.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!location) throw ApiError.notFound('QR location not found.');
  res.json({ location });
});

export const deleteQrLocation = asyncHandler(async (req: Request, res: Response) => {
  const location = await QRLocation.findByIdAndDelete(req.params.id);
  if (!location) throw ApiError.notFound('QR location not found.');
  res.json({ success: true, message: `QR location ${location.code} removed.` });
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await MenuItem.distinct('category');
  const merged = Array.from(new Set([...MENU_CATEGORIES, ...categories]));
  res.json({ categories: merged });
});