import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { ON_PLAN, applyLayout, parseLayout } from '../src/services/floor-plan.service.js';
import { seedMenuAndQuestions } from './seed-menu.js';
import { seedGames } from './seed-games.js';

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
	// «انتخاب برای من» خاموش شروع می‌شود؛ بعد از برچسب‌زدن منو از تنظیمات پنل روشنش کن
	['recommenderEnabled', '0'],
	// بخش بازی‌ها هم خاموش شروع می‌شود؛ از بخش «بازی‌ها»ی پنل روشنش کن
	['gamesEnabled', '0'],
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

	// میزها از prisma/seed-data/floor-map.json (همان نقشه‌ی client/public/maps/roof-base.svg)؛ فقط وقتی هیچ میزی
	// روی نقشه نیست. قبلاً میزهای جاافتاده با کدشان ساخته می‌شدند: با نقشه‌ی تازه، میزهای قدیم و جدید قاطی می‌شدند.
	// برای بردن یک دیتابیس پر به نقشه‌ی تازه: npm run map:apply
	const layout = parseLayout(JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'prisma', 'seed-data', 'floor-map.json'), 'utf8')));
	if ((await prisma.cafeTable.count({ where: ON_PLAN })) === 0) {
		const made = await applyLayout(layout, { client: prisma });
		console.log(`Floor plan: ${made.created} tables, ${made.connections} connections.`);
	} else {
		console.log('Floor plan: tables already exist, left as they are (npm run map:apply puts them on prisma/seed-data/floor-map.json).');
	}

	// منو (با عکس‌ها) و سوال‌های «انتخاب برای من» از prisma/seed-data؛ فقط روی دیتابیس خالی
	await seedMenuAndQuestions(prisma);
	// دسته‌کارت‌های بازی‌های کلمه‌ای (جاسوس، گوشی رو پیشونی، پانتومیم، کلمات ممنوعه)؛ فقط اگر هیچ دسته‌ای نباشد
	await seedGames(prisma);

	console.log('Seed completed.');
	console.log(`Developer admin: ${username}`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => prisma.$disconnect());
