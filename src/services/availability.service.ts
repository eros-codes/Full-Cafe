import type { CafeTable, Closure, ReservationStatus, ReservationTable, TableConnection, WorkingHour } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { addDays, addMinutes, combineDateAndTime, endMinutesToTime, makeTimeSlots, overlapWithBuffer, timeToMinutes } from '../lib/time.js';
import { getSettings, numberSetting, type Settings } from './settings.service.js';
import { createHttpError } from '../lib/http-error.js';
import { CANCEL_WINDOW_MINUTES } from '../lib/constants.js';

// رزروهایی که میز را اشغال می‌کنند
export const BLOCKING_STATUSES: ReservationStatus[] = ['HOLD', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'CONFIRMED'];

export type TableWithConnections = CafeTable & { connectableTableIds: string[] };

interface BlockingReservation {
	status: ReservationStatus;
	holdExpiresAt: Date | null;
	startAt: Date;
	endAt: Date;
	tables: Pick<ReservationTable, 'tableId'>[];
}

type WindowCheck = { ok: false; reason: string } | { ok: true; startAt: Date; endAt: Date; endTime: string };

export type TableAvailability =
	| { tableId: string; code: string; available: false; reason: string }
	| {
			tableId: string;
			code: string;
			displayNumber: string;
			available: true;
			matchType: 'perfect' | 'soft';
			startTime: string;
			endTime: string;
			maxReservableMinutes: number;
			message: string;
	  };

export interface ComboAvailability {
	comboId: string;
	tableIds: string[];
	codes: string[];
	displayNumbers: string[];
	available: true;
	matchType: 'perfect-combo' | 'soft-combo';
	startTime: string;
	endTime: string;
	capacity: number;
	message: string;
}

export interface AvailabilityQuery {
	date: string;
	guestCount: number;
	durationMinutes: number;
	startTime?: string;
	rangeStart?: string;
	rangeEnd?: string;
}

export interface AvailabilityOptions {
	/** Staff bookings (phone/walk-in) skip the online minimum lead time. */
	ignoreLeadTime?: boolean;
	skipCombos?: boolean;
	skipSuggestions?: boolean;
}

export async function expireOldHolds(client: Db = prisma): Promise<void> {
	await client.reservation.updateMany({
		where: {
			status: { in: ['HOLD', 'PAYMENT_PENDING'] },
			holdExpiresAt: { lt: new Date() },
		},
		data: { status: 'EXPIRED' },
	});
}

export async function getPublicConfig() {
	const settings = await getSettings();
	const windowDays = numberSetting(settings, 'reservationWindowDays', 14);
	const dates: string[] = [];
	const today = new Date();
	for (let i = 0; i < windowDays; i++) {
		const d = addDays(today, i);
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		dates.push(`${y}-${m}-${day}`);
	}
	return {
		settings: {
			reservationWindowDays: windowDays,
			minLeadMinutes: numberSetting(settings, 'minLeadMinutes', 120),
			minDurationMinutes: numberSetting(settings, 'minDurationMinutes', 60),
			maxDurationMinutes: numberSetting(settings, 'maxDurationMinutes', 240),
			slotIntervalMinutes: numberSetting(settings, 'slotIntervalMinutes', 15),
			cleaningBufferMinutes: numberSetting(settings, 'cleaningBufferMinutes', 15, { min: 0 }),
			holdMinutes: numberSetting(settings, 'holdMinutes', 10),
			pricePerGuest: numberSetting(settings, 'pricePerGuest', 100000),
			decorationPrice: numberSetting(settings, 'decorationPrice', 0, { min: 0 }),
			minCancelMinutes: CANCEL_WINDOW_MINUTES,
			currencyLabel: settings.currencyLabel || 'تومان',
		},
		dates,
	};
}

export async function getTablesWithConnections(client: Db = prisma): Promise<{ tables: TableWithConnections[]; connections: TableConnection[] }> {
	const [tables, connections] = await Promise.all([
		client.cafeTable.findMany({ orderBy: [{ zone: 'asc' }, { code: 'asc' }] }),
		client.tableConnection.findMany(),
	]);
	const byId = new Map<string, TableWithConnections>(tables.map((t) => [t.id, { ...t, connectableTableIds: [] }]));
	for (const c of connections) {
		const a = byId.get(c.tableAId);
		const b = byId.get(c.tableBId);
		if (a && b) {
			a.connectableTableIds.push(c.tableBId);
			b.connectableTableIds.push(c.tableAId);
		}
	}
	return { tables: [...byId.values()], connections };
}

