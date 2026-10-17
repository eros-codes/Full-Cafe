// Single place that decides who may do what in the admin panel.
// DEVELOPER: the template owner. Full access; the only role that edits the floor map.
// MAIN:      café manager. Everything except floor-map geometry and developer accounts.
// SECONDARY: café staff. Reservations, manual booking, menu and reviews.
import type { AdminRole } from '@prisma/client';

export const ADMIN_ROLES: readonly AdminRole[] = ['DEVELOPER', 'MAIN', 'SECONDARY'];

export const ROLE_GROUPS = {
	// dashboards, reports, settings, working hours, closures, admin management
	manager: ['DEVELOPER', 'MAIN'],
	// create/move/reshape/delete tables, chairs, table connections
	mapEditor: ['DEVELOPER'],
	// turn a table on/off without touching its geometry
	tableToggle: ['DEVELOPER', 'MAIN'],
	// reservations list, manual booking, menu, reviews
	staff: ['DEVELOPER', 'MAIN', 'SECONDARY'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type RoleGroup = keyof typeof ROLE_GROUPS;

export function isAdminRole(value: unknown): value is AdminRole {
	return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function hasRole(admin: { role: AdminRole } | null | undefined, group: RoleGroup): boolean {
	return Boolean(admin && (ROLE_GROUPS[group] as readonly AdminRole[]).includes(admin.role));
}

/** Can `actor` create/edit/delete an admin account that has (or will have) `targetRole`? */
export function canManageRole(actor: { role: AdminRole } | null | undefined, targetRole: AdminRole): boolean {
	if (!actor) return false;
	if (actor.role === 'DEVELOPER') return true;
	if (actor.role === 'MAIN') return targetRole !== 'DEVELOPER';
	return false;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
