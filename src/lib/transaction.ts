import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { prismaCode } from './http-error.js';

type Tx = Prisma.TransactionClient;

/**
 * Runs `work` in a Serializable transaction and retries it when PostgreSQL aborts it because another
 * transaction ran at the same time (P2034). Under Serializable that also happens when the two did not
 * really touch the same rows (e.g. two holds on different tables of the same evening), so a single
 * conflict must not reach the customer as «someone else just booked this table». Only after the last
 * attempt is the P2034 thrown, for the caller to turn into a 409.
 */
export async function serializable<T>(work: (tx: Tx) => Promise<T>, { attempts = 3, timeout }: { attempts?: number; timeout?: number } = {}): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...(timeout ? { timeout } : {}) });
		} catch (error) {
			if (prismaCode(error) !== 'P2034' || attempt >= attempts) throw error;
			// a short random pause, so the two do not collide again at once
			await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60 * attempt));
		}
	}
}
