/** An HTTP error from our API, carrying the status and the server's (Persian) message. */
export class ApiError extends Error {
	readonly status: number;
	/** The full JSON body of the error response (e.g. `productCount` on a 409). */
	readonly data: Record<string, unknown>;
	constructor(status: number, message: string, data: Record<string, unknown> = {}) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.data = data;
	}
}

export interface ApiOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** Sent as JSON, or as-is when it is FormData (file uploads). */
	body?: unknown;
	signal?: AbortSignal;
	/** Message used when the server gives none. */
	fallbackMessage?: string;
}

/**
 * Calls the API on this same site (cookies included) and returns the parsed JSON.
 * Non-2xx answers throw an ApiError with the server's message.
 */
export async function api<T>(path: string, { method = 'GET', body, signal, fallbackMessage }: ApiOptions = {}): Promise<T> {
	const isForm = body instanceof FormData;
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			credentials: 'include',
			signal,
			headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
			body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new ApiError(0, 'خطا در ارتباط با سرور. اتصال اینترنت را بررسی کن.');
	}
	const text = await res.text();
	let data: unknown = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			/* not JSON (e.g. a proxy error page) */
		}
	}
	if (!res.ok) {
		const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
		const message =
			(typeof record.message === 'string' && record.message) ||
			(typeof record.error === 'string' && record.error) ||
			fallbackMessage ||
			'خطا در ارتباط با سرور';
		throw new ApiError(res.status, message, record);
	}
	return data as T;
}

export function errorText(error: unknown, fallback = 'خطایی رخ داد؛ دوباره تلاش کن.'): string {
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}
