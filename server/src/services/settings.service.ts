import { Settings, type ISettings } from '../models';

let cache: { value: ISettings; expiresAt: number } | null = null;
const TTL_MS = 10_000;

export async function getSettings(): Promise<ISettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const doc = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cache = { value: doc, expiresAt: Date.now() + TTL_MS };
  return doc;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function updateSettings(patch: Partial<ISettings>, adminId: string): Promise<ISettings> {
  const doc = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: { ...patch, updatedBy: adminId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  invalidateSettingsCache();
  return doc;
}