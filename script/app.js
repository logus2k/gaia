import * as THREE from "three";
import { OrbitControls } from "../library/OrbitControls.js";
import { SunCalcUTC } from "../script/sunset.js";
import { MiniGlobeOverlay } from "../script/mini.globe.js";
import { LocationSearchClient } from "../script/location.search.client.js";
import { WavingFlag } from "../script/waving.flag.js";

import { CountryDataDisplay } from "../script/country.data.display.js";



SunCalcUTC.setLongitudeConvention('east');

// ---------- Settings (baseline) ----------
const SETTINGS = {
	dayTexture: '../data/world.topo.bathy.200412.3x21600x10800.jpg',
	nightTexture: '../data/BlackMarble_2016_3km.jpg',
	bathymetryTexture: '../data/gebco_08_rev_bath_3600x1800_color.jpg',
	terrainTexture: '../data/HYP_VLR_SR_OB_DR.png',
	populationTexture: '../data/population_3600_1800.png',
	vegetationTexture: '../data/vegetation_3600_1800.png',
	land_temperatureTexture: '../data/land_temperature_3600_1800.png',
	land_cover_classificationTexture: '../data/land_cover_classification_3600_1800.png',
	cloudsTexture: '../data/fair_clouds_4k.png',
	skyTexture: '../data/eso0932a_xl.jpg',
	bordersGeoJSON: '../data/ne_10m/countries/ne_10m_admin_0_countries.geojson',
	globeColorRGB: 0x0a2a43,
	globeColorAlpha: 1.0,
	earthRadiusKm: 6371
};

// ---------- 2D Map handoff (MapLibre) ----------
const TILE_SIZE = 512;           // WebMercator world size used by MapLibre zoom

const EARTH_R_METERS = SETTINGS.earthRadiusKm * 1000;

// Handoff thresholds (WebMercator zoom)
const HANDOFF_Z_IN = 5.0;
const HANDOFF_Z_OUT = 4.99;

let map2d = null;                   // MapLibre instance
let map2dVisible = false;
let lastEstimatedZ = 3.0;
let lastCenterLL = { lat: 0, lon: 0 };
let _justEntered2D = false;
let _handoffPose = null;
let _handoffGlobeQuaternion = null;
let _mapBearingChanged = false;
let _lastMapBearing = 0;


const STREETS_STYLE_URL = 'https://tiles.stadiamaps.com/styles/osm_bright.json';
const AERIAL_STYLE_OBJ = {
	version: 8,
	sources: {
		'esri-satellite': {
			type: 'raster',
			tiles: ['https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
			tileSize: 256,
			attribution: 'Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
		}
	},
	layers: [{ id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite' }]
};

// --- Mini-globe telemetry cache / throttles ---
const _teleCache = {
	// TIME …
	lastTimeSec: -1,
	timeUTC: '—',
	timeLocal: '—',

	// SUNSET …
	lastSunsetMs: 0,
	lastSunsetLL: { lat: NaN, lon: NaN },
	sunset: '—',

	// LOCATION …
	lastLocMs: 0,
	lastLocLL: { lat: NaN, lon: NaN },
	location: 'N/A',

	// BEARING (new)
	bearingDeg: NaN,          // cached normalized bearing in [-180, 180)
	lastBearingMs: 0          // last time we accepted an update
};

// Normalize to [-180, 180) and collapse -0 to +0
function normalizeBearingDeg(b) {
	if (!Number.isFinite(b)) return 0;
	let n = ((b % 360) + 360) % 360;   // [0, 360)
	if (n >= 180) n -= 180 * 2;        // [-180, 180)
	if (Object.is(n, -0)) n = 0;       // kill -0
	return n;
}

// Shortest absolute angular difference in degrees
function angDiffDeg(a, b) {
	let d = a - b;
	d = ((d + 180) % 360) - 180;
	return Math.abs(d);
}


// thresholds
const SUNSET_MIN_INTERVAL_MS = 60000; // 60s
const LOCATION_MIN_INTERVAL_MS = 3000;  // 3s
const LL_EPS_SUNSET = 0.5;   // deg change needed to refresh sunset sooner
const LL_EPS_LOC = 0.25;  // deg change needed to refresh location


// ---------- Utils ----------
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function hexFromInt(i) { return '#' + i.toString(16).padStart(6, '0'); }
function intFromHex(h) { return parseInt(h.replace('#', '').slice(0, 6), 16); }
function parseHexRGBA(str) {
	let s = str.trim(); if (s.startsWith('#')) s = s.slice(1);
	if (s.length === 6) return { rgb: parseInt(s, 16), a: 1.0 };
	if (s.length === 8) { const rgb = parseInt(s.slice(0, 6), 16); const a = parseInt(s.slice(6, 8), 16) / 255; return { rgb, a: clamp01(a) }; }
	return null;
}
function rgbaToHex8(rgbInt, a01) { const a = Math.round(clamp01(a01) * 255); return '#' + rgbInt.toString(16).padStart(6, '0') + a.toString(16).padStart(2, '0').toUpperCase(); }
function deg(v) { return v * 180 / Math.PI; }
function rad(v) { return v * Math.PI / 180; }

function signedAngleAroundAxis(a, b, axis) {
	const an = a.clone().normalize(), bn = b.clone().normalize(), ax = axis.clone().normalize();
	const cross = new THREE.Vector3().crossVectors(an, bn);
	const dot = THREE.MathUtils.clamp(an.dot(bn), -1, 1);
	return Math.atan2(ax.dot(cross), dot);
}

const HORIZON_BIAS = 0.02;
const STAR_REALISM = { minDeg: 60, maxDeg: 120, minBright: 0.02 };
const ATMO = { color: 0x78b4ff, intensity: 0.6, power: 3.8, sunFactor: 0.5, scale: 1.015 };
const LOCAL_Y = new THREE.Vector3(0, 1, 0);

// single lat/lon->vec util for entire file
function latLonToVector3(latDeg, lonDeg, radius = 1) {
	const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
	return new THREE.Vector3(radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), -radius * Math.cos(lat) * Math.sin(lon));
}


function haversineMeters(lat1deg, lon1deg, lat2deg, lon2deg) {
	const toRad = THREE.MathUtils.degToRad;
	const φ1 = toRad(lat1deg), φ2 = toRad(lat2deg);
	const Δφ = φ2 - φ1;
	const Δλ = toRad(lon2deg - lon1deg);
	const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
	const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
	return EARTH_R_METERS * c;
}

function latLonAtScreen(clientX, clientY) {
	const hit = pickLatLonFromClient(clientX, clientY);
	if (!hit) return null;
	return { lat: hit.latDeg, lon: hit.lonDeg };
}

function currentCenterLatLon() {
	const p = raySphereCenterPoint();
	if (!p) return lastCenterLL;
	const { latDeg, lonDeg } = latLonFromWorldPoint(p);
	lastCenterLL = { lat: latDeg, lon: lonDeg };
	return lastCenterLL;
}

/** Estimate WebMercator zoom by measuring meters-per-pixel on the globe near screen center. */
function estimateMapZoom(centerOverride = null) {
	const center = centerOverride || currentCenterLatLon();
	const φ = THREE.MathUtils.degToRad(center.lat);

	// Small angular steps
	const d = 0.20; // degrees

	// Build 3 local points at the same radius
	const pC = latLonToVector3(center.lat, center.lon, R);
	const pE = latLonToVector3(center.lat, center.lon + d, R);
	const pN = latLonToVector3(center.lat + d, center.lon, R);

	// Project to screen
	const sC = worldToScreen(earth.localToWorld(pC.clone()));
	const sE = worldToScreen(earth.localToWorld(pE.clone()));
	const sN = worldToScreen(earth.localToWorld(pN.clone()));

	const pxEW = Math.hypot(sE.x - sC.x, sE.y - sC.y);
	const pxNS = Math.hypot(sN.x - sC.x, sN.y - sC.y);
	if (pxEW < 1e-3 || pxNS < 1e-3) return lastEstimatedZ;

	// True distances for those tiny steps
	const mEW = haversineMeters(center.lat, center.lon, center.lat, center.lon + d);
	const mNS = haversineMeters(center.lat, center.lon, center.lat + d, center.lon);

	// Average meters-per-pixel
	const mpp = 0.5 * (mEW / pxEW + mNS / pxNS);

	// WebMercator zoom (512px world)
	const z = Math.log2((Math.cos(φ) * 2 * Math.PI * EARTH_R_METERS) / (TILE_SIZE * mpp));
	lastEstimatedZ = THREE.MathUtils.clamp(z, 0, 22);
	return lastEstimatedZ;
}


let _handoffCooldownUntil = 0;
let _preMapCamDist = null;

function cameraDistanceToGlobeCenter() {
	const c = new THREE.Vector3(); globe.getWorldPosition(c);
	return camera.position.distanceTo(c);
}
function setCameraDistance(dist) {
	const c = new THREE.Vector3(); globe.getWorldPosition(c);
	const v = camera.position.clone().sub(c).normalize().multiplyScalar(dist);
	camera.position.copy(c.clone().add(v));
	camera.updateProjectionMatrix();
}

function normalizeLon(lon) {
	// Keep longitude in [-180, 180)
	let L = ((lon + 180) % 360 + 360) % 360 - 180;
	return Math.abs(L) < 1e-12 ? 0 : L;
}

function tryEnter2D() {
	if (map2dVisible) return;
	if (performance.now() < _handoffCooldownUntil) return;

	// Use cursor LL if you have it; otherwise fall back to current center
	const ll = (typeof handoffCenterLL === 'function') ? handoffCenterLL() : currentCenterLatLon();
	const zEst = (estimateMapZoom.length >= 1) ? estimateMapZoom(ll) : estimateMapZoom();

	if (zEst >= HANDOFF_Z_IN) showMap2D(ll, zEst);
}

// Web Mercator ground resolution (meters per CSS pixel) at latitude/zoom
function mercMetersPerPixel(latDeg, zoom) {
	const EQUATOR_CIRCUM_M = 40075016.68557849; // 2πR (R=6378137m)
	const latRad = THREE.MathUtils.degToRad(latDeg);
	// Clamp cos(lat) to avoid degeneracy near the poles
	const cosLat = Math.max(1e-6, Math.abs(Math.cos(latRad)));
	// 256 px tiles in MapLibre/Mapbox default schema
	return (EQUATOR_CIRCUM_M * cosLat) / (256 * Math.pow(2, zoom));
}


function buildMiniGlobeTelemetry() {

	const centerLL = currentCenterLatLon(); // { lat, lon }

	const in2D = !!(map2dVisible && typeof map2d?.getBearing === 'function');

	const refCenter = in2D
		? { lat: map2d.getCenter().lat, lon: normalizeLon(map2d.getCenter().lng) }
		: (typeof handoffCenterLL === 'function' ? handoffCenterLL() : currentCenterLatLon());

	const bearingDeg = in2D ? map2d.getBearing() : screenNorthBearingDegAt(refCenter);

	// SPEED (km/h): zero while 2D is visible
	const v_kms = (map2dVisible ? 0 : Math.abs(autorotateSpeed)) * SETTINGS.earthRadiusKm;
	const v_kmh = v_kms * 3600;

	// ALTITUDE (km):
	//  - 3D: true camera height above surface (existing behavior)
	//  - 2D: "equivalent height" that would show the same vertical ground span
	let altitudeKm;
	if (in2D && map2d) {
		// MapLibre zoom & center latitude → meters-per-pixel
		const c2 = map2d.getCenter();
		const zoom2d = map2d.getZoom();
		const mpp = mercMetersPerPixel(c2.lat, zoom2d);       // meters per CSS pixel

		// Use the actual visible container height for 2D
		const hPx = map2d.getContainer()?.clientHeight || window.innerHeight || 1080;

		// Reuse your 3D camera FOV for equivalence
		const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);

		// Vertical ground span on screen, then equivalent height from pinhole model
		const groundSpanMeters = mpp * hPx;
		const eqHeightMeters = groundSpanMeters / (2 * Math.tan(fovRad / 2));
		altitudeKm = Math.max(0, eqHeightMeters / 1000);
	} else {
		const dist = cameraDistanceToGlobeCenter();
		const surface = R * ATMO.scale;
		altitudeKm = Math.max(0, (dist - surface) * SETTINGS.earthRadiusKm);
	}

	// ----- SLOW: time (once per second) -----
	const now = new Date();
	const nowSec = Math.floor(now.getTime() / 1000);
	if (nowSec !== _teleCache.lastTimeSec) {
		_teleCache.lastTimeSec = nowSec;

		// UTC clock
		_teleCache.timeUTC =
			`${String(now.getUTCHours()).padStart(2, '0')}:` +
			`${String(now.getUTCMinutes()).padStart(2, '0')}:` +
			`${String(now.getUTCSeconds()).padStart(2, '0')}`;

		// Local clock (approx civil time derived from longitude; no DST DB)
		const lonEast = SunCalcUTC._mapLonToEast(centerLL.lon);
		const offsetMin = Math.round(((lonEast / 15) * 60) / 15) * 15; // nearest 15 min
		const localMs = now.getTime() + offsetMin * 60000;
		const t = new Date(localMs);
		_teleCache.timeLocal =
			`${String(t.getUTCHours()).padStart(2, '0')}:` +
			`${String(t.getUTCMinutes()).padStart(2, '0')}:` +
			`${String(t.getUTCSeconds()).padStart(2, '0')}`;
	}

	// ----- SLOW: location/country (when LL moves enough or every few seconds) -----
	const locDtMs = now - _teleCache.lastLocMs;
	const dLatLoc = Math.abs(centerLL.lat - _teleCache.lastLocLL.lat);
	const dLonLoc = Math.abs(centerLL.lon - _teleCache.lastLocLL.lon);
	if (locDtMs > LOCATION_MIN_INTERVAL_MS || dLatLoc > LL_EPS_LOC || dLonLoc > LL_EPS_LOC) {
		_teleCache.lastLocMs = now;
		_teleCache.lastLocLL = { ...centerLL };
		const country = countryAtLonLat(centerLL.lon, centerLL.lat);
		_teleCache.location = country?.name || 'N/A';
	}

	// ----- SLOW: sunset (local display to match the local clock) -----
	const sunDtMs = now - _teleCache.lastSunsetMs;
	const dLatSun = Math.abs(centerLL.lat - _teleCache.lastSunsetLL.lat);
	const dLonSun = Math.abs(centerLL.lon - _teleCache.lastSunsetLL.lon);
	if (sunDtMs > SUNSET_MIN_INTERVAL_MS || dLatSun > LL_EPS_SUNSET || dLonSun > LL_EPS_SUNSET) {
		_teleCache.lastSunsetMs = now;
		_teleCache.lastSunsetLL = { ...centerLL };

		_teleCache.sunset = SunCalcUTC.computeSunsetUTC(centerLL, now);
		// _teleCache.sunset = SunCalcUTC.computeSunsetSolar(centerLL, now);
	}

	return {
		mode: in2D ? '2d' : '3d',
		centerLL,                           // { lat, lon } (unchanged)
		bearingDeg,                         // number
		mapBearingDeg: in2D ? bearingDeg : undefined,
		location: _teleCache.location,      // throttled
		speedKmh: v_kmh,
		altitudeKm,
		timeUTC: _teleCache.timeUTC,        // "HH:MM:SS UTC"
		timeLocal: _teleCache.timeLocal,    // "HH:MM:SS LT"
		sunset: _teleCache.sunset,          // "HH:MM:SS LT" (local, zone-style)
		status: 'Online'
	};
}


const sunAutoCfg = {
	enabled: true,
	lastSec: -1
};

// SOLAR HELPERS
// -------------
function dayOfYearUTC(d) {
	const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
	return Math.floor((d - start) / 86400000);
}
function declinationRad(N) {
	return (23.44 * Math.PI / 180) * Math.sin((2 * Math.PI / 365) * (284 + N));
}
function equationOfTimeMin(N) {
	const B = 2 * Math.PI * (N - 81) / 364;
	return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}
// If you configured sunset.js to 'east' (default), this matches:
function lonEastDegrees(lonApp) {
	return ((lonApp + 180) % 360 + 360) % 360 - 180;
}

function updateSunFromSolarTimeOncePerSecond() {
	if (!SunLighting.enabled) return;

	const now = new Date();
	const sec = Math.floor(now.getTime() / 200);
	if (sec === SunLighting.lastSec) return;
	SunLighting.lastSec = sec;

	const centerLL = currentCenterLatLon();      // { lat, lon }
	const N = dayOfYearUTC(now);
	const dec = declinationRad(N);
	const eot = equationOfTimeMin(N);
	const lonE = lonEastDegrees(centerLL.lon);

	// Local Solar Time at center (hours)
	const lstHours = (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600)
		+ (lonE / 15) + (eot / 60);

	// Hour angle H (radians)
	const H = (Math.PI / 12) * (lstHours - 12);

	// Sun direction in your globe axes: x=0° lon, y=north, z=+90°E
	const cosd = Math.cos(dec), sind = Math.sin(dec);
	const sunDir = new THREE.Vector3(
		cosd * Math.cos(H),
		sind,
		cosd * Math.sin(H)
	).normalize();

	dirLight.position.copy(sunDir).multiplyScalar(SunLighting.radius);
	dirLight.visible = true;
	dirLight.target?.position.set(0, 0, 0);
	dirLight.target?.updateMatrixWorld();

	atmoUniforms.sunDirW.value.copy(dirLight.position).normalize();
}




// ---------- Renderer / Scene / Camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 8000);
const INITIAL_DISTANCE = 3.2;
camera.position.set(0, 0, INITIAL_DISTANCE);

// ---------- Lights ----------
const dirLight = new THREE.DirectionalLight(0xffffff, 0.0); // start disabled by default
dirLight.position.set(5, 3, 5);
const ambLight = new THREE.AmbientLight(0x404040, 1.0);
scene.add(dirLight, ambLight);

// ---------- Texture loader ----------
const loader = new THREE.TextureLoader();
const cache = new Map();
function loadTexture(url) {
	return new Promise((resolve, reject) => {
		if (cache.has(url)) return resolve(cache.get(url));
		loader.load(url, tex => {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.anisotropy = renderer.capabilities.anisotropy;
			tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
			cache.set(url, tex); resolve(tex);
		}, undefined, reject);
	});
}


// ---------- Globe ----------
const globe = new THREE.Group(); scene.add(globe);
const R = 1;

// 4k x 2k overlay (tune as needed)
const selCanvas = document.createElement('canvas');
selCanvas.width = 4096;
selCanvas.height = 2048;

const selCtx = selCanvas.getContext('2d');
const selTex = new THREE.CanvasTexture(selCanvas);
selTex.colorSpace = THREE.SRGBColorSpace;

selTex.generateMipmaps = true;
selTex.minFilter = THREE.LinearMipmapLinearFilter;
selTex.magFilter = THREE.LinearFilter;
selTex.wrapS = THREE.ClampToEdgeWrapping;
selTex.wrapT = THREE.ClampToEdgeWrapping;

selTex.anisotropy = renderer.capabilities.anisotropy;


const selectedOverlay = new THREE.Mesh(
	new THREE.SphereGeometry(R * 1.004, 96, 96),
	new THREE.MeshBasicMaterial({
		map: selTex,
		transparent: true,
		depthTest: true,
		depthWrite: false
	})
);


const OVERLAY_BASE = 1.004;     // what the geometry was built with
const OVERLAY_TARGET = 1.0013;  // try 1.0010–1.0016 for your taste

selectedOverlay.scale.setScalar(OVERLAY_TARGET / OVERLAY_BASE);

const mat = selectedOverlay.material;
mat.polygonOffset = true;
mat.polygonOffsetFactor = -1;
mat.polygonOffsetUnits = -1;
mat.alphaTest = 0.02;           // trims the subtle AA fringe
mat.needsUpdate = true;


selectedOverlay.material.alphaTest = 0.02;   // trims fuzzy 1–2% alpha fringe
selectedOverlay.material.needsUpdate = true;

selectedOverlay.renderOrder = 0.5; // globe(0) < overlay(1.5) < clouds(1) if you want clouds above, set to 0.5 instead





globe.add(selectedOverlay);

function sizeSelectionOverlayToDPR() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // cap if needed
	// keep 2:1 aspect, power-of-two for nice mipmaps
	const targetW = Math.min(8192, Math.max(2048, Math.pow(2, Math.round(Math.log2(renderer.domElement.clientWidth * dpr * 2)))));
	const targetH = targetW / 2;
	if (selCanvas.width !== targetW || selCanvas.height !== targetH) {
		selCanvas.width = targetW;
		selCanvas.height = targetH;
		selTex.needsUpdate = true;
	}
}
sizeSelectionOverlayToDPR();
window.addEventListener('resize', sizeSelectionOverlayToDPR);

