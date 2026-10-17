import express from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, type AdminRole, type CafeTable, type ReservationStatus, type TableShape, type ZoneKey } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { createManualReservation } from '../services/reservation.service.js';
import { getSettings, setSetting } from '../services/settings.service.js';
import { CLOCK_TIME, CLOSING_TIME, combineDateAndTime, isValidDateString, normalizePhone } from '../lib/time.js';
import { setCookie, signAdminToken } from '../lib/auth.js';
import { confirmationMessage, sendMockSms } from '../lib/sms.js';
import { ROLE_GROUPS, USERNAME_PATTERN, canManageRole, isAdminRole, normalizeUsername } from '../lib/roles.js';
import { adminMenuRouter } from './admin-menu.routes.js';
import { todayKey } from '../middleware/site-visit.js';
import { findConflictingReservations } from '../services/availability.service.js';
import { createHttpError, prismaCode } from '../lib/http-error.js';
import { currentAdmin } from '../lib/request.js';

export const adminRouter = express.Router();

adminRouter.use(requireAdmin);

adminRouter.get('/me', (req, res) => {
	const admin = currentAdmin(req);
	res.json({ admin: { id: admin.id, username: admin.username, name: admin.name, role: admin.role } });
});

// منو، دسته‌بندی، نظرات و آپلود تصویر (از قالب کافه)
adminRouter.use(adminMenuRouter);

adminRouter.get('/dashboard', requireRole(...ROLE_GROUPS.manager), async (_req, res, next) => {
	try {
		const now = new Date();
		const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

		const [actionNeeded, upcoming, revenue, visitorsToday, productsCount, categoriesCount, reviewsPending] = await Promise.all([
			// از همون تعریف فیلتر استفاده می‌شه تا این دو عدد هیچ‌وقت با هم فرق نکنن
			prisma.reservation.count({ where: reservationFilterWhere('action', now) }),
			// رزروهای امروز که هنوز ساعتشون نرسیده
			prisma.reservation.findMany({
				where: { status: 'CONFIRMED', startAt: { gte: now, lt: dayEnd } },
				orderBy: { startAt: 'asc' },
				take: 20,
				include: { tables: { include: { table: true } } },
			}),
			prisma.payment.aggregate({
				where: { status: 'PAID', reservation: { status: { not: 'CANCELLED' } } },
				_sum: { amount: true },
			}),
			// آمار بخش منو (از داشبورد قالب کافه)
			prisma.siteVisit.count({ where: { visitDate: todayKey(now) } }),
			prisma.product.count(),
			prisma.category.count(),
			prisma.review.count({ where: { visible: false } }),
		]);

		res.json({
			actionNeeded,
			upcoming,
			totalRevenue: revenue._sum.amount || 0,
			visitorsToday,
			productsCount,
			categoriesCount,
			reviewsPending,
		});
	} catch (error) {
		next(error);
	}
});

const RESERVATION_FILTERS = ['action', 'all', 'today', 'confirmed', 'completed', 'noshow', 'cancelled'] as const;
type ReservationFilter = (typeof RESERVATION_FILTERS)[number];

function isReservationFilter(value: unknown): value is ReservationFilter {
	return typeof value === 'string' && (RESERVATION_FILTERS as readonly string[]).includes(value);
}

function reservationFilterWhere(filter: ReservationFilter | undefined, now: Date): Prisma.ReservationWhereInput {
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	switch (filter) {
		// هرچیزی که واقعاً منتظر تصمیم یا اقدام ادمینه:
		case 'action':
			return {
				OR: [
					// زمانش تموم شده ولی تکمیل/عدم‌حضور نخورده
					{ status: 'CONFIRMED', endAt: { lt: now } },
					// پول گرفته شده ولی ثبت رزرو شکست خورده — فوری‌ترین مورد
					{ status: 'PAYMENT_REVIEW' },
					// به مشتری بدهکاریم و هنوز برنگردوندیم
					{ refundStatus: 'PENDING' },
				],
			};
		case 'today':
			return { startAt: { gte: dayStart, lt: dayEnd } };
		// رزرو شده ولی هنوز ساعتش نرسیده
		case 'confirmed':
			return { status: 'CONFIRMED', startAt: { gte: now } };
		case 'completed':
			return { status: 'COMPLETED' };
		case 'noshow':
			return { status: 'NO_SHOW' };
		case 'cancelled':
			return { status: 'CANCELLED' };
		default:
			return {};
	}
}

adminRouter.get('/reservations/counts', async (_req, res, next) => {
	try {
		const now = new Date();
		const entries = await Promise.all(
			RESERVATION_FILTERS.map(async (key) => [key, await prisma.reservation.count({ where: reservationFilterWhere(key, now) })]),
		);
		res.json({ counts: Object.fromEntries(entries) });
	} catch (error) {
		next(error);
	}
});

