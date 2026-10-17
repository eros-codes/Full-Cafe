export type ZoneKey = 'WINDOW' | 'CENTER' | 'ROOF';
export type TableShape = 'ROUND' | 'SQUARE' | 'RECTANGLE';

export interface ChairPosition {
	x: number;
	y: number;
	angle?: number;
	scale?: number;
	/** "shared" = a seat on the sofa behind the table, drawn as a small dot. */
	type?: 'normal' | 'shared';
}

export interface TableAvailability {
	available: boolean;
	reason?: string;
	matchType?: 'perfect' | 'soft';
	startTime?: string;
	endTime?: string;
	message?: string;
}

/** A table as the map draws it (from /api/availability, /api/tables or /api/admin/tables). */
export interface MapTable {
	id: string;
	code: string;
	displayNumber: string;
	zone: ZoneKey;
	shape: TableShape;
	capacity: number;
	minGuests: number;
	maxGuests: number;
	isActive: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	chairs: ChairPosition[] | null;
	description?: string | null;
	connectableTableIds?: string[];
	availability?: TableAvailability | null;
}

export interface ViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MapConfig {
	viewBox: number[] | ViewBox;
	defaultView?: ViewBox | number[];
	zones: Record<string, { label: string; bounds: ViewBox | number[] }>;
	limits?: { minZoom?: number; maxZoom?: number };
	ignoredTableCodes?: string[];
}