function clearSelectionOverlay() {
	selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
	selTex.needsUpdate = true;
}

function lonLatToPx(lon, lat) {
	const x = ((lon + 180) / 360) * selCanvas.width;
	const y = ((90 - lat) / 180) * selCanvas.height;
	return [x, y];
}

// Draw one polygon (outer + holes) at an optional X offset for seam handling
function drawPolygon(poly, xOffset = 0) {
	const path = new Path2D();
	for (let r = 0; r < poly.length; r++) {
		const ring = poly[r];
		for (let i = 0; i < ring.length; i++) {
			const [lon, lat] = ring[i];
			const [x, y] = lonLatToPx(lon, lat);
			if (i === 0) path.moveTo(x + xOffset, y);
			else path.lineTo(x + xOffset, y);
		}
		path.closePath();
	}
	return path;
}

function paintSelectionToOverlay(country, opts) {
	// opts: { fillRGBA?: [r,g,b,a], strokeRGBA?: [r,g,b,a], strokePx?: number }
	clearSelectionOverlay();
	if (!country?.polygons?.length) return;

	const refLon = country.centroid?.lon ?? 0;

	// Unwrap rings around the centroid so we don't cross the dateline
	const polys = country.polygons.map(poly => poly.map(ring => unwrapRingToRef(ring, refLon)));

	// Optionally draw twice shifted by ±width to catch seam overlap
	const shifts = [0, -selCanvas.width, selCanvas.width];

	for (const poly of polys) {
		for (const shift of shifts) {
			const path = drawPolygon(poly, shift);

			if (opts.fillRGBA) {
				const [fr, fg, fb, fa] = opts.fillRGBA;
				selCtx.fillStyle = `rgba(${fr},${fg},${fb},${fa})`;
				selCtx.fill(path, 'evenodd');
			}
			if (opts.strokeRGBA) {
				const [sr, sg, sb, sa] = opts.strokeRGBA;
				selCtx.lineWidth = opts.strokePx ?? 2;
				selCtx.strokeStyle = `rgba(${sr},${sg},${sb},${sa})`;
				selCtx.stroke(path);
			}
		}
	}
	selTex.needsUpdate = true;
}

let _autoSpinWasEnabled = false;

function pauseAutoSpin() {
	// if you have a boolean flag, use it; otherwise zero the velocity
	if (typeof autoSpinEnabled !== 'undefined') {
		_autoSpinWasEnabled = !!autoSpinEnabled;
		autoSpinEnabled = false;
	}
	if (typeof spinVel !== 'undefined' && spinVel?.set) spinVel.set(0, 0, 0);
}

function resumeAutoSpin() {
	if (typeof autoSpinEnabled !== 'undefined') {
		autoSpinEnabled = _autoSpinWasEnabled;
	}
}



// ---------- Controls (zoom only) ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enablePan = false;
controls.enableZoom = true;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
// Zoom around cursor (r152+). Harmless no-op if property not present.
if ('zoomToCursor' in controls) controls.zoomToCursor = true;
if ('screenSpacePanning' in controls) controls.screenSpacePanning = true;

controls.target.set(0, 0, 0);


// --- Keep the visual center fixed while allowing zoom-to-cursor ---
// OrbitControls will nudge `controls.target` toward the mouse to keep the
// point under the cursor stationary during a dolly. That breaks our
// "camera looks at origin" assumption. We counteract by moving the camera
// by the same offset and resetting target to the origin.
const _ZERO = new THREE.Vector3(0, 0, 0);
let _relocking = false;

controls.addEventListener('change', () => {
	if (_relocking) return;
	if (!controls.target.equals(_ZERO)) {
		_relocking = true;
		const off = controls.target.clone();
		controls.target.copy(_ZERO);
		camera.position.sub(off);         // counter-move camera by the same offset
		// camera.updateProjectionMatrix(); // (not needed unless FOV/aspect changes)
		_relocking = false;
	}
});




const SURFACE = R * ATMO.scale;
controls.minDistance = SURFACE + 0.15;
controls.maxDistance = 20;

controls.addEventListener('change', () => {
	if (!map2dVisible && performance.now() >= _handoffCooldownUntil) {
		const ll = handoffCenterLL();
		tryEnter2D();
	}
});


const earthMatLit = new THREE.MeshPhongMaterial({ shininess: 5, specular: new THREE.Color(0x333333), color: 0xffffff, transparent: false, opacity: 1 });
const earthMatUnlit = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: false, opacity: 1 });
let earthActiveMat = earthMatUnlit;

const earthGeom = new THREE.SphereGeometry(R, 96, 96);
const earth = new THREE.Mesh(earthGeom, earthActiveMat); earth.renderOrder = 0; globe.add(earth);

// Clouds
const cloudsGeom = new THREE.SphereGeometry(R * 1.01, 96, 96);
const clouds = new THREE.Mesh(cloudsGeom, new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.6, depthWrite: true, alphaTest: 0.01 }));
clouds.renderOrder = 1; globe.add(clouds);

// Atmosphere shader
const atmoGeom = new THREE.SphereGeometry(R * ATMO.scale, 96, 96);
const atmoUniforms = {
	color: { value: new THREE.Color(ATMO.color) }, colorA: { value: 1.0 },
	intensity: { value: ATMO.intensity }, power: { value: ATMO.power },
	sunFactor: { value: ATMO.sunFactor }, sunDirW: { value: new THREE.Vector3(1, 0, 0) }
};
const atmoMat = new THREE.ShaderMaterial({
	uniforms: atmoUniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
	vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
	fragmentShader: `uniform vec3 color; uniform float colorA; uniform float intensity; uniform float power; uniform float sunFactor; uniform vec3 sunDirW;
        varying vec3 vN; varying vec3 vW;
        void main(){ vec3 N=normalize(vN); vec3 V=normalize(cameraPosition - vW);
          float rim=pow(clamp(1.0 - dot(N,V),0.0,1.0), power);
          float day=max(dot(N, normalize(sunDirW)),0.0);
          float a=intensity * rim * mix(1.0, day, clamp(sunFactor,0.0,1.0));
          gl_FragColor=vec4(color * (a*colorA), a*colorA);
        }`
});
const atmosphere = new THREE.Mesh(atmoGeom, atmoMat); atmosphere.renderOrder = 2; globe.add(atmosphere);

// Stars
let sky = null, skyMaterial = null, skyBaseBrightness = 0.03;
async function ensureSky() {
	if (sky) return sky;
	const skyTex = await loadTexture(SETTINGS.skyTexture);
	skyMaterial = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false });
	sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 60, 40), skyMaterial);
	sky.renderOrder = -1; scene.add(sky);
	return sky;
}
function computeAutoDimBrightness() {
	const base = skyBaseBrightness;
	if (!skyMaterial) return base;
	return base;
}
function applySkyBrightness() {
	if (!skyMaterial) return;
	const eff = computeAutoDimBrightness();
	skyMaterial.color.setScalar(eff);
	document.getElementById('sky-bright-readout').textContent = Math.round(skyBaseBrightness * 100) + '%';
}

// Borders (lines)
const bordersGroup = new THREE.Group(); bordersGroup.visible = false; globe.add(bordersGroup);
let bordersMaterial = null, pendingBordersColor = 0xffffff, pendingBordersAlpha = 0.75;


// --- Selected country highlight (outline) ---
const selectedBordersGroup = new THREE.Group();
selectedBordersGroup.visible = false;
globe.add(selectedBordersGroup);

function clearSelectedBorders() {
	selectedBordersGroup.clear();
	selectedBordersGroup.visible = false;
}

