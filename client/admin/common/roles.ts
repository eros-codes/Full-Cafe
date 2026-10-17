// Mirror of src/lib/roles.ts for the admin UI. The server is the real gatekeeper;
// this only decides which buttons and sections to show.

export type AdminRole = 'DEVELOPER' | 'MAIN' | 'SECONDARY';

export interface Admin {
	id: string;
	username: string;
	name: string;
	role: AdminRole;
}

export const ROLE_FA: Record<AdminRole, string> = { DEVELOPER: 'توسعه‌دهنده', MAIN: 'ادمین اصلی', SECONDARY: 'ادمین فرعی' };

const GROUPS = {
	manager: ['DEVELOPER', 'MAIN'],
	mapEditor: ['DEVELOPER'],
	tableToggle: ['DEVELOPER', 'MAIN'],
	staff: ['DEVELOPER', 'MAIN', 'SECONDARY'],
} satisfies Record<string, AdminRole[]>;

export function can(admin: Admin | null, group: keyof typeof GROUPS): boolean {
	return Boolean(admin && (GROUPS[group] as AdminRole[]).includes(admin.role));
}

/** Roles this admin may create or assign (ordered from most to least privileged). */
export function assignableRoles(admin: Admin | null): AdminRole[] {
	if (admin?.role === 'DEVELOPER') return ['DEVELOPER', 'MAIN', 'SECONDARY'];
	if (admin?.role === 'MAIN') return ['MAIN', 'SECONDARY'];
	return [];
}
