// localStorage can throw (private mode, blocked site data) — every access is guarded.

export const safeStorage = {
	get(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key: string, value: string): void {
		try {
			localStorage.setItem(key, value);
		} catch {
			/* storage unavailable: the value just isn't remembered */
		}
	},
	remove(key: string): void {
		try {
			localStorage.removeItem(key);
		} catch {
			/* ignore */
		}
	},
};
