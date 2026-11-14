// The café's floor plan as data: the tables of prisma/seed-data/floor-map.json, their chairs and which tables can be
// joined. Used by the seed (an empty database gets the layout), by `npm run map:apply` (an existing database is put
// on a new layout) and by the developer's «حذف میز» in the panel.
//
// A table that bookings point at cannot be deleted (their history keeps its number). Before, it could only be
// deactivated, and an inactive table is still drawn on the map: a new plan would have shown the old tables on top.
// Such a table is now *retired*: kept in the database, on no map and in no search.
import type { Prisma, PrismaClient, TableShape, ZoneKey } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { BLOCKING_STATUSES } from './availability.service.js';

/** The tables that are on the floor plan. */
export const ON_PLAN = { retiredAt: null } satisfies Prisma.CafeTableWhereInput;

const ZONES: readonly ZoneKey[] = ['WINDOW', 'CENTER', 'ROOF'];
const SHAPES: readonly TableShape[] = ['ROUND', 'SQUARE', 'RECTANGLE'];

export interface LayoutChair {
	x: number;
	y: number;
	angle?: number;
	type?: 'normal' | 'shared';
}

export interface LayoutTable {
	code: string;
	displayNumber: string;
	zone: ZoneKey;
	shape: TableShape;
	capacity: number;
	minGuests: number;
	maxGuests: number;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	chairs: LayoutChair[];
	description: string | null;
}

export interface FloorLayout {
	tables: LayoutTable[];
	/** Pairs of table codes that can be booked together. */
	connections: [string, string][];
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 40;

/** Checks a layout file and returns it typed; throws with every problem found (in English, for the developer). */
export function parseLayout(input: unknown): FloorLayout {
	const problems: string[] = [];
	const data = (input ?? {}) as { tables?: unknown; connections?: unknown };
	if (!Array.isArray(data.tables) || !data.tables.length) throw new Error('floor map: "tables" must be a non-empty list');
	const codes = new Set<string>();
	const numbers = new Set<string>();
	const tables = data.tables.map((raw, i): LayoutTable => {
		const t = (raw ?? {}) as Record<string, unknown>;
		const where = `table ${i + 1}${typeof t.code === 'string' ? ` (${t.code})` : ''}`;
		const code = typeof t.code === 'string' ? t.code.trim().toUpperCase() : '';
		if (!/^[A-Z0-9-]{1,12}$/.test(code)) problems.push(`${where}: code must be 1–12 letters, digits or "-"`);
		else if (codes.has(code)) problems.push(`${where}: code ${code} is used twice`);
		codes.add(code);
		const displayNumber = typeof t.displayNumber === 'string' ? t.displayNumber.trim() : '';
		if (!displayNumber || displayNumber.length > 12) problems.push(`${where}: displayNumber is required (at most 12 characters)`);
		else if (numbers.has(displayNumber)) problems.push(`${where}: display number ${displayNumber} is used twice`);
		numbers.add(displayNumber);
		if (!ZONES.includes(t.zone as ZoneKey)) problems.push(`${where}: zone must be one of ${ZONES.join(', ')}`);
		if (!SHAPES.includes(t.shape as TableShape)) problems.push(`${where}: shape must be one of ${SHAPES.join(', ')}`);
		for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
			if (!isNumber(t[key]) && !(key === 'rotation' && t[key] === undefined)) problems.push(`${where}: ${key} must be a number`);
		}
		if (isNumber(t.x) && (t.x < 0 || t.x > 1800)) problems.push(`${where}: x is outside the plan (0–1800)`);
		if (isNumber(t.y) && (t.y < 0 || t.y > 900)) problems.push(`${where}: y is outside the plan (0–900)`);
		const chairs = Array.isArray(t.chairs) ? (t.chairs as LayoutChair[]) : [];
		if (!chairs.length || chairs.some((c) => !c || !isNumber(c.x) || !isNumber(c.y)))
			problems.push(`${where}: chairs must be a list of {x, y}`);
		for (const key of ['capacity', 'minGuests', 'maxGuests'] as const)
			if (!isCount(t[key])) problems.push(`${where}: ${key} must be a whole number from 1`);
		if (isCount(t.minGuests) && isCount(t.maxGuests) && t.minGuests > t.maxGuests)
			problems.push(`${where}: minGuests is more than maxGuests`);
		if (isCount(t.maxGuests) && isCount(t.capacity) && t.maxGuests > t.capacity) problems.push(`${where}: maxGuests is more than capacity`);
		return {
			code,
			displayNumber,
			zone: t.zone as ZoneKey,
			shape: t.shape as TableShape,
			capacity: t.capacity as number,
			minGuests: t.minGuests as number,
			maxGuests: t.maxGuests as number,
			x: t.x as number,
			y: t.y as number,
			width: t.width as number,
			height: t.height as number,
			rotation: (t.rotation as number) ?? 0,
			chairs: chairs.map((c) => ({ x: c.x, y: c.y, angle: c.angle ?? 0, type: c.type === 'shared' ? 'shared' : 'normal' })),
			description: typeof t.description === 'string' && t.description.trim() ? t.description.trim().slice(0, 300) : null,
		};
	});
	const connections: [string, string][] = [];
	for (const pair of Array.isArray(data.connections) ? data.connections : []) {
		const [a, b] = Array.isArray(pair) ? pair.map((c) => String(c).trim().toUpperCase()) : [];
		if (!a || !b || a === b || !codes.has(a) || !codes.has(b))
			problems.push(`connection ${JSON.stringify(pair)}: needs two different table codes of this layout`);
		else connections.push([a, b]);
	}
	if (problems.length) throw new Error(`floor map has problems:\n  ${problems.join('\n  ')}`);
	return { tables, connections };
}

