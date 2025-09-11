// sunset.js

export class SunCalcUTC {
	// ---------------------------------------------------------------------------
	// Configure longitude convention ONCE at startup if needed:
	//   SunCalcUTC.setLongitudeConvention('east'); // +E / -W  (DEFAULT)
	//   SunCalcUTC.setLongitudeConvention('west'); // +W / -E
	// ---------------------------------------------------------------------------

	static setLongitudeConvention(mode /* 'east' | 'west' */) {
		SunCalcUTC._lonMode = (mode === 'west') ? 'west' : 'east';
	}

	// === Public API ============================================================

	/** Sunset in UTC: "HH:MM:SS UTC" or "—" */
	static computeSunsetUTC(centerLL, date = new Date()) {
		const p = SunCalcUTC._sunParams(centerLL, date);
		if (!p) return '—';

		// LSTsunset = 12 + H0/15  (hours)
		const LSTsunset = 12 + (p.H0deg / 15);

		// LST = UTC + lonE/15 + EoT/60  =>  UTC = LST - lonE/15 - EoT/60
		const utcHours = LSTsunset - (p.lonEast / 15) - (p.eotMin / 60);

		return SunCalcUTC._formatHMS(SunCalcUTC._wrap24(utcHours)) + ' UTC';
	}

	/** Sunset in Local Solar Time (astronomical, no DST/zones): "HH:MM:SS LST" or "—" */
	static computeSunsetSolar(centerLL, date = new Date()) {
		const p = SunCalcUTC._sunParams(centerLL, date);
		if (!p) return '—';

		const LSTsunset = 12 + (p.H0deg / 15); // in [12, 24) hours
		return SunCalcUTC._formatHMS(SunCalcUTC._wrap24(LSTsunset)) + ' LST';
	}

	/**
	 * Sunset in an approximate local civil clock (no DST DB):
	 *  - mode 'solar' (default) → same as computeSunsetSolar (LST)
	 *  - mode 'zone'  → UTC plus a longitude-derived offset rounded to 15 min (no DST)
	 * Returns "HH:MM:SS LST" or "HH:MM:SS LT" or "—".
	 */
	static computeSunsetLocal(centerLL, date = new Date(), { mode = 'solar' } = {}) {
		if (mode === 'solar') return SunCalcUTC.computeSunsetSolar(centerLL, date);

		const p = SunCalcUTC._sunParams(centerLL, date);
		if (!p) return '—';

		// First get UTC numerically (no strings)
		const LSTsunset = 12 + (p.H0deg / 15);
		const utcHours = LSTsunset - (p.lonEast / 15) - (p.eotMin / 60);

		// Approx civil offset from longitude (rounded to 15 minutes), still no DST
		const offsetMin = Math.round(((p.lonEast / 15) * 60) / 15) * 15;
		const localHours = SunCalcUTC._wrap24(utcHours + offsetMin / 60);

		return SunCalcUTC._formatHMS(localHours) + ' LT';
	}

	// === Internals =============================================================

	// Core solar params for given center/date. Returns null for polar day/night.
	static _sunParams(centerLL, date) {
		if (!centerLL || !Number.isFinite(centerLL.lat) || !Number.isFinite(centerLL.lon)) return null;

		const N = SunCalcUTC.dayOfYear(date);
		const decl = SunCalcUTC.declinationDeg(N);     // degrees
		const eotMin = SunCalcUTC.equationOfTimeMin(N);  // minutes
		const lonEast = SunCalcUTC._toEastPositive(centerLL.lon);

		const φ = centerLL.lat * Math.PI / 180;
		const δ = decl * Math.PI / 180;
		const zenith = 90.833 * Math.PI / 180; // refraction + solar radius

		let cosH0 = (Math.cos(zenith) - Math.sin(φ) * Math.sin(δ)) / (Math.cos(φ) * Math.cos(δ));
		if (cosH0 < -1 || cosH0 > 1) return null; // polar day/night
		cosH0 = Math.min(1, Math.max(-1, cosH0));

		const H0deg = Math.acos(cosH0) * 180 / Math.PI;

		return { H0deg, eotMin, lonEast };
	}

	// UTC day-of-year (1..366)
	static dayOfYear(d = new Date()) {
		const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
		return Math.floor((d - start) / 86400000);
	}

	// Solar declination (approx; good for UI)
	static declinationDeg(N) {
		return 23.44 * Math.sin((2 * Math.PI / 365) * (284 + N));
	}

	// Equation of Time (minutes), compact approximation
	static equationOfTimeMin(N) {
		const B = 2 * Math.PI * (N - 81) / 364;
		return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
	}

	// Map your app's lon to EAST-positive based on configured convention
	static _lonMode = 'east'; // stable default
	static _toEastPositive(lonApp) {
		// Normalize lon to [-180, 180] first to avoid wrap jumps affecting utc modulo
		let lon = ((lonApp + 180) % 360 + 360) % 360 - 180;
		if (SunCalcUTC._lonMode === 'west') lon = -lon;
		return lon;
	}

	// ---- Compatibility alias (so app.js calls keep working) ----
	static _mapLonToEast(lonApp) {
		return SunCalcUTC._toEastPositive(lonApp);
	}

	// Helpers
	static _wrap24(h) {
		return ((h % 24) + 24) % 24;
	}
	static _formatHMS(h) {
		const hh = String(Math.floor(h)).padStart(2, '0');
		const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
		const ss = String(Math.round((((h % 1) * 60) % 1) * 60)).padStart(2, '0');
		return `${hh}:${mm}:${ss}`;
	}
}
