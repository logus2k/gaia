// sunset.js

export class SunCalcUTC {
  // --- Public API -----------------------------------------------------------

  /**
   * Sunset in UTC: "HH:MM:SS UTC" or "—"
   */
  static computeSunsetUTC(centerLL, date = new Date()) {
    const p = SunCalcUTC._sunParams(centerLL, date);
    if (!p) return '—';

    // LST → UTC  (LST = UTC + lonE/15 + EoT/60  ⇒  UTC = LST − lonE/15 − EoT/60)
    const LSTsunset = 12 + (p.H0deg / 15);
    const utcHours  = LSTsunset - (p.lonEast / 15) - (p.eotMin / 60);

    const h = SunCalcUTC._wrap24(utcHours);
    const out = SunCalcUTC._formatHMS(h) + ' UTC';

    // (Optional auto-observe; harmless)
    SunCalcUTC._observe(centerLL?.lon, h);
    return out;
  }

  /**
   * Sunset in **Local Solar Time** (astronomical local time, no DST/zone rules).
   * Returns "HH:MM:SS LST" or "—".
   *
   * This is derived directly from geometry:
   *   LSTsunset = 12 + H0/15   (always in [12, 24) hours)
   */
  static computeSunsetSolar(centerLL, date = new Date()) {
    const p = SunCalcUTC._sunParams(centerLL, date);
    if (!p) return '—';

    const LSTsunset = 12 + (p.H0deg / 15);
    const h = SunCalcUTC._wrap24(LSTsunset);
    return SunCalcUTC._formatHMS(h) + ' LST';
  }

  /**
   * Sunset in an approximate **local** clock:
   *   - mode: 'solar' (default) → same as computeSunsetSolar (LST).
   *   - mode: 'zone'            → approx civil time (UTC offset from longitude, rounded to 15 min, no DST).
   * Returns "HH:MM:SS LST" (solar) or "HH:MM:SS LT" (zone) or "—".
   */
  static computeSunsetLocal(centerLL, date = new Date(), { mode = 'solar' } = {}) {
    if (mode === 'solar') {
      return SunCalcUTC.computeSunsetSolar(centerLL, date);
    }

    // 'zone' mode: derive an approximate zone offset from longitude (no DST)
    const p = SunCalcUTC._sunParams(centerLL, date);
    if (!p) return '—';

    // First compute the UTC hours (as in computeSunsetUTC, but keep numeric)
    const LSTsunset = 12 + (p.H0deg / 15);
    const utcHours  = LSTsunset - (p.lonEast / 15) - (p.eotMin / 60);

    // Map longitude to an approximate civil offset (nearest 15 minutes)
    const offsetMin = Math.round(((p.lonEast / 15) * 60) / 15) * 15;
    const localHours = SunCalcUTC._wrap24(utcHours + offsetMin / 60);

    return SunCalcUTC._formatHMS(localHours) + ' LT';
  }

  // --- Internals ------------------------------------------------------------

  // Core solar/geometry pieces for the given center and date.
  // Returns null if polar day/night (no sunset).
  static _sunParams(centerLL, date) {
    if (!centerLL || !Number.isFinite(centerLL.lat) || !Number.isFinite(centerLL.lon)) return null;

    const N      = SunCalcUTC.dayOfYear(date);
    const decl   = SunCalcUTC.declinationDeg(N);
    const eotMin = SunCalcUTC.equationOfTimeMin(N);
    const lonEast = SunCalcUTC._mapLonToEast(centerLL.lon);

    const φ = centerLL.lat * Math.PI / 180;
    const δ = decl * Math.PI / 180;
    const zenith = 90.833 * Math.PI / 180; // standard refraction + solar radius

    let cosH0 = (Math.cos(zenith) - Math.sin(φ) * Math.sin(δ)) / (Math.cos(φ) * Math.cos(δ));
    if (cosH0 < -1 || cosH0 > 1) return null; // sun never sets/rises (polar day/night)
    cosH0 = Math.min(1, Math.max(-1, cosH0));

    const H0deg = Math.acos(cosH0) * 180 / Math.PI;

    return { H0deg, eotMin, lonEast };
  }

  // UTC day-of-year (1..366)
  static dayOfYear(d = new Date()) {
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
    return Math.floor((d - start) / 86400000);
  }

  // Approximate solar declination (Spencer-style)
  static declinationDeg(N) {
    return 23.44 * Math.sin((2 * Math.PI / 365) * (284 + N));
  }

  // Equation of Time (minutes), compact approximation
  static equationOfTimeMin(N) {
    const B = 2 * Math.PI * (N - 81) / 364;
    return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  }

  // --- Longitude convention auto-detection (optional; harmless if unused) ---

  // +1 means your lon is east-positive; -1 means west-positive
  static _lonSignFactor = null;
  static _prevSample = null; // { lonApp, utcHourFloat }

  static _mapLonToEast(lonApp) {
    if (SunCalcUTC._lonSignFactor === 1 || SunCalcUTC._lonSignFactor === -1) {
      return SunCalcUTC._lonSignFactor * lonApp;
    }
    // Default until motion lets us infer
    return lonApp;
  }

  static _observe(lonApp, utcHourFloat) {
    const epsLon = 1e-4;
    const prev = SunCalcUTC._prevSample;
    SunCalcUTC._prevSample = { lonApp, utcHourFloat };
    if (!prev) return;

    const dLon = lonApp - prev.lonApp;
    if (Math.abs(dLon) < epsLon) return;

    const dUTC = utcHourFloat - prev.utcHourFloat;
    const eastLooksRight = Math.sign(dUTC) === -Math.sign(dLon);
    const westLooksRight = Math.sign(dUTC) ===  Math.sign(dLon);
    if (eastLooksRight && !westLooksRight) SunCalcUTC._lonSignFactor = +1;
    else if (westLooksRight && !eastLooksRight) SunCalcUTC._lonSignFactor = -1;
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