function reservationBlocksTable(reservation: BlockingReservation, tableId: string, startAt: Date, endAt: Date, bufferMinutes: number): boolean {
	const isActiveHold = reservation.status === 'HOLD' || reservation.status === 'PAYMENT_PENDING';
	if (isActiveHold && reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) return false;
	const hasTable = reservation.tables.some((rt) => rt.tableId === tableId);
	if (!hasTable) return false;
	return overlapWithBuffer(startAt, endAt, reservation.startAt, reservation.endAt, bufferMinutes);
}

function isTableClosed(table: CafeTable, dayClosures: Closure[], startTime: string, endTime: string): boolean {
	const relevant = dayClosures.filter((c) => (!c.tableId && !c.zone) || c.tableId === table.id || c.zone === table.zone);
	if (!relevant.length) return false;
	const requestedStart = timeToMinutes(startTime);
	// endTime برای رزروی که دقیقاً نیمه‌شب تمام می‌شود «24:00» است
	const requestedEnd = timeToMinutes(endTime, { allowEndOfDay: true });
	return relevant.some((closure) => {
		if (!closure.startTime || !closure.endTime) return true;
		return requestedStart < timeToMinutes(closure.endTime, { allowEndOfDay: true }) && requestedEnd > timeToMinutes(closure.startTime);
	});
}

// رزرو دستی پرسنل (تلفنی/حضوری) فاصله‌ی حداقلی مشتری آنلاین رو لازم نداره، ولی نباید در گذشته باشه.
const WALK_IN_GRACE_MINUTES = 15;

function validateTimeWindow({
	date,
	startTime,
	durationMinutes,
	settings,
	workingHoursByDay,
	ignoreLeadTime = false,
}: {
	date: string;
	startTime: string;
	durationMinutes: number;
	settings: Settings;
	workingHoursByDay: Map<number, WorkingHour>;
	ignoreLeadTime?: boolean;
}): WindowCheck {
	const minLeadMinutes = numberSetting(settings, 'minLeadMinutes', 120, { min: 0 });
	const windowDays = numberSetting(settings, 'reservationWindowDays', 14);
	const minDuration = numberSetting(settings, 'minDurationMinutes', 60);
	const maxDuration = numberSetting(settings, 'maxDurationMinutes', 240);
	if (durationMinutes < minDuration || durationMinutes > maxDuration) {
		return {
			ok: false,
			reason: `مدت رزرو باید بین ${minDuration / 60} تا ${maxDuration / 60} ساعت باشد.`,
		};
	}
	const startAt = combineDateAndTime(date, startTime);
	const endAt = addMinutes(startAt, durationMinutes);
	const now = new Date();
	if (ignoreLeadTime) {
		if (startAt < addMinutes(now, -WALK_IN_GRACE_MINUTES)) {
			return { ok: false, reason: 'زمان شروع رزرو گذشته است.' };
		}
	} else if (startAt < addMinutes(now, minLeadMinutes)) {
		return {
			ok: false,
			reason: `رزرو باید حداقل ${Math.round(minLeadMinutes / 60)} ساعت قبل از شروع ثبت شود.`,
		};
	}
	const maxDate = addDays(new Date(), windowDays);
	maxDate.setHours(23, 59, 59, 999);
	if (startAt > maxDate) {
		return { ok: false, reason: `رزرو فقط تا ${windowDays} روز آینده ممکن است.` };
	}
	const workingHour = workingHoursByDay.get(startAt.getDay());
	if (!workingHour || workingHour.isClosed) return { ok: false, reason: 'کافه در این روز بسته است.' };
	const endMinutesFromStartDay = timeToMinutes(startTime) + durationMinutes;
	const closesAt = timeToMinutes(workingHour.closesAt, { allowEndOfDay: true });
	if (timeToMinutes(startTime) < timeToMinutes(workingHour.opensAt) || endMinutesFromStartDay > closesAt) {
		return {
			ok: false,
			reason: `بازه باید داخل ساعات کاری ${workingHour.opensAt} تا ${workingHour.closesAt} باشد.`,
		};
	}
	// بعد از چک ساعات کاری، پایان رزرو حداکثر 24:00 همان روز است
	return { ok: true, startAt, endAt, endTime: endMinutesToTime(endMinutesFromStartDay) };
}

