import { prisma } from '../lib/prisma.js';

export type Settings = Record<string, string>;

let settingsCache: Settings | null = null;
let settingsCachedAt = 0;
let pendingLoad: Promise<Settings> | null = null;
/** Goes up with every change: a load that started before a change must not be cached (or shared) after it. */
let generation = 0;
const SETTINGS_TTL_MS = 60 * 1000;

export async function getSettings({ fresh = false }: { fresh?: boolean } = {}): Promise<Settings> {
	const now = Date.now();
	if (!fresh && settingsCache && now - settingsCachedAt < SETTINGS_TTL_MS) return settingsCache;
	// اگه یه بارگذاری در جریانه، بقیه منتظر همون می‌مونن به‌جای کوئری موازی
	if (pendingLoad) return pendingLoad;
	const startedAt = generation;
	const load = prisma.setting
		.findMany()
		.then((rows) => {
			const loaded: Settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
			// before, a load that read the old values just before an admin saved new ones was cached afterwards,
			// and the old price / hold time / … stayed in use for another minute
			if (startedAt === generation) {
				settingsCache = loaded;
				settingsCachedAt = Date.now();
			}
			return loaded;
		})
		.finally(() => {
			if (pendingLoad === load) pendingLoad = null;
		});
	pendingLoad = load;
	return load;
}

export function invalidateSettingsCache(): void {
	settingsCache = null;
	settingsCachedAt = 0;
	generation++;
	// the next reader starts a load of its own instead of joining one that may have read the old values
	pendingLoad = null;
}

export function numberSetting(settings: Settings, key: string, fallback: number, { min = null }: { min?: number | null } = {}): number {
	const n = Number(settings[key]);
	if (!Number.isFinite(n)) return fallback;
	if (min !== null && n < min) return fallback;
	return n;
}

export async function setSetting(key: string, value: string | number) {
	const row = await prisma.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
	invalidateSettingsCache();
	return row;
}
