import express from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import type { WaiterCallKind } from '@prisma/client';
import { config } from '../config.js';
import { BRAND } from '../brand.js';
import { prisma } from '../lib/prisma.js';
import { verifyAdminToken } from '../lib/auth.js';
import { ZONE_FA } from '../zones.js';
import { CALL_KINDS, cancelCall, createCall, guestView, tableByToken, tablesWithCodes } from '../services/waiter-call.service.js';

// «صدا کردن گارسون», the guest's side: /api/table-call/<token> (the token of the table's QR code).
//   GET                → the table («میز ۱۲») and the guest's calls, so the site shows the button and their state
//   POST {kind}        → a call: WAITER or BILL
//   DELETE /<id>       → the guest takes their call back
// And /admin/table-qr: the printable sheet of every table's QR code (admins only).

export const tableCallRouter = express.Router();

// on top of the per-table cooldown: one address cannot flood the panel from many tables
const callLimiter = rateLimit({
	skip: () => config.isTest,
	windowMs: 10 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: 'درخواست‌ها زیاد شد؛ کمی بعد دوباره امتحان کن.' },
});

const publicTable = (table: { displayNumber: string; zone: string }) => ({ displayNumber: table.displayNumber, zone: table.zone, zoneFa: ZONE_FA[table.zone] ?? '' });

tableCallRouter.get('/api/table-call/:token', async (req, res, next) => {
	try {
		const table = await tableByToken(req.params.token);
		if (!table) return res.status(404).json({ message: 'این کد میز معتبر نیست.' });
		res.json({ table: publicTable(table), calls: await guestView(table.id) });
	} catch (error) {
		next(error);
	}
});

tableCallRouter.post('/api/table-call/:token', callLimiter, async (req, res, next) => {
	try {
		const table = await tableByToken(req.params.token);
		if (!table) return res.status(404).json({ message: 'این کد میز معتبر نیست.' });
		const kind = req.body?.kind as WaiterCallKind;
		if (!CALL_KINDS.includes(kind)) return res.status(400).json({ message: 'نوع درخواست نامعتبر است.' });
		const result = await createCall(table.id, kind);
		if (!result.ok) return res.status(result.status).json({ message: result.message });
		res.status(201).json({ call: result.call, calls: await guestView(table.id) });
	} catch (error) {
		next(error);
	}
});

tableCallRouter.delete('/api/table-call/:token/:id', async (req, res, next) => {
	try {
		const table = await tableByToken(req.params.token);
		if (!table) return res.status(404).json({ message: 'این کد میز معتبر نیست.' });
		await cancelCall(table.id, req.params.id);
		res.json({ calls: await guestView(table.id) });
	} catch (error) {
		next(error);
	}
});

// ─── the QR sheet ────────────────────────────────────────────────────────────

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const faDigits = (value: string) => value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** The address in a table's QR code. */
export const callUrl = (token: string) => `${config.appUrl.replace(/\/+$/, '')}/menu?table=${token}`;

tableCallRouter.get('/admin/table-qr', async (req, res, next) => {
	try {
		// the same check as the admin API, but a page: without a session it goes to the login page
		let adminId: string | null = null;
		try {
			const payload = verifyAdminToken(req.cookies?.adminToken ?? '');
			const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
			if (admin?.isActive && (payload.ver ?? 0) === (admin.tokenVersion ?? 0)) adminId = admin.id;
		} catch {
			adminId = null;
		}
		if (!adminId) return res.redirect(302, '/admin/login');

		const tables = (await tablesWithCodes()).filter((t) => t.isActive && t.callCode);
		const cards = await Promise.all(
			tables.map(async (t) => {
				const svg = await QRCode.toString(callUrl(t.callCode!.token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2a1a12', light: '#ffffff' } });
				return `<article class="card">
	<header><img src="${BRAND.logo.dark}" alt="" /><span>${escapeHtml(BRAND.cafeFa)}</span></header>
	<div class="qr">${svg}</div>
	<p class="num">میز ${escapeHtml(faDigits(t.displayNumber))}</p>
	<p class="zone">${escapeHtml(ZONE_FA[t.zone] ?? '')}</p>
	<p class="hint">برای مشاهده منو ، کد را با دوربین گوشی اسکن کنید</p>
</article>`;
			}),
		);
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('X-Robots-Tag', 'noindex, nofollow');
		res.type('html').send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>QR میزها · ${escapeHtml(BRAND.nameFa)}</title>
<link rel="icon" type="image/svg+xml" href="${BRAND.logo.mark}" />
<style>
@font-face { font-family: 'Estedad'; src: url('/fonts/Estedad/estedad-arabic-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f5efe7; color: #2a1a12; font-family: 'Estedad', Tahoma, sans-serif; }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; max-width: 1100px; margin: 0 auto 20px; }
.bar h1 { margin: 0; font-size: 20px; }
.bar p { margin: 4px 0 0; color: #6b5a4e; font-size: 13px; }
.bar button { padding: 10px 22px; border: 0; border-radius: 12px; background: #3a1f12; color: #faf2e8; font: inherit; font-weight: 700; cursor: pointer; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; max-width: 1100px; margin: 0 auto; }
.card { display: grid; justify-items: center; gap: 4px; padding: 18px 16px 16px; background: #fff; border: 1.5px dashed #c9b9a6; border-radius: 18px; text-align: center; break-inside: avoid; page-break-inside: avoid; }
.card header { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; }
.card header img { width: 30px; height: 23px; }
.qr { width: 170px; height: 170px; margin: 6px 0 2px; }
.qr svg { width: 100%; height: 100%; display: block; }
.num { margin: 0; font-size: 24px; font-weight: 900; }
.zone { margin: 0; color: #6b5a4e; font-size: 13px; }
.hint { margin: 6px 0 0; color: #6b5a4e; font-size: 11.5px; line-height: 1.7; }
.empty { max-width: 1100px; margin: 0 auto; color: #6b5a4e; }
@media print {
	body { padding: 0; background: #fff; }
	.bar { display: none; }
	.grid { grid-template-columns: repeat(3, 1fr); gap: 10mm; }
	@page { size: A4; margin: 12mm; }
}
</style>
<script src="/admin-print.js" defer></script>
</head>
<body>
<div class="bar">
	<div>
		<h1>کدهای QR میزها</h1>
		<p>${tables.length.toLocaleString('fa-IR')} میز · هر کارت را جدا کنید و روی میز خودش بچسبانید. کد هر میز فقط مال همان میز است.</p>
	</div>
	<button type="button" id="printSheet">چاپ</button>
</div>
${cards.length ? `<main class="grid">${cards.join('\n')}</main>` : '<p class="empty">میز فعالی روی نقشه نیست.</p>'}
</body>
</html>`);
	} catch (error) {
		next(error);
	}
});