interface SlotContext {
	guestCount: number;
	durationMinutes: number;
	reservations: BlockingReservation[];
	dayClosures: Closure[];
	bufferMinutes: number;
}

function tableAvailabilityForStart(table: CafeTable, startTime: string, check: WindowCheck, ctx: SlotContext): TableAvailability {
	const unavailable = (reason: string): TableAvailability => ({ tableId: table.id, code: table.code, available: false, reason });
	if (!check.ok) return unavailable(check.reason);
	if (!table.isActive) return unavailable('این میز موقتاً غیرفعال است.');
	if (ctx.guestCount < table.minGuests) return unavailable('تعداد نفرات برای این میز کم است.');
	if (ctx.guestCount > table.maxGuests) return unavailable('ظرفیت این میز کافی نیست.');
	if (isTableClosed(table, ctx.dayClosures, startTime, check.endTime)) return unavailable('این میز/بخش در این بازه بسته است.');
	const blocked = ctx.reservations.some((reservation) =>
		reservationBlocksTable(reservation, table.id, check.startAt, check.endAt, ctx.bufferMinutes),
	);
	if (blocked) return unavailable('این میز در این زمان رزرو شده است.');

	return {
		tableId: table.id,
		code: table.code,
		displayNumber: table.displayNumber,
		available: true,
		matchType: ctx.guestCount === table.capacity ? 'perfect' : 'soft',
		startTime,
		endTime: check.endTime,
		maxReservableMinutes: ctx.durationMinutes,
		message: ctx.guestCount === table.capacity ? 'انتخاب ایده‌آل برای تعداد شما' : 'ظرفیت میز بیشتر از تعداد نفرات شماست',
	};
}

function enumerateConnectedGroups({
	tables,
	connectionRows,
	guestCount,
	maxTables = 4,
	maxGroups = 60,
}: {
	tables: CafeTable[];
	connectionRows: TableConnection[];
	guestCount: number;
	maxTables?: number;
	maxGroups?: number;
}): CafeTable[][] {
	const byId = new Map(tables.map((t) => [t.id, t]));
	const neighbors = new Map<string, Set<string>>(tables.map((t) => [t.id, new Set<string>()]));
	for (const c of connectionRows) {
		const a = neighbors.get(c.tableAId);
		const b = neighbors.get(c.tableBId);
		if (!a || !b) continue;
		a.add(c.tableBId);
		b.add(c.tableAId);
	}

	const table = (id: string) => byId.get(id) as CafeTable;
	const sumMin = (ids: string[]) => ids.reduce((s, id) => s + (table(id).minGuests || 1), 0);
	const sumMax = (ids: string[]) => ids.reduce((s, id) => s + (table(id).maxGuests || 0), 0);

	const groups: CafeTable[][] = [];
	const seen = new Set<string>();
	let frontier: string[][] = [...byId.keys()].map((id) => [id]).filter((g) => sumMin(g) < guestCount);

	while (frontier.length && groups.length < maxGroups) {
		const next: string[][] = [];
		for (const group of frontier) {
			if (group.length >= maxTables) continue;
			const candidates = new Set<string>();
			for (const id of group) {
				for (const n of neighbors.get(id) ?? []) if (!group.includes(n)) candidates.add(n);
			}
			for (const n of candidates) {
				const grown = [...group, n];
				const key = [...grown].sort().join('|');
				if (seen.has(key)) continue;
				seen.add(key);
				const min = sumMin(grown);
				if (guestCount >= min && guestCount <= sumMax(grown)) {
					groups.push(grown.map(table));
					if (groups.length >= maxGroups) return groups;
				}
				if (min < guestCount) next.push(grown);
			}
		}
		frontier = next;
	}
	return groups;
}