adminRouter.get('/reservations', async (req, res, next) => {
	try {
		const VALID_STATUSES: readonly string[] = [
			'DRAFT',
			'HOLD',
			'PAYMENT_PENDING',
			'PAYMENT_REVIEW',
			'CONFIRMED',
			'CANCELLED',
			'COMPLETED',
			'NO_SHOW',
			'EXPIRED',
		];
		const filter = isReservationFilter(req.query.filter) ? req.query.filter : undefined;
		if (req.query.filter && !filter) {
			return res.status(400).json({ message: 'فیلتر نامعتبر است.' });
		}
		const where: Prisma.ReservationWhereInput = { ...reservationFilterWhere(filter, new Date()) };
		const status = req.query.status;
		if (status) {
			if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
				return res.status(400).json({ message: 'وضعیت نامعتبر است.' });
			}
			// فیلتر و وضعیت هم‌زمان یعنی درخواست متناقض؛ بی‌صدا یکی را نادیده نگیریم
			if (filter && filter !== 'all') {
				return res.status(400).json({ message: 'فیلتر و وضعیت را هم‌زمان نمی‌توان فرستاد.' });
			}
			where.status = status as ReservationStatus;
		}
		if (req.query.from || req.query.to) {
			const startAt: Prisma.DateTimeFilter<'Reservation'> = {};
			for (const [param, op] of [
				['from', 'gte'],
				['to', 'lte'],
			] as const) {
				const raw = req.query[param];
				if (!raw) continue;
				const parsed = new Date(typeof raw === 'string' ? raw : Number.NaN);
				if (Number.isNaN(parsed.getTime())) {
					return res.status(400).json({ message: 'بازه‌ی تاریخ نامعتبر است.' });
				}
				startAt[op] = parsed;
			}
			where.startAt = startAt;
		}
		const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
		const skip = Math.max(Number(req.query.offset) || 0, 0);
		const [reservations, total] = await Promise.all([
			prisma.reservation.findMany({
				where,
				orderBy: { startAt: 'desc' },
				take,
				skip,
				include: { tables: { include: { table: true } }, payments: { orderBy: { createdAt: 'desc' } }, invoice: true, user: true },
			}),
			prisma.reservation.count({ where }),
		]);
		res.json({ reservations, total, limit: take, offset: skip });
	} catch (error) {
		next(error);
	}
});

adminRouter.post('/reservations/manual', async (req, res, next) => {
	try {
		const reservation = await createManualReservation({
			tableIds: req.body.tableIds,
			date: req.body.date,
			startTime: req.body.startTime,
			durationMinutes: Number(req.body.durationMinutes),
			guestCount: Number(req.body.guestCount),
			customerName: req.body.customerName,
			customerPhone: normalizePhone(req.body.customerPhone),
			userId: null,
			decoration: req.body.decoration === true,
			decorationNote: req.body.decorationNote,
		});
		await sendMockSms({
			phone: reservation.customerPhone,
			type: 'CONFIRMATION',
			message: `رزرو دستی شما در Roof تایید شد. کد پیگیری: ${reservation.trackingCode}`,
		}).catch((error) => console.error('SMS رزرو دستی ارسال نشد:', error));
		res.status(201).json({ reservation });
	} catch (error) {
		next(error);
	}
});

// وضعیت مقصد ← وضعیت‌هایی که می‌شود از آن‌ها به مقصد رفت.
// قبلاً هر وضعیتی به هر وضعیتی قابل تغییر بود؛ مثلاً یک رزرو منقضی یا لغوشده
// دوباره «تایید» می‌شد بدون اینکه میز آزاد بودنش چک شود (خطر رزرو دوبل).
const STATUS_TRANSITIONS: Record<'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED', readonly ReservationStatus[]> = {
	// فقط بعد از بررسی دستی پرداخت (پول گرفته شده ولی ثبت خودکار شکست خورده)
	CONFIRMED: ['PAYMENT_REVIEW'],
	COMPLETED: ['CONFIRMED'],
	NO_SHOW: ['CONFIRMED'],
	CANCELLED: ['HOLD', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'CONFIRMED'],
};
type SettableStatus = keyof typeof STATUS_TRANSITIONS;
const SECONDARY_SETTABLE: readonly SettableStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED'];

function isSettableStatus(value: unknown): value is SettableStatus {
	return typeof value === 'string' && Object.hasOwn(STATUS_TRANSITIONS, value);
}

