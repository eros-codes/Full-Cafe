import type { Request } from 'express';
import type { AdminUser, User } from '@prisma/client';
import { createHttpError } from './http-error.js';

/**
 * A single query-string value. Express parses `?a=1&a=2` into an array and `?a[b]=1` into an object;
 * neither is a valid value for any of our parameters, so both count as missing.
 */
export function queryString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** The signed-in customer. Only valid behind `requireUser`. */
export function currentUser(req: Request): User {
	if (!req.user) throw createHttpError(401, 'لطفاً وارد حساب شوید.');
	return req.user;
}

/** The signed-in admin. Only valid behind `requireAdmin`. */
export function currentAdmin(req: Request): AdminUser {
	if (!req.admin) throw createHttpError(401, 'ورود ادمین لازم است.');
	return req.admin;
}
