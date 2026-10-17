/** An Error that carries the HTTP status the error handler should answer with. */
export class HttpError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export function createHttpError(status: number, message: string): HttpError {
	return new HttpError(status, message);
}

/** Prisma error code (e.g. 'P2002', 'P2025') of an unknown thrown value, if it has one. */
export function prismaCode(error: unknown): string | undefined {
	if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
		return (error as { code: string }).code;
	}
	return undefined;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
