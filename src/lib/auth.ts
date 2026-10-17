import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import type { AdminRole } from '@prisma/client';
import { config } from '../config.js';

export interface UserTokenPayload {
	sub: string;
	phone: string;
	ver: number;
	type: 'user';
}

export interface GuestTokenPayload {
	phone: string;
	reservationId: string;
	trackingCode: string;
	type: 'guest';
}

export interface AdminTokenPayload {
	sub: string;
	username: string;
	role: AdminRole;
	ver: number;
	type: 'admin';
}

type TokenType = 'user' | 'guest' | 'admin';
type CookieName = 'adminToken' | 'guestToken' | 'userToken';

export function signUserToken(user: { id: string; phone: string; tokenVersion?: number | null }): string {
	const payload: UserTokenPayload = { sub: user.id, phone: user.phone, ver: user.tokenVersion ?? 0, type: 'user' };
	return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function signGuestToken(payload: Omit<GuestTokenPayload, 'type'>): string {
	return jwt.sign({ ...payload, type: 'guest' }, config.jwtSecret, { expiresIn: '2h' });
}

export function signAdminToken(admin: { id: string; username: string; role: AdminRole; tokenVersion?: number | null }): string {
	const payload: AdminTokenPayload = { sub: admin.id, username: admin.username, role: admin.role, ver: admin.tokenVersion ?? 0, type: 'admin' };
	return jwt.sign(payload, config.adminJwtSecret, { expiresIn: '12h' });
}

function verifyTyped<T extends { type: TokenType }>(token: string, secret: string, expectedType: T['type']): T {
	const payload = jwt.verify(token, secret);
	if (typeof payload !== 'object' || payload === null || (payload as { type?: unknown }).type !== expectedType) {
		throw new Error('نوع توکن نامعتبر است.');
	}
	return payload as unknown as T;
}

export function verifyUserToken(token: string): UserTokenPayload {
	return verifyTyped<UserTokenPayload>(token, config.jwtSecret, 'user');
}

export function verifyAdminToken(token: string): AdminTokenPayload {
	return verifyTyped<AdminTokenPayload>(token, config.adminJwtSecret, 'admin');
}

export function verifyGuestToken(token: string): GuestTokenPayload {
	return verifyTyped<GuestTokenPayload>(token, config.jwtSecret, 'guest');
}

const COOKIE_MAX_AGE: Record<CookieName, number> = {
	adminToken: 12 * 60 * 60 * 1000,
	guestToken: 2 * 60 * 60 * 1000,
	userToken: 30 * 24 * 60 * 60 * 1000,
};

function cookieOptions(name: CookieName): CookieOptions {
	return {
		httpOnly: true,
		sameSite: name === 'adminToken' ? 'strict' : 'lax',
		secure: config.isProd,
		path: '/',
	};
}

export function setCookie(res: Response, name: CookieName, token: string): void {
	res.cookie(name, token, { ...cookieOptions(name), maxAge: COOKIE_MAX_AGE[name] });
}

export function clearCookie(res: Response, name: CookieName): void {
	res.clearCookie(name, cookieOptions(name));
}
