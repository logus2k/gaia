// sunset.js


export class SunCalcUTC {

    static dayOfYear(d = new Date()) {
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
    return Math.floor((d - start) / 86400000);
  }

  static declinationDeg(N) {
    // Approximate solar declination (Spencer 1971)
    return 23.44 * Math.sin((2 * Math.PI / 365) * (284 + N));
  }

  static equationOfTimeMin(N) {
    const B = 2 * Math.PI * (N - 81) / 364;
    return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  }

  static computeSunsetUTC(centerLL, date = new Date()) {
    if (!centerLL) return '—';
    const N = SunCalcUTC.dayOfYear(date);
    const δdeg = SunCalcUTC.declinationDeg(N);
    const eotMin = SunCalcUTC.equationOfTimeMin(N);

    const φ = centerLL.lat * Math.PI / 180;
    const δ = δdeg * Math.PI / 180;
    const zenith = 90.833 * Math.PI / 180;

    const cosH0 = (Math.cos(zenith) - Math.sin(φ) * Math.sin(δ)) / (Math.cos(φ) * Math.cos(δ));
    if (cosH0 < -1 || cosH0 > 1) return '—'; // polar day/night

    const H0deg = Math.acos(cosH0) * 180 / Math.PI;
    const solarNoon = 12 + (eotMin / 60) - (centerLL.lon / 15);
    const sunsetLST = solarNoon + (H0deg / 15);

    const utcHours = sunsetLST + (centerLL.lon / 15) - (eotMin / 60);
    const h = ((utcHours % 24) + 24) % 24;
    const hh = String(Math.floor(h)).padStart(2,'0');
    const mm = String(Math.floor((h % 1) * 60)).padStart(2,'0');
    const ss = String(Math.round((((h % 1) * 60) % 1) * 60)).padStart(2,'0');
    return `${hh}:${mm}:${ss} UTC`;
  }
}