adminRouter.patch('/reservations/:id/status', async (req, res, next) => {
	try {
		const nextStatus: unknown = req.body?.status;
		if (!isSettableStatus(nextStatus)) {
			return res.status(400).json({ message: 'این وضعیت از پنل ادمین قابل تنظیم نیست.' });
		}
		if (currentAdmin(req).role === 'SECONDARY' && !SECONDARY_SETTABLE.includes(nextStatus)) {
			return res.status(403).json({
				message: 'ادمین فرعی فقط می‌تواند وضعیت را روی تکمیل‌شده، عدم حضور یا لغو بگذارد.',
			});
		}
		const existing = await prisma.reservation.findUnique({
			where: { id: req.params.id },
			include: { payments: true },
		});
		if (!existing) return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		if (!STATUS_TRANSITIONS[nextStatus].includes(existing.status)) {
			return res.status(409).json({ message: 'این تغییر وضعیت برای رزرو در وضعیت فعلی‌اش مجاز نیست.' });
		}
		if ((nextStatus === 'COMPLETED' || nextStatus === 'NO_SHOW') && existing.startAt > new Date()) {
			return res.status(409).json({ message: 'تکمیل یا عدم حضور فقط بعد از رسیدن زمان رزرو قابل ثبت است.' });
		}

		const notes = typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, 500) : undefined;
		// پول واقعی گرفته شده (یا احتمالاً گرفته شده و در حال بررسی است)؟ لغو باید بدهی بازگشت وجه ثبت کند
		const moneyTaken = existing.payments.some((p) => p.status === 'PAID' || p.status === 'REVIEW');
		const owesRefund = nextStatus === 'CANCELLED' && moneyTaken;

		const result = await prisma.$transaction(
			async (tx) => {
				// تایید دستی پرداخت از موتور دسترس‌پذیری رد نمی‌شود؛ اگر در این فاصله میز به کس دیگری
				// رسیده باشد، تایید یعنی رزرو دوبل. در این حالت باید لغو و پول برگردانده شود.
				if (nextStatus === 'CONFIRMED' && (await findConflictingReservations(existing.id, tx)).length) {
					throw createHttpError(409, 'این میز در همین زمان رزرو فعال دیگری دارد؛ تایید ممکن نیست. رزرو را لغو کن تا بازگشت وجه ثبت شود.');
				}
				// شرط وضعیت داخل همان update است تا دو درخواست هم‌زمان هر دو موفق نشوند
				const changed = await tx.reservation.updateMany({
					where: { id: existing.id, status: existing.status },
					data: {
						status: nextStatus,
						...(notes ? { notes } : {}),
						...(owesRefund ? { refundStatus: 'PENDING' } : {}),
						...(nextStatus === 'CONFIRMED' ? { paidAmount: existing.totalAmount, holdExpiresAt: null } : {}),
					},
				});
				if (changed.count === 0) return null;
				if (owesRefund) {
					await tx.payment.updateMany({
						where: { reservationId: existing.id, status: { in: ['PAID', 'REVIEW'] } },
						data: { status: 'REFUND_PENDING' },
					});
				}
				if (nextStatus === 'CONFIRMED') {
					await tx.payment.updateMany({
						where: { reservationId: existing.id, status: 'REVIEW' },
						data: { status: 'PAID', verifiedAt: new Date() },
					});
				}
				return tx.reservation.findUnique({ where: { id: existing.id } });
			},
			{ isolationLevel: 'Serializable' },
		);
		if (!result) return res.status(409).json({ message: 'وضعیت این رزرو همین الان تغییر کرد؛ لیست را تازه کن.' });

		if (nextStatus === 'CANCELLED') {
			await sendMockSms({
				phone: result.customerPhone,
				type: 'CANCELLATION',
				message: owesRefund
					? `رزرو ${result.trackingCode} لغو شد. برای بازگشت وجه با مجموعه تماس بگیرید.`
					: `رزرو ${result.trackingCode} لغو شد.`,
			}).catch((e) => console.error('SMS لغو ارسال نشد:', e));
		}
		if (nextStatus === 'CONFIRMED') {
			await sendMockSms({
				phone: result.customerPhone,
				type: 'CONFIRMATION',
				message: confirmationMessage(result),
			}).catch((e) => console.error('SMS تایید ارسال نشد:', e));
		}
		res.json({ reservation: result });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		if (prismaCode(error) === 'P2034') return res.status(409).json({ message: 'هم‌زمان تغییر دیگری روی این رزرو انجام شد؛ دوباره تلاش کن.' });
		next(error);
	}
});

adminRouter.get('/tables', async (_req, res, next) => {
	try {
		const [tables, connections] = await Promise.all([
			prisma.cafeTable.findMany({ orderBy: { code: 'asc' } }),
			prisma.tableConnection.findMany(),
		]);
		res.json({ tables, connections });
	} catch (error) {
		next(error);
	}
});

const ZONE_PREFIX: Record<ZoneKey, string> = { WINDOW: 'W', CENTER: 'M', ROOF: 'R' };
const ZONES = Object.keys(ZONE_PREFIX) as ZoneKey[];
const SHAPES: readonly TableShape[] = ['ROUND', 'SQUARE', 'RECTANGLE'];

function isZone(value: unknown): value is ZoneKey {
	return typeof value === 'string' && (ZONES as readonly string[]).includes(value);
}

function isShape(value: unknown): value is TableShape {
	return typeof value === 'string' && (SHAPES as readonly string[]).includes(value);
}

async function uniqueTableCode(zone: ZoneKey): Promise<string> {
	const prefix = ZONE_PREFIX[zone] || 'T';
	for (let i = 0; i < 10; i++) {
		const c = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
		if (!(await prisma.cafeTable.findUnique({ where: { code: c } }))) return c;
	}
	throw new Error('ساخت کد میز ناموفق بود.');
}

// فیلدهایی که واقعاً در مدل CafeTable وجود دارند. (قبلاً «image» هم اینجا بود
// که در اسکیما ستونی نداشت و ارسالش خطای ۵۰۰ می‌داد.)
const NUMERIC_TABLE_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'capacity', 'minGuests', 'maxGuests'] as const;
const COUNT_TABLE_FIELDS = ['capacity', 'minGuests', 'maxGuests'] as const;
type NumericTableField = (typeof NUMERIC_TABLE_FIELDS)[number];