/** Bookings still to come on these tables: held (not run out), paid, or paid and waiting for the payment check. */
export async function upcomingBookingsOn(tableIds: string[], client: Db = prisma, now = new Date()) {
	if (!tableIds.length) return [];
	const rows = await client.reservation.findMany({
		where: { status: { in: BLOCKING_STATUSES }, endAt: { gt: now }, tables: { some: { tableId: { in: tableIds } } } },
		select: {
			id: true,
			trackingCode: true,
			customerName: true,
			startAt: true,
			status: true,
			holdExpiresAt: true,
			tables: { select: { table: { select: { code: true, displayNumber: true } } } },
		},
		orderBy: { startAt: 'asc' },
	});
	return rows.filter((r) => !(r.status === 'HOLD' && r.holdExpiresAt && r.holdExpiresAt <= now));
}

/**
 * Takes a table off the plan: deleted when no booking ever used it, otherwise retired (its connections and its own
 * closures go; the bookings keep pointing at it). Check upcomingBookingsOn first: this does not.
 */
export async function removeFromPlan(tx: Db, tableId: string): Promise<'deleted' | 'retired'> {
	const used = await tx.reservationTable.count({ where: { tableId } });
	if (!used) {
		await tx.cafeTable.delete({ where: { id: tableId } });
		return 'deleted';
	}
	await tx.tableConnection.deleteMany({ where: { OR: [{ tableAId: tableId }, { tableBId: tableId }] } });
	await tx.closure.deleteMany({ where: { tableId } });
	await tx.cafeTable.update({ where: { id: tableId }, data: { retiredAt: new Date(), isActive: false } });
	return 'retired';
}

export interface LayoutPlan {
	create: string[];
	update: string[];
	/** Tables on the plan today that the layout does not have. */
	remove: { id: string; code: string; displayNumber: string; used: boolean }[];
	/** Upcoming bookings on the tables that would leave the plan. */
	blockers: Awaited<ReturnType<typeof upcomingBookingsOn>>;
}

