const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** 1234567 → «۱٬۲۳۴٬۵۶۷» */
export function faNumber(value: unknown): string {
	const n = Number(value);
	return (Number.isFinite(n) ? n : 0).toLocaleString('fa-IR');
}

/** Replaces every Latin digit in a string with its Persian form, leaving everything else. */
export function faDigits(value: string | number): string {
	return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toman(amount: unknown): string {
	return `${faNumber(amount)} تومان`;
}

/** «۰۹:۳۰» → «09:30». Persian and Arabic-Indic digits typed on a Persian keyboard become Latin digits. */
export function latinDigits(value: string): string {
	return value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