interface TableFields extends Partial<Record<NumericTableField, number>> {
	code?: string;
	displayNumber?: string;
	zone?: ZoneKey;
	shape?: TableShape;
	description?: string | null;
	isActive?: boolean;
	chairs?: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
}

type TableInputResult = { ok: true; data: TableFields } | { ok: false; error: string };

/** ورودی میز را از body برمی‌دارد، عددها را عدد می‌کند و اعتبارسنجی می‌کند. */
function readTableInput(
	body: Record<string, unknown>,
	existing: Pick<CafeTable, 'minGuests' | 'maxGuests' | 'capacity'> | null = null,
): TableInputResult {
	const data: TableFields = {};
	for (const key of NUMERIC_TABLE_FIELDS) {
		if (body[key] === undefined) continue;
		const n = Number(body[key]);
		if (!Number.isFinite(n)) return { ok: false, error: `مقدار «${key}» باید عدد باشد.` };
		data[key] = n;
	}
	for (const key of COUNT_TABLE_FIELDS) {
		const value = data[key];
		if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 50)) {
			return { ok: false, error: `مقدار «${key}» باید عددی صحیح بین ۱ و ۵۰ باشد.` };
		}
	}
	for (const key of ['width', 'height'] as const) {
		const value = data[key];
		if (value !== undefined && (value < 10 || value > 600)) return { ok: false, error: `مقدار «${key}» خارج از محدوده است.` };
	}
	if (body.zone !== undefined) {
		if (!isZone(body.zone)) return { ok: false, error: 'سالن نامعتبر است.' };
		data.zone = body.zone;
	}
	if (body.shape !== undefined) {
		if (!isShape(body.shape)) return { ok: false, error: 'شکل میز نامعتبر است.' };
		data.shape = body.shape;
	}
	if (body.isActive !== undefined) {
		if (typeof body.isActive !== 'boolean') return { ok: false, error: 'وضعیت فعال بودن نامعتبر است.' };
		data.isActive = body.isActive;
	}
	if (body.chairs !== undefined) {
		if (body.chairs !== null && !Array.isArray(body.chairs)) return { ok: false, error: 'چیدمان صندلی نامعتبر است.' };
		// ستون Json? با null خام خطای Prisma می‌دهد؛ «بدون چیدمان» باید JsonNull باشد
		data.chairs = body.chairs === null ? Prisma.JsonNull : (body.chairs as Prisma.InputJsonValue);
	}
	if (body.displayNumber !== undefined) {
		const displayNumber = String(body.displayNumber).trim().slice(0, 12);
		if (!displayNumber) return { ok: false, error: 'شماره نمایشی میز لازم است.' };
		data.displayNumber = displayNumber;
	}
	if (body.code !== undefined) {
		const code = String(body.code).trim().toUpperCase().slice(0, 12);
		if (code) data.code = code;
	}
	if (body.description !== undefined) data.description = body.description === null ? null : String(body.description).slice(0, 300);

	const min = data.minGuests ?? existing?.minGuests;
	const max = data.maxGuests ?? existing?.maxGuests;
	const capacity = data.capacity ?? existing?.capacity;
	if (min !== undefined && max !== undefined && min > max) return { ok: false, error: 'حداقل نفر نمی‌تواند از حداکثر بیشتر باشد.' };
	if (max !== undefined && capacity !== undefined && max > capacity) {
		return { ok: false, error: 'حداکثر نفر نمی‌تواند از ظرفیت میز بیشتر باشد.' };
	}
	return { ok: true, data };
}

// ساخت میز جدید فقط با توسعه‌دهنده است؛ نقشه را مدیر کافه تغییر نمی‌دهد
adminRouter.post('/tables', requireRole(...ROLE_GROUPS.mapEditor), async (req, res, next) => {
	try {
		const input = readTableInput(req.body || {});
		if (!input.ok) return res.status(400).json({ message: input.error });
		const { zone, shape, x, y, capacity, maxGuests, ...rest } = input.data;
		if (zone === undefined) return res.status(400).json({ message: 'فیلد «zone» برای ساخت میز لازم است.' });
		if (shape === undefined) return res.status(400).json({ message: 'فیلد «shape» برای ساخت میز لازم است.' });
		if (x === undefined) return res.status(400).json({ message: 'فیلد «x» برای ساخت میز لازم است.' });
		if (y === undefined) return res.status(400).json({ message: 'فیلد «y» برای ساخت میز لازم است.' });
		if (capacity === undefined) return res.status(400).json({ message: 'فیلد «capacity» برای ساخت میز لازم است.' });
		if (maxGuests === undefined) return res.status(400).json({ message: 'فیلد «maxGuests» برای ساخت میز لازم است.' });
		const code = rest.code || (await uniqueTableCode(zone));
		const displayNumber = rest.displayNumber || code.replace(/^\D+/, '') || code;
		const table = await prisma.cafeTable.create({ data: { ...rest, zone, shape, x, y, capacity, maxGuests, code, displayNumber } });
		res.status(201).json({ table });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'میزی با این کد از قبل وجود دارد.' });
		next(error);
	}
});