function comboAvailabilityForStart(groupTables: CafeTable[], startTime: string, check: WindowCheck, ctx: SlotContext): ComboAvailability | null {
	if (groupTables.length < 2) return null;
	if (!check.ok) return null;
	if (groupTables.some((t) => !t.isActive)) return null;

	const combinedMin = groupTables.reduce((s, t) => s + (t.minGuests || 1), 0);
	const combinedMax = groupTables.reduce((s, t) => s + (t.maxGuests || 0), 0);
	const combinedCapacity = groupTables.reduce((s, t) => s + (t.capacity || 0), 0);
	if (ctx.guestCount < combinedMin || ctx.guestCount > combinedMax) return null;

	if (groupTables.some((t) => isTableClosed(t, ctx.dayClosures, startTime, check.endTime))) return null;

	const blocked = ctx.reservations.some((reservation) =>
		groupTables.some((t) => reservationBlocksTable(reservation, t.id, check.startAt, check.endAt, ctx.bufferMinutes)),
	);
	if (blocked) return null;

	const displayNumbers = groupTables.map((t) => t.displayNumber);
	return {
		comboId: groupTables.map((t) => t.id).join('+'),
		tableIds: groupTables.map((t) => t.id),
		codes: groupTables.map((t) => t.code),
		displayNumbers,
		available: true,
		matchType: ctx.guestCount === combinedCapacity ? 'perfect-combo' : 'soft-combo',
		startTime,
		endTime: check.endTime,
		capacity: combinedCapacity,
		message: `پیشنهاد ترکیبی: میزهای ${displayNumbers.join(' و ')}`,
	};
}

export async function getAvailability(query: AvailabilityQuery, options: AvailabilityOptions = {}, client: Db = prisma) {
	const { date, guestCount, durationMinutes, startTime, rangeStart, rangeEnd } = query;
	// expireOldHolds intentionally omitted here: callers should allow background cleanup
	const settings = await getSettings();
	const interval = numberSetting(settings, 'slotIntervalMinutes', 15, { min: 1 });
	const { tables, connections: connectionRows } = await getTablesWithConnections(client);
	const dayStart = combineDateAndTime(date, '00:00');
	const dayEnd = addMinutes(dayStart, 24 * 60);
	const [reservations, workingHours, dayClosures] = await Promise.all([
		client.reservation.findMany({
			where: {
				status: { in: BLOCKING_STATUSES },
				startAt: { lt: dayEnd },
				endAt: { gt: dayStart },
			},
			include: { tables: true },
		}),
		client.workingHour.findMany(),
		client.closure.findMany({ where: { date: dayStart } }),
	]);
	const workingHoursByDay = new Map(workingHours.map((w) => [w.dayOfWeek, w]));

	let starts: string[];
	if (startTime) {
		starts = [startTime];
	} else if (rangeStart && rangeEnd) {
		const possible = makeTimeSlots(rangeStart, rangeEnd, interval);
		starts = possible.filter((slot) => timeToMinutes(slot) + durationMinutes <= timeToMinutes(rangeEnd, { allowEndOfDay: true }));
	} else {
		throw createHttpError(400, 'زمان شروع یا بازه زمانی لازم است.');
	}

	const ctx: SlotContext = {
		guestCount,
		durationMinutes,
		reservations,
		dayClosures,
		bufferMinutes: numberSetting(settings, 'cleaningBufferMinutes', 15, { min: 0 }),
	};
	const checkSlot = (slot: string) =>
		validateTimeWindow({ date, startTime: slot, durationMinutes, settings, workingHoursByDay, ignoreLeadTime: options.ignoreLeadTime });
	const slotChecks = new Map(starts.map((slot) => [slot, checkSlot(slot)]));

	const tableResults: (TableWithConnections & { availability: TableAvailability | null })[] = [];
	for (const table of tables) {
		let best: TableAvailability | null = null;
		for (const slot of starts) {
			const result = tableAvailabilityForStart(table, slot, slotChecks.get(slot) as WindowCheck, ctx);
			if (result.available) {
				best = result;
				break;
			}
			if (!best) best = result;
		}
		tableResults.push({ ...table, availability: best });
	}

	// ترکیب‌ها — قابل غیرفعال‌سازی برای بهبود عملکرد درون تراکنش
	const combos: ComboAvailability[] = [];
	const groups = options.skipCombos
		? []
		: enumerateConnectedGroups({
				tables,
				connectionRows,
				guestCount,
				maxTables: numberSetting(settings, 'maxComboTables', 4, { min: 2 }),
			});
	for (const group of groups) {
		for (const slot of starts) {
			const combo = comboAvailabilityForStart(group, slot, slotChecks.get(slot) as WindowCheck, ctx);
			if (combo) {
				combos.push(combo);
				break;
			}
		}
	}

	combos.sort((x, y) => x.tableIds.length - y.tableIds.length || Math.abs(x.capacity - guestCount) - Math.abs(y.capacity - guestCount));

	// پیشنهادِ زمان‌های نزدیک، قابل غیرفعال‌سازی برای عملیات ثبت
	const suggestions: { startTime: string; endTime: string }[] = [];
	const nothingFound = !tableResults.some((t) => t.availability?.available) && combos.length === 0;
	if (startTime && nothingFound && !options.skipSuggestions) {
		const workingHour = workingHoursByDay.get(dayStart.getDay());
		if (workingHour && !workingHour.isClosed) {
			const requestedMinutes = timeToMinutes(startTime);
			const closesAt = timeToMinutes(workingHour.closesAt, { allowEndOfDay: true });
			const daySlots = makeTimeSlots(workingHour.opensAt, workingHour.closesAt, interval)
				.filter((slot) => slot !== startTime && timeToMinutes(slot) + durationMinutes <= closesAt)
				.sort((a, b) => Math.abs(timeToMinutes(a) - requestedMinutes) - Math.abs(timeToMinutes(b) - requestedMinutes));

			for (const slot of daySlots) {
				if (suggestions.length >= 6) break;
				const check = checkSlot(slot);
				if (!check.ok) continue;
				const hasFreeTable = tables.some((table) => tableAvailabilityForStart(table, slot, check, ctx).available);
				if (hasFreeTable) suggestions.push({ startTime: slot, endTime: check.endTime });
			}
			suggestions.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
		}
	}

	const hasPerfect = tableResults.some((t) => t.availability?.available && t.availability.matchType === 'perfect');
	const hasSoft = tableResults.some((t) => t.availability?.available && t.availability.matchType === 'soft');
	const exactMissingMessage =
		!hasPerfect && hasSoft ? 'میز دقیق برای تعداد شما موجود نیست؛ نزدیک‌ترین میزهای قابل رزرو با سبز کمرنگ نمایش داده شده‌اند.' : null;

	return {
		date,
		guestCount,
		durationMinutes,
		tables: tableResults,
		combos,
		suggestions,
		exactMissingMessage,
	};
}

