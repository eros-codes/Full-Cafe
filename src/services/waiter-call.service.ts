import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { WaiterCallKind } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { timeToMinutes } from '../lib/time.js';
import { ON_PLAN } from './floor-plan.service.js';

// «صدا کردن گارسون»: every table has a QR code (/menu?table=<token>); a guest who scanned it can ask for the
// waiter or the bill from the site, and the panel hears it at once (server-sent events, see admin.routes.ts).
//
// Against pranks from outside the café:
//   · the token is random (12 characters, ~72 bits) and lives in its own table, never sent with the table rows
//     the site shows; the manager can replace every code at once (the old stickers stop working)
//   · one open call of each kind per table; a new one only after COOLDOWN since the table's last call
//   · calls are taken only while the café is open (the panel's working hours, with a little margin)
//   · a call nobody answered for STALE_MINUTES no longer blocks the table (the guest may ask again)

export const COOLDOWN_SECONDS = 30;
export const STALE_MINUTES = 20;
/** Minutes before opening and after closing a call is still taken (staff getting ready, the last guests). */
const HOURS_MARGIN = 30;

export const CALL_KINDS: readonly WaiterCallKind[] = ['WAITER', 'BILL'];
export const CALL_KIND_FA: Record<WaiterCallKind, string> = { WAITER: 'گارسون', BILL: 'صورت‌حساب' };

export const newCallToken = () => randomBytes(9).toString('base64url');

/** The table of a QR code: only one on the floor plan and switched on. */
export async function tableByToken(token: string) {
	if (!/^[\w-]{8,40}$/.test(token)) return null;
	const code = await prisma.tableCallCode.findUnique({ where: { token }, include: { table: true } });
	if (!code || code.table.retiredAt || !code.table.isActive) return null;
	return code.table;
}

/** Every table on the plan with its code; a table without one gets it now (new tables, the first sheet). */
export async function tablesWithCodes() {
	const tables = await prisma.cafeTable.findMany({ where: ON_PLAN, orderBy: { code: 'asc' }, include: { callCode: true } });
	const missing = tables.filter((t) => !t.callCode);
	if (missing.length) {
		await prisma.tableCallCode.createMany({ data: missing.map((t) => ({ tableId: t.id, token: newCallToken() })), skipDuplicates: true });
		return prisma.cafeTable.findMany({ where: ON_PLAN, orderBy: { code: 'asc' }, include: { callCode: true } });
	}
	return tables;
}

/** New codes for every table: the printed ones stop working (a sticker photographed and used from home). */
export async function replaceAllCodes(): Promise<number> {
	const tables = await prisma.cafeTable.findMany({ where: ON_PLAN, select: { id: true } });
	await prisma.$transaction([
		prisma.tableCallCode.deleteMany({}),
		prisma.tableCallCode.createMany({ data: tables.map((t) => ({ tableId: t.id, token: newCallToken() })) }),
	]);
	notifyCallsChanged();
	return tables.length;
}

/** Whether the café takes calls now (its working hours of today, server time like the bookings). */
export async function isOpenNow(now = new Date()): Promise<boolean> {
	const day = await prisma.workingHour.findUnique({ where: { dayOfWeek: now.getDay() } });
	if (!day || day.isClosed) return false;
	const minutes = now.getHours() * 60 + now.getMinutes();
	return minutes >= timeToMinutes(day.opensAt) - HOURS_MARGIN && minutes <= timeToMinutes(day.closesAt, { allowEndOfDay: true }) + HOURS_MARGIN;
}

const staleBefore = (now = new Date()) => new Date(now.getTime() - STALE_MINUTES * 60_000);

/** What a guest at the table sees: their open calls, and a call answered in the last minute (shown green briefly). */
export async function guestView(tableId: string) {
	const now = new Date();
	const calls = await prisma.waiterCall.findMany({
		where: {
			tableId,
			OR: [
				{ status: 'OPEN', createdAt: { gte: staleBefore(now) } },
				{ status: 'DONE', handledAt: { gte: new Date(now.getTime() - 60_000) } },
			],
		},
		orderBy: { createdAt: 'desc' },
		select: { id: true, kind: true, status: true, createdAt: true, handledAt: true },
	});
	return calls;
}

export type CallResult = { ok: true; call: { id: string; kind: WaiterCallKind; status: string; createdAt: Date } } | { ok: false; status: number; message: string };

/** A guest's call (WAITER or BILL); an open call of the same kind is returned as it is, not repeated. */
export async function createCall(tableId: string, kind: WaiterCallKind, now = new Date()): Promise<CallResult> {
	if (!(await isOpenNow(now))) return { ok: false, status: 409, message: 'الان ساعت کاری کافه نیست؛ درخواست فرستاده نشد.' };
	const open = await prisma.waiterCall.findFirst({ where: { tableId, kind, status: 'OPEN', createdAt: { gte: staleBefore(now) } } });
	if (open) return { ok: true, call: open };
	const last = await prisma.waiterCall.findFirst({ where: { tableId }, orderBy: { createdAt: 'desc' } });
	const wait = last ? COOLDOWN_SECONDS - Math.floor((now.getTime() - last.createdAt.getTime()) / 1000) : 0;
	if (wait > 0) return { ok: false, status: 429, message: `چند لحظه صبر کن و دوباره بزن (${wait.toLocaleString('fa-IR')} ثانیه).` };
	const call = await prisma.waiterCall.create({ data: { tableId, kind } });
	notifyCallsChanged();
	return { ok: true, call };
}

export async function cancelCall(tableId: string, id: string): Promise<boolean> {
	const { count } = await prisma.waiterCall.updateMany({ where: { id, tableId, status: 'OPEN' }, data: { status: 'CANCELLED' } });
	if (count) notifyCallsChanged();
	return count > 0;
}

/** The panel's list: open calls (oldest first) and the ones answered in the last half hour. */
export async function adminCalls() {
	const now = new Date();
	const include = { table: { select: { id: true, displayNumber: true, zone: true } }, handledBy: { select: { name: true } } } as const;
	const [open, done] = await Promise.all([
		prisma.waiterCall.findMany({ where: { status: 'OPEN', createdAt: { gte: new Date(now.getTime() - 3 * 3600_000) } }, orderBy: { createdAt: 'asc' }, include }),
		prisma.waiterCall.findMany({ where: { status: 'DONE', handledAt: { gte: new Date(now.getTime() - 30 * 60_000) } }, orderBy: { handledAt: 'desc' }, take: 20, include }),
	]);
	return { open, done, now };
}

export async function handleCall(id: string, adminId: string): Promise<boolean> {
	const { count } = await prisma.waiterCall.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'DONE', handledAt: new Date(), handledById: adminId } });
	if (count) notifyCallsChanged();
	return count > 0;
}

// ─── the panel's live line ───────────────────────────────────────────────────

const events = new EventEmitter();
// every open panel (each a listener): no warning past the default ten
events.setMaxListeners(0);

export function notifyCallsChanged(): void {
	events.emit('changed');
}

export function onCallsChanged(listener: () => void): () => void {
	events.on('changed', listener);
	return () => events.off('changed', listener);
}