adminRouter.patch('/tables/:id', requireRole(...ROLE_GROUPS.tableToggle), async (req, res, next) => {
	try {
		const existing = await prisma.cafeTable.findUnique({ where: { id: req.params.id } });
		if (!existing) return res.status(404).json({ message: 'میز پیدا نشد.' });

		// مدیر کافه فقط می‌تواند میز را فعال/غیرفعال کند؛ هندسه و ظرفیت دست توسعه‌دهنده است
		if (!(ROLE_GROUPS.mapEditor as readonly AdminRole[]).includes(currentAdmin(req).role)) {
			const keys = Object.keys(req.body || {}).filter((key) => req.body[key] !== undefined);
			if (keys.some((key) => key !== 'isActive')) {
				return res.status(403).json({ message: 'تغییر نقشه و مشخصات میز فقط با حساب توسعه‌دهنده ممکن است.' });
			}
		}

		const input = readTableInput(req.body || {}, existing);
		if (!input.ok) return res.status(400).json({ message: input.error });
		const table = await prisma.cafeTable.update({ where: { id: req.params.id }, data: input.data });
		res.json({ table });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'میزی با این کد از قبل وجود دارد.' });
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'میز پیدا نشد.' });
		next(error);
	}
});

adminRouter.delete('/tables/:id', requireRole(...ROLE_GROUPS.mapEditor), async (req, res, next) => {
	try {
		await prisma.cafeTable.delete({ where: { id: req.params.id } });
		res.json({ message: 'میز حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2003') {
			return res
				.status(409)
				.json({ message: 'این میز تو رزروهای قبلی یا فعلی استفاده شده و نمی‌شه حذفش کرد؛ به‌جاش می‌تونی غیرفعالش کنی.' });
		}
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'میز پیدا نشد.' });
		next(error);
	}
});

adminRouter.post('/table-connections', requireRole(...ROLE_GROUPS.mapEditor), async (req, res, next) => {
	try {
		const { tableAId, tableBId } = req.body || {};
		if (typeof tableAId !== 'string' || typeof tableBId !== 'string' || !tableAId || !tableBId) {
			return res.status(400).json({ message: 'شناسه‌ی هر دو میز لازم است.' });
		}
		if (tableAId === tableBId) {
			return res.status(400).json({ message: 'یک میز را نمی‌توان به خودش وصل کرد.' });
		}
		const [a, b] = [tableAId, tableBId].sort();
		const connection = await prisma.tableConnection.upsert({
			where: { tableAId_tableBId: { tableAId: a, tableBId: b } },
			update: {},
			create: { tableAId: a, tableBId: b },
		});
		res.status(201).json({ connection });
	} catch (error) {
		if (prismaCode(error) === 'P2003') return res.status(404).json({ message: 'یکی از میزها پیدا نشد.' });
		next(error);
	}
});

adminRouter.delete('/table-connections/:id', requireRole(...ROLE_GROUPS.mapEditor), async (req, res, next) => {
	try {
		await prisma.tableConnection.delete({ where: { id: req.params.id } });
		res.json({ message: 'اتصال حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'موردی برای حذف پیدا نشد.' });
		next(error);
	}
});

adminRouter.get('/settings', async (_req, res, next) => {
	try {
		res.json({ settings: await getSettings() });
	} catch (error) {
		next(error);
	}
});

// هر تنظیم علاوه بر کف، سقف منطقی هم دارد تا یک اشتباه تایپی
// (مثلاً یک صفر اضافه) میزها را برای روزها قفل نکند
const NUMBER_SETTING_BOUNDS: Record<string, { min: number; max: number }> = {
	// قبلاً این دو بدون هیچ محدودیتی ذخیره می‌شدند؛ زمان آماده‌سازی منفی باعث می‌شد
	// رزروها روی هم بیفتند (یک میز در یک زمان دو بار رزرو شود)
	minLeadMinutes: { min: 0, max: 10080 },
	cleaningBufferMinutes: { min: 0, max: 240 },
	slotIntervalMinutes: { min: 5, max: 120 },
	minDurationMinutes: { min: 15, max: 720 },
	maxDurationMinutes: { min: 15, max: 720 },
	reservationWindowDays: { min: 1, max: 365 },
	holdMinutes: { min: 1, max: 120 },
	pricePerGuest: { min: 1, max: 100000000 },
	// صفر مجازه و یعنی قابلیت تزئین کلاً خاموش
	decorationPrice: { min: 0, max: 100000000 },
	// حداکثر میزهای ترکیبی که پیشنهاد داده می‌شود
	maxComboTables: { min: 2, max: 8 },
	// صفر یعنی یادآوری خاموش؛ سقف یک هفته
	reminderBeforeMinutes: { min: 0, max: 10080 },
};

const TEXT_SETTINGS: readonly string[] = ['currencyLabel', 'cafeName'];

adminRouter.patch('/settings', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const updates: [string, unknown][] = Object.entries(req.body || {});
		// فقط تنظیمات شناخته‌شده؛ قبلاً هر کلید دلخواهی در جدول تنظیمات ذخیره می‌شد
		const unknown = updates.find(([key]) => !Object.hasOwn(NUMBER_SETTING_BOUNDS, key) && !TEXT_SETTINGS.includes(key));
		if (unknown) return res.status(400).json({ message: `تنظیم «${unknown[0]}» شناخته‌شده نیست.` });
		for (const [key, value] of updates) {
			if (TEXT_SETTINGS.includes(key)) {
				if (typeof value !== 'string' || !value.trim() || value.length > 60) {
					return res.status(400).json({ message: `مقدار «${key}» نامعتبر است.` });
				}
				continue;
			}
			const bounds = NUMBER_SETTING_BOUNDS[key];
			const n = Number(value);
			if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
				return res.status(400).json({ message: `مقدار «${key}» باید عددی بین ${bounds.min} و ${bounds.max} باشد.` });
			}
		}
		// حداقل مدت رزرو نباید از حداکثر بیشتر باشد (وگرنه هیچ رزروی ممکن نیست)
		const current = await getSettings({ fresh: true });
		const merged = { ...current, ...Object.fromEntries(updates) };
		if (Number(merged.minDurationMinutes ?? 60) > Number(merged.maxDurationMinutes ?? 240)) {
			return res.status(400).json({ message: 'حداقل مدت رزرو نمی‌تواند از حداکثر بیشتر باشد.' });
		}
		for (const [key, value] of updates) await setSetting(key, TEXT_SETTINGS.includes(key) ? String(value).trim() : Number(value));
		res.json({ settings: await getSettings() });
	} catch (error) {
		next(error);
	}
});

