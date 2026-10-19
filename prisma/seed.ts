import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedMenuAndQuestions } from './seed-menu.js';

const prisma = new PrismaClient();

const settings = [
	['reservationWindowDays', '14'],
	['minLeadMinutes', '120'],
	['minDurationMinutes', '60'],
	['maxDurationMinutes', '240'],
	['slotIntervalMinutes', '15'],
	['cleaningBufferMinutes', '15'],
	['holdMinutes', '10'],
	['pricePerGuest', '100000'],
	['decorationPrice', '100000'],
	['maxComboTables', '4'],
	['currencyLabel', 'تومان'],
	['reminderBeforeMinutes', '180'],
	['cafeName', 'Roof'],
	// «انتخاب برای من» خاموش شروع می‌شود؛ بعد از برچسب‌زدن منو از تنظیمات پنل روشنش کن
	['recommenderEnabled', '0'],
];

async function main() {
	// update خالی: اگر رکورد از قبل هست، دست نمی‌خورد. seed فقط مقدار اولیه می‌سازد،
	// نه اینکه تنظیمات واقعی را با اجرای دوباره پاک کند.
	for (const [key, value] of settings) {
		await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
	}

	for (let day = 0; day <= 6; day++) {
		await prisma.workingHour.upsert({
			where: { dayOfWeek: day },
			update: {},
			create: { dayOfWeek: day, opensAt: '09:00', closesAt: '21:00', isClosed: false },
		});
	}

	// حساب اول همیشه «توسعه‌دهنده» است: تنها نقشی که نقشه‌ی میزها را ویرایش می‌کند.
	const username = (process.env.SEED_ADMIN_USERNAME || 'developer').trim().toLowerCase();
	const password = process.env.SEED_ADMIN_PASSWORD || '';
	const name = process.env.SEED_ADMIN_NAME || 'Developer';
	if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
		throw new Error('SEED_ADMIN_USERNAME باید ۳ تا ۳۲ کاراکتر و فقط حروف انگلیسی کوچک، عدد، نقطه، خط تیره یا زیرخط باشد.');
	}
	if (password.length < 8) {
		throw new Error('SEED_ADMIN_PASSWORD باید تنظیم شود و حداقل ۸ کاراکتر باشد.');
	}

	const existingAdmin = await prisma.adminUser.findUnique({ where: { username } });
	if (existingAdmin) {
		console.log(`Admin «${username}» از قبل وجود دارد؛ رمز و نقشش دست‌نخورده باقی ماند.`);
	} else {
		const passwordHash = await bcrypt.hash(password, 10);
		await prisma.adminUser.create({
			data: { username, name, passwordHash, role: 'DEVELOPER', isActive: true },
		});
	}

	// --------------------------------------------------------------------
	// میزها: نسخه‌ی اول برگرفته از نقشه‌ی واقعی کافه (Cafe-plan + عکس‌ها).
	// کدها و displayNumber فعلاً رندومن؛ عمداً طبق خواسته‌ی خودت، تا وقتی
	// شماره‌گذاری نهایی رو دستی ندی، عوضشون نمی‌کنیم.
	// ظرفیت هر میز از رو تعداد صندلی دورش رو نقشه دراومده.
	// اتصال میزها (TableConnection) عمداً خالی مونده - طبق گفته‌ی خودت،
	// فعلاً کاری باهاش نداریم. صندلی هر میز (chairs) هم عمداً خالیه -
	// هیچ چیدمان پیش‌فرضی نداره، از تو پنل ادمین (ابزار جدید) دستی چیده می‌شه.
	// --------------------------------------------------------------------
	// عمداً خالی — همه‌ی میزهای قبلی (چه نمونه‌های اولیه، چه صندلی‌هاشون) حذف
	// شدن. از این به بعد میزها فقط از تو پنل ادمین («+ افزودن میز») ساخته می‌شن.
	const tableData: Prisma.CafeTableCreateInput[] = [
		{
			code: 'W108',
			displayNumber: '7',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 225.8,
			y: 425.2,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: 60,
					y: 3,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W187',
			displayNumber: '8',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 262.3,
			y: 332.2,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: 57,
					y: 4,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W262',
			displayNumber: '2',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 157.2,
			y: 605.6,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 3,
					y: -52,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 51,
					type: 'normal',
					angle: 180,
				},
				{
					x: 53,
					y: 4,
					type: 'normal',
					angle: 450,
				},
			],
			description: null,
		},
		{
			code: 'W277',
			displayNumber: '16',
			zone: 'WINDOW',
			shape: 'RECTANGLE',
			capacity: 6,
			minGuests: 6,
			maxGuests: 6,
			isActive: true,
			x: 437.1,
			y: 546.2,
			width: 96,
			height: 60,
			rotation: 0,
			chairs: [
				{
					x: -1,
					y: -51,
					type: 'normal',
					angle: 0,
				},
				{
					x: 3,
					y: 55,
					type: 'normal',
					angle: 180,
				},
				{
					x: 33,
					y: 54,
					type: 'normal',
					angle: 180,
				},
				{
					x: -30,
					y: 55,
					type: 'normal',
					angle: 180,
				},
				{
					x: 32,
					y: -52,
					type: 'normal',
					angle: 0,
				},
				{
					x: -35,
					y: -50,
					type: 'normal',
					angle: 0,
				},
			],
			description: null,
		},
		{
			code: 'W394',
			displayNumber: '5',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 4,
			minGuests: 3,
			maxGuests: 4,
			isActive: true,
			x: 131.8,
			y: 780.9,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 58,
					y: 4,
					type: 'normal',
					angle: 90,
				},
				{
					x: -56,
					y: 6,
					type: 'normal',
					angle: 270,
				},
				{
					x: 1,
					y: 60,
					type: 'shared',
					angle: 270,
				},
			],
			description: null,
		},
		{
			code: 'W417',
			displayNumber: '13',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 518.3,
			y: 150.1,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: -58,
					y: 3,
					type: 'normal',
					angle: 270,
				},
			],
			description: null,
		},
		{
			code: 'W529',
			displayNumber: '9',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 300.3,
			y: 240.6,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: 56,
					y: -1,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W531',
			displayNumber: '11',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 380.9,
			y: 281.3,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: -55,
					y: 5,
					type: 'normal',
					angle: 270,
				},
				{
					x: 54,
					y: 3,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W598',
			displayNumber: '6',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 191.6,
			y: 516.1,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: 59,
					y: 3,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W667',
			displayNumber: '1',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 122.5,
			y: 691.5,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -49,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 52,
					type: 'normal',
					angle: 180,
				},
				{
					x: 51,
					y: 1,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
		{
			code: 'W777',
			displayNumber: '14',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 517,
			y: 255.1,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: -56,
					y: 1,
					type: 'normal',
					angle: 270,
				},
			],
			description: null,
		},
		{
			code: 'W785',
			displayNumber: '17',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 524.6,
			y: 539.1,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: -55,
					y: 3,
					type: 'normal',
					angle: 270,
				},
			],
			description: null,
		},
		{
			code: 'W833',
			displayNumber: '3',
			zone: 'WINDOW',
			shape: 'RECTANGLE',
			capacity: 6,
			minGuests: 5,
			maxGuests: 6,
			isActive: true,
			x: 329.8,
			y: 773.6,
			width: 96,
			height: 60,
			rotation: 90,
			chairs: [
				{
					x: -19,
					y: -53,
					type: 'shared',
					angle: 0,
				},
				{
					x: 26,
					y: 51,
					type: 'normal',
					angle: 180,
				},
				{
					x: -16,
					y: 50,
					type: 'normal',
					angle: 180,
				},
				{
					x: -66,
					y: 1,
					type: 'normal',
					angle: 270,
				},
				{
					x: 26,
					y: -54,
					type: 'shared',
					angle: 288,
				},
				{
					x: 70,
					y: -1,
					type: 'shared',
					angle: 300,
				},
			],
			description: null,
		},
		{
			code: 'W842',
			displayNumber: '12',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 2,
			minGuests: 2,
			maxGuests: 2,
			isActive: true,
			x: 373.6,
			y: 368.2,
			width: 70,
			height: 70,
			rotation: 90,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
			],
			description: null,
		},
		{
			code: 'W920',
			displayNumber: '4',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 4,
			minGuests: 3,
			maxGuests: 4,
			isActive: true,
			x: 229.1,
			y: 777.7,
			width: 70,
			height: 70,
			rotation: 0,
			chairs: [
				{
					x: -1,
					y: -57,
					type: 'normal',
					angle: 0,
				},
				{
					x: 58,
					y: 0,
					type: 'normal',
					angle: 90,
				},
				{
					x: -56,
					y: 5,
					type: 'normal',
					angle: 270,
				},
				{
					x: 0,
					y: 59,
					type: 'shared',
					angle: 270,
				},
			],
			description: null,
		},
		{
			code: 'W966',
			displayNumber: '10',
			zone: 'WINDOW',
			shape: 'SQUARE',
			capacity: 3,
			minGuests: 2,
			maxGuests: 3,
			isActive: true,
			x: 332.5,
			y: 147.7,
			width: 70,
			height: 70,
			rotation: 20,
			chairs: [
				{
					x: 0,
					y: -60,
					type: 'normal',
					angle: 0,
				},
				{
					x: 0,
					y: 60,
					type: 'normal',
					angle: 180,
				},
				{
					x: 57,
					y: 3,
					type: 'normal',
					angle: 90,
				},
			],
			description: null,
		},
	];
	// فقط میزهایی که هنوز وجود ندارند ساخته می‌شوند. قبلاً اجرای دوباره‌ی seed همه‌ی تغییراتی را
	// که در پنل روی نقشه داده شده بود (جای میز، ظرفیت، صندلی‌ها) به مقدار اولیه برمی‌گرداند.
	for (const table of tableData) {
		await prisma.cafeTable.upsert({
			where: { code: table.code },
			update: {},
			create: table,
		});
	}

	// اتصال میزها فعلاً خالی — بعداً که خودت تصمیم گرفتی کدوم میزها قابل
	// اتصالن، این آرایه رو پر می‌کنیم: [['کدمیزالف','کدمیزب'], ...]
	const wantedConnections = [
		['W667', 'W262'],
		['W262', 'W598'],
		['W598', 'W108'],
		['W108', 'W187'],
		['W966', 'W417'],
	];

	for (const [codeA, codeB] of wantedConnections) {
		const a = await prisma.cafeTable.findUnique({ where: { code: codeA } });
		const b = await prisma.cafeTable.findUnique({ where: { code: codeB } });
		if (a && b) {
			const tableAId = a.id < b.id ? a.id : b.id;
			const tableBId = a.id < b.id ? b.id : a.id;
			await prisma.tableConnection.upsert({
				where: { tableAId_tableBId: { tableAId, tableBId } },
				update: {},
				create: { tableAId, tableBId },
			});
		}
	}

	// منو (با عکس‌ها) و سوال‌های «انتخاب برای من» از prisma/seed-data؛ فقط روی دیتابیس خالی
	await seedMenuAndQuestions(prisma);

	console.log('Seed completed.');
	console.log(`Developer admin: ${username}`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => prisma.$disconnect());
