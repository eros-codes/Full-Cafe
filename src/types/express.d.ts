import type { AdminUser, User } from '@prisma/client';

declare global {
	namespace Express {
		interface Request {
			/** Set by requireAdmin. */
			admin?: AdminUser;
			/** Set by optionalUser / requireUser. */
			user?: User;
		}
	}
}

export {};
