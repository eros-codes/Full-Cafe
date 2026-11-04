import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config.js';
import { authRouter } from './routes/auth.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { reservationRouter } from './routes/reservation.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { menuRouter } from './routes/menu.routes.js';
import { recommenderRouter } from './routes/recommender.routes.js';
import { gamesRouter } from './routes/games.routes.js';
import { trackSiteVisit } from './middleware/site-visit.js';
import { PRODUCTS_DIR, PRODUCTS_URL } from './lib/uploads.js';
import { clientFiles, legacyRedirects, servePage } from './web/frontend.js';

// Pages (React, see client/ and src/web/pages.ts):
//   /, /menu, /feedback, /games             → café site
//   /reserve, /reserve/{payment,invoice,…}  → reservation
//   /admin, /admin/login                    → the single admin panel
const isDev = !config.isProd && !config.isTest;

export const app = express();
// پشت nginx/Cloudflare بدون این خط، req.ip برای همه یکسان می‌شه. تعداد پراکسی‌ها از TRUST_PROXY در .env
// (پیش‌فرض ۱: فقط nginx؛ پشت Cloudflare و nginx: ۲)
if (config.isProd) app.set('trust proxy', config.trustProxyHops);
app.disable('x-powered-by');

app.use(
	helmet({
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				// اسکریپت‌ها فقط از خود سایت؛ همین جلوی اجرای کد تزریق‌شده رو می‌گیره.
				// فقط در حالت توسعه، Vite برای بارگذاری دوباره‌ی React یک اسکریپت درون‌خطی کوچک لازم دارد.
				scriptSrc: isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
				// 'unsafe-inline' فقط برای style لازمه چون کد از style="..." درون‌خطی استفاده می‌کنه
				styleSrc: ["'self'", "'unsafe-inline'"],
				fontSrc: ["'self'", 'data:'],
				imgSrc: ["'self'", 'data:', 'blob:', 'https://*.google.com', 'https://*.googleapis.com', 'https://*.gstatic.com'],
				// نقشه‌ی گوگل در صفحه‌ی «درباره ما»
				frameSrc: ['https://www.google.com'],
				// ws: فقط برای hot reload در حالت توسعه
				connectSrc: isDev ? ["'self'", 'ws:'] : ["'self'"],
				objectSrc: ["'none'"],
				frameAncestors: ["'none'"],
				baseUri: ["'self'"],
				// فرم‌ها فقط به خود سایت؛ redirect درگاه پرداخت با location.href انجام می‌شه نه form
				formAction: ["'self'"],
				upgradeInsecureRequests: config.isProd ? [] : null,
			},
		},
		// iframe نقشه‌ی گوگل با COEP پیش‌فرض بارگذاری نمی‌شد
		crossOriginEmbedderPolicy: false,
	}),
);
// gzip برای JSON، HTML، JS و CSS (عکس‌ها خودشان فشرده‌اند و دست نمی‌خورند). مثلاً /api/games با همه‌ی کارت‌های
// بازی‌ها چند برابر کوچک‌تر می‌شود. اگر nginx خودش gzip کند، این لایه دوباره فشرده نمی‌کند (پاسخ از قبل Content-Encoding دارد).
app.use(compression());
// در تست‌ها لاگ هر درخواست فقط خروجی را شلوغ می‌کند
if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(
	'/api',
	rateLimit({
		// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
		skip: () => config.isTest,
		windowMs: 60 * 1000,
		// Everyone on the café's Wi-Fi shares one public IP. A menu page alone makes about five API calls, so 120 a
		// minute was reached by some 25 guests opening the menu at once, and then the whole café got «too many
		// requests». The costly routes (SMS codes, holds, payments, admin login) keep their own tighter limits.
		max: 600,
		standardHeaders: true,
		legacyHeaders: false,
		message: { message: 'تعداد درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کن.' },
	}),
);
app.get('/health', (_req, res) => res.json({ ok: true, service: 'roof' }));

// ─── Pages ───────────────────────────────────────────────────────────────────

app.use(legacyRedirects);
app.use(trackSiteVisit);
// Every product photo gets a new, unique file name (a changed photo is a new file), so a name's content never changes:
// browsers may keep it for a year without asking again.
app.use(PRODUCTS_URL, express.static(PRODUCTS_DIR, { maxAge: config.isProd ? '365d' : 0, immutable: config.isProd, index: false }));
app.use('/admin', (_req, res, next) => {
	res.setHeader('X-Robots-Tag', 'noindex, nofollow');
	next();
});

// ─── API ─────────────────────────────────────────────────────────────────────

// IMPORTANT: `authRouter` must be registered before `adminRouter` so that
// routes like `/api/admin/login` implemented in `auth.routes.js` are
// matched before `adminRouter`'s `requireAdmin` middleware runs.
app.use('/api', authRouter);
app.use('/api', publicRouter);
app.use('/api', menuRouter);
app.use('/api', recommenderRouter);
app.use('/api', gamesRouter);
app.use('/api/reservations', reservationRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/admin', adminRouter);

app.use(servePage);
app.use(clientFiles);

app.use((req, res) => {
	if (req.path.startsWith('/api')) return res.status(404).json({ message: 'مسیر API پیدا نشد.' });
	// فقط GET به صفحه‌ی اصلی برمی‌گرده؛ بقیه‌ی متدها یعنی مسیر واقعاً وجود نداره
	if (req.method !== 'GET') return res.status(404).json({ message: 'مسیر پیدا نشد.' });
	// فایل‌های استاتیک گم‌شده (عکس، css، js) نباید HTML بگیرن
	if (path.extname(req.path)) return res.status(404).end();
	res.redirect(302, '/');
});

interface ErrorLike {
	type?: string;
	status?: number;
	statusCode?: number;
	message?: string;
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
	console.error(err);
	const error: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : { message: String(err) };
	// JSON خراب در body یعنی خطای کاربر، نه خطای سرور
	const status = error.type === 'entity.parse.failed' ? 400 : error.status || error.statusCode || 500;
	const safeMessage =
		status < 500
			? error.type === 'entity.parse.failed'
				? 'بدنه‌ی درخواست JSON معتبر نیست.'
				: error.message || 'درخواست نامعتبر است.'
			: config.isProd
				? 'خطای داخلی سرور؛ کمی بعد دوباره تلاش کن.'
				: error.message;
	res.status(status).json({ message: safeMessage });
});