adminRouter.get('/working-hours', requireRole(...ROLE_GROUPS.manager), async (_req, res, next) => {
	try {
		const workingHours = await prisma.workingHour.findMany({ orderBy: { dayOfWeek: 'asc' } });
		res.json({ workingHours });
	} catch (error) {
		next(error);
	}
});

adminRouter.patch('/working-hours/:dayOfWeek', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const dayOfWeek = Number(req.params.dayOfWeek);
		if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
			return res.status(400).json({ message: 'روز هفته باید عددی بین ۰ تا ۶ باشد.' });
		}
		const { opensAt, closesAt } = req.body;
		// بسته شدن تا نیمه‌شب «24:00» است؛ کار بعد از نیمه‌شب (مثلاً تا 02:00) پشتیبانی نمی‌شود
		if (!CLOCK_TIME.test(String(opensAt)) || !CLOSING_TIME.test(String(closesAt))) {
			return res.status(400).json({ message: 'ساعت باید به شکل HH:MM باشد (مثلاً 09:00)؛ برای نیمه‌شب 24:00 بنویس.' });
		}
		if (opensAt >= closesAt) {
			return res.status(400).json({ message: 'ساعت بسته شدن باید بعد از ساعت باز شدن باشد.' });
		}
		// isClosed === true تا رشته‌ی "false" اشتباهاً true تفسیر نشود
		const isClosed = req.body.isClosed === true || req.body.isClosed === 'true';
		const workingHour = await prisma.workingHour.upsert({
			where: { dayOfWeek },
			update: { opensAt, closesAt, isClosed },
			create: { dayOfWeek, opensAt, closesAt, isClosed },
		});
		res.json({ workingHour });
	} catch (error) {
		next(error);
	}
});

adminRouter.get('/closures', requireRole(...ROLE_GROUPS.manager), async (_req, res, next) => {
	try {
		const closures = await prisma.closure.findMany({ orderBy: { date: 'desc' }, include: { table: true } });
		res.json({ closures });
	} catch (error) {
		next(error);
	}
});

adminRouter.post('/closures', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const title = String(req.body.title || '').trim();
		if (!title) return res.status(400).json({ message: 'عنوان تعطیلی لازم است.' });
		if (!isValidDateString(req.body.date)) return res.status(400).json({ message: 'تاریخ تعطیلی نامعتبر است.' });
		const date = combineDateAndTime(req.body.date, '00:00');
		if (
			(req.body.startTime && !CLOCK_TIME.test(String(req.body.startTime))) ||
			(req.body.endTime && !CLOSING_TIME.test(String(req.body.endTime)))
		) {
			return res.status(400).json({ message: 'ساعت باید به شکل HH:MM باشد (پایان روز: 24:00).' });
		}
		if (Boolean(req.body.startTime) !== Boolean(req.body.endTime)) {
			return res.status(400).json({ message: 'برای بستن بخشی از روز، هر دو ساعت شروع و پایان لازم است.' });
		}
		if (req.body.startTime && req.body.endTime && req.body.startTime >= req.body.endTime) {
			return res.status(400).json({ message: 'ساعت پایان باید بعد از ساعت شروع باشد.' });
		}
		// قبلاً سالن یا میز نامعتبر مستقیم به دیتابیس می‌رفت و خطای ۵۰۰ می‌داد
		if (req.body.zone && !ZONES.includes(req.body.zone)) return res.status(400).json({ message: 'سالن نامعتبر است.' });
		if (req.body.tableId && !(await prisma.cafeTable.findUnique({ where: { id: String(req.body.tableId) } }))) {
			return res.status(400).json({ message: 'میز انتخاب‌شده پیدا نشد.' });
		}
		const closure = await prisma.closure.create({
			data: {
				title: title.slice(0, 120),
				date,
				startTime: req.body.startTime || null,
				endTime: req.body.endTime || null,
				zone: req.body.zone || null,
				tableId: req.body.tableId || null,
				reason: req.body.reason ? String(req.body.reason).slice(0, 300) : null,
			},
		});
		res.status(201).json({ closure });
	} catch (error) {
		next(error);
	}
});

