import { config } from '../config.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

// Public menu + reviews API (from the café template).
// Responses keep the original shapes (plain arrays) so the menu pages work unchanged.
export const menuRouter = express.Router();

const reviewLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: 'تعداد مجاز نظرات در این ساعت تجاوز شد. بعداً دوباره امتحان کنید.' },
});

// Same limits as the feedback form (text 100, name 64). Before, the form allowed
// 100 characters but the server accepted 500, so the two disagreed.
export const REVIEW_TEXT_MAX = 100;
export const REVIEW_NAME_MAX = 64;

type Pagination = { error: string } | { skip: number; take: number; page: number; limit: number };

function parsePagination(query: Record<string, unknown>): Pagination | null {
	if (query.page === undefined && query.limit === undefined) return null;
	const page = query.page !== undefined ? Number(query.page) : 1;
	const limit = query.limit !== undefined ? Number(query.limit) : 20;
	if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
		return { error: 'page و limit باید اعداد صحیح مثبت باشند و limit نباید بیشتر از 100 باشد.' };
	}
	return { skip: (page - 1) * limit, take: limit, page, limit };
}

// Tabs of the menu page, in the order set in the admin panel. Hidden (inactive) types are left out.
menuRouter.get('/menu-types', async (_req, res, next) => {
	try {
		const menuTypes = await prisma.menuType.findMany({
			where: { isActive: true },
			select: { id: true, name: true },
			orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
		});
		res.json(menuTypes);
	} catch (error) {
		next(error);
	}
});

const VISIBLE_CATEGORY = { menuType: { isActive: true } } satisfies Prisma.CategoryWhereInput;

menuRouter.get('/categories', async (_req, res, next) => {
	try {
		const categories = await prisma.category.findMany({
			where: VISIBLE_CATEGORY,
			select: { id: true, name: true, menuTypeId: true },
			orderBy: { id: 'asc' },
		});
		res.json(categories);
	} catch (error) {
		next(error);
	}
});

menuRouter.get('/products', async (req, res, next) => {
	try {
		const where: Prisma.ProductWhereInput = { category: VISIBLE_CATEGORY };
		if (req.query.categoryId !== undefined) {
			const categoryId = Number(req.query.categoryId);
			if (!Number.isInteger(categoryId) || categoryId < 1) return res.status(400).json({ message: 'categoryId نامعتبر است' });
			where.categoryId = categoryId;
		}
		const products = await prisma.product.findMany({
			where,
			select: {
				id: true,
				name: true,
				price: true,
				description: true,
				image: true,
				categoryId: true,
				// ناموجود هم در منو دیده می‌شود (با برچسب «ناموجود»)، ولی سفارش داده نمی‌شود
				isAvailable: true,
				// فقط افزودنی‌های فعال، به ترتیبی که در پنل برای همین محصول چیده شده
				addOns: {
					where: { addOn: { isActive: true } },
					orderBy: { sortOrder: 'asc' },
					select: { addOn: { select: { id: true, name: true, price: true } } },
				},
			},
			orderBy: { id: 'asc' },
		});
		res.json(products.map(({ addOns, ...product }) => ({ ...product, addOns: addOns.map((link) => link.addOn) })));
	} catch (error) {
		next(error);
	}
});

const PUBLIC_REVIEW_FIELDS = { id: true, name: true, text: true, reply: true, createdAt: true } satisfies Prisma.ReviewSelect;

menuRouter.get('/reviews', async (req, res, next) => {
	try {
		const pagination = parsePagination(req.query);
		if (pagination && 'error' in pagination) return res.status(400).json({ message: pagination.error });
		const where = { visible: true };
		if (!pagination) {
			const reviews = await prisma.review.findMany({ where, select: PUBLIC_REVIEW_FIELDS, orderBy: { createdAt: 'desc' } });
			return res.json(reviews);
		}
		const [reviews, total] = await prisma.$transaction([
			prisma.review.findMany({
				where,
				select: PUBLIC_REVIEW_FIELDS,
				orderBy: { createdAt: 'desc' },
				skip: pagination.skip,
				take: pagination.take,
			}),
			prisma.review.count({ where }),
		]);
		res.json({ data: reviews, page: pagination.page, limit: pagination.limit, total });
	} catch (error) {
		next(error);
	}
});

menuRouter.post('/reviews', reviewLimiter, async (req, res, next) => {
	try {
		const { name, text } = req.body || {};
		if (typeof text !== 'string') return res.status(400).json({ message: 'متن نظر نامعتبر است' });
		if (name !== undefined && name !== null && typeof name !== 'string') return res.status(400).json({ message: 'نام نامعتبر است' });
		const cleanText = text.trim();
		const cleanName = typeof name === 'string' ? name.trim() : '';
		if (!cleanText) return res.status(400).json({ message: 'متن نظر الزامی است' });
		if (cleanText.length > REVIEW_TEXT_MAX) return res.status(400).json({ message: `متن نظر حداکثر ${REVIEW_TEXT_MAX} کاراکتر است` });
		if (cleanName.length > REVIEW_NAME_MAX) return res.status(400).json({ message: `نام حداکثر ${REVIEW_NAME_MAX} کاراکتر است` });

		const review = await prisma.review.create({ data: { name: cleanName || null, text: cleanText, visible: false } });
		res.status(201).json({ id: review.id, name: review.name, text: review.text, createdAt: review.createdAt });
	} catch (error) {
		next(error);
	}
});