/** What applying the layout would do (nothing is changed). */
export async function planLayout(layout: FloorLayout, client: Db = prisma): Promise<LayoutPlan> {
	const existing = await client.cafeTable.findMany({ select: { id: true, code: true, displayNumber: true, retiredAt: true } });
	const byCode = new Map(existing.map((t) => [t.code, t]));
	const wanted = new Set(layout.tables.map((t) => t.code));
	const leaving = existing.filter((t) => !t.retiredAt && !wanted.has(t.code));
	const usedIds = new Set(
		(await client.reservationTable.findMany({ where: { tableId: { in: leaving.map((t) => t.id) } }, select: { tableId: true } })).map(
			(r) => r.tableId,
		),
	);
	return {
		create: layout.tables.filter((t) => !byCode.has(t.code)).map((t) => t.code),
		update: layout.tables.filter((t) => byCode.has(t.code)).map((t) => t.code),
		remove: leaving.map((t) => ({ id: t.id, code: t.code, displayNumber: t.displayNumber, used: usedIds.has(t.id) })),
		blockers: await upcomingBookingsOn(
			leaving.map((t) => t.id),
			client,
		),
	};
}

export interface LayoutResult {
	created: number;
	updated: number;
	deleted: number;
	retired: number;
	connections: number;
}

/**
 * Puts the database on the layout, in one transaction: tables of the layout are created or updated (by code; an
 * existing table keeps its on/off switch), the other tables leave the plan (removeFromPlan), and the connections
 * become exactly the layout's. Refuses while bookings to come sit on a table that would leave, unless `force`.
 */
export async function applyLayout(
	layout: FloorLayout,
	{ client = prisma, force = false }: { client?: PrismaClient; force?: boolean } = {},
): Promise<LayoutResult> {
	return client.$transaction(
		async (tx) => {
			const plan = await planLayout(layout, tx);
			if (plan.blockers.length && !force) {
				const list = plan.blockers.map((r) => `${r.trackingCode} (${r.tables.map((t) => t.table.displayNumber).join('+')})`).join(', ');
				throw new Error(`bookings to come are on tables the new plan removes: ${list}. Move or cancel them first, or use --force.`);
			}
			const result: LayoutResult = { created: 0, updated: 0, deleted: 0, retired: 0, connections: 0 };
			for (const table of plan.remove) {
				result[(await removeFromPlan(tx, table.id)) === 'deleted' ? 'deleted' : 'retired']++;
			}
			const ids = new Map<string, string>();
			for (const t of layout.tables) {
				const fields = {
					displayNumber: t.displayNumber,
					zone: t.zone,
					shape: t.shape,
					capacity: t.capacity,
					minGuests: t.minGuests,
					maxGuests: t.maxGuests,
					x: t.x,
					y: t.y,
					width: t.width,
					height: t.height,
					rotation: t.rotation,
					chairs: t.chairs as unknown as Prisma.InputJsonValue,
					description: t.description,
				};
				const before = await tx.cafeTable.findUnique({ where: { code: t.code }, select: { id: true, retiredAt: true } });
				const saved = before
					? await tx.cafeTable.update({
							where: { id: before.id },
							// a retired table that the layout brings back is on the plan and on again
							data: { ...fields, ...(before.retiredAt ? { retiredAt: null, isActive: true } : {}) },
						})
					: await tx.cafeTable.create({ data: { code: t.code, ...fields, isActive: true } });
				ids.set(t.code, saved.id);
				result[before ? 'updated' : 'created']++;
			}
			const planIds = [...ids.values()];
			await tx.tableConnection.deleteMany({ where: { OR: [{ tableAId: { in: planIds } }, { tableBId: { in: planIds } }] } });
			for (const [a, b] of layout.connections) {
				const [tableAId, tableBId] = [ids.get(a)!, ids.get(b)!].sort();
				await tx.tableConnection.upsert({
					where: { tableAId_tableBId: { tableAId, tableBId } },
					update: {},
					create: { tableAId, tableBId },
				});
				result.connections++;
			}
			return result;
		},
		{ timeout: 30_000 },
	);
}