adminRouter.delete('/closures/:id', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		await prisma.closure.delete({ where: { id: req.params.id } });
		res.json({ message: 'تعطیلی حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'موردی برای حذف پیدا نشد.' });
		next(error);
	}
});

adminRouter.get('/reports/revenue', requireRole(...ROLE_GROUPS.manager), async (_req, res, next) => {
	try {
		const now = new Date();
		const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

		// درآمد = هر پرداخت موفق، منهای رزروهای لغوشده
		// باید دقیقاً با کوئری داشبورد یکی باشه، وگرنه ادمین دو عدد متفاوت می‌بینه
		const paidWhere = { status: 'PAID', reservation: { status: { not: 'CANCELLED' } } } satisfies Prisma.PaymentWhereInput;

		const [paid, counts, guestAgg, recentPayments, topTables] = await Promise.all([
			prisma.payment.aggregate({ where: paidWhere, _sum: { amount: true }, _count: true }),
			prisma.reservation.groupBy({ by: ['status'], _count: { _all: true } }),
			prisma.reservation.aggregate({
				where: { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
				_avg: { guestCount: true },
			}),
			prisma.payment.findMany({
				where: {
					...paidWhere,
					reservation: { status: { not: 'CANCELLED' }, startAt: { gte: sevenDaysAgo } },
				},
				select: { amount: true, reservation: { select: { startAt: true } } },
			}),
			prisma.reservationTable.groupBy({
				by: ['tableId'],
				_count: { _all: true },
				orderBy: { _count: { tableId: 'desc' } },
				take: 5,
			}),
		]);

		const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

		// درآمد هفت روز اخیر، گروه‌بندی بر اساس تاریخ محلی رزرو
		const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		const daily = new Map<string, number>();
		for (let i = 6; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
			daily.set(dayKey(d), 0);
		}
		for (const p of recentPayments) {
			const key = dayKey(new Date(p.reservation.startAt));
			const sum = daily.get(key);
			if (sum !== undefined) daily.set(key, sum + p.amount);
		}

		const tableInfo = await prisma.cafeTable.findMany({
			where: { id: { in: topTables.map((t) => t.tableId) } },
			select: { id: true, displayNumber: true, zone: true },
		});
		const tableById = Object.fromEntries(tableInfo.map((t) => [t.id, t]));

		const totalPaid = paid._sum?.amount || 0;
		res.json({
			totalPaid,
			paidCount: paid._count,
			avgPerReservation: paid._count ? Math.round(totalPaid / paid._count) : 0,
			avgGuests: Math.round((guestAgg._avg.guestCount || 0) * 10) / 10,
			completed: byStatus.COMPLETED || 0,
			cancelled: byStatus.CANCELLED || 0,
			noShow: byStatus.NO_SHOW || 0,
			upcoming: byStatus.CONFIRMED || 0,
			daily: [...daily].map(([date, amount]) => ({ date, amount })),
			topTables: topTables.map((t) => ({
				displayNumber: tableById[t.tableId]?.displayNumber || '؟',
				zone: tableById[t.tableId]?.zone || '',
				count: t._count._all,
			})),
		});
	} catch (error) {
		next(error);
	}
});

adminRouter.get('/users', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
		const skip = Math.max(Number(req.query.offset) || 0, 0);
		const users = await prisma.user.findMany({
			orderBy: { createdAt: 'desc' },
			take,
			skip,
			include: { _count: { select: { reservations: true } } },
		});
		res.json({ users });
	} catch (error) {
		next(error);
	}
});

const ADMIN_PUBLIC_FIELDS = { id: true, username: true, name: true, role: true, isActive: true, createdAt: true } satisfies Prisma.AdminUserSelect;

adminRouter.get('/admins', requireRole(...ROLE_GROUPS.manager), async (_req, res, next) => {
	try {
		const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' }, select: ADMIN_PUBLIC_FIELDS });
		res.json({ admins });
	} catch (error) {
		next(error);
	}
});

adminRouter.post('/admins', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const username = normalizeUsername(req.body?.username);
		const name = String(req.body?.name || '')
			.trim()
			.slice(0, 80);
		const role: unknown = req.body?.role;
		const password = typeof req.body?.password === 'string' ? req.body.password : '';
		if (!USERNAME_PATTERN.test(username)) {
			return res
				.status(400)
				.json({ message: 'نام کاربری باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.' });
		}
		if (!name) return res.status(400).json({ message: 'نام لازم است.' });
		if (!isAdminRole(role)) return res.status(400).json({ message: 'نقش نامعتبر است.' });
		if (!canManageRole(currentAdmin(req), role)) return res.status(403).json({ message: 'ساخت حساب با این نقش برای شما مجاز نیست.' });
		if (password.length < 8 || password.length > 128) return res.status(400).json({ message: 'رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد.' });
		const passwordHash = await bcrypt.hash(password, 10);
		const admin = await prisma.adminUser.create({ data: { username, name, role, passwordHash }, select: ADMIN_PUBLIC_FIELDS });
		res.status(201).json({ admin });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'ادمینی با این نام کاربری از قبل وجود دارد.' });
		next(error);
	}
});

