// The names of the café's halls, in one place: the map's tabs, the booking page, the admin panel, the QR cards.
// The keys are the database's ZoneKey (fixed); the names belong to the floor plan (client/public/maps/roof-base.svg).
// «ROOF» is only the key of the third hall: on this plan it is the terrace.
//
// No imports: the client loads this file too (client/shared/zones.ts).
export const ZONE_FA: Record<string, string> = { WINDOW: 'سالن پنجره', CENTER: 'سالن اصلی', ROOF: 'تراس' };