function buildCountryBordersGeometry(rings, radius = R * 1.004) {
	const positions = [];
	for (const ring of rings) {
		for (let i = 0; i < ring.length - 1; i++) {
			const [lonA, latA] = ring[i];
			const [lonB, latB] = ring[i + 1];
			const a = latLonToVector3(latA, lonA, radius);
			const b = latLonToVector3(latB, lonB, radius);
			positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
	return geom;
}

function highlightCountry(country, rgb = 0xffd34a, alpha = 0.8) {
	clearSelectedBorders();
	if (!country || !country.rings?.length) return;

	// core outline
	const OUTLINE_R = R * 1.0016;
	const coreGeom = buildCountryBordersGeometry(country.rings, OUTLINE_R);
	const coreMat = new THREE.LineBasicMaterial({
		color: rgb,
		transparent: alpha < 1,
		opacity: alpha,
		depthTest: true,
		depthWrite: true
	});
	const core = new THREE.LineSegments(coreGeom, coreMat);
	core.renderOrder = 6;

	selectedBordersGroup.add(core);
	selectedBordersGroup.visible = true;
}



// Handle 2D map clicks
function handle2DMapClick(e) {
	const { lat, lng: lon } = e.lngLat;
	const country = countryAtLonLat(lon, lat);

	if (country) {
		const countryName = country.feature.properties.ADMIN;
		const sovereignCountryName = country.feature.properties.SOVEREIGNT;
		const subRegion = country.feature.properties.SUBREGION;
		const iso_a2 = country.feature.properties.ISO_A2;

		showPicked(lat, lon, {
			title: countryName,
			titleSuffix: sovereignCountryName,
			subTitle: subRegion,
			iso_a2: iso_a2
		});

		lastSelectedCountry = country;
		applySelectionStyling();
	}
}



// --- Selected country fill (triangulated on tangent plane) ---
const selectedFillGroup = new THREE.Group();
selectedFillGroup.visible = false;
globe.add(selectedFillGroup);

function clearSelectedFill() {
	selectedFillGroup.clear();
	selectedFillGroup.visible = false;
}

function tangentFrameAt(latDeg, lonDeg) {
	const n = latLonToVector3(latDeg, lonDeg, 1).normalize();
	const upRef = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
	const u = new THREE.Vector3().crossVectors(upRef, n).normalize();
	const v = new THREE.Vector3().crossVectors(n, u).normalize();
	const origin = n.clone().multiplyScalar(R * 1.002); // slightly above surface
	return { n, u, v, origin };
}
function projectRingTo2D(ring, frame) {
	const out = [];
	for (const [lon, lat] of ring) {
		const p = latLonToVector3(lat, lon, R * 1.002);
		const rel = p.sub(frame.origin);
		out.push(new THREE.Vector2(rel.dot(frame.u), rel.dot(frame.v)));
	}
	return out;
}
function buildCountryFillGeometry(country) {
	const positions = [];
	for (const poly of (country.polygons || [])) {
		if (!poly.length) continue;
		const { lat, lon } = centroidOfRings([poly[0]]);
		const frame = tangentFrameAt(lat, lon);
		const contour2 = projectRingTo2D(poly[0], frame);
		const holes2 = poly.slice(1).map(r => projectRingTo2D(r, frame));
		const tris = THREE.ShapeUtils.triangulateShape(contour2, holes2);
		const verts2 = contour2.concat(...holes2);

		const to3D = (v2) => {
			const p = frame.origin.clone()
				.add(frame.u.clone().multiplyScalar(v2.x))
				.add(frame.v.clone().multiplyScalar(v2.y))
				.normalize().multiplyScalar(R * 1.002);
			return p;
		};
		for (const [ia, ib, ic] of tris) {
			const a = to3D(verts2[ia]);
			const b = to3D(verts2[ib]);
			const c = to3D(verts2[ic]);
			positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
		}
	}
	if (!positions.length) return null;
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
	return geom;
}
function fillCountry(country, rgb = 0x00c8ff, alpha = 0.25) {
	clearSelectedFill();
	if (!country?.polygons?.length) return;
	const geom = buildCountryFillGeometry(country);
	if (!geom) return;
	const mat = new THREE.MeshBasicMaterial({
		color: rgb,
		transparent: true,
		opacity: alpha,
		depthTest: true,
		depthWrite: false,
		side: THREE.DoubleSide
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.renderOrder = 4;
	selectedFillGroup.add(mesh);
	selectedFillGroup.visible = true;
}




// Country index for queries
let COUNTRY_INDEX = null;  // array of { name, names[], iso2, iso3, centroid:{lat,lon}, bboxes:[...], rings:[[ [lon,lat], ... ] ...], feature }
let countryGeo = null;

function unwrapRingToRef(ring, refLon) {
	const out = []; if (ring.length === 0) return out;
	let prev = ring[0][0];
	// shift ref near first
	let testLon = refLon;
	while (testLon - prev > 180) testLon -= 360;
	while (prev - testLon > 180) testLon += 360;
	let base = prev;
	out.push([base, ring[0][1]]);
	for (let i = 1; i < ring.length; i++) {
		let lon = ring[i][0];
		let d = lon - prev;
		while (d > 180) { lon -= 360; d = lon - prev; }
		while (d < -180) { lon += 360; d = lon - prev; }
		out.push([lon, ring[i][1]]);
		prev = lon;
	}
	return out;
}
function pointInRing(lon, lat, ring) {
	// Ray casting on unwrapped ring (lon as x, lat as y)
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0], yi = ring[i][1];
		const xj = ring[j][0], yj = ring[j][1];
		const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-30) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
}
function pointInRings(lon, lat, rings) {
	// Even-odd across all rings (outer + holes) with unwrap around point
	for (const r of rings) {
		const ur = unwrapRingToRef(r, lon);
		if (pointInRing(lon, lat, ur)) return true;
	}
	return false;
}
function centroidOfRings(rings) {
	// Rough spherical centroid: average unit vectors of all vertices
	let sx = 0, sy = 0, sz = 0, n = 0;
	for (const ring of rings) {
		for (const [lon, lat] of ring) {
			const v = latLonToVector3(lat, lon, 1).normalize();
			sx += v.x; sy += v.y; sz += v.z; n++;
		}
	}
	if (!n) return { lat: 0, lon: 0 };
	const v = new THREE.Vector3(sx / n, sy / n, sz / n).normalize();
	const lat = Math.asin(v.y);
	const lon = Math.atan2(-v.z, v.x);
	return { lat: deg(lat), lon: deg(lon) };
}
function bboxOfRings(rings) {
	let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
	for (const ring of rings) {
		for (const [lon, lat] of ring) {
			minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
			minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
		}
	}
	return { minLat, maxLat, minLon, maxLon };
}
function namesFromProps(p) {
	const cands = [p.NAME, p.ADMIN, p.NAME_LONG, p.NAME, p.BRK_NAME, p.FORMAL_EN, p.ABBREV, p.SOVEREIGNT].filter(Boolean);
	return Array.from(new Set(cands));
}

async function ensureCountryIndex() {
	if (COUNTRY_INDEX) return COUNTRY_INDEX;
	const res = await fetch(SETTINGS.bordersGeoJSON);
	if (!res.ok) throw new Error(`Failed to load countries: ${res.status}`);
	countryGeo = await res.json();
	const idx = [];
	for (const f of countryGeo.features) {
		if (!f.geometry) continue;
		const ringsCollection = [];
		if (f.geometry.type === 'Polygon') {
			ringsCollection.push(f.geometry.coordinates); // array of rings
		} else if (f.geometry.type === 'MultiPolygon') {
			for (const poly of f.geometry.coordinates) ringsCollection.push(poly);
		} else continue;

		// Flatten rings: concatenate all polygon rings (outer + holes); for point-in, we use even-odd over all.
		const flatRings = [];
		for (const rings of ringsCollection) {
			for (const ring of rings) flatRings.push(ring);
		}
		const centroid = centroidOfRings(flatRings);
		const bbox = bboxOfRings(flatRings);
		const names = namesFromProps(f.properties);

		idx.push({
			name: names[0] || '—',
			names: names.map(s => String(s)),
			iso2: f.properties.ISO_A2 || f.properties.ISO2 || null,
			iso3: f.properties.ISO_A3 || f.properties.ISO3 || null,
			centroid,
			bbox,
			rings: flatRings,
			polygons: ringsCollection.map(poly => poly.map(ring => ring.slice())), // <— add this
			feature: f
		});

	}
	COUNTRY_INDEX = idx;
	return COUNTRY_INDEX;
}

async function loadBorders(url) {
	// Use index data if already loaded to avoid double fetching
	if (!countryGeo) {
		await ensureCountryIndex();
	}
	const geo = countryGeo;
	const positions = [];
	function pushRing(ring, radius = R * 1.002) {
		for (let i = 0; i < ring.length - 1; i++) {
			const [lonA, latA] = ring[i], [lonB, latB] = ring[i + 1];
			const a = latLonToVector3(latA, lonA, radius), b = latLonToVector3(latB, lonB, radius);
			positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
		}
	}
	for (const f of geo.features) {
		const g = f.geometry; if (!g) continue;
		if (g.type === 'Polygon') for (const ring of g.coordinates) pushRing(ring);
		else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) pushRing(ring);
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
	bordersMaterial = new THREE.LineBasicMaterial({ color: pendingBordersColor, transparent: true, opacity: pendingBordersAlpha, depthTest: true, depthWrite: true });
	const lines = new THREE.LineSegments(geom, bordersMaterial); lines.frustumCulled = false; bordersGroup.add(lines);
}

function setBordersColorAndAlpha(rgbInt, a01) {
	pendingBordersColor = rgbInt; pendingBordersAlpha = a01;
	if (bordersMaterial) { bordersMaterial.color.setHex(rgbInt); bordersMaterial.opacity = a01; bordersMaterial.needsUpdate = true; }
}

// Graticule
const graticuleGroup = new THREE.Group(); graticuleGroup.visible = false; globe.add(graticuleGroup);
let graticuleMat = null; let graticuleRGB = 0xcccccc, graticuleA = 0.35;
function buildGraticule({ latStep = 10, lonStep = 10, segStep = 2 } = {}) {
	if (graticuleGroup.children.length) return;
	const positions = [];
	function addPolyline(points) { for (let i = 0; i < points.length - 1; i++) { const a = points[i], b = points[i + 1]; positions.push(a.x, a.y, a.z, b.x, b.y, b.z); } }
	for (let lat = -80; lat <= 80; lat += latStep) { const pts = []; for (let lon = -180; lon <= 180; lon += segStep) pts.push(latLonToVector3(lat, lon, R * 1.001)); addPolyline(pts); }
	for (let lon = -180; lon < 180; lon += lonStep) { const pts = []; for (let lat = -89; lat <= 89; lat += segStep) pts.push(latLonToVector3(lat, lon, R * 1.001)); addPolyline(pts); }
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
	graticuleMat = new THREE.LineBasicMaterial({ color: graticuleRGB, transparent: true, opacity: graticuleA, depthTest: true, depthWrite: true });
	const mesh = new THREE.LineSegments(geom, graticuleMat); mesh.frustumCulled = false; graticuleGroup.add(mesh);
}
function setGraticuleColorAlpha(rgbInt, a01) {
	graticuleRGB = rgbInt; graticuleA = a01;
	if (graticuleMat) { graticuleMat.color.setHex(rgbInt); graticuleMat.opacity = a01; graticuleMat.needsUpdate = true; }
}

// ---- Markers ----
const markersRoot = document.getElementById('markers-root');
function worldToScreen(vec3) {
	const v = vec3.clone().project(camera);
	return { x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth, y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight, z: v.z };
}
const MarkerManager = (() => {
	const byId = new Map(); let visible = true;
	function makeEl(label) { const el = document.createElement('div'); el.className = 'marker'; el.textContent = label ?? 'Marker'; markersRoot.appendChild(el); return el; }
	function addMarker(id, { lat, lon, label, elevate = 0.012 } = {}) { removeMarker(id); byId.set(id, { lat, lon, label, elevate, el: makeEl(label) }); }
	function removeMarker(id) { const m = byId.get(id); if (m) { m.el.remove(); byId.delete(id); } }
	function clear() { for (const id of Array.from(byId.keys())) removeMarker(id); }
	function setVisible(flag) { visible = !!flag; markersRoot.style.display = visible ? 'block' : 'none'; }
	const tmpCenter = new THREE.Vector3(), tmpCam = new THREE.Vector3();
	function isFrontFacing(pointWorld) {
		camera.getWorldPosition(tmpCam); globe.getWorldPosition(tmpCenter);
		const normal = pointWorld.clone().sub(tmpCenter).normalize();
		const view = tmpCam.clone().sub(pointWorld).normalize();
		return normal.dot(view) > HORIZON_BIAS;
	}
	function update() {
		if (!visible) return; earth.updateMatrixWorld(true);
		for (const m of byId.values()) {
			const surfLocal = latLonToVector3(m.lat, m.lon, R);
			const surfWorld = surfLocal.clone().applyMatrix4(earth.matrixWorld);
			if (!isFrontFacing(surfWorld)) { m.el.classList.add('hidden'); continue; }
			const aboveLocal = latLonToVector3(m.lat, m.lon, R * (1 + m.elevate));
			const aboveWorld = aboveLocal.applyMatrix4(earth.matrixWorld);
			const { x, y } = worldToScreen(aboveWorld);
			m.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
			m.el.classList.remove('hidden');
		}
	}
	return { addMarker, removeMarker, clear, update, setVisible };
})();


/*
MarkerManager.addMarker('lisbon', { lat: 38.7223, lon: -9.1393, label: 'Lisbon' });
MarkerManager.addMarker('newyork', { lat: 40.7128, lon: -74.0060, label: 'New York' });
MarkerManager.addMarker('tokyo', { lat: 35.6762, lon: 139.6503, label: 'Tokyo' });
*/


// -------- Layout Manager --------------
// ---------- Callout (edge panel + leader line + anchor dot) ----------
const Callout = (() => {

	let active = false;
	let lat = 0, lon = 0, elevate = 0.012;   // small lift above surface for the anchor point
	let lineEl = null, dotEl = null;

	const tmpCenter = new THREE.Vector3(), tmpCam = new THREE.Vector3(), globeCenterW = new THREE.Vector3();

	function isFrontFacing(worldPoint) {
		camera.getWorldPosition(tmpCam); globe.getWorldPosition(tmpCenter);
		const normal = worldPoint.clone().sub(tmpCenter).normalize();
		const view = tmpCam.clone().sub(worldPoint).normalize();
		return normal.dot(view) > HORIZON_BIAS;
	}

	function ensureLine() {
		if (!lineEl) {
			lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			lineEl.setAttribute('stroke', 'rgba(255,255,255,0.65)');
			lineEl.setAttribute('stroke-width', '1.0');
			lineEl.setAttribute('stroke-linecap', 'round');
			calloutSvg.appendChild(lineEl);
		}
		if (!dotEl) {
			dotEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			dotEl.setAttribute('r', '3.0');  // dot size
			dotEl.setAttribute('fill', 'white');
			dotEl.setAttribute('stroke', 'rgba(0,0,0,0.5)');
			dotEl.setAttribute('stroke-width', '1');
			calloutSvg.appendChild(dotEl);
		}
		return lineEl;
	}

	/*
	function buildHTML({ calloutText: calloutText, lines }) {

		const coordinates = (lines || []).map(s => `<div class="calloutNotes">${s}</div>`).join('');

		const titleSuffix = calloutText.titleSuffix && (calloutText.title && calloutText.titleSuffix !== calloutText.title) ? `<span class="callOutTitleSuffix">, ${calloutText.titleSuffix}</span>` : "";
		const title = calloutText.title ? `<div class="calloutTitle">${calloutText.title}${titleSuffix}</div>` : "";
		const subTitle = calloutText.subTitle ? `<div class="calloutSubTitle">${calloutText.subTitle}</div>` : "";
		const notes = coordinates ? coordinates : "";

		const flag = calloutText.iso_a2 ? `<div class="calloutFlag"><img src="./api/flag/${calloutText.iso_a2.toLowerCase()}" /></div>` : "";

		return `
			${flag}
			${title}
			<div class="sep"></div>
			${subTitle}
			${notes}
		`;
	}
	*/

	function buildHTML({ calloutText: calloutText, lines }) {
		const coordinates = (lines || []).map(s => `<div class="calloutNotes">${s}</div>`).join('');

		const titleSuffix = calloutText.titleSuffix &&
			(calloutText.title && calloutText.titleSuffix !== calloutText.title)
			? `<span class="callOutTitleSuffix">, ${calloutText.titleSuffix}</span>` : "";

		const title = calloutText.title ? `<div class="calloutTitle">${calloutText.title}${titleSuffix}</div>` : "";
		const subTitle = calloutText.subTitle ? `<div class="calloutSubTitle">${calloutText.subTitle}</div>` : "";
		const notes = coordinates || "";

		// ⬇️ Replace <img> with a mount for WavingFlag
		const iso = (calloutText.iso_a2 || '').toString().trim().toUpperCase();
		const flag = iso
			? `<div class="calloutFlag">
				<div class="flag-mount" data-iso="${iso}" data-px="100"></div>
			</div>`
			: "";

		return `
			${flag}
			${title}
			<div class="sep"></div>
			${subTitle}
			${notes}
		`;
	}


	function addCloseButton() {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.setAttribute('aria-label', 'Close marker');
		btn.title = 'Close';
		btn.textContent = '×';
		Object.assign(btn.style, {
			position: 'absolute',
			top: '6px',
			right: '6px',
			width: '20px',
			height: '20px',
			lineHeight: '18px',
			textAlign: 'center',
			border: 'none',
			borderRadius: '999px',
			background: 'transparent',
			color: '#fff',
			fontSize: '14px',
			cursor: 'pointer',
			opacity: '0.85',
			padding: '0',
		});
		btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
		btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.85'));
		btn.addEventListener('click', (ev) => { ev.stopPropagation(); hide(); });
		calloutEl.appendChild(btn);
	}


	function show({ lat: la, lon: lo, calloutText: calloutText, lines }) {
		// update coords
		lat = la; lon = lo;

		// Clean up previous flag instances for this callout
		if (calloutEl.__flagInstances) {
			calloutEl.__flagInstances.forEach(inst => inst?.destroy?.());
			calloutEl.__flagInstances = null;
		}

		// Inject HTML (emits .flag-mount if iso_a2 exists)
		calloutEl.innerHTML = buildHTML({ calloutText: calloutText, lines });

		// Make the callout visible BEFORE measuring/initializing the flags
		calloutEl.style.display = 'block';

		// Defer flag init one frame so layout is up-to-date
		requestAnimationFrame(() => {
			const mounts = calloutEl.querySelectorAll('.flag-mount');
			const instances = [];

			mounts.forEach(m => {
				const px = parseInt(m.dataset.px, 10) || 600;

				// Container controls size (target is 4:3). Explicit height avoids 0-height edge cases.
				m.style.width = px + 'px';
				m.style.height = Math.round(px * 3 / 4) + 'px';   // 4:3
				if (!m.style.position) m.style.position = 'relative';
				if (!m.style.display) m.style.display = 'block';

				const inst = new WavingFlag(m, {
					transparent: true,
					showPole: false,

					// Container-controlled sizing
					tightCanvas: false,
					fitMargin: 1.10,

					// Geometry & wave
					flagWidth: 4,
					flagHeight: 3,
					segments: 256,
					animationSpeed: 4,
					frequency: { x: 4, y: 3 },
					strength: 0.10,

					// Placement nudges
					offsetXFrac: -0.165,
					offsetYFrac: 0.11,

					crossOrigin: 'anonymous',
					svgUrl: `./api/flag/${(m.dataset.iso || '').toUpperCase()}`
				});

				instances.push(inst);
			});

			// Keep refs to clean up next time
			calloutEl.__flagInstances = instances;

			// In case other layout code adjusts sizes after this, trigger a resize pass
			window.dispatchEvent(new Event('resize'));
		});

		// UI wiring
		addCloseButton();
		ensureLine();
		sizeCalloutSvgToViewport();
		
		active = true;
		update(true);
	}





	function hide() {

		active = false;
		calloutEl.style.display = "none";

		if (lineEl) { lineEl.setAttribute('x1', '0'); lineEl.setAttribute('y1', '0'); lineEl.setAttribute('x2', '0'); lineEl.setAttribute('y2', '0'); }
		if (dotEl) dotEl.setAttribute('r', '0');

		// remove selection visuals
		clearSelectedBorders();
		clearSelectedFill();
		clearSelectionOverlay();

		lastSelectedCountry = null;

		syncSelectionTo2D();

		if (calloutEl.__flagInstances) {
			calloutEl.__flagInstances.forEach(inst => inst?.destroy?.());
			calloutEl.__flagInstances = null;
		}		
	}

	function update(force = false) {
		if (!active) return;

		// Anchor: surface & slightly above for clarity
		const surfLocal = latLonToVector3(lat, lon, R);
		const aboveLocal = latLonToVector3(lat, lon, R * (1 + elevate));

		earth.updateMatrixWorld(true);
		const surfWorld = surfLocal.clone().applyMatrix4(earth.matrixWorld);
		const aboveWorld = aboveLocal.applyMatrix4(earth.matrixWorld);

		const front = isFrontFacing(surfWorld);
		if (!front) {
			// Temporarily hide, but keep active so it can reappear when it rotates back
			calloutEl.style.display = 'none';
			if (lineEl) {
				lineEl.setAttribute('x1', '0'); lineEl.setAttribute('y1', '0');
				lineEl.setAttribute('x2', '0'); lineEl.setAttribute('y2', '0');
			}
			if (dotEl) dotEl.setAttribute('r', '0');
			return;
		}
		calloutEl.style.display = 'block';
		ensureLine();
		window.dispatchEvent(new Event('resize'));

		
		// --- Compute globe center and screen-space radius along the anchor direction ---
		earth.getWorldPosition(globeCenterW);
		const centerPx = worldToScreen(globeCenterW);
		const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
		const edgeWorld = globeCenterW.clone().add(camRight.multiplyScalar(R * ATMO.scale));
		const edgePx = worldToScreen(edgeWorld);
		const radiusPx = Math.hypot(edgePx.x - centerPx.x, edgePx.y - centerPx.y);

		// FIXED ANCHOR: Screen coords for the geographic point (never smoothed)
		const a = worldToScreen(aboveWorld); // anchor px - always exact
		const vw = renderer.domElement.clientWidth;
		const vh = renderer.domElement.clientHeight;
		const PAD = radiusPx * 0.25;
		const GAP = radiusPx * 0.25;
		const MAX_TOP = vh - PAD - calloutEl.offsetHeight;

		// Direction from center to anchor in screen space
		let vx = a.x - centerPx.x, vy = a.y - centerPx.y;
		const len = Math.hypot(vx, vy);
		if (len < 1e-3) {
			vx = (a.x < vw * 0.5) ? -1 : 1; vy = 0;
		} else {
			vx /= len; vy /= len;
		}

		// Calculate TARGET position for the panel (where we want the panel to be)
		const px = centerPx.x + vx * (radiusPx + GAP);
		const py = centerPx.y + vy * (radiusPx + GAP);

		const panelW = calloutEl.offsetWidth || 280;
		const panelH = calloutEl.offsetHeight || 120;
		let targetLeftPx;
		if (vx >= 0) {
			targetLeftPx = Math.min(vw - PAD - panelW, Math.max(PAD, px));
		} else {
			targetLeftPx = Math.min(vw - PAD, Math.max(PAD, px - panelW));
		}
		const targetTopPx = Math.min(MAX_TOP, Math.max(PAD, py - panelH / 2));

		// SMOOTH PANEL MOVEMENT: Only interpolate the panel position, not the anchor
		if (!update.currentLeft) update.currentLeft = targetLeftPx;
		if (!update.currentTop) update.currentTop = targetTopPx;

		// Damping factor - adjust this to control panel smoothness
		const DAMPING = 0.03; // Similar to OrbitControls dampingFactor

		// Smoothly interpolate panel position toward target
		update.currentLeft += (targetLeftPx - update.currentLeft) * DAMPING;
		update.currentTop += (targetTopPx - update.currentTop) * DAMPING;

		// Apply the smoothed position to the panel
		calloutEl.style.left = `${Math.round(update.currentLeft)}px`;
		calloutEl.style.right = '';
		calloutEl.style.top = `${Math.round(update.currentTop)}px`;

		// Line connects FIXED anchor point to center of nearest panel side
		const r = calloutEl.getBoundingClientRect();

		// Calculate the center points of each side
		const leftCenter = { x: r.left, y: r.top + r.height / 2 };
		const rightCenter = { x: r.right, y: r.top + r.height / 2 };
		const topCenter = { x: r.left + r.width / 2, y: r.top };
		const bottomCenter = { x: r.left + r.width / 2, y: r.bottom };

		// Calculate distances from anchor point to each side center
		const distToLeft = Math.hypot(a.x - leftCenter.x, a.y - leftCenter.y);
		const distToRight = Math.hypot(a.x - rightCenter.x, a.y - rightCenter.y);
		const distToTop = Math.hypot(a.x - topCenter.x, a.y - topCenter.y);
		const distToBottom = Math.hypot(a.x - bottomCenter.x, a.y - bottomCenter.y);

		// Find which side center is closest
		const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

		let x2, y2;
		if (minDist === distToLeft) {
			// Connect to middle of left side
			x2 = leftCenter.x;
			y2 = leftCenter.y;
		} else if (minDist === distToRight) {
			// Connect to middle of right side
			x2 = rightCenter.x;
			y2 = rightCenter.y;
		} else if (minDist === distToTop) {
			// Connect to middle of top side
			x2 = topCenter.x;
			y2 = topCenter.y;
		} else {
			// Connect to middle of bottom side
			x2 = bottomCenter.x;
			y2 = bottomCenter.y;
		}

		// Update SVG line: fixed anchor to smoothed panel
		lineEl.setAttribute('x1', String(a.x)); // anchor always exact
		lineEl.setAttribute('y1', String(a.y));
		lineEl.setAttribute('x2', String(x2));
		lineEl.setAttribute('y2', String(y2));

		// Update anchor dot: always exactly at geographic coordinates
		dotEl.setAttribute('cx', String(a.x)); // anchor always exact
		dotEl.setAttribute('cy', String(a.y));
		dotEl.setAttribute('r', '3.5');
	}

	return { show, hide, update, isActive: () => active };
})();


const miniGlobeOverlay = new MiniGlobeOverlay();
miniGlobeOverlay.init();

// Toggle control
function toggleMiniGlobe() {
	miniGlobeOverlay.setVisible(!miniGlobeOverlay.isVisible);
}

// ---------- Load initial textures & clouds ----------
const [dayTex, nightTex, cloudsTex] = await Promise.all([
	loadTexture(SETTINGS.dayTexture),
	loadTexture(SETTINGS.nightTexture),
	loadTexture(SETTINGS.cloudsTexture),
]);
const TEX = {
	day: dayTex,
	night: nightTex,
	population: null,
	vegetation: null,
	bathymetry: null,
	land_temperature: null,
	land_cover_classification: null,
	terrain: null
};

// Build clouds materials
const cloudsMatLit = new THREE.MeshPhongMaterial({
	map: cloudsTex, transparent: true, opacity: 0.6, depthWrite: true, alphaTest: 0.01
});
const cloudsMatUnlit = new THREE.MeshBasicMaterial({
	map: cloudsTex, transparent: true, opacity: 0.6, depthWrite: true, alphaTest: 0.01
});

function applyCloudsMode() {
	const mat = cloudsMatUnlit;
	// Normal blending; the “always white” look comes from MeshBasicMaterial
	mat.blending = THREE.NormalBlending;
	mat.depthWrite = true;
	mat.needsUpdate = true;
	clouds.material = cloudsMatUnlit;
}
applyCloudsMode();


// ---------- Ensure sky + country index ----------
try { await ensureSky(); } catch (e) { console.warn('Sky failed:', e); }
applySkyBrightness();


const searchStatus = document.getElementById('searchStatus');

try {
	await ensureCountryIndex();
	// searchStatus.textContent = `Countries indexed: ${COUNTRY_INDEX.length}`;
} catch (e) {
	console.error(e);
	searchStatus.textContent = `Failed to index countries (see console).`;
}

// Initialize the search client
const searchClient = new LocationSearchClient();
await searchClient.initialize();


/*
// Search for locations (e.g., in autocomplete)
function handleSearch(query) {
	try {
		const results = searchClient.search(query, { limit: 20 });
		displaySearchResults(results);
	} catch (error) {
		console.error('Search failed:', error);
	}
}

// When user selects a location, get full details
async function handleLocationSelect(locationId) {
	try {
		// Show loading state
		showLoadingIndicator();
	    
		// Fetch detailed location information
		const locationDetails = await searchClient.getLocationDetails(locationId);
	    
		// Use the detailed data (render on map, show info panel, etc.)
		renderLocationDetails(locationDetails);
	    
	} catch (error) {
		console.error('Failed to load location details:', error);
		showError('Failed to load location details');
	} finally {
		hideLoadingIndicator();
	}
}
*/





// ---------- HUD refs ----------
const modeSel = document.getElementById('mode');
const globeColorRow = document.getElementById('globeColorRow');
const globeColorPick = document.getElementById('globeColorPick');
const globeHexInput = document.getElementById('globeHex');
const chkStarsMotion = document.getElementById('toggle-stars-motion');
const chkClouds = document.getElementById('toggle-clouds');

// const cloudsAdditiveChk = document.getElementById('clouds-additive');
const chkAtmo = document.getElementById('toggle-atmo');
const atmoColorRow = document.getElementById('atmoColorRow');
const atmoColorPick = document.getElementById('atmoColorPick');
const atmoHex = document.getElementById('atmoHex');
// const chkLabels = document.getElementById('toggle-labels');
const chkBorders = document.getElementById('toggle-borders');
const bordersColorRow = document.getElementById('bordersColorRow');
const bordersColorPick = document.getElementById('bordersColorPick');
const bordersHex = document.getElementById('bordersHex');
const chkGraticule = document.getElementById('toggle-graticule');
const graticuleColorRow = document.getElementById('graticuleColorRow');
const graticuleColorPick = document.getElementById('graticuleColorPick');
const graticuleHex = document.getElementById('graticuleHex');
const chkLighting = document.getElementById('toggle-lighting');
const chkStars = document.getElementById('toggle-stars');
const starsControls = document.getElementById('stars-controls');

const skyBright = document.getElementById('skyBright');
const speedInput = document.getElementById('speed');
const speedReadout = document.getElementById('speed-readout');
const speedReadoutKm = document.getElementById('speed-readout-km');
const sunTimeInput = document.getElementById('sunTime');
const sunReadout = document.getElementById('sun-readout');
// const chkView = document.getElementById('toggle-view-readout');
const viewRow = document.getElementById('view-readout-row');
//const viewCenterEl = document.getElementById('view-center');
//const viewRollEl = document.getElementById('view-roll');

// Data Explorer refs
const searchBox = document.getElementById('searchBox');
const searchBtn = document.getElementById('btn-search');
const resultsBox = document.getElementById('searchResults');
const pickedInfo = document.getElementById('pickedInfo');
const propsBox = document.getElementById('propsBox');
const propsList = document.getElementById('propsList');

const selBorderToggle = document.getElementById('sel-border-toggle');
const selBorderColorRow = document.getElementById('sel-border-color-row');
const selBorderColorPick = document.getElementById('sel-border-color');
const selBorderHex = document.getElementById('sel-border-hex');

const selFillToggle = document.getElementById('sel-fill-toggle');
const selFillColorRow = document.getElementById('sel-fill-color-row');
const selFillColorPick = document.getElementById('sel-fill-color');
const selFillHex = document.getElementById('sel-fill-hex');

// Initialize the country data display
const countryDataDisplay = new CountryDataDisplay(
	document.getElementById('propsList'),
	document.getElementById('propsBox'),
	document.getElementById('pickedInfo')
);

// Marker call-out
const calloutEl = document.getElementById('callout');
const calloutSvg = document.getElementById('callout-svg');


const sunTimeAutoEl = document.getElementById('sunTimeAuto');
if (sunTimeAutoEl) {
	sunTimeAutoEl.checked = true;
	sunTimeAutoEl.addEventListener('change', () => {
		sunAutoCfg.enabled = !!sunTimeAutoEl.checked;
	});
}


// Borders color UI only when borders are on
chkBorders.addEventListener('change', async (e) => {
	bordersColorRow.classList.toggle('hidden', !e.target.checked);
	if (e.target.checked && bordersGroup.children.length === 0) {
		try { await loadBorders(SETTINGS.bordersGeoJSON); }
		catch (err) { console.error(err); e.target.checked = false; bordersColorRow.classList.add('hidden'); return; }
	}
	bordersGroup.visible = e.target.checked;
});
(function initBordersControls() {
	const parsed = parseHexRGBA(bordersHex.value) || { rgb: 0xffffff, a: 0.75 };
	bordersColorPick.value = hexFromInt(parsed.rgb);
	setBordersColorAndAlpha(parsed.rgb, parsed.a);
})();
bordersColorPick.addEventListener('input', () => {
	const parsed = parseHexRGBA(bordersHex.value) || { rgb: 0xffffff, a: 0.75 };
	const rgb = intFromHex(bordersColorPick.value);
	bordersHex.value = rgbaToHex8(rgb, parsed.a);
	setBordersColorAndAlpha(rgb, parsed.a);
});
bordersHex.addEventListener('input', () => {
	const p = parseHexRGBA(bordersHex.value); if (!p) return;
	bordersColorPick.value = hexFromInt(p.rgb);
	setBordersColorAndAlpha(p.rgb, p.a);
});

// Atmosphere toggle & color controls
chkAtmo.checked = false;
atmosphere.visible = false;
atmoColorRow.classList.toggle('hidden', !chkAtmo.checked);
chkAtmo.addEventListener('change', () => { atmosphere.visible = chkAtmo.checked; atmoColorRow.classList.toggle('hidden', !chkAtmo.checked); });
(function initAtmoControls() {
	const p = parseHexRGBA(atmoHex.value) || { rgb: ATMO.color, a: 1.0 };
	atmoColorPick.value = hexFromInt(p.rgb);
	atmoUniforms.color.value.setHex(p.rgb);
	atmoUniforms.colorA.value = p.a;
})();
atmoColorPick.addEventListener('input', () => {
	const p = parseHexRGBA(atmoHex.value) || { rgb: ATMO.color, a: 1.0 };
	const rgb = intFromHex(atmoColorPick.value);
	atmoHex.value = rgbaToHex8(rgb, p.a);
	atmoUniforms.color.value.setHex(rgb);
});
atmoHex.addEventListener('input', () => {
	const p = parseHexRGBA(atmoHex.value); if (!p) return;
	atmoColorPick.value = hexFromInt(p.rgb);
	atmoUniforms.color.value.setHex(p.rgb);
	atmoUniforms.colorA.value = p.a;
});

// Graticule toggle & color controls
chkGraticule.addEventListener('change', (e) => {
	graticuleColorRow.classList.toggle('hidden', !e.target.checked);
	if (e.target.checked && graticuleGroup.children.length === 0) buildGraticule();
	graticuleGroup.visible = e.target.checked;
});
(function initGraticuleControls() {
	const p = parseHexRGBA(graticuleHex.value) || { rgb: graticuleRGB, a: graticuleA };
	graticuleColorPick.value = hexFromInt(p.rgb);
	setGraticuleColorAlpha(p.rgb, p.a);
})();
graticuleColorPick.addEventListener('input', () => {
	const p = parseHexRGBA(graticuleHex.value) || { rgb: graticuleRGB, a: graticuleA };
	const rgb = intFromHex(graticuleColorPick.value);
	graticuleHex.value = rgbaToHex8(rgb, p.a);
	setGraticuleColorAlpha(rgb, p.a);
});
graticuleHex.addEventListener('input', () => {
	const p = parseHexRGBA(graticuleHex.value); if (!p) return;
	graticuleColorPick.value = hexFromInt(p.rgb);
	setGraticuleColorAlpha(p.rgb, p.a);
});

// Clouds UI
chkClouds.addEventListener('change', () => { clouds.visible = chkClouds.checked; });
clouds.visible = chkClouds.checked;


// Labels toggle
// chkLabels.addEventListener('change', (e) => { MarkerManager.setVisible(e.target.checked); });
// MarkerManager.setVisible(chkLabels.checked);

// View readout toggle
// chkView.addEventListener('change', (e) => { viewRow.classList.toggle('hidden', !e.target.checked); });


// Lighting
function updateSunFromTime(tHours) {
	const lonDeg = (tHours / 24) * 360 - 180;
	const lon = THREE.MathUtils.degToRad(lonDeg); const radius = 10;
	dirLight.position.set(Math.cos(lon) * radius, 0, Math.sin(lon) * radius);
	sunReadout.textContent = `${tHours.toFixed(1)} h · lon ${Math.round(lonDeg)}°`;
}

// lighting state
const SunLighting = {
	enabled: true,
	lastTickMs: 0,
	intervalMs: 200,
	fallbackDir: new THREE.Vector3(0.6, 0.5, 0.6).normalize(),
	radius: 25
};


const sunLightingEnabledEl = document.getElementById('sunLightingEnabled');
function applySunLightingEnabled() {
	SunLighting.enabled = !!sunLightingEnabledEl.checked;

	if (SunLighting.enabled) {
		// respond to lights
		if (earth.material !== earthMatLit) earth.material = earthMatLit;

		// turn the sun ON and compute its pose immediately
		dirLight.intensity = 1.2;
		dirLight.visible = true;
		SunLighting.lastSec = -1;
		updateSunFromSolarTimeOncePerSecond(); // compute once right now
	} else {
		// unlit look
		if (earth.material !== earthMatUnlit) earth.material = earthMatUnlit;

		dirLight.position.copy(SunLighting.fallbackDir).multiplyScalar(SunLighting.radius);
		dirLight.intensity = 0.0;
		dirLight.visible = false;
		dirLight.target?.position.set(0, 0, 0);
		dirLight.target?.updateMatrixWorld();
	}
}

if (sunLightingEnabledEl) {
	sunLightingEnabledEl.addEventListener('change', applySunLightingEnabled);
	applySunLightingEnabled(); // set initial state
}




// Stars
chkStars.addEventListener('change', async (e) => {
	if (e.target.checked) { await ensureSky(); if (sky) sky.visible = true; starsControls.classList.remove('disabled'); applySkyBrightness(); }
	else if (sky) { sky.visible = false; starsControls.classList.add('disabled'); }
});
skyBaseBrightness = parseFloat(skyBright.value);
skyBright.addEventListener('input', async () => { skyBaseBrightness = parseFloat(skyBright.value); await ensureSky(); applySkyBrightness(); });


// Spin readout
let autorotateSpeed = parseFloat(speedInput.value); // rad/s
function formatPeriod(seconds) {
	if (!isFinite(seconds) || seconds > 864000) {
		return '—';
	}
	
	const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
	
	if (h > 0) {
		return `${h}h ${m}m ${r}s`;
	}
	
	if (m > 0) {
		return `${m}m ${r}s`;
	}
	
	return `${r}s`;
}

function updateSpeedReadout(radPerSec) {
	const dps = radPerSec * 180 / Math.PI;
	
	//const dir = (Math.abs(dps) < 1e-3) ? 'Stopped' : (dps > 0 ? 'Forward' : 'Reverse');
	const dir = "";
	
	const sign = dps > 0 ? '+' : (dps < 0 ? '−' : '±');
	speedReadout.textContent = `${sign}${Math.abs(dps).toFixed(2)}°/s`;
	const v_kms = Math.abs(radPerSec) * SETTINGS.earthRadiusKm, v_kmh = v_kms * 3600;
	const period = (Math.abs(radPerSec) < 1e-6) ? Infinity : (2 * Math.PI / Math.abs(radPerSec));

	const v_kms_formatted = Math.round(v_kms).toLocaleString("en-US");
	const v_kmh_formatted = Math.round(v_kmh).toLocaleString("en-US")
	const period_formatted = period && period !== Infinity ? ` · ${formatPeriod(period)} period` : "";

	speedReadoutKm.textContent = `${v_kms_formatted} km/s · ${v_kmh_formatted} km/h${period_formatted}`;
}
updateSpeedReadout(autorotateSpeed);
speedInput.addEventListener('input', () => { autorotateSpeed = parseFloat(speedInput.value); updateSpeedReadout(autorotateSpeed); });

// Textures
function setEarthMap(tex) { earthMatLit.map = tex; earthMatUnlit.map = tex; earthMatLit.needsUpdate = earthMatUnlit.needsUpdate = true; }
function setEarthOpaque() { earthMatLit.transparent = earthMatUnlit.transparent = false; earthMatLit.opacity = earthMatUnlit.opacity = 1; }
function applyGlobeColorAlpha() {
	earthMatLit.map = earthMatUnlit.map = null;
	earthMatLit.color.setHex(SETTINGS.globeColorRGB);
	earthMatUnlit.color.setHex(SETTINGS.globeColorRGB);
	const useAlpha = SETTINGS.globeColorAlpha < 0.999;
	earthMatLit.transparent = earthMatUnlit.transparent = useAlpha;
	earthMatLit.opacity = earthMatUnlit.opacity = SETTINGS.globeColorAlpha;
	earthMatLit.needsUpdate = earthMatUnlit.needsUpdate = true;
}
async function applyTextureMode(mode) {
	const showGlobe = (mode === 'none'); globeColorRow.classList.toggle('hidden', !showGlobe);
	if (mode === 'none') { applyGlobeColorAlpha(); return; }
	setEarthOpaque(); earthMatLit.color.set(0xffffff); earthMatUnlit.color.set(0xffffff);
	let tex = TEX[mode];
	if (!tex) {
		if (mode === 'bathymetry') tex = TEX.bathymetry = await loadTexture(SETTINGS.bathymetryTexture);
		else if (mode === 'population') tex = TEX.population = await loadTexture(SETTINGS.populationTexture);
		else if (mode === 'vegetation') tex = TEX.vegetation = await loadTexture(SETTINGS.vegetationTexture);
		else if (mode === 'land_temperature') tex = TEX.land_temperature = await loadTexture(SETTINGS.land_temperatureTexture);
		else if (mode === 'land_cover_classification') tex = TEX.land_cover_classification = await loadTexture(SETTINGS.land_cover_classificationTexture);
		else if (mode === 'terrain') tex = TEX.terrain = await loadTexture(SETTINGS.terrainTexture);
		else if (mode === 'day') tex = TEX.day = TEX.day || await loadTexture(SETTINGS.dayTexture);
		else if (mode === 'night') tex = TEX.night = TEX.night || await loadTexture(SETTINGS.nightTexture);
	}
	setEarthMap(tex);
}

modeSel.addEventListener('change', () => { applyTextureMode(modeSel.value); });

await applyTextureMode('day');
modeSel.value = 'day';


// Globe color controls
globeColorPick.value = hexFromInt(SETTINGS.globeColorRGB);
globeHexInput.value = rgbaToHex8(SETTINGS.globeColorRGB, SETTINGS.globeColorAlpha);
globeColorPick.addEventListener('input', () => {
	const parsed = parseHexRGBA(globeHexInput.value) || { rgb: SETTINGS.globeColorRGB, a: SETTINGS.globeColorAlpha };
	const rgb = intFromHex(globeColorPick.value); SETTINGS.globeColorRGB = rgb;
	globeHexInput.value = rgbaToHex8(rgb, parsed.a);
	if (modeSel.value === 'none') applyGlobeColorAlpha();
});
globeHexInput.addEventListener('input', () => {
	const p = parseHexRGBA(globeHexInput.value); if (!p) return;
	SETTINGS.globeColorRGB = p.rgb; SETTINGS.globeColorAlpha = p.a;
	globeColorPick.value = hexFromInt(p.rgb);
	if (modeSel.value === 'none') applyGlobeColorAlpha();
});





function ensure2DSelectionLayers() {
	if (!map2d || map2d.getSource('selected-country')) return;
	map2d.addSource('selected-country', {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] }
	});
	map2d.addLayer({
		id: 'selected-country-fill',
		type: 'fill',
		source: 'selected-country',
		paint: { 'fill-color': '#00c8ff', 'fill-opacity': 0.25, 'fill-antialias': true }
	});
	map2d.addLayer({
		id: 'selected-country-outline',
		type: 'line',
		source: 'selected-country',
		paint: { 'line-color': '#ffd34a', 'line-width': 2 }
	});
}