// همیشه باید دست‌کم یک توسعه‌دهنده‌ی فعال بماند، وگرنه دیگر کسی نمی‌تواند نقشه را ویرایش کند
async function activeDeveloperCount() {
	return prisma.adminUser.count({ where: { role: 'DEVELOPER', isActive: true } });
}

adminRouter.patch('/admins/:id', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
		if (!target) return res.status(404).json({ message: 'ادمین پیدا نشد.' });
		const actor = currentAdmin(req);
		if (!canManageRole(actor, target.role)) return res.status(403).json({ message: 'ویرایش این حساب برای شما مجاز نیست.' });
		const isSelf = target.id === actor.id;
		const body = req.body || {};
		const losesDeveloper = (nextRole: AdminRole, nextActive: boolean) =>
			target.role === 'DEVELOPER' && target.isActive && (nextRole !== 'DEVELOPER' || nextActive === false);

		const data: Prisma.AdminUserUpdateInput = {};
		if (body.name !== undefined) {
			const name = String(body.name).trim().slice(0, 80);
			if (!name) return res.status(400).json({ message: 'نام نمی‌تواند خالی باشد.' });
			data.name = name;
		}
		if (body.username !== undefined) {
			const username = normalizeUsername(body.username);
			if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ message: 'نام کاربری نامعتبر است.' });
			data.username = username;
		}
		if (body.isActive !== undefined) {
			if (typeof body.isActive !== 'boolean') return res.status(400).json({ message: 'وضعیت نامعتبر است.' });
			if (isSelf && !body.isActive) return res.status(400).json({ message: 'نمی‌توانی حساب خودت را غیرفعال کنی.' });
			if (losesDeveloper(target.role, body.isActive) && (await activeDeveloperCount()) <= 1) {
				return res.status(400).json({ message: 'حداقل یک توسعه‌دهنده‌ی فعال باید باقی بماند.' });
			}
			data.isActive = body.isActive;
			// غیرفعال شدن یعنی نشست‌های باز هم باید فوراً بسته شوند
			if (!body.isActive) data.tokenVersion = { increment: 1 };
		}
		if (body.role !== undefined) {
			if (!isAdminRole(body.role)) return res.status(400).json({ message: 'نقش نامعتبر است.' });
			if (isSelf) return res.status(400).json({ message: 'نمی‌توانی نقش خودت را عوض کنی.' });
			if (!canManageRole(actor, body.role)) return res.status(403).json({ message: 'دادن این نقش برای شما مجاز نیست.' });
			if (losesDeveloper(body.role, target.isActive) && (await activeDeveloperCount()) <= 1) {
				return res.status(400).json({ message: 'حداقل یک توسعه‌دهنده‌ی فعال باید باقی بماند.' });
			}
			data.role = body.role;
			// تغییر نقش هم باید نشست‌های قبلی را باطل کند تا دسترسی قدیمی در توکن نماند
			data.tokenVersion = { increment: 1 };
		}
		if (body.password !== undefined) {
			const password = String(body.password);
			if (password.length < 8 || password.length > 128)
				return res.status(400).json({ message: 'رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد.' });
			data.passwordHash = await bcrypt.hash(password, 10);
			// نشست‌های باز با رمز قدیمی باید فوراً قطع شن
			data.tokenVersion = { increment: 1 };
		}

		const admin = await prisma.adminUser.update({ where: { id: req.params.id }, data, select: ADMIN_PUBLIC_FIELDS });
		// اگر ادمین رمز خودش را عوض کرد، کوکی تازه بگیرد تا از پنل بیرون نیفتد
		if (isSelf && data.tokenVersion) {
			const fresh = await prisma.adminUser.findUnique({ where: { id: admin.id } });
			if (fresh) setCookie(res, 'adminToken', signAdminToken(fresh));
		}
		res.json({ admin });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'ادمینی با این نام کاربری از قبل وجود دارد.' });
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'ادمین پیدا نشد.' });
		next(error);
	}
});

adminRouter.delete('/admins/:id', requireRole(...ROLE_GROUPS.manager), async (req, res, next) => {
	try {
		const actor = currentAdmin(req);
		if (req.params.id === actor.id) return res.status(400).json({ message: 'نمی‌توانی حساب خودت را حذف کنی.' });
		const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
		if (!target) return res.status(404).json({ message: 'ادمین پیدا نشد.' });
		if (!canManageRole(actor, target.role)) return res.status(403).json({ message: 'حذف این حساب برای شما مجاز نیست.' });
		if (target.role === 'DEVELOPER' && target.isActive && (await activeDeveloperCount()) <= 1) {
			return res.status(400).json({ message: 'حداقل یک توسعه‌دهنده‌ی فعال باید باقی بماند.' });
		}
		await prisma.adminUser.delete({ where: { id: req.params.id } });
		res.json({ message: 'ادمین حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'ادمین پیدا نشد.' });
		next(error);
	}
});
