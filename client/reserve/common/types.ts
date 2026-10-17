// Shapes of the reservation API responses used by the pages.

export interface ReservationTableLink {
	tableId: string;
	table?: { id: string; displayNumber: string; zone: string; code: string } | null;
}

export interface Payment {
	id: string;
	status: string;
	amount: number;
	refId: string | null;
	createdAt: string;
}

export interface Reservation {
	id: string;
	trackingCode: string;
	userId: string | null;
	customerName: string;
	customerPhone: string;
	guestCount: number;
	startAt: string;
	endAt: string;
	durationMinutes: number;
	status: string;
	source: string;
	holdExpiresAt: string | null;
	pricePerGuest: number;
	totalAmount: number;
	paidAmount: number;
	refundStatus: string;
	decorationAmount: number;
	decorationNote: string | null;
	notes: string | null;
	createdAt: string;
	tables?: ReservationTableLink[];
	payments?: Payment[];
	invoice?: { number: string } | null;
	user?: { id: string; name: string | null; phone: string } | null;
}

export interface CurrentUser {
	id: string;
	name: string | null;
	phone: string;
}

export interface PublicConfig {
	settings: {
		reservationWindowDays: number;
		minLeadMinutes: number;
		minDurationMinutes: number;
		maxDurationMinutes: number;
		slotIntervalMinutes: number;
		cleaningBufferMinutes: number;
		holdMinutes: number;
		pricePerGuest: number;
		decorationPrice: number;
		minCancelMinutes: number;
		currencyLabel: string;
	};
	dates: string[];
}