function countryToFeature(c) {
	if (!c) return null;
	if (c.feature) return c.feature;  // best: already valid GeoJSON feature
	// fallback from your normalized structure:
	const geom = c.polygons?.length
		? { type: 'MultiPolygon', coordinates: c.polygons }
		: { type: 'Polygon', coordinates: c.rings || [] };
	return { type: 'Feature', properties: { name: c.name, iso3: c.iso3 }, geometry: geom };
}

function syncSelectionTo2D() {
	if (!map2d) return;
	ensure2DSelectionLayers();
	const src = map2d.getSource('selected-country');

	if (lastSelectedCountry) {
		const feat = countryToFeature(lastSelectedCountry);
		src.setData({ type: 'FeatureCollection', features: feat ? [feat] : [] });

		const fill = parseHexRGBA(selFillHex.value) || { rgb: 0x00c8ff, a: 0.25 };
		const stroke = parseHexRGBA(selBorderHex.value) || { rgb: 0xffd34a, a: 0.8 };
		map2d.setPaintProperty('selected-country-fill', 'fill-color', '#' + fill.rgb.toString(16).padStart(6, '0'));
		map2d.setPaintProperty('selected-country-fill', 'fill-opacity', selFillToggle.checked ? fill.a : 0);
		map2d.setPaintProperty('selected-country-outline', 'line-color', '#' + stroke.rgb.toString(16).padStart(6, '0'));
		map2d.setPaintProperty('selected-country-outline', 'line-opacity', selBorderToggle.checked ? stroke.a : 0);
	} else {
		// clear the source and hide layers
		src.setData({ type: 'FeatureCollection', features: [] });
		if (map2d.getLayer('selected-country-fill')) map2d.setPaintProperty('selected-country-fill', 'fill-opacity', 0);
		if (map2d.getLayer('selected-country-outline')) map2d.setPaintProperty('selected-country-outline', 'line-opacity', 0);
	}
}




