// Bookings that a schedule change in the panel falls on: a new closure, or new working hours for a weekday.
// The change itself is always allowed (the café decides), but the panel lists these bookings right away so the
// staff can call the customers. Before, a closure on a day with paid bookings was saved without a word, and the
// customers found out at the door.
import type { Closure, Prisma, ReservationStatus, WorkingHour } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { addMinutes, timeToMinutes } from '../lib/time.js';

/** A customer is really coming: paid, or paid and waiting for the staff to check the payment. */
const COMING: ReservationStatus[] = ['CONFIRMED', 'PAYMENT_REVIEW'];

const SELECT = {
	id: true,
	trackingCode: true,
	customerName: true,
	customerPhone: true,
	startAt: true,
	endAt: true,
	tables: { select: { table: { select: { displayNumber: true } } } },
} satisfies Prisma.ReservationSelect;

type Row = Prisma.ReservationGetPayload<{ select: typeof SELECT }>;

export interface AffectedReservation {
	id: string;
	trackingCode: string;
	customerName: string;
	customerPhone: string;
	startAt: Date;
	endAt: Date;
	/** Display numbers of the booked tables. */
	tables: string[];
}

const shape = (row: Row): AffectedReservation => ({
	id: row.id,
	trackingCode: row.trackingCode,
	customerName: row.customerName,
	customerPhone: row.customerPhone,
	startAt: row.startAt,
	endAt: row.endAt,
	tables: row.tables.map((t) => t.table.displayNumber),
});

/**
 * Upcoming bookings inside a closure: the same rule the booking page uses (whole café, one hall or one table;
 * the whole day or part of it).
 */
export async function reservationsInClosure(
	closure: Pick<Closure, 'date' | 'startTime' | 'endTime' | 'zone' | 'tableId'>,
	client: Db = prisma,
	now = new Date(),
): Promise<AffectedReservation[]> {
	const from = closure.startTime ? addMinutes(closure.date, timeToMinutes(closure.startTime)) : closure.date;
	const to = closure.endTime
		? addMinutes(closure.date, timeToMinutes(closure.endTime, { allowEndOfDay: true }))
		: addMinutes(closure.date, 24 * 60);
	const where: Prisma.ReservationWhereInput = {
		status: { in: COMING },
		startAt: { lt: to },
		endAt: { gt: from > now ? from : now },
	};
	if (closure.tableId || closure.zone) {
		const scope: Prisma.ReservationTableWhereInput[] = [];
		if (closure.tableId) scope.push({ tableId: closure.tableId });
		if (closure.zone) scope.push({ table: { zone: closure.zone } });
		where.tables = { some: { OR: scope } };
	}
	const rows = await client.reservation.findMany({ where, orderBy: { startAt: 'asc' }, select: SELECT });
	return rows.map(shape);
}

/** Upcoming bookings on this weekday that the new hours no longer cover (or all of them, if the day is now closed). */
export async function reservationsOutsideHours(
	dayOfWeek: number,
	hours: Pick<WorkingHour, 'opensAt' | 'closesAt' | 'isClosed'>,
	client: Db = prisma,
	now = new Date(),
): Promise<AffectedReservation[]> {
	const rows = await client.reservation.findMany({
		where: { status: { in: COMING }, endAt: { gt: now } },
		orderBy: { startAt: 'asc' },
		select: SELECT,
	});
	const opens = timeToMinutes(hours.opensAt);
	const closes = timeToMinutes(hours.closesAt, { allowEndOfDay: true });
	return rows
		.filter((row) => {
			// Tehran local time (src/timezone.ts), like the booking rules
			if (row.startAt.getDay() !== dayOfWeek) return false;
			if (hours.isClosed) return true;
			const start = row.startAt.getHours() * 60 + row.startAt.getMinutes();
			const end = start + Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000);
			return start < opens || end > closes;
		})
		.map(shape);
}
