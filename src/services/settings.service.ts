import { prisma } from '../lib/prisma.js';

export type Settings = Record<string, string>;

let settingsCache: Settings | null = null;
let settingsCachedAt = 0;
let pendingLoad: Promise<Settings> | null = null;
const SETTINGS_TTL_MS = 60 * 1000;

export async function getSettings({ fresh = false }: { fresh?: boolean } = {}): Promise<Settings> {
	const now = Date.now();
	if (!fresh && settingsCache && now - settingsCachedAt < SETTINGS_TTL_MS) return settingsCache;
	// اگه یه بارگذاری در جریانه، بقیه منتظر همون می‌مونن به‌جای کوئری موازی
	if (pendingLoad) return pendingLoad;
	pendingLoad = prisma.setting
		.findMany()
		.then((rows) => {
			const loaded: Settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
			settingsCache = loaded;
			settingsCachedAt = Date.now();
			return loaded;
		})
		.finally(() => {
			pendingLoad = null;
		});
	return pendingLoad;
}

export function invalidateSettingsCache(): void {
	settingsCache = null;
	settingsCachedAt = 0;
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
