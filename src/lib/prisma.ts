import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

export const prisma = new PrismaClient({
	log: config.isProd ? ['error'] : ['error', 'warn'],
});

/** Either the global client or a transaction client. */
export type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
