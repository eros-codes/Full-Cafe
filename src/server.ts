import './timezone.js';
import http from 'http';
import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { expireOldHolds } from './services/availability.service.js';
import { sendDueReminders } from './services/reservation.service.js';
import { cleanupStaleTempUploads } from './lib/uploads.js';
import { startViteDevServer, stopViteDevServer } from './web/frontend.js';

const holdCleanup = setInterval(() => {
	expireOldHolds().catch((error) => console.error('پاک‌سازی نگه‌داری‌های منقضی ناموفق بود:', error));
}, 60 * 1000);
holdCleanup.unref();

const reminderJob = setInterval(
	() => {
		sendDueReminders().catch((error) => console.error('ارسال یادآوری‌ها ناموفق بود:', error));
	},
	5 * 60 * 1000,
);
reminderJob.unref();

const uploadCleanup = setInterval(cleanupStaleTempUploads, 6 * 60 * 60 * 1000);
uploadCleanup.unref();

const server = http.createServer(app);
// `npm run dev` این فایل را مستقیم از سورس TypeScript اجرا می‌کند (tsx)؛ آن وقت صفحه‌های React هم
// از سورس (client/) و با بارگذاری خودکار سرو می‌شوند. نسخه‌ی build‌شده (dist/) همیشه فایل‌های build را سرو می‌کند.
const runningFromSource = import.meta.url.endsWith('.ts');
const liveReload = runningFromSource && !config.isProd;
if (liveReload) await startViteDevServer(server);

server.listen(config.port, () => {
	console.log(`Roof running on ${config.appUrl}${liveReload ? ' (development, live reload)' : ''}`);
	console.log(`  site:    ${config.appUrl}/`);
	console.log(`  reserve: ${config.appUrl}/reserve`);
	console.log(`  admin:   ${config.appUrl}/admin`);
	console.log(`NODE_ENV=${config.nodeEnv} → کوکی‌ها secure=${config.isProd} (روی http فقط با secure=false کار می‌کنن)`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	clearInterval(holdCleanup);
	clearInterval(reminderJob);
	clearInterval(uploadCleanup);
	console.log(`${signal} دریافت شد؛ در حال بستن امنِ سرور...`);
	await stopViteDevServer().catch(() => {});
	server.close(async () => {
		await prisma.$disconnect().catch((error) => console.error('قطع اتصال دیتابیس ناموفق بود:', error));
		process.exit(0);
	});
	// اگه تا ۱۰ ثانیه درخواست‌ها تموم نشدن، به‌زور ببند
	setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