let lastSelectedCountry = null;

function applySelectionStyling() {
	if (!lastSelectedCountry) { clearSelectionOverlay(); clearSelectedBorders(); return; }

	const wantFill = selFillToggle.checked;
	const wantStroke = selBorderToggle.checked;

	const fill = wantFill ? parseHexRGBA(selFillHex.value) : null;
	const fillRGBA = fill ? [(fill.rgb >> 16) & 255, (fill.rgb >> 8) & 255, fill.rgb & 255, fill.a] : null;

	// paint only the fill to the overlay canvas
	paintSelectionToOverlay(lastSelectedCountry, { fillRGBA, strokeRGBA: null });

	// draw the outline as crisp 3D lines
	if (wantStroke) {
		const s = parseHexRGBA(selBorderHex.value) || { rgb: 0xffd34a, a: 0.8 };
		highlightCountry(lastSelectedCountry, s.rgb, s.a);
	} else {
		clearSelectedBorders();
	}

	// 2D overlay:
	syncSelectionTo2D();
}



// Toggle rows visibility
selBorderToggle.addEventListener('change', () => {
	selBorderColorRow.classList.toggle('hidden', !selBorderToggle.checked);
	applySelectionStyling();
});
selFillToggle.addEventListener('change', () => {
	selFillColorRow.classList.toggle('hidden', !selFillToggle.checked);
	applySelectionStyling();
});

// Color pickers <-> hex sync (border)
selBorderColorPick.addEventListener('input', () => {
	const p = parseHexRGBA(selBorderHex.value) || { rgb: 0xffd34a, a: 0.8 };
	const rgb = intFromHex(selBorderColorPick.value);
	selBorderHex.value = rgbaToHex8(rgb, p.a);
	applySelectionStyling();
});
selBorderHex.addEventListener('input', () => {
	const p = parseHexRGBA(selBorderHex.value); if (!p) return;
	selBorderColorPick.value = hexFromInt(p.rgb);
	applySelectionStyling();
});

// Color pickers <-> hex sync (fill)
selFillColorPick.addEventListener('input', () => {
	const p = parseHexRGBA(selFillHex.value) || { rgb: 0x00c8ff, a: 0.25 };
	const rgb = intFromHex(selFillColorPick.value);
	selFillHex.value = rgbaToHex8(rgb, p.a);
	applySelectionStyling();
});
selFillHex.addEventListener('input', () => {
	const p = parseHexRGBA(selFillHex.value); if (!p) return;
	selFillColorPick.value = hexFromInt(p.rgb);
	applySelectionStyling();
});





// ---------- Drag modes (arcball) ----------
let earthDragActive = true;
const canvas = renderer.domElement;

function screenToNDC(clientX, clientY) {
	const r = canvas.getBoundingClientRect();
	return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
}
function ndcToArcballVec(ndc) {
	const v = new THREE.Vector3(ndc.x, ndc.y, 0), d2 = v.x * v.x + v.y * v.y; if (d2 <= 1) v.z = Math.sqrt(1 - d2); else v.normalize(); return v;
}

let pointerIsDown = false, lastArcballVec = null, lastMoveTime = 0;
let downX = 0, downY = 0, downT = 0;
const CLICK_MAX_PX = 4, CLICK_MAX_MS = 250;

const spinVel = new THREE.Vector3(0, 0, 0); const qTmp = new THREE.Quaternion();
const SPIN_HALFLIFE = 0.25; function decayFactor(dt) { return Math.exp(Math.log(0.5) * dt / SPIN_HALFLIFE); }