/**
 * رزروهای فعال دیگری که با این رزرو روی همان میز(ها) و همان زمان (با زمان آماده‌سازی) تداخل دارند.
 * برای وقتی که رزرو بدون گذر از موتور دسترس‌پذیری تایید می‌شود (پرداخت دیرهنگام، تایید دستی پرداخت).
 */
export async function findConflictingReservations(reservationId: string, client: Db = prisma) {
	const reservation = await client.reservation.findUnique({ where: { id: reservationId }, include: { tables: true } });
	if (!reservation) return [];
	const settings = await getSettings();
	const buffer = numberSetting(settings, 'cleaningBufferMinutes', 15, { min: 0 });
	const tableIds = reservation.tables.map((t) => t.tableId);
	const candidates = await client.reservation.findMany({
		where: {
			id: { not: reservation.id },
			status: { in: BLOCKING_STATUSES },
			tables: { some: { tableId: { in: tableIds } } },
			startAt: { lt: addMinutes(reservation.endAt, buffer) },
			endAt: { gt: addMinutes(reservation.startAt, -buffer) },
		},
		select: { id: true, trackingCode: true, status: true, holdExpiresAt: true },
	});
	const now = new Date();
	// نگه‌داری‌های منقضی‌شده (که هنوز پاک‌سازی نشده‌اند) دیگر میز را اشغال نمی‌کنند
	return candidates.filter((r) => !((r.status === 'HOLD' || r.status === 'PAYMENT_PENDING') && r.holdExpiresAt && r.holdExpiresAt < now));
}

export async function assertTablesAvailable(
	{ tableIds, date, startTime, durationMinutes, guestCount }: { tableIds: string[]; date: string; startTime: string; durationMinutes: number; guestCount: number },
	client: Db = prisma,
	{ ignoreLeadTime = false }: { ignoreLeadTime?: boolean } = {},
): Promise<void> {
	const availability = await getAvailability({ date, startTime, durationMinutes, guestCount }, { ignoreLeadTime, skipSuggestions: true }, client);
	if (tableIds.length === 1) {
		const table = availability.tables.find((t) => t.id === tableIds[0]);
		if (!table?.availability?.available) {
			throw createHttpError(400, (table?.availability && !table.availability.available && table.availability.reason) || 'میز در این زمان قابل رزرو نیست.');
		}
	} else {
		const requested = [...tableIds].sort().join('|');
		const combo = availability.combos.find((c) => [...c.tableIds].sort().join('|') === requested);
		if (!combo) throw createHttpError(400, 'این ترکیب میز در این زمان قابل رزرو نیست.');
	}
}
