import { ApiError, api, type ApiOptions } from '../../shared/api';

export const LOGIN_URL = '/admin/login';

/**
 * API call from the admin panel. A 401 anywhere means the session ended (expired, password changed,
 * account deactivated): back to the login page.
 */
export async function adminApi<T>(path: string, options?: ApiOptions): Promise<T> {
	try {
		return await api<T>(path, options);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401 && !path.endsWith('/login')) window.location.href = LOGIN_URL;
		throw error;
	}
}