// ----- Smooth navigation tween (adds animation for nav & search) -----
let navTween = null; // {from, to, t, dur, lastQ, onComplete}
const Ease = { cubicInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) };


let _lastPointer = { x: null, y: null };
let _lastHoverLL = null;

// Track pointer position even when not dragging, to support zoom-around-cursor handoff
window.addEventListener('pointermove', (e) => {
	_lastPointer.x = e.clientX; _lastPointer.y = e.clientY;
	// Update last hover lat/lon under the cursor (if over the globe)
	const ll = pickLatLonFromClient(e.clientX, e.clientY);
	if (ll) _lastHoverLL = { lat: ll.latDeg, lon: ll.lonDeg };
});

// Use cursor focus if available; fall back to screen-center
function handoffCenterLL() {
	return (_lastHoverLL && Number.isFinite(_lastHoverLL.lat) && Number.isFinite(_lastHoverLL.lon))
		? _lastHoverLL
		: currentCenterLatLon();
}


canvas.addEventListener('pointerdown', (e) => {
	pointerIsDown = true; canvas.setPointerCapture(e.pointerId);
	navTween = null; // cancel any in-flight tween on user interaction
	lastArcballVec = ndcToArcballVec(screenToNDC(e.clientX, e.clientY)); lastMoveTime = e.timeStamp;
	downX = e.clientX; downY = e.clientY; downT = e.timeStamp;
	spinVel.set(0, 0, 0);
});

canvas.addEventListener('pointermove', (e) => {
	if (!pointerIsDown || !lastArcballVec) return;
	const v1 = ndcToArcballVec(screenToNDC(e.clientX, e.clientY));
	const axisCam = new THREE.Vector3().crossVectors(lastArcballVec, v1);
	const dotp = THREE.MathUtils.clamp(lastArcballVec.dot(v1), -1, 1);
	if (axisCam.lengthSq() > 1e-12 && Math.abs(dotp) < 0.999999) {
		const angle = Math.acos(dotp);
		const axisWorld = axisCam.applyQuaternion(camera.quaternion).normalize();
		const dt = Math.max(1e-3, (e.timeStamp - lastMoveTime) / 1000);
		// Always rotate the globe
		qTmp.setFromAxisAngle(axisWorld, angle);
		globe.quaternion.premultiply(qTmp);
		spinVel.copy(axisWorld).multiplyScalar(angle / dt);

		// If enabled, counter-rotate the sky so stars “move”
		if (chkStarsMotion?.checked && sky) {
			const qInv = new THREE.Quaternion().setFromAxisAngle(axisWorld, -angle);
			sky.quaternion.premultiply(qInv);
		}
	}
	lastArcballVec = v1; lastMoveTime = e.timeStamp;
});

const raycaster = new THREE.Raycaster();

window.addEventListener('pointermove', (e) => {
	_lastPointer.x = e.clientX; _lastPointer.y = e.clientY;
	const ll = pickLatLonFromClient(e.clientX, e.clientY);
	if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lon)) {
		_lastHoverLL = { lat: ll.lat, lon: ll.lon };
	}
});

function pickLatLonFromClient(clientX, clientY) {
	const r = renderer.domElement.getBoundingClientRect();
	const ndc = { x: ((clientX - r.left) / r.width) * 2 - 1, y: -(((clientY - r.top) / r.height) * 2 - 1) };
	raycaster.setFromCamera(ndc, camera);
	const hits = raycaster.intersectObject(earth, false);
	if (!hits.length) return null;
	const worldP = hits[0].point;
	// Convert world to globe-local => lat/lon
	const qInv = globe.quaternion.clone().invert();
	const local = worldP.clone().applyQuaternion(qInv).normalize();
	const lat = Math.asin(local.y);
	const lon = Math.atan2(-local.z, local.x);
	return { latDeg: deg(lat), lonDeg: deg(lon), worldP };
}

function endPointer(e) {
	// determine click vs drag
	const dx = e.clientX - downX, dy = e.clientY - downY, dt = e.timeStamp - downT;
	const isClick = Math.hypot(dx, dy) <= CLICK_MAX_PX && dt <= CLICK_MAX_MS;
	pointerIsDown = false; lastArcballVec = null; try { canvas.releasePointerCapture(e.pointerId); } catch (_) { }
	if (isClick) handleGlobeClick(e.clientX, e.clientY);
}

canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer); canvas.addEventListener('pointerleave', e => { if (pointerIsDown) endPointer(e); });

// ---------- Navigation (mode-aware & fixed) ----------
function cameraViewDir() { const v = new THREE.Vector3(); camera.getWorldDirection(v); return v.normalize(); }
function northVectorWorld() { return new THREE.Vector3(0, 1, 0).applyQuaternion(globe.quaternion).normalize(); }

function northUpGlobe() {
	const view = cameraViewDir();
	const northW = northVectorWorld();
	const a = northW.clone().projectOnPlane(view).normalize();
	const screenUpW = camera.up.clone().projectOnPlane(view).normalize();
	if (!isFinite(a.lengthSq()) || a.lengthSq() < 1e-12 || screenUpW.lengthSq() < 1e-12) return;
	const angle = signedAngleAroundAxis(a, screenUpW, view);
	qTmp.setFromAxisAngle(view, angle);
	globe.quaternion.premultiply(qTmp);
}
function northUpCamera() {
	const view = cameraViewDir();
	const northW = northVectorWorld();
	const a = northW.clone().projectOnPlane(view).normalize();
	const screenUpW = camera.up.clone().projectOnPlane(view).normalize();
	if (!isFinite(a.lengthSq()) || a.lengthSq() < 1e-12 || screenUpW.lengthSq() < 1e-12) return;
	const angle = signedAngleAroundAxis(screenUpW, a, view);
	const q = new THREE.Quaternion().setFromAxisAngle(view, angle);
	camera.quaternion.premultiply(q);
	camera.up.applyQuaternion(q);
	camera.updateMatrixWorld();
}
function centerOnGlobe(latDeg, lonDeg) {
	const vLocal = latLonToVector3(latDeg, lonDeg, 1);
	const vWorld = vLocal.clone().applyQuaternion(globe.quaternion).normalize();
	const desired = cameraViewDir().clone().negate();
	const qAlign = new THREE.Quaternion().setFromUnitVectors(vWorld, desired);
	globe.quaternion.premultiply(qAlign);
	northUpGlobe();
}
function centerByCameraDirWorld(dirWorld) {
	const d = camera.position.length();
	const n = dirWorld.clone().normalize();
	camera.position.copy(n.multiplyScalar(d));
	camera.lookAt(0, 0, 0);
	northUpCamera();
}


function computeTargetQuatForCenter(latDeg, lonDeg, opts = {}) {
	const q0 = globe.quaternion.clone();

	// ---- Step 1: yaw/pitch so (lat,lon) is at view center ----
	const vLocal = latLonToVector3(latDeg, lonDeg, 1);
	const vWorld = vLocal.clone().applyQuaternion(q0).normalize();
	const viewDir = cameraViewDir().normalize();
	const desired = viewDir.clone().negate();
	const qAlign = new THREE.Quaternion().setFromUnitVectors(vWorld, desired);
	let q = qAlign.multiply(q0); // q = qAlign * q0

	// ---- Step 2: roll control (skip near the poles) ----
	const nearPole = Math.abs(latDeg) > 89.5;
	if (!nearPole) {
		const view = viewDir;
		const screenUpW = camera.up.clone().projectOnPlane(view).normalize();

		if (!opts.preserveRoll && screenUpW.lengthSq() > 1e-12) {
			if (typeof opts.targetBearingDeg === 'number') {
				// compute current on-screen bearing of north at target after step 1
				const d = 0.20;
				const pC = latLonToVector3(latDeg, lonDeg, R).applyQuaternion(q);
				const pN = latLonToVector3(latDeg + d, lonDeg, R).applyQuaternion(q);
				const sC = worldToScreen(pC);
				const sN = worldToScreen(pN);
				const vx = sN.x - sC.x, vy = sN.y - sC.y;
				const curDeg = Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6
					? 0
					: THREE.MathUtils.radToDeg(Math.atan2(vx, -vy)); // [-180,180]
				let delta = opts.targetBearingDeg - curDeg;
				delta = ((delta + 180) % 360) - 180; // shortest signed
				if (Math.abs(delta) > 1e-4) {
					const qRoll = new THREE.Quaternion().setFromAxisAngle(view, THREE.MathUtils.degToRad(delta));
					q = qRoll.multiply(q);
				}
			} else {
				// north-up: rotate projected geographic north to screen-up
				const northW = LOCAL_Y.clone().applyQuaternion(q).normalize();
				const northOnScreen = northW.clone().projectOnPlane(view).normalize();
				if (northOnScreen.lengthSq() > 1e-12) {
					const angle = signedAngleAroundAxis(northOnScreen, screenUpW, view);
					if (Math.abs(angle) > 1e-6) {
						const qRoll = new THREE.Quaternion().setFromAxisAngle(view, angle);
						q = qRoll.multiply(q);
					}
				}
			}
		}
		// else: preserveRoll true → do nothing
	}
	// Near the pole → skip roll entirely to avoid undefined bearing

	return q.normalize();
}




function startNavTweenToQuat(qTarget, dur = 1200, onComplete) {
	// Stop any in-flight tween and pause auto-spin
	if (typeof navTween !== 'undefined' && navTween?.stop) { try { navTween.stop(); } catch { } }
	navTween = null;
	pauseAutoSpin();

	// Normalize start/target and force short arc
	const qStart = globe.quaternion.clone().normalize();
	const qTo = (qTarget instanceof THREE.Quaternion
		? qTarget.clone()
		: new THREE.Quaternion(qTarget.x, qTarget.y, qTarget.z, qTarget.w)
	).normalize();

	let dot = THREE.MathUtils.clamp(qStart.dot(qTo), -1, 1);
	if (dot < 0) { qTo.set(-qTo.x, -qTo.y, -qTo.z, -qTo.w); dot = -dot; }

	// Snap if already there
	const ang = Math.acos(dot);
	if (ang < THREE.MathUtils.degToRad(0.1)) {
		globe.quaternion.copy(qTo);
		resumeAutoSpin();
		if (typeof onComplete === 'function') onComplete();
		return;
	}

	// Start tween; your render loop should slerp using navTween.t/dur
	navTween = {
		from: qStart,
		to: qTo,
		t: 0,
		dur,
		lastQ: qStart.clone(),
		onComplete: () => {
			resumeAutoSpin();
			if (typeof onComplete === 'function') onComplete();
		}
	};
}


// put near other module-level state
let _southPoleLonRef = null;

// replace your animateCenterOnGlobe with this minimal tweak
function animateCenterOnGlobe(latDeg, lonDeg, opts = {}) {
	// Lock meridian at the pole to avoid flip/jumps in readouts
	if (latDeg <= -89.5) {
		if (_southPoleLonRef == null) _southPoleLonRef = normalizeLon(lonDeg);
		lonDeg = _southPoleLonRef;
	}

	const qTarget = computeTargetQuatForCenter(latDeg, lonDeg, opts);

	startNavTweenToQuat(qTarget, opts.duration ?? 1200, () => {
		// refresh the locked meridian to whatever we actually landed on
		const c = currentCenterLatLon?.() || { lat: latDeg, lon: lonDeg };
		if (c.lat <= -89.5) _southPoleLonRef = normalizeLon(c.lon);
		if (typeof opts.onComplete === 'function') opts.onComplete();
	});
}


document.getElementById('btn-face-n').addEventListener('click', () => {
	if (navTween?.stop) { try { navTween.stop(); } catch { } }
	animateCenterOnGlobe(90, 0, { preserveRoll: true });
});
document.getElementById('btn-face-s').addEventListener('click', () => {
	if (navTween?.stop) { try { navTween.stop(); } catch { } }
	animateCenterOnGlobe(-90, 0, { preserveRoll: true });
});


document.getElementById('btn-face-0').addEventListener('click', () => {
	animateCenterOnGlobe(0, 0);
});
document.getElementById('btn-face-180').addEventListener('click', () => {
	animateCenterOnGlobe(0, 180);
});


/*
document.getElementById('btn-mini-globe').addEventListener('click', () => {
	miniGlobeOverlay.setVisible(!miniGlobeOverlay.isVisible);
});
*/

// ---------- View readout ----------
function latLonFromWorldPoint(worldP) {
	const qInv = globe.quaternion.clone().invert();
	const local = worldP.clone().applyQuaternion(qInv).normalize();
	const lat = Math.asin(local.y);
	const lon = Math.atan2(-local.z, local.x);
	return { latDeg: deg(lat), lonDeg: deg(lon) };
}
function formatLat(lat) { const a = Math.abs(lat).toFixed(3); return lat >= 0 ? `${a}° N` : `${a}° S`; }
function formatLon(lon) { let L = ((lon + 540) % 360) - 180; const a = Math.abs(L).toFixed(3); return L >= 0 ? `${a}° E` : `${a}° W`; }
function raySphereCenterPoint() {
	const view = cameraViewDir(), C = camera.position.clone();
	const b = C.dot(view), c = C.lengthSq() - R * R, disc = b * b - c;
	if (disc < 0) return null;
	const t = -b - Math.sqrt(disc);
	return C.add(view.multiplyScalar(t));
}
function computeNorthUpErrorDeg() {
	const view = cameraViewDir();
	const nW = northVectorWorld();
	const a = nW.clone().projectOnPlane(view).normalize();
	const screenUpW = camera.up.clone().projectOnPlane(view).normalize();
	if (a.lengthSq() < 1e-12 || screenUpW.lengthSq() < 1e-12) return 0;
	return deg(signedAngleAroundAxis(a, screenUpW, view));
}

/*
function updateViewReadout() {
	if (viewRow.classList.contains('hidden')) return;
	const hit = raySphereCenterPoint();
	if (!hit) { viewCenterEl.textContent = '—'; viewRollEl.textContent = '—'; return; }
	const { latDeg, lonDeg } = latLonFromWorldPoint(hit);
	viewCenterEl.textContent = `${formatLat(latDeg)}, ${formatLon(lonDeg)}`;
	const rollErr = computeNorthUpErrorDeg();
	viewRollEl.textContent = `North-up error: ${rollErr >= 0 ? '+' : ''}${rollErr.toFixed(1)}°`;
}
*/

// ---------- Resize ----------
window.addEventListener('resize', () => {
	renderer.setSize(window.innerWidth, window.innerHeight);
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	sizeCalloutSvgToViewport();
	applySkyBrightness();

	if (map2d) map2d.resize();
});

// ---------- Camera orbit helper ----------
function orbitCameraAroundY(angle) {
	const q = new THREE.Quaternion().setFromAxisAngle(LOCAL_Y, angle);
	camera.position.applyQuaternion(q);
	camera.up.applyQuaternion(q);
	camera.lookAt(0, 0, 0);
}

// ---------- Animation ----------
let last = performance.now();

(function animate(now) {
	// schedule next frame first
	requestAnimationFrame(animate);

	// mini globe HUD
	miniGlobeOverlay.update(globe, buildMiniGlobeTelemetry());

	// time step (clamped to avoid huge jumps on tab switches)
	let dt = (now - last) / 1000;
	if (!Number.isFinite(dt) || dt < 0) dt = 0;
	if (dt > 0.05) dt = 0.05; // cap ~50ms
	last = now;

	// --- 2D handoff check (throttled ~100ms) and honoring cooldown ---
	if (!animate._handoffTimer) animate._handoffTimer = 0;
	animate._handoffTimer += dt;
	if (animate._handoffTimer >= 0.10) {
		animate._handoffTimer = 0;
		if (!map2dVisible && performance.now() >= _handoffCooldownUntil) {
			tryEnter2D();
		}
	}

	// If a navigation tween is active, drive it; else run autorotate/inertia
	if (navTween) {
		navTween.t += dt * 1000;
		const a = Math.min(1, navTween.t / navTween.dur);
		const e = Ease.cubicInOut(a);

		// slerp from->to
		const qCur = new THREE.Quaternion().slerpQuaternions(navTween.from, navTween.to, e);

		// delta from last to current (for sky counter-rotation)
		const qPrev = navTween.lastQ;
		const qDelta = qPrev.clone().invert().multiply(qCur);

		// apply to globe
		globe.quaternion.copy(qCur).normalize();

		// counter-rotate sky if stars movement is enabled
		if (chkStarsMotion?.checked && sky) {
			const qInv = qDelta.clone().invert();
			sky.quaternion.premultiply(qInv).normalize();
		}

		navTween.lastQ = qCur;

		if (a >= 1) {
			const cb = navTween.onComplete;
			navTween = null;
			if (typeof cb === 'function') cb();
		}
	} else {
		// --- Autorotate (only when not dragging and 2D is hidden) ---
		if (!pointerIsDown && !map2dVisible) {
			const yaw = autorotateSpeed * dt;
			if (yaw) {
				globe.rotateOnAxis(LOCAL_Y, yaw);
				if (typeof clouds !== 'undefined' && clouds) {
					const drift = autorotateSpeed * 0.25 * dt;
					if (drift) clouds.rotateOnAxis(LOCAL_Y, drift);
				}
				if (chkStarsMotion?.checked && sky) {
					sky.rotateOnAxis(LOCAL_Y, -yaw);
				}
			}
		}

		// --- Inertial spin (from drag) ---
		if (typeof spinVel !== 'undefined' && spinVel) {
			const speed = spinVel.length();
			if (speed > 1e-5) {
				const axis = spinVel.clone().normalize();
				const angle = speed * dt;
				qTmp.setFromAxisAngle(axis, angle);
				globe.quaternion.premultiply(qTmp).normalize();

				if (chkStarsMotion?.checked && sky) {
					const qInv = new THREE.Quaternion().setFromAxisAngle(axis, -angle);
					sky.quaternion.premultiply(qInv).normalize();
				}

				spinVel.multiplyScalar(decayFactor(dt));
			}
		}
	}

	// lighting / controls / UI / render
	atmoUniforms.sunDirW.value.copy(dirLight.position).normalize();

	controls.update();
	MarkerManager.update();
	Callout.update();

	applySkyBrightness();
	// updateViewReadout();

	updateSunFromSolarTimeOncePerSecond();

	renderer.render(scene, camera);
})(last);


// ---------- Init ----------
await applyTextureMode('day');
modeSel.value = 'day';

// Set startup view to Lisbon
animateCenterOnGlobe(38.7223, -9.1393, { duration: 0 });


/*
// ---------- Data Explorer logic ----------
function showPicked(latDeg, lonDeg, country) {
	const latTxt = formatLat(latDeg);
	const lonTxt = formatLon(lonDeg);
	if (country) {
		pickedInfo.textContent = `${latTxt}, ${lonTxt} · ${country.name}${country.iso3 ? ` (${country.iso3})` : ''}`;
		// render selected props
		propsList.innerHTML = '';
		const p = country.feature.properties || {};
		const preferred = ['ADMIN', 'NAME_LONG', 'NAME', 'BRK_NAME', 'FORMAL_EN', 'ABBREV', 'ISO_A2', 'ISO_A3', 'CONTINENT', 'SUBREGION', 'REGION_UN', 'POP_EST', 'GDP_MD_EST'];
		const seen = new Set();
		for (const k of preferred) {
			if (p[k] != null) { appendProp(k, p[k]); seen.add(k); }
		}
		// fill a few more generic properties
		let extraCount = 0;
		for (const k in p) {
			if (seen.has(k)) continue;
			if (extraCount >= 20) break;
			const v = p[k];
			if (v != null && typeof v !== 'object') { appendProp(k, v); extraCount++; }
		}
		propsBox.classList.remove('hidden');
		function appendProp(k, v) {
			const dt = document.createElement('dt'); dt.textContent = k;
			const dd = document.createElement('dd'); dd.textContent = String(v);
			propsList.appendChild(dt); propsList.appendChild(dd);
		}
	} else {
		pickedInfo.textContent = `${latTxt}, ${lonTxt} · Ocean / no country match`;
		propsBox.classList.add('hidden');
		propsList.innerHTML = '';
	}

	// Show an edge callout for this selection
	const title = country ? `${country.name}${country.iso3 ? ` (${country.iso3})` : ''}` : 'Selected location';
	const lines = [`${formatLat(latDeg)}, ${formatLon(lonDeg)}`];
	Callout.show({ lat: latDeg, lon: lonDeg, title, lines });

	if (country) {
		highlightCountry(country);
	} else {
		clearSelectedBorders();
	}

	lastSelectedCountry = country || null;
	applySelectionStyling();
}
*/

async function showPicked(latDeg, lonDeg, calloutText) {

	// const selectedCountry = await countryDataDisplay.showPicked(latDeg, lonDeg, country);

	// Show an edge callout for this selection
	// const title = country ? `${country.name}${country.iso3 ? ` (${country.iso3})` : ''}` : 'Selected location';

	const lines = [`${formatLat(latDeg)}, ${formatLon(lonDeg)}`];
	Callout.show({ lat: latDeg, lon: lonDeg, calloutText: calloutText, lines });

	/*
	if (country) {
		highlightCountry(country);
	} else {
		clearSelectedBorders();
	}
	

	lastSelectedCountry = country || null;
	applySelectionStyling();

	return selectedCountry;
	*/
}




function countryAtLonLat(lonDeg, latDeg) {
	if (!COUNTRY_INDEX) return null;
	// quick scan with bbox first
	for (const c of COUNTRY_INDEX) {
		const b = c.bbox;
		if (latDeg < b.minLat || latDeg > b.maxLat) continue;
		// unwrap point near bbox center
		const lonRef = ((b.minLon + b.maxLon) / 2);
		const unwrappedRings = c.rings; // unwrap is done per test ring in pointInRings
		if (pointInRings(lonDeg, latDeg, unwrappedRings)) return c;
	}
	return null;
}

function handleGlobeClick(clientX, clientY) {

	const hit = pickLatLonFromClient(clientX, clientY);
	if (!hit) {
		return;
	}

	const { latDeg, lonDeg } = hit;
	const country = countryAtLonLat(lonDeg, latDeg);

	if (country) {
		const countryName = country.feature.properties.ADMIN;
		const sovereignCountryName = country.feature.properties.SOVEREIGNT;
		const subRegion = country.feature.properties.SUBREGION;
		const iso_a2 = country.feature.properties.ISO_A2_EH;

		showPicked(latDeg, lonDeg, { title: countryName, titleSuffix: sovereignCountryName, subTitle: subRegion, iso_a2: iso_a2 });

		lastSelectedCountry = country;
		applySelectionStyling();
	}
}

function sizeCalloutSvgToViewport() {
	const w = renderer.domElement.clientWidth;
	const h = renderer.domElement.clientHeight;
	calloutSvg.setAttribute('width', String(w));
	calloutSvg.setAttribute('height', String(h));
}
sizeCalloutSvgToViewport(); // once at startup

function parseQueryToCoords(q) {
	// Accept: "lat, lon" decimals; optional N/S/E/W
	const s = q.trim();
	// If it contains two numbers (and optional NSEW), parse
	const re = /([+-]?\d+(?:\.\d+)?)\s*([NS])?[^0-9a-zA-Z+.-]+([+-]?\d+(?:\.\d+)?)\s*([EW])?/i;
	const m = s.match(re);
	if (m) {
		let lat = parseFloat(m[1]);
		let lon = parseFloat(m[3]);
		const ns = (m[2] || '').toUpperCase();
		const ew = (m[4] || '').toUpperCase();
		if (ns === 'S') lat = -Math.abs(lat); else if (ns === 'N') lat = Math.abs(lat);
		if (ew === 'W') lon = -Math.abs(lon); else if (ew === 'E') lon = Math.abs(lon);
		if (!isFinite(lat) || !isFinite(lon)) return null;
		// clamp
		lat = Math.max(-90, Math.min(90, lat));
		lon = ((lon + 540) % 360) - 180;
		return { lat, lon };
	}
	return null;
}


function renderSearchResults(items, coords) {
	// Clear existing results
	resultsBox.innerHTML = '';

	if (coords) {
		// Will handle coordinate results
		return;
	}

	// Handle location search results
	if (items.length === 0) {
		resultsBox.innerHTML = '<div class="no-results">No locations found</div>';
		return;
	}

	items.forEach(item => {
		const div = document.createElement('div');
		div.className = 'search-result-item';
		div.innerHTML = `${item.name} [${item.countryCode}]<i>(${item.type === 'country' ? 'Country' : 'Place'})</i>`;

		// Add click handler to load full details (triggers a second API call for the chosen location details)
		div.addEventListener('click', () => {
			handleLocationSelection(item.id);
		});

		resultsBox.appendChild(div);
	});
}


// Adapted search function
async function doSearch() {
	const q = searchBox.value;

	// Check if it's coordinates first
	const coords = parseQueryToCoords(q);
	if (coords) {
		renderSearchResults([], coords);
		pickedInfo.textContent = `Parsed coordinates: ${formatLat(coords.lat)}, ${formatLon(coords.lon)}`;
		propsBox.classList.add('hidden');
		propsList.innerHTML = '';
		return;
	}

	// Use the "new" search client for location search
	try {
		const items = searchClient.search(q);
		searchStatus.textContent = items.length ? `${items.length} result(s)` : 'No results';
		renderSearchResults(items, null);
	} catch (error) {
		console.error('Search failed:', error);
		searchStatus.textContent = 'Search error';
		renderSearchResults([], null);
	}
}

// Function to render the detailed location information
function renderLocationDetails(locationDetails) {
	// Update your UI with the detailed information
	console.log('Location details:', locationDetails);

	// Show in info panel
	pickedInfo.textContent = `${locationDetails.ne_10m_countries.properties.NAME} (${locationDetails.ne_10m_countries.properties.ISO_A3})`;

	// Populate properties list
	propsBox.classList.remove('hidden');
	propsList.innerHTML = '';

	// Add key properties to the list
	const propertiesToShow = [
		{ label: 'Type', value: locationDetails.type },
		{ label: 'Name', value: locationDetails.name },
		{ label: 'Country Code', value: locationDetails.countryCode },
		{ label: 'ID', value: locationDetails.id }
	];

	// Add additional properties based on type
	if (locationDetails.placeType) {
		propertiesToShow.push({ label: 'Place Type', value: locationDetails.placeType });
	}
	if (locationDetails.population) {
		propertiesToShow.push({ label: 'Population', value: locationDetails.population.toLocaleString() });
	}
	if (locationDetails.adminRegion) {
		propertiesToShow.push({ label: 'Region', value: locationDetails.adminRegion });
	}

	propertiesToShow.forEach(prop => {
		const li = document.createElement('li');
		li.innerHTML = `<strong>${prop.label}:</strong> ${prop.value}`;
		propsList.appendChild(li);
	});

	// Focus on location
	if (locationDetails.geometry) {
		focusOnLocationGeometry(locationDetails.geometry);
	}
}

// Example function to focus on location geometry
function focusOnLocationGeometry(geometry) {

	if (geometry.type === 'Point') {
		const [lon, lat] = geometry.coordinates;
	} else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
		// highlightCountryGeometry(geometry);
	}
}

async function handleLocationSelection(locationId) {
	try {

		// Fetch detailed location information from the second API call
		const locationDetails = await searchClient.getLocationDetails(locationId);

		// Use the detailed data (render on map, show info panel, etc.)
		// renderLocationDetails(locationDetails);

		let latitude, longitude, locationName, countryName, sovereignCountryName, subRegion, iso_a2;

		if (locationDetails.populated_places) {
			latitude = locationDetails.populated_places.properties.LATITUDE;
			longitude = locationDetails.populated_places.properties.LONGITUDE;
			locationName = locationDetails.populated_places.properties.NAME;
			countryName = locationDetails.populated_places.properties.ADM0NAME;
			sovereignCountryName = locationDetails.populated_places.properties.SOV0NAME;
			subRegion = locationDetails.populated_places.properties.SUBREGION;
			iso_a2 = locationDetails.populated_places.properties.ISO_A2;
		}
		else if (locationDetails.ne_10m_countries) {
			latitude = locationDetails.ne_10m_countries.properties.LABEL_Y;
			longitude = locationDetails.ne_10m_countries.properties.LABEL_X;
			locationName = locationDetails.ne_10m_countries.properties.NAME;
			countryName = locationDetails.ne_10m_countries.properties.ADMIN;
			sovereignCountryName = locationDetails.ne_10m_countries.properties.SOVEREIGNT;
			subRegion = locationDetails.ne_10m_countries.properties.SUBREGION;
			iso_a2 = locationDetails.ne_10m_countries.properties.ISO_A2;
		}


		animateCenterOnGlobe(latitude, longitude);

		if (locationDetails.ne_10m_countries) {
			const geom = locationDetails.ne_10m_countries.geometry;
			const country =
				geom.type === 'Polygon'
					? { rings: geom.coordinates, polygons: [geom.coordinates] }
					: geom.type === 'MultiPolygon'
						? { rings: geom.coordinates.flat(), polygons: geom.coordinates }
						: null;

			if (country) {
				highlightCountry(country);
				lastSelectedCountry = country || null;
				applySelectionStyling();
			}
		}

		showPicked(latitude, longitude, { title: locationName, titleSuffix: countryName || sovereignCountryName, subTitle: subRegion, iso_a2: iso_a2 });

	} catch (error) {
		console.error('Failed to load location details:', error);
		searchStatus.classList.remove('loading');
		searchStatus.textContent = 'Failed to load details';

		pickedInfo.textContent = 'Failed to load location details. Please try again.';
	}
}
window.handleLocationSelection = handleLocationSelection;


let searchTimer = null;

searchBox.addEventListener('input', () => {
	clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 180);
});

searchBtn.addEventListener('click', doSearch);
searchBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });


const mapDiv = document.getElementById('map2d');

function defaultMapStyleFromEarthControls() {
	// 'day' -> aerial, 'terrain' -> streets; other modes fall back to aerial
	const v = modeSel?.value || 'day';
	return (v === 'terrain') ? 'streets' : 'aerial';
}

/*
// CORRECTED VERSION: This version properly accounts for globe rotation
function screenNorthBearingDegAt(centerLL) {
	const lat = THREE.MathUtils.degToRad(centerLL.lat);
	const lon = THREE.MathUtils.degToRad(centerLL.lon);

	// Point on unit sphere and local tangent basis (north/east) at that point IN LOCAL COORDS
	const clat = Math.cos(lat), slat = Math.sin(lat);
	const clon = Math.cos(lon), slon = Math.sin(lon);
	const pLocal = new THREE.Vector3(clat * clon, slat, clat * slon);                       // surface normal (local)
	const northLocal = new THREE.Vector3(-slat * clon, clat, -slat * slon).normalize();        // +lat (local)
	const eastLocal = new THREE.Vector3(-slon, 0, clon).normalize();             // +lon (local)

	// *** CRITICAL FIX: Transform to world coordinates using globe rotation ***
	const p = pLocal.clone().applyQuaternion(globe.quaternion);
	const north = northLocal.clone().applyQuaternion(globe.quaternion);
	const east = eastLocal.clone().applyQuaternion(globe.quaternion);

	// Camera "screen up" in world space (this was already correct)
	const camUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

	// Project screen-up into the tangent plane at p (now using world coords)
	const upTangent = camUpWorld.clone().sub(p.clone().multiplyScalar(camUpWorld.dot(p)));
	if (upTangent.lengthSq() < 1e-12) return 0; // looking straight along normal — arbitrary

	upTangent.normalize();

	// Bearing = clockwise degrees from true north to projected screen-up
	const x = upTangent.dot(east);
	const y = upTangent.dot(north);

	// Return in [-180, 180] to match MapLibre getBearing()
	let brg = THREE.MathUtils.radToDeg(Math.atan2(x, y));  // already in [-180,180]
	return brg;
}
*/

function screenNorthBearingDegAt(centerLL) {
	// Ensure matrices are current (cheap; helps if called mid-frame)
	if (camera.updateMatrixWorld) camera.updateMatrixWorld();
	if (globe.updateMatrixWorld) globe.updateMatrixWorld();

	// Clamp latitude slightly away from the poles to avoid degeneracy
	const poleSafeLat = 89.999; // minimal change; keep your behavior
	const latDeg = Math.max(-poleSafeLat, Math.min(poleSafeLat, centerLL.lat));
	const lonDeg = normalizeLon ? normalizeLon(centerLL.lon) : centerLL.lon;

	const lat = THREE.MathUtils.degToRad(latDeg);
	const lon = THREE.MathUtils.degToRad(lonDeg);

	// Point on unit sphere and local tangent basis (LOCAL coords)
	const clat = Math.cos(lat), slat = Math.sin(lat);
	const clon = Math.cos(lon), slon = Math.sin(lon);
	const pLocal = new THREE.Vector3(clat * clon, slat, clat * slon);
	const northLocal = new THREE.Vector3(-slat * clon, clat, -slat * slon).normalize();
	const eastLocal = new THREE.Vector3(-slon, 0, clon).normalize();

	// Rotate into WORLD space using the globe's orientation
	const qGlobe = globe.quaternion; // assumed normalized
	const p = pLocal.clone().applyQuaternion(qGlobe);
	const north = northLocal.clone().applyQuaternion(qGlobe);
	const east = eastLocal.clone().applyQuaternion(qGlobe);

	// Camera "screen up" in world space
	const camUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

	// Project screen-up into the tangent plane at p
	const upTangent = camUpWorld.clone().sub(p.clone().multiplyScalar(camUpWorld.dot(p)));

	const len2 = upTangent.lengthSq();
	if (len2 < 1e-12) return 0; // looking straight along the normal—bearing undefined; pick 0

	upTangent.multiplyScalar(1 / Math.sqrt(len2)); // normalize

	// Bearing: clockwise degrees from true north to projected screen-up
	const x = upTangent.dot(east);
	const y = upTangent.dot(north);
	let brg = THREE.MathUtils.radToDeg(Math.atan2(x, y)); // [-180,180]

	// Snap tiny jitter and kill -0
	if (Math.abs(brg) < 0.05) brg = 0;
	if (Object.is(brg, -0)) brg = 0;

	return brg; // in [-180,180]
}




// Add this helper function to force bearing application
function forceMapBearing(map, bearing, retries = 3) {

	return;

	/*
	if (!map || retries <= 0) return;

	try {
		map.stop();
		map.setBearing(bearing);

		// Verify it took effect
		setTimeout(() => {
			const actualBearing = map.getBearing();

			// Handle bearing wraparound: normalize both to [0, 360) and check difference
			const normalizedExpected = ((bearing % 360) + 360) % 360;
			const normalizedActual = ((actualBearing % 360) + 360) % 360;

			// Calculate the shortest angular difference
			let diff = Math.abs(normalizedActual - normalizedExpected);
			if (diff > 180) diff = 360 - diff;

			// If bearing didn't stick (allowing for small rounding errors), retry
			if (diff > 1.0) {
				console.warn(`Bearing application failed. Expected: ${bearing.toFixed(2)}° (normalized: ${normalizedExpected.toFixed(2)}°), Got: ${actualBearing.toFixed(2)}° (normalized: ${normalizedActual.toFixed(2)}°). Diff: ${diff.toFixed(2)}°. Retrying...`);
				forceMapBearing(map, bearing, retries - 1);
			} else {
				console.log(`Bearing successfully applied: ${actualBearing.toFixed(2)}° (expected: ${bearing.toFixed(2)}°, diff: ${diff.toFixed(2)}°)`);
			}
		}, 50);

	} catch (error) {
		console.error('Error applying bearing:', error);
		setTimeout(() => forceMapBearing(map, bearing, retries - 1), 100);
	}
	*/
}


function ensureMap(centerLL, zoom, stylePref) {

	const desiredTag = (stylePref === 'streets') ? 'streets' : 'aerial';

	// Capture pose once upstream; reuse it verbatim while entering 2D.
	const pose = _handoffPose || {
		center: { lat: centerLL.lat, lon: normalizeLon(centerLL.lon) },
		zoom,
		bearing: (() => {
			const b = screenNorthBearingDegAt(centerLL);
			return Number.isFinite(b) ? b : 0;
		})()
	};

	// Guard to avoid double-firing exit during hide/animate
	let _exiting2D = false;

	// ---------------- Reuse existing map instance ----------------
	if (map2d) {
		const needStyleChange = map2d._styleTag !== desiredTag;
		if (needStyleChange) {
			if (desiredTag === 'streets') map2d.setStyle(STREETS_STYLE_URL);
			else map2d.setStyle(AERIAL_STYLE_OBJ);
			map2d._styleTag = desiredTag;

			map2d.once('styledata', () => {
				if (_handoffPose) {
					try {
						map2d.stop();
						map2d.jumpTo({
							center: [_handoffPose.center.lon, _handoffPose.center.lat],
							zoom: _handoffPose.zoom,
							bearing: _handoffPose.bearing,
							pitch: 0
						});
						// Force bearing application
						setTimeout(() => {
							forceMapBearing(map2d, _handoffPose.bearing);
						}, 100);
					} catch (e) {
						console.error('Error in styledata handler:', e);
					}
				}
			});
		}

		// Apply pose immediately when just entering 2D
		if (_justEntered2D && _handoffPose) {
			try {
				map2d.stop();
				map2d.jumpTo({
					center: [_handoffPose.center.lon, _handoffPose.center.lat],
					zoom: _handoffPose.zoom,
					bearing: _handoffPose.bearing,
					pitch: 0
				});
				// Force bearing application (slight delay)
				setTimeout(() => {
					forceMapBearing(map2d, _handoffPose.bearing);
				}, 50);
				_justEntered2D = false;
			} catch (e) {
				console.error('Error applying handoff pose:', e);
			}
		}

		// ADD COUNTRY SELECTION: Ensure click handler is bound for reused maps
		if (!map2d._countryClickBound) {
			map2d.on('click', handle2DMapClick);
			map2d._countryClickBound = true;
		}

		bindExitHandlerOnce(map2d);
		return map2d;
	}

	// ---------------- Create map first time ----------------
	map2d = new maplibregl.Map({
		container: 'map2d',
		style: (desiredTag === 'streets') ? STREETS_STYLE_URL : AERIAL_STYLE_OBJ,
		center: [pose.center.lon, pose.center.lat],
		zoom: pose.zoom,
		bearing: pose.bearing,
		pitch: 0,
		attributionControl: true,
		// allow rotation with pitch locked to 0
		dragRotate: true,
		pitchWithRotate: false
	});
	map2d._styleTag = desiredTag;

	// Controls / gestures
	map2d.addControl(new maplibregl.NavigationControl(), 'top-right');
	if (map2d.scrollZoom?.enable) map2d.scrollZoom.enable({ around: 'pointer' });
	if (map2d.dragRotate?.enable) map2d.dragRotate.enable();
	if (map2d.touchZoomRotate?.enableRotation) map2d.touchZoomRotate.enableRotation();

	// ADD COUNTRY SELECTION: Bind click handler for new maps
	map2d.on('click', handle2DMapClick);
	map2d._countryClickBound = true;

	// After style load, assert the captured pose ONCE with force bearing
	map2d.once('styledata', () => {
		if (_handoffPose) {
			try {
				map2d.stop();
				map2d.jumpTo({
					center: [_handoffPose.center.lon, _handoffPose.center.lat],
					zoom: _handoffPose.zoom,
					bearing: _handoffPose.bearing,
					pitch: 0
				});
				setTimeout(() => {
					forceMapBearing(map2d, _handoffPose.bearing);
				}, 100);
			} catch (e) {
				console.error('Error in initial styledata handler:', e);
			}
		}
	});

	// Also force bearing after map is fully loaded
	map2d.once('load', () => {
		if (_handoffPose && Number.isFinite(_handoffPose.bearing)) {
			setTimeout(() => {
				forceMapBearing(map2d, _handoffPose.bearing);
			}, 200);
		}
	});

	// After style is ready, (re)create selection layers and sync current pick
	map2d.on('styledata', () => {
		if (!map2d.getSource('selected-country')) {
			ensure2DSelectionLayers();
		}
		if (lastSelectedCountry) {
			syncSelectionTo2D();
		}
	});

	map2d.once('load', () => {
		if (!map2d.getSource('selected-country')) {
			ensure2DSelectionLayers();
		}
		if (lastSelectedCountry) {
			syncSelectionTo2D();
		}
	});

	_lastMapBearing = map2d.getBearing();
	_mapBearingChanged = false;

	// Track rotation in 2D (tiny deadband)
	const _onRotate = () => {
		const b = map2d.getBearing();
		// smallest diff in [0..180]
		const diff = Math.abs(((b - _lastMapBearing + 540) % 360) - 180);
		if (diff > 0.05) {
			_mapBearingChanged = true;
			_lastMapBearing = b;
		}
	};
	map2d.on('rotate', _onRotate);

	bindExitHandlerOnce(map2d);
	return map2d;

	function bindExitHandlerOnce(map) {
		if (map._exitBound) return;

		let _exiting2D = false;

		const maybeExit2D = () => {
			if (!map2dVisible || _exiting2D) return;
			if (map.getZoom() > HANDOFF_Z_OUT) return;

			_exiting2D = true;
			try { map.stop(); } catch { }

			const c = map.getCenter();
			const center = { lat: c.lat, lon: normalizeLon(c.lng) };
			const b360 = ((map.getBearing() % 360) + 360) % 360;

			// Hide 2D first to avoid races with layout/paint
			hideMap2D(true);

			// Kill any residual 3D motion
			if (typeof spinVel !== 'undefined' && spinVel?.set) spinVel.set(0, 0, 0);
			if (typeof navTween !== 'undefined' && navTween?.stop) { try { navTween.stop(); } catch { } }
			navTween = null;

			// Near the poles, bearing is ill-defined — keep existing roll for stability
			const nearPole = Math.abs(center.lat) > 89.5;

			// Single, immediate handoff (no delayed "second" animation)
			animateCenterOnGlobe(center.lat, center.lon, {
				duration: 0,
				preserveRoll: nearPole,
				targetBearingDeg: nearPole ? undefined : b360
			});

			_exiting2D = false;
		};

		// One trigger is enough; avoids double firing
		map.on('zoomend', maybeExit2D);
		// map.on('moveend', maybeExit2D); // enable only if you really need it

		map._exitBound = true;
	}
}





function showMap2D(centerLL, zoom) {
	const stylePref = defaultMapStyleFromEarthControls();

	// Stop any ongoing navigation/motion
	if (typeof navTween !== 'undefined' && navTween && navTween.stop) {
		try { navTween.stop(); } catch (_) { }
	}
	navTween = null;
	if (spinVel && spinVel.set) spinVel.set(0, 0, 0);

	// Ensure matrices are up to date before measuring
	camera.updateMatrixWorld();
	globe.updateMatrixWorld();

	// Single, canonical bearing measurement
	const bearing = screenNorthBearingDegAt(centerLL);

	// Capture pose for 2D
	_handoffPose = {
		center: { lat: centerLL.lat, lon: normalizeLon(centerLL.lon) },
		zoom,
		bearing
	};
	_handoffGlobeQuaternion = globe.quaternion.clone();
	_justEntered2D = true;

	// Ensure / update the map instance
	ensureMap(centerLL, zoom, stylePref);

	// Show 2D overlay and disable 3D input
	mapDiv.classList.add('visible');
	map2dVisible = true;

	if (map2d?.isStyleLoaded?.()) {
		ensure2DSelectionLayers();
		if (lastSelectedCountry) syncSelectionTo2D();
	}

	renderer.domElement.style.pointerEvents = 'none';
	_preMapCamDist = cameraDistanceToGlobeCenter();

	// Assert pose into MapLibre
	if (map2d) {
		try { map2d.stop(); } catch (_) { }
		map2d.resize();

		// Immediate assert (covers already-loaded style)
		map2d.jumpTo({
			center: [_handoffPose.center.lon, _handoffPose.center.lat],
			zoom: _handoffPose.zoom,
			bearing: _handoffPose.bearing,
			pitch: 0
		});

		// Nudge bearing once more shortly after to defeat style/layout jitter
		setTimeout(() => {
			if (!_handoffPose) return;
			forceMapBearing(map2d, _handoffPose.bearing);
			// Keep 2D rotation state consistent for later handlers
			_lastMapBearing = map2d.getBearing();
			_mapBearingChanged = false;
		}, 100);

		// After a style reload, assert again and resync rotation state
		map2d.once('styledata', () => {
			const p = _handoffPose;
			if (!p) return;
			try {
				map2d.stop();
				map2d.jumpTo({
					center: [p.center.lon, p.center.lat],
					zoom: p.zoom,
					bearing: p.bearing,
					pitch: 0
				});
			} catch (_) { }
			setTimeout(() => {
				forceMapBearing(map2d, p.bearing);
				_lastMapBearing = map2d.getBearing();
				_mapBearingChanged = false;
			}, 100);
		});

		// Also after full load (first create path)
		map2d.once('load', () => {
			const p = _handoffPose;
			if (!p) return;
			setTimeout(() => {
				forceMapBearing(map2d, p.bearing);
				_lastMapBearing = map2d.getBearing();
				_mapBearingChanged = false;
			}, 200);
		});
	}

	// Hide 3D HUD while in 2D
	if (calloutEl) calloutEl.style.display = 'none';
	if (markersRoot) markersRoot.style.display = 'none';
}



function hideMap2D(nudgeOut = false) {
	mapDiv.classList.remove('visible');
	map2dVisible = false;
	renderer.domElement.style.pointerEvents = '';

	if (nudgeOut) {
		// Current estimated 3D zoom (works with either signature of estimateMapZoom)
		const ll = (typeof currentCenterLatLon === 'function') ? currentCenterLatLon() : { lat: 0, lon: 0 };
		const zNow = (estimateMapZoom.length >= 1) ? estimateMapZoom(ll) : estimateMapZoom();

		// Land just inside the OUT side with a very small push.
		// Aim roughly 0.2–0.3 zoom levels below IN, but cap the push so it never feels big.
		const safety = 0.005;
		const targetZ = Math.min(HANDOFF_Z_IN - 0.20, HANDOFF_Z_OUT - safety);

		if (Number.isFinite(zNow) && zNow > targetZ + 1e-3) {
			const delta = zNow - targetZ;                   // desired Δz
			const capped = Math.min(delta, 0.35);           // cap to ~0.35 levels max
			const factor = Math.pow(2, capped);             // distance multiplier for Δz
			const d0 = _preMapCamDist || cameraDistanceToGlobeCenter();
			setCameraDistance(d0 * factor);
		}

		_handoffCooldownUntil = performance.now() + 800;   // short cooldown
	}

	// Optional: restore markers visibility
	// if (markersRoot) markersRoot.style.display = chkLabels?.checked ? '' : 'none';

	_handoffPose = null;
	_handoffGlobeQuaternion = null;
	_mapBearingChanged = false;
}
