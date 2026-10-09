import mongoose, { Schema, type Model } from 'mongoose';

/** Atomic monotonic counters (order numbers, daily token sequences). */
export interface ICounter {
  key: string;
  value: number;
}

const counterSchema = new Schema<ICounter>({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: Number, default: 0 },
});

export const Counter: Model<ICounter> = mongoose.models.Counter || mongoose.model<ICounter>('Counter', counterSchema);

export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  return doc.value;
}