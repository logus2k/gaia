import * as THREE from 'three';
import { OrbitControls } from '../library/OrbitControls.js';

// ---------- Settings (baseline) ----------
const SETTINGS = {
	dayTexture: '../data/world.topo.bathy.200412.3x21600x10800.jpg',
	nightTexture: '../data/BlackMarble_2016_3km.jpg',
	topographyTexture: '../data/topography_3600_1800.png',
	bathymetryTexture: '../data/gebco_08_rev_bath_3600x1800_color.jpg',
	terrainTexture: '../data/eo_base_2020_clean_3600x1800.png',
	populationTexture: '../data/population_3600_1800.png',
	vegetationTexture: '../data/vegetation_3600_1800.png',
	land_temperatureTexture: '../data/land_temperature_3600_1800.png',
	land_cover_classificationTexture: '../data/land_cover_classification_3600_1800.png',
	cloudsTexture: '../data/fair_clouds_4k.png',
	skyTexture: '../data/eso0932a_xl.jpg',
	bordersGeoJSON: '../data/ne_10m_admin_0_countries.geojson',
	globeColorRGB: 0x0a2a43,
	globeColorAlpha: 1.0,
	earthRadiusKm: 6371
};


// ---------- 2D Map handoff (MapLibre) ----------
const TILE_SIZE = 512;           // WebMercator world size used by MapLibre zoom

const EARTH_R_METERS = SETTINGS.earthRadiusKm * 1000;

// Handoff thresholds (WebMercator zoom)
const HANDOFF_Z_IN = 5.0;
const HANDOFF_Z_OUT = 5.0;

let map2d = null;                   // MapLibre instance
let map2dVisible = false;
let lastEstimatedZ = 3.0;
let lastCenterLL = { lat: 0, lon: 0 };

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
selCanvas.width = 4096; selCanvas.height = 2048;
const selCtx = selCanvas.getContext('2d');
const selTex = new THREE.CanvasTexture(selCanvas);
selTex.colorSpace = THREE.SRGBColorSpace;
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
selectedOverlay.renderOrder = 1.5; // globe(0) < overlay(1.5) < clouds(1) if you want clouds above, set to 0.5 instead
globe.add(selectedOverlay);

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
	const coreGeom = buildCountryBordersGeometry(country.rings, R * 1.004);
	const coreMat = new THREE.LineBasicMaterial({
		color: rgb,
		transparent: alpha < 1,
		opacity: alpha,
		depthTest: true,
		depthWrite: true
	});
	const core = new THREE.LineSegments(coreGeom, coreMat);
	core.renderOrder = 6;

	// subtle glow (slightly lifted + additive)
	/*
	const glowGeom = buildCountryBordersGeometry(country.rings, R * 1.006);
	const glowMat = new THREE.LineBasicMaterial({
		color: rgb,
		transparent: true,
		opacity: Math.min(1, alpha * 0.5),
		blending: THREE.AdditiveBlending,
		depthTest: true,
		depthWrite: false
	});
	const glow = new THREE.LineSegments(glowGeom, glowMat);
	glow.renderOrder = 5;
	*/

	// selectedBordersGroup.add(glow, core);
	selectedBordersGroup.add(core);
	selectedBordersGroup.visible = true;
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
	const cands = [p.ADMIN, p.NAME_LONG, p.NAME, p.BRK_NAME, p.FORMAL_EN, p.ABBREV].filter(Boolean);
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
MarkerManager.addMarker('lisbon', { lat: 38.7223, lon: -9.1393, label: 'Lisbon' });
MarkerManager.addMarker('newyork', { lat: 40.7128, lon: -74.0060, label: 'New York' });
MarkerManager.addMarker('tokyo', { lat: 35.6762, lon: 139.6503, label: 'Tokyo' });


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

	function buildHTML({ title, lines }) {
		const L = (lines || []).map(s => `<div class="mini">${s}</div>`).join('');
		return `<h2 style="margin:0 0 6px 0; font-size:14px;">${title || 'Selected location'}</h2>${L}`;
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

	function show({ lat: la, lon: lo, title, lines }) {
		lat = la; lon = lo;
		calloutEl.innerHTML = buildHTML({ title, lines });
		addCloseButton();                     // ← add this line
		calloutEl.style.display = 'block';
		ensureLine();
		sizeCalloutSvgToViewport();
		active = true;
		update(true);
	}

	function hide() {
		active = false;
		calloutEl.style.display = 'none';
		if (lineEl) { lineEl.setAttribute('x1', '0'); lineEl.setAttribute('y1', '0'); lineEl.setAttribute('x2', '0'); lineEl.setAttribute('y2', '0'); }
		if (dotEl) dotEl.setAttribute('r', '0');

		// remove selection visuals
		clearSelectedBorders();
		clearSelectedFill();
		clearSelectionOverlay();

		lastSelectedCountry = null;
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


		// --- Compute globe center and screen-space radius along the anchor direction ---
		earth.getWorldPosition(globeCenterW);  // center is (0,0,0) in our scene, but this is robust
		const centerPx = worldToScreen(globeCenterW);
		// camera right vector → a point on the silhouette in world, then project to screen to get radius in px
		const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
		const edgeWorld = globeCenterW.clone().add(camRight.multiplyScalar(R * ATMO.scale)); // use atmo scale as visual rim
		const edgePx = worldToScreen(edgeWorld);
		const radiusPx = Math.hypot(edgePx.x - centerPx.x, edgePx.y - centerPx.y);

		// Screen coords for the anchor
		const a = worldToScreen(aboveWorld); // anchor px
		const vw = renderer.domElement.clientWidth;
		const vh = renderer.domElement.clientHeight;
		const PAD = 12;       // viewport padding
		const GAP = radiusPx * 0.25; // % of the globe’s on-screen radius
		const MAX_TOP = vh - PAD - calloutEl.offsetHeight;

		// Direction from center to anchor in screen space
		let vx = a.x - centerPx.x, vy = a.y - centerPx.y;
		const len = Math.hypot(vx, vy);
		if (len < 1e-3) {  // avoid degenerate, pick side by screen half
			vx = (a.x < vw * 0.5) ? -1 : 1; vy = 0;
		} else {
			vx /= len; vy /= len;
		}

		// Target panel edge position just outside the globe along (vx,vy)
		const px = centerPx.x + vx * (radiusPx + GAP);
		const py = centerPx.y + vy * (radiusPx + GAP);

		// Position panel so its near edge sits at (px,py)
		// If pointing right (vx>0): the panel’s left edge should be at px; else right edge at px.
		const panelW = calloutEl.offsetWidth || 280;
		const panelH = calloutEl.offsetHeight || 120;
		let leftPx;
		if (vx >= 0) {
			leftPx = Math.min(vw - PAD - panelW, Math.max(PAD, px));
		} else {
			leftPx = Math.min(vw - PAD, Math.max(PAD, px - panelW));
		}
		const topPx = Math.min(MAX_TOP, Math.max(PAD, py - panelH / 2));

		calloutEl.style.left = `${leftPx}px`;
		calloutEl.style.right = '';      // ensure left-based positioning
		calloutEl.style.top = `${topPx}px`;

		// Nearest point on the panel rect to the anchor (for the line end)
		const r = calloutEl.getBoundingClientRect();
		const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
		const x2 = clamp(a.x, r.left, r.right);
		const y2 = clamp(a.y, r.top, r.bottom);

		// Update SVG line (anchor → panel edge)
		lineEl.setAttribute('x1', String(a.x));
		lineEl.setAttribute('y1', String(a.y));
		lineEl.setAttribute('x2', String(x2));
		lineEl.setAttribute('y2', String(y2));

		// Update anchor dot right on the globe position
		dotEl.setAttribute('cx', String(a.x));
		dotEl.setAttribute('cy', String(a.y));
		dotEl.setAttribute('r', '3.5');
	}

	return { show, hide, update, isActive: () => active };
})();





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
	topography: null,
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
	searchStatus.textContent = `Countries indexed: ${COUNTRY_INDEX.length}`;
} catch (e) {
	console.error(e);
	searchStatus.textContent = `Failed to index countries (see console).`;
}

// ---------- HUD refs ----------
const modeSel = document.getElementById('mode');
const globeColorRow = document.getElementById('globeColorRow');
const globeColorPick = document.getElementById('globeColorPick');
const globeHexInput = document.getElementById('globeHex');
const chkStarsMotion = document.getElementById('toggle-stars-motion');
const chkClouds = document.getElementById('toggle-clouds');
/* cloudsModeSel removed */
const cloudsAdditiveChk = document.getElementById('clouds-additive');
const chkAtmo = document.getElementById('toggle-atmo');
const atmoColorRow = document.getElementById('atmoColorRow');
const atmoColorPick = document.getElementById('atmoColorPick');
const atmoHex = document.getElementById('atmoHex');
const chkLabels = document.getElementById('toggle-labels');
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
/* chkStarsReal removed */
const skyBright = document.getElementById('skyBright');
const speedInput = document.getElementById('speed');
const speedReadout = document.getElementById('speed-readout');
const speedReadoutKm = document.getElementById('speed-readout-km');
const sunTimeInput = document.getElementById('sunTime');
const sunReadout = document.getElementById('sun-readout');
const chkView = document.getElementById('toggle-view-readout');
const viewRow = document.getElementById('view-readout-row');
const viewCenterEl = document.getElementById('view-center');
const viewRollEl = document.getElementById('view-roll');

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

// Marker call-out
const calloutEl = document.getElementById('callout');
const calloutSvg = document.getElementById('callout-svg');



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
/* cloudsModeSel listener removed */
cloudsAdditiveChk.addEventListener('change', () => {
	// Checkbox toggles UNLIT vs LIT; we keep “always white” when checked
	const useUnlit = cloudsAdditiveChk.checked;
	const mat = useUnlit ? cloudsMatUnlit : cloudsMatLit;
	mat.blending = THREE.NormalBlending;
	mat.depthWrite = true;
	mat.needsUpdate = true;
	clouds.material = mat;
});


// Labels toggle
chkLabels.addEventListener('change', (e) => { MarkerManager.setVisible(e.target.checked); });
MarkerManager.setVisible(chkLabels.checked);

// View readout toggle
chkView.addEventListener('change', (e) => { viewRow.classList.toggle('hidden', !e.target.checked); });

// Lighting
function updateSunFromTime(tHours) {
	const lonDeg = (tHours / 24) * 360 - 180;
	const lon = THREE.MathUtils.degToRad(lonDeg); const radius = 10;
	dirLight.position.set(Math.cos(lon) * radius, 0, Math.sin(lon) * radius);
	sunReadout.textContent = `${tHours.toFixed(1)} h · lon ${Math.round(lonDeg)}°`;
}
chkLighting.addEventListener('change', (e) => {
	const lit = e.target.checked;
	earthActiveMat = lit ? earthMatLit : earthMatUnlit;
	earth.material = earthActiveMat;
	dirLight.intensity = lit ? 1.0 : 0.0;
	ambLight.intensity = 1.0;
	if (modeSel.value === 'none') applyGlobeColorAlpha();
});

updateSunFromTime(parseFloat(sunTimeInput.value));
sunTimeInput.addEventListener('input', () => { updateSunFromTime(parseFloat(sunTimeInput.value)); applySkyBrightness(); });

// Stars
chkStars.addEventListener('change', async (e) => {
	if (e.target.checked) { await ensureSky(); if (sky) sky.visible = true; starsControls.classList.remove('disabled'); applySkyBrightness(); }
	else if (sky) { sky.visible = false; starsControls.classList.add('disabled'); }
});
skyBaseBrightness = parseFloat(skyBright.value);
skyBright.addEventListener('input', async () => { skyBaseBrightness = parseFloat(skyBright.value); await ensureSky(); applySkyBrightness(); });


// Spin readout
let autorotateSpeed = parseFloat(speedInput.value); // rad/s
function formatPeriod(seconds) { if (!isFinite(seconds) || seconds > 864000) return '—'; const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; if (h > 0) return `${h}h ${m}m ${r}s`; if (m > 0) return `${m}m ${r}s`; return `${r}s`; }
function updateSpeedReadout(radPerSec) {
	const dps = radPerSec * 180 / Math.PI; const dir = (Math.abs(dps) < 1e-3) ? 'Stopped' : (dps > 0 ? 'Forward' : 'Reverse'); const sign = dps > 0 ? '+' : (dps < 0 ? '−' : '±');
	speedReadout.textContent = `${sign}${Math.abs(dps).toFixed(2)}°/s · ${dir}`;
	const v_kms = Math.abs(radPerSec) * SETTINGS.earthRadiusKm, v_kmh = v_kms * 3600;
	const period = (Math.abs(radPerSec) < 1e-6) ? Infinity : (2 * Math.PI / Math.abs(radPerSec));
	speedReadoutKm.textContent = `${v_kms.toFixed(3)} km/s · ${Math.round(v_kmh)} km/h · period ${formatPeriod(period)}`;
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
		if (mode === 'topography') tex = TEX.topography = await loadTexture(SETTINGS.topographyTexture);
		else if (mode === 'bathymetry') tex = TEX.bathymetry = await loadTexture(SETTINGS.bathymetryTexture);
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
await applyTextureMode('day'); modeSel.value = 'day';

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



let lastSelectedCountry = null;

function applySelectionStyling() {
	if (!lastSelectedCountry) { clearSelectionOverlay(); return; }

	const wantFill = selFillToggle.checked;
	const wantStroke = selBorderToggle.checked;

	const fill = wantFill ? parseHexRGBA(selFillHex.value) : null;
	const stroke = wantStroke ? parseHexRGBA(selBorderHex.value) : null;

	const fillRGBA = fill ? [(fill.rgb >> 16) & 255, (fill.rgb >> 8) & 255, fill.rgb & 255, fill.a] : null;
	const strokeRGBA = stroke ? [(stroke.rgb >> 16) & 255, (stroke.rgb >> 8) & 255, stroke.rgb & 255, stroke.a] : null;

	paintSelectionToOverlay(lastSelectedCountry, {
		fillRGBA,
		strokeRGBA,
		strokePx: 1  // tweakable; use 3–4 for thicker borders
	});
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

// ---- Smooth tween helpers for navigation & search ----
function computeTargetQuatForCenter(latDeg, lonDeg, opts = {}) {
	const q0 = globe.quaternion.clone();

	// Step 1: align target to view center
	const vLocal = latLonToVector3(latDeg, lonDeg, 1);
	const vWorld = vLocal.clone().applyQuaternion(q0).normalize();
	const desired = cameraViewDir().clone().negate();
	const qAlign = new THREE.Quaternion().setFromUnitVectors(vWorld, desired);
	let q = qAlign.multiply(q0); // q = qAlign * q0

	// Step 2: roll control
	const view = cameraViewDir();
	const northW = LOCAL_Y.clone().applyQuaternion(q).normalize();
	const a = northW.clone().projectOnPlane(view).normalize();
	const screenUpW = camera.up.clone().projectOnPlane(view).normalize();
	if (a.lengthSq() > 1e-12 && screenUpW.lengthSq() > 1e-12) {

		if (opts.preserveRoll) {
			// do nothing: keep whatever screen-roll we currently have
		} else if (typeof opts.targetBearingDeg === 'number') {
			// Compute the current screen-bearing of north after Step 1…
			const d = 0.20;
			const centerLL = { lat: latDeg, lon: lonDeg };
			const pC = latLonToVector3(centerLL.lat, centerLL.lon, R).applyQuaternion(q);
			const pN = latLonToVector3(centerLL.lat + d, centerLL.lon, R).applyQuaternion(q);
			const sC = worldToScreen(pC);
			const sN = worldToScreen(pN);
			const vx = sN.x - sC.x, vy = sN.y - sC.y;
			const curDeg = (THREE.MathUtils.radToDeg(Math.atan2(vx, -vy)) + 360) % 360;
			let delta = curDeg - opts.targetBearingDeg;
			delta = ((delta + 180) % 360) - 180; // shortest direction
			const qRoll = new THREE.Quaternion().setFromAxisAngle(view, THREE.MathUtils.degToRad(-delta));
			q = qRoll.multiply(q);
		} else {
			// default legacy behavior: north-up
			const angle = signedAngleAroundAxis(a, screenUpW, view);
			const qRoll = new THREE.Quaternion().setFromAxisAngle(view, angle);
			q = qRoll.multiply(q);
		}

	}
	return q;
}
function startNavTweenToQuat(qTarget, dur = 1200, onComplete) {
	spinVel.set(0, 0, 0);              // stop inertial spin while tweening
	navTween = {
		from: globe.quaternion.clone(),
		to: qTarget.clone(),
		t: 0,
		dur,
		lastQ: globe.quaternion.clone(),
		onComplete
	};
}

function animateCenterOnGlobe(latDeg, lonDeg, opts = {}) {
	const qTarget = computeTargetQuatForCenter(latDeg, lonDeg, opts);
	startNavTweenToQuat(qTarget, opts.duration ?? 1200, opts.onComplete);
}

/*
document.getElementById('btn-face-n').addEventListener('click', () => {
	animateCenterOnGlobe(90, 0);
});
document.getElementById('btn-face-s').addEventListener('click', () => {
	animateCenterOnGlobe(-90, 0);
});
document.getElementById('btn-face-0').addEventListener('click', () => {
	animateCenterOnGlobe(0, 0);
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
function updateViewReadout() {
	if (viewRow.classList.contains('hidden')) return;
	const hit = raySphereCenterPoint();
	if (!hit) { viewCenterEl.textContent = '—'; viewRollEl.textContent = '—'; return; }
	const { latDeg, lonDeg } = latLonFromWorldPoint(hit);
	viewCenterEl.textContent = `${formatLat(latDeg)}, ${formatLon(lonDeg)}`;
	const rollErr = computeNorthUpErrorDeg();
	viewRollEl.textContent = `North-up error: ${rollErr >= 0 ? '+' : ''}${rollErr.toFixed(1)}°`;
}

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

	requestAnimationFrame(animate);
	const dt = (now - last) / 1000; last = now;


	// --- 2D handoff check every ~250ms ---
	if (!animate._handoffTimer) animate._handoffTimer = 0;
		animate._handoffTimer += dt;
		if (animate._handoffTimer >= 0.10) {
		animate._handoffTimer = 0;
		tryEnter2D();
	}


	// If a navigation tween is active, drive it; else run autorotate/inertia
	if (navTween) {
		navTween.t += dt * 1000;
		const a = Math.min(1, navTween.t / navTween.dur);
		const e = Ease.cubicInOut(a);

		// slerp from->to
		const qCur = new THREE.Quaternion().slerpQuaternions(navTween.from, navTween.to, e);

		// delta from last to current
		const qPrev = navTween.lastQ;
		const qDelta = qPrev.clone().invert().multiply(qCur);

		// apply to globe
		globe.quaternion.copy(qCur);

		// counter-rotate sky if stars movement is enabled
		if (chkStarsMotion?.checked && sky) {
			const qInv = qDelta.clone().invert();
			sky.quaternion.premultiply(qInv);
		}

		navTween.lastQ = qCur;

		if (a >= 1) {
			const cb = navTween.onComplete;
			navTween = null;
			if (typeof cb === 'function') cb();
		}
	} else {
		// Autorotate
		if (!pointerIsDown && !map2dVisible) {
			const yaw = autorotateSpeed * dt;
			if (yaw) {
				// Always rotate the globe
				globe.rotateOnAxis(LOCAL_Y, yaw);
				const drift = autorotateSpeed * 0.25 * dt;
				if (drift) clouds.rotateOnAxis(LOCAL_Y, drift);

				// If enabled, make the stars appear to move by rotating the sky opposite the globe
				if (chkStarsMotion?.checked && sky) {
					sky.rotateOnAxis(LOCAL_Y, -yaw);
				}
			}
		}

		// Inertial spin (from drag)
		const speed = spinVel.length();
		if (speed > 1e-5) {
			const axis = spinVel.clone().normalize();
			const angle = speed * dt;
			qTmp.setFromAxisAngle(axis, angle);
			globe.quaternion.premultiply(qTmp);

			if (chkStarsMotion?.checked && sky) {
				const qInv = new THREE.Quaternion().setFromAxisAngle(axis, -angle);
				sky.quaternion.premultiply(qInv);
			}

			spinVel.multiplyScalar(decayFactor(dt));
		}
	}

	if (!map2dVisible && performance.now() >= _handoffCooldownUntil) {
		tryEnter2D();
	}


	atmoUniforms.sunDirW.value.copy(dirLight.position).normalize();

	controls.update();
	MarkerManager.update();
	Callout.update();

	applySkyBrightness();
	updateViewReadout();

	renderer.render(scene, camera);
})(last);

// ---------- Init ----------
await applyTextureMode('day'); modeSel.value = 'day';

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
	if (!hit) return;
	const { latDeg, lonDeg } = hit;
	const c = countryAtLonLat(lonDeg, latDeg);
	showPicked(latDeg, lonDeg, c);
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

function searchCountriesByName(q) {
	if (!COUNTRY_INDEX) return [];
	const s = q.trim().toLowerCase();
	if (!s) return [];
	const hits = [];
	for (const c of COUNTRY_INDEX) {
		for (const n of c.names) {
			if (String(n).toLowerCase().includes(s)) {
				hits.push(c); break;
			}
		}
	}
	// dedupe and sort by name length then alpha
	const seen = new Set(); const out = [];
	for (const c of hits) {
		if (seen.has(c.name)) continue;
		seen.add(c.name); out.push(c);
	}
	out.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
	return out.slice(0, 20);
}

function renderSearchResults(items, coords) {
	resultsBox.innerHTML = '';
	if ((items && items.length) || coords) {
		resultsBox.classList.remove('hidden');
	} else {
		resultsBox.classList.add('hidden');
		return;
	}
	if (coords) {
		const btn = document.createElement('button');
		btn.textContent = `Go to ${coords.lat.toFixed(4)}°, ${coords.lon.toFixed(4)}°`;
		btn.addEventListener('click', () => {
			// animateCenterOnGlobe(coords.lat, coords.lon); // smooth center
			showPicked(coords.lat, coords.lon, countryAtLonLat(coords.lon, coords.lat));
		});

		resultsBox.appendChild(btn);
	}
	for (const c of (items || [])) {
		const btn = document.createElement('button');
		const iso = c.iso3 ? ` (${c.iso3})` : '';
		btn.textContent = `${c.name}${iso}`;
		btn.addEventListener('click', () => {
			const { lat, lon } = c.centroid;
			// animateCenterOnGlobe(lat, lon); // smooth center for country result
			// keep current UX: show picked info immediately (no delay)
			showPicked(lat, lon, c);
		});
		resultsBox.appendChild(btn);
	}
}

function doSearch() {
	const q = searchBox.value;
	const coords = parseQueryToCoords(q);
	if (coords) {
		renderSearchResults([], coords);
		pickedInfo.textContent = `Parsed coordinates: ${formatLat(coords.lat)}, ${formatLon(coords.lon)}`;
		propsBox.classList.add('hidden'); propsList.innerHTML = '';
		return;
	}
	const items = searchCountriesByName(q);
	searchStatus.textContent = items.length ? `${items.length} result(s)` : 'No results';
	renderSearchResults(items, null);
}

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

// Bearing of "north" on screen at the current view center (degrees, clockwise from screen-up)
function screenNorthBearingDegAt(centerLL) {
	// Exact bearing from camera screen-up to true north on tangent plane at LL
	const lat = THREE.MathUtils.degToRad(centerLL.lat);
	const lon = THREE.MathUtils.degToRad(centerLL.lon);
	const clat = Math.cos(lat), slat = Math.sin(lat);
	const clon = Math.cos(lon), slon = Math.sin(lon);

	// Surface normal at LL
	const p = new THREE.Vector3(clat * clon, slat, clat * slon);

	// Local tangent basis: true north & east unit vectors
	const north = new THREE.Vector3(-slat * clon, clat, -slat * slon).normalize();
	const east = new THREE.Vector3(-slon, 0, clon).normalize();

	// Camera up in world space
	const camUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

	// Project screen-up into the tangent plane at p
	const upTangent = camUpWorld.clone().sub(p.clone().multiplyScalar(camUpWorld.dot(p)));
	if (upTangent.lengthSq() < 1e-12) return 0; // edge case

	upTangent.normalize();

	// Bearing = clockwise degrees from true north to projected screen-up
	const x = upTangent.dot(east);
	const y = upTangent.dot(north);
	let brg = THREE.MathUtils.radToDeg(Math.atan2(x, y));
	if (brg < 0) brg += 360;
	return brg;
}



let _handoffPose = null;

function ensureMap(centerLL, zoom, stylePref) {
	const desiredTag = (stylePref === 'streets') ? 'streets' : 'aerial';
	const bearing = (() => {
		const b = screenNorthBearingDegAt(centerLL);
		return Number.isFinite(b) ? b : 0;
	})();

	if (map2d) {
		// Reuse existing instance
		try { map2d.stop(); } catch (_) { }

		// Only change style if needed
		const needStyleChange = map2d._styleTag !== desiredTag;
		if (needStyleChange) {
			if (desiredTag === 'streets') map2d.setStyle(STREETS_STYLE_URL);
			else map2d.setStyle(AERIAL_STYLE_OBJ);
			map2d._styleTag = desiredTag;

			// After style load, assert the captured pose exactly
			map2d.once('styledata', () => {
				const p = _handoffPose || { center: centerLL, zoom, bearing };
				try { map2d.stop(); } catch (_) { }
				map2d.jumpTo({
					center: [p.center.lon, p.center.lat],
					zoom: p.zoom,
					bearing: p.bearing,
					pitch: 0
				});
			});
		}

		// Immediate assert (covers already-loaded style)
		const poseNow = _handoffPose || { center: centerLL, zoom, bearing };
		map2d.jumpTo({
			center: [poseNow.center.lon, poseNow.center.lat],
			zoom: poseNow.zoom,
			bearing: poseNow.bearing,
			pitch: 0
		});

		return map2d;
	}

	// Create the map (first time)
	map2d = new maplibregl.Map({
		container: 'map2d',
		style: (desiredTag === 'streets') ? STREETS_STYLE_URL : AERIAL_STYLE_OBJ,
		center: [centerLL.lon, centerLL.lat],
		zoom,
		bearing,
		pitch: 0,
		attributionControl: true
	});
	map2d._styleTag = desiredTag;

	// Basic controls
	map2d.addControl(new maplibregl.NavigationControl(), 'top-right');
	// Zoom around mouse pointer (noop if already enabled)
	if (map2d.scrollZoom && map2d.scrollZoom.enable) {
		map2d.scrollZoom.enable({ around: 'pointer' });
	}

	// After initial/any style load, assert the captured pose exactly
	map2d.once('styledata', () => {
		if (_handoffPose) {
			try { map2d.stop(); } catch (_) {}
			map2d.jumpTo({
			center: [_handoffPose.center.lon, _handoffPose.center.lat],
			zoom: _handoffPose.zoom,
			bearing: _handoffPose.bearing,
			pitch: 0
			});
		}
	});

	// ----- Exit back to 3D when zooming out past threshold -----
	const maybeExit2D = () => {
		if (!map2dVisible) return;                    // only if we’re currently in 2D
		const z = map2d.getZoom();
		if (z <= HANDOFF_Z_OUT) {
			try { map2d.stop(); } catch (_) { }          // freeze inertia/easing
			const c = map2d.getCenter();
			const b = map2d.getBearing();
			// Snap instantly to the same pose (no tween)
			animateCenterOnGlobe(c.lat, normalizeLon(c.lng), { targetBearingDeg: b, duration: 0 });
			// Ensure no residual motion carries over
			if (typeof spinVel !== 'undefined' && spinVel.set) spinVel.set(0, 0, 0);
			if (typeof navTween !== 'undefined') navTween = null;
			hideMap2D(true); // keep your nudge/cooldown to avoid immediate re-entry
		}
	};

	// Avoid duplicate bindings if ensureMap is called again
	if (map2d._maybeExit2D) {
		map2d.off('zoom', map2d._maybeExit2D);
		map2d.off('zoomend', map2d._maybeExit2D);
		map2d.off('moveend', map2d._maybeExit2D);
		map2d.off('wheel', map2d._maybeExit2D);
	}
	map2d._maybeExit2D = maybeExit2D;
	map2d.on('zoom', maybeExit2D);
	map2d.on('zoomend', maybeExit2D);
	map2d.on('moveend', maybeExit2D);
	map2d.on('wheel', maybeExit2D);

	return map2d;
}



function showMap2D(centerLL, zoom) {
	const stylePref = defaultMapStyleFromEarthControls();
	const bearing = (() => {
		const b = screenNorthBearingDegAt(centerLL);
		return Number.isFinite(b) ? b : 0;
	})();

	// Capture the exact pose we want MapLibre to use
	_handoffPose = {
		center: { lat: centerLL.lat, lon: normalizeLon(centerLL.lon) },
		zoom,
		bearing
	};

	ensureMap(centerLL, zoom, stylePref);

	// Show the overlay and route input to MapLibre
	mapDiv.classList.add('visible');
	map2dVisible = true;
	renderer.domElement.style.pointerEvents = 'none';
	navTween = null; spinVel.set(0, 0, 0);
	_preMapCamDist = cameraDistanceToGlobeCenter();

	// Make sure the map lays out and adopts the captured pose
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
		// Assert again right after any style reload finishes
		map2d.once('styledata', () => {
			const p = _handoffPose;
			if (p) {
				map2d.jumpTo({
					center: [p.center.lon, p.center.lat],
					zoom: p.zoom,
					bearing: p.bearing,
					pitch: 0
				});
			}
		});
	}

	// Optional: hide 3D HUD bits while 2D is up
	if (calloutEl) calloutEl.style.display = 'none';
	if (markersRoot) markersRoot.style.display = 'none';
}


function hideMap2D(nudgeOut = false) {
	mapDiv.classList.remove('visible');
	map2dVisible = false;
	renderer.domElement.style.pointerEvents = '';

	if (nudgeOut) {
		// Current estimated zoom (3D)
		// If your estimateMapZoom supports a center override, you can pass currentCenterLatLon() explicitly.
		const zNow = (estimateMapZoom.length >= 1) ? estimateMapZoom(currentCenterLatLon()) : estimateMapZoom();

		// Push to a target comfortably below HANDOFF_Z_IN.
		// Using OUT - 0.2 ensures we land *inside* the hysteresis band.
		const targetZ = Math.min(HANDOFF_Z_OUT - 0.2, HANDOFF_Z_IN - 0.6);

		if (zNow > targetZ) {
			// zoom distance scaling: Δz corresponds to multiplying distance by 2^(Δz)
			const delta = zNow - targetZ;
			const factor = Math.pow(2, delta);

			const d0 = _preMapCamDist || cameraDistanceToGlobeCenter();
			setCameraDistance(d0 * factor);
		}

		// Give the animation loop ample time before it can re-enter 2D again
		_handoffCooldownUntil = performance.now() + 1400; // 1.4s feels solid on trackpads
	}


	// Optional: restore markers visibility tied to your checkbox
	if (markersRoot) markersRoot.style.display = chkLabels?.checked ? '' : 'none';

	_handoffPose = null;
}
