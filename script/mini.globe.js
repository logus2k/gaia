import * as THREE from "three";

export class MiniGlobeOverlay {
    constructor() {
        this.size = 240;
        this.canvas = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.miniGlobe = null;
        this.isVisible = true;
        this.handoffGlobeQuaternion = null;

        // (Option B doesn't need this, kept harmlessly for future use)
        this.infoProvider = null;
    }

    setInfoProvider(fn) {
        this.infoProvider = typeof fn === 'function' ? fn : null;
    }
   
    init() {
        this.createCanvas();
        this.setupRenderer();
        this.createScene();
        this.addOrientationIndicators();
        this.addLabel();
        this.render(); // initial test render
    }
   
    createCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.canvas.style.position = 'fixed';
        this.canvas.style.bottom = '20px';
        this.canvas.style.right = '20px';
        this.canvas.style.zIndex = '10000';
        this.canvas.style.borderRadius = '8px';
        this.canvas.style.background = 'transparent';
        document.body.appendChild(this.canvas);
    }
   
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(this.size, this.size);
        this.renderer.setClearColor(0x000000, 0.0); // Fully transparent background
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    }
   
    createScene() {
        this.scene = new THREE.Scene();
       
        // Mini camera - positioned to see the globe clearly
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
        this.camera.position.set(0, 0, 3);
        this.camera.lookAt(0, 0, 0);
       
        // Very transparent globe
        const geometry = new THREE.SphereGeometry(1, 32, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x6699ff,
            transparent: true,
            opacity: 0.15
        });
        this.miniGlobe = new THREE.Mesh(geometry, material);
        this.scene.add(this.miniGlobe);
       
        // Basic lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
    }
   
    addOrientationIndicators() {
        if (!this.miniGlobe) return;
       
        // North pole indicator (thick red line)
        const northGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const northMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const northPole = new THREE.Mesh(northGeometry, northMaterial);
        northPole.position.set(0, 1.1, 0);
        this.miniGlobe.add(northPole);
       
        // South pole indicator (thick blue line)
        const southGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const southMaterial = new THREE.MeshBasicMaterial({ color: 0x0066ff });
        const southPole = new THREE.Mesh(southGeometry, southMaterial);
        southPole.position.set(0, -1.1, 0);
        this.miniGlobe.add(southPole);
       
        // West indicator (magenta line at 90°W)
        const westGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const westMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const westPole = new THREE.Mesh(westGeometry, westMaterial);
        westPole.position.set(0, 0, -1.1);
        westPole.rotation.x = Math.PI / 2;
        this.miniGlobe.add(westPole);
       
        // East indicator (cyan line at 90°E)
        const eastGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const eastMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const eastPole = new THREE.Mesh(eastGeometry, eastMaterial);
        eastPole.position.set(0, 0, 1.1);
        eastPole.rotation.x = Math.PI / 2;
        this.miniGlobe.add(eastPole);
       
        // Equator ring (green)
        const ringGeometry = new THREE.TorusGeometry(1.01, 0.015, 8, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const equatorRing = new THREE.Mesh(ringGeometry, ringMaterial);
        equatorRing.rotation.x = Math.PI / 2;
        this.miniGlobe.add(equatorRing);
       
        // Prime meridian indicator (yellow line)
        const lineGeometry = new THREE.CylinderGeometry(0.015, 0.015, 2.05, 8);
        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const meridianLine = new THREE.Mesh(lineGeometry, lineMaterial);
        meridianLine.position.set(1, 0, 0);
        meridianLine.rotation.z = Math.PI / 2;
        this.miniGlobe.add(meridianLine);
       
        // Graticule
        this.addGraticule();
    }
   
    addGraticule() {
        if (!this.miniGlobe) return;
       
        const graticuleGroup = new THREE.Group();
       
        // Latitude lines
        for (let lat = -75; lat <= 75; lat += 15) {
            if (lat === 0) continue; // skip equator (already drawn)
            const radius = Math.cos(THREE.MathUtils.degToRad(lat));
            const height = Math.sin(THREE.MathUtils.degToRad(lat));
            const latGeometry = new THREE.TorusGeometry(radius, 0.00625, 8, 32);
            const latMaterial = new THREE.MeshBasicMaterial({
                color: 0xaaaaaa, transparent: true, opacity: 0.8
            });
            const latLine = new THREE.Mesh(latGeometry, latMaterial);
            latLine.position.y = height;
            latLine.rotation.x = Math.PI / 2;
            graticuleGroup.add(latLine);
        }
       
        // Longitude lines
        for (let lon = 0; lon < 360; lon += 15) {
            if (lon === 0) continue; // skip prime meridian (already drawn)
            const lonGeometry = new THREE.CircleGeometry(1, 32);
            const lonMaterial = new THREE.LineBasicMaterial({
                color: 0xaaaaaa, transparent: true, opacity: 0.8
            });
            const lonLine = new THREE.Line(lonGeometry, lonMaterial);
            lonLine.rotation.y = THREE.MathUtils.degToRad(lon);
            graticuleGroup.add(lonLine);
        }
       
        this.miniGlobe.add(graticuleGroup);
    }
   
    addLabel() {
        const label = document.createElement('div');
        label.style.position = 'fixed';
        label.style.bottom = '10px';
        label.style.right = '20px';
        label.style.color = '#00ff41';
        label.style.fontSize = '11px';
        label.style.fontFamily = 'Monaco, "Lucida Console", "Courier New", monospace';
        label.style.textAlign = 'right';
        label.style.width = '1500px';
        label.style.background = 'transparent';
        label.style.padding = '6px';
        label.style.borderRadius = '4px';
        label.style.zIndex = '10000';
        label.style.textShadow = '0 0 4px #00ff41';
        label.style.fontWeight = 'normal';
        label.textContent = '';
        label.id = 'mini-globe-label';
        document.body.appendChild(label);
       
        // Add N label overlaid on the canvas and keep it aligned/offset
        this.addPoleLabels();
    }
   
    addPoleLabels() {
        // North label (dynamic, sticky with north pole)
        const northLabel = document.createElement('div');
        northLabel.style.position = 'fixed';
        northLabel.style.top = '0px';
        northLabel.style.color = 'white';
        northLabel.style.fontSize = '14px';
        northLabel.style.fontFamily = 'Arial, sans-serif';
        northLabel.style.fontWeight = 'bold';
        northLabel.style.textAlign = 'center';
        northLabel.style.width = '12px';
        northLabel.style.height = '12px';
        northLabel.style.zIndex = '10001';
        northLabel.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
        northLabel.style.pointerEvents = 'none';
        northLabel.textContent = 'N';
        northLabel.id = 'mini-globe-north-label';
        document.body.appendChild(northLabel);

        // Override render to also update the N label each frame
        this.render = () => {
            if (this.renderer && this.scene && this.camera && this.isVisible) {
                try {
                    const northLocal = new THREE.Vector3(0, 1.2, 0);
                    const southLocal = new THREE.Vector3(0, -1.2, 0);

                    this.miniGlobe.updateWorldMatrix(true, false);

                    const northWorld = northLocal.clone().applyMatrix4(this.miniGlobe.matrixWorld);
                    const southWorld = southLocal.clone().applyMatrix4(this.miniGlobe.matrixWorld);

                    const toScreenPosition = (position, camera) => {
                        const v = position.clone().project(camera);
                        const rect = this.canvas.getBoundingClientRect();
                        return {
                            x: (v.x * 0.5 + 0.5) * this.size + rect.left,
                            y: -(v.y * 0.5 - 0.5) * this.size + rect.top,
                            z: v.z
                        };
                    };

                    const northScreen = toScreenPosition(northWorld, this.camera);
                    const southScreen = toScreenPosition(southWorld, this.camera);

                    if (northScreen.z > 0) {
                        const dx = northScreen.x - southScreen.x;
                        const dy = northScreen.y - southScreen.y;
                        const angleRad = Math.atan2(dy, dx);
                        const angleDeg = angleRad * 180 / Math.PI;

                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ux = dx / len, uy = dy / len;

                        const offset = 12; // outward offset
                        const px = northScreen.x + ux * offset;
                        const py = northScreen.y + uy * offset;

                        northLabel.style.left = `${px}px`;
                        northLabel.style.top  = `${py}px`;
                        northLabel.style.display = 'block';
                        northLabel.style.transformOrigin = '50% 50%';
                        northLabel.style.transform = `translate(-50%, -50%) rotate(${angleDeg + 90}deg)`;
                    } else {
                        northLabel.style.display = 'none';
                    }

                    this.renderer.render(this.scene, this.camera);
                } catch (e) {
                    console.error('Mini globe render error:', e);
                }
            }
        };
    }

    // -------- Option B: telemetry-driven update --------

    // Main update method (telemetry object is built in app.js)
    update(globe, telemetry) {
        try {
            if (!telemetry) { this.render(); return; }
            if (telemetry.mode === '2d') {
                this.updateFrom2DTelemetry(telemetry);
            } else {
                this.updateFrom3DTelemetry(globe, telemetry);
            }
        } catch (e) {
            console.warn('Mini globe update failed:', e);
            this.render();
        }
    }

    // 3D path: copy globe quaternion; build label from telemetry
    updateFrom3DTelemetry(globe, telemetry) {
        if (!this.miniGlobe || !globe) return;

        // Mirror main globe orientation + 180° Y tweak
        this.miniGlobe.quaternion.copy(globe.quaternion);
        const offsetY180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        this.miniGlobe.quaternion.multiply(offsetY180);

        // Build label
        const label = document.getElementById('mini-globe-label');
        if (label) {
            const lat = telemetry.centerLL?.lat, lon = telemetry.centerLL?.lon;

            const altitudeStr = Number.isFinite(telemetry.altitudeKm)
              ? `${telemetry.altitudeKm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Km`
              : '—';

            const bearingStr = Number.isFinite(telemetry.bearingDeg)
              ? `${telemetry.bearingDeg.toFixed(1)}°`
              : '—';

            const speedStr = Number.isFinite(telemetry.speedKmh)
              ? `${telemetry.speedKmh.toLocaleString(undefined, { maximumFractionDigits: 2 })} Km/h`
              : '—';

            const parts = [
              `TIME ${telemetry.timeUTC ?? '—'}`,
              `LOCATION ${telemetry.location ?? '—'}`,
              `SUNSET ${telemetry.sunset ?? '—'}`,
              `SPEED ${speedStr}`,
              `ALTITUDE ${altitudeStr}`,
              `BEARING ${bearingStr}`,
              `LATITUDE ${Number.isFinite(lat) ? lat.toFixed(2) : '—'}`,
              `LONGITUDE ${Number.isFinite(lon) ? lon.toFixed(2) : '—'}`,
              `STATUS ${telemetry.status ?? 'Online'}`
            ];

            label.textContent = parts.join(' | ');
        }

        this.render();
    }

    // 2D path: rotate about Y by -bearing; build label from telemetry
    updateFrom2DTelemetry(telemetry) {
        if (!this.miniGlobe) return;

        const b = Number.isFinite(telemetry.mapBearingDeg) ? telemetry.mapBearingDeg : 0;
        this.miniGlobe.rotation.y = THREE.MathUtils.degToRad(-b);

        const label = document.getElementById('mini-globe-label');
        if (label) {
            const lat = telemetry.centerLL?.lat, lon = telemetry.centerLL?.lon;

            const altitudeStr = Number.isFinite(telemetry.altitudeKm)
              ? `${telemetry.altitudeKm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Km`
              : '—';

            const bearingStr = Number.isFinite(telemetry.bearingDeg)
              ? `${telemetry.bearingDeg.toFixed(1)}°`
              : '—';

            const speedStr = Number.isFinite(telemetry.speedKmh)
              ? `${telemetry.speedKmh.toLocaleString(undefined, { maximumFractionDigits: 2 })} Km/h`
              : '—';

            const parts = [
              `TIME ${telemetry.timeUTC ?? '—'}`,
              `LOCATION ${telemetry.location ?? '—'}`,
              `SUNSET ${telemetry.sunset ?? '—'}`,
              `SPEED ${speedStr}`,
              `ALTITUDE ${altitudeStr}`,
              `BEARING ${bearingStr}`,
              `LATITUDE ${Number.isFinite(lat) ? lat.toFixed(2) : '—'}`,
              `LONGITUDE ${Number.isFinite(lon) ? lon.toFixed(2) : '—'}`,
              `STATUS ${telemetry.status ?? 'Online'}`
            ];

            label.textContent = parts.join(' | ');
            // Optional 2D cue:
            // label.style.color = 'yellow';
        }

        this.render();
    }

    // -------- Back-compat shims (safe no-ops if not used) --------

    // Old 3D path signature – rebuild minimal telemetry and forward
    updateFromMainGlobe(globe, currentCenterLatLon, screenNorthBearingDegAt /*, map2dVisible */) {
        const ll = typeof currentCenterLatLon === 'function' ? currentCenterLatLon() : { lat: NaN, lon: NaN };
        const bearing = typeof screenNorthBearingDegAt === 'function' ? screenNorthBearingDegAt(ll) : NaN;
        const telemetry = { mode: '3d', centerLL: ll, bearingDeg: bearing };
        this.updateFrom3DTelemetry(globe, telemetry);
    }

    // Old 2D path signature – rebuild minimal telemetry and forward
    updateFrom2DMap(bearingDeg, currentCenterLatLon /*, _handoffGlobeQuaternion */) {
        const ll = typeof currentCenterLatLon === 'function' ? currentCenterLatLon() : { lat: NaN, lon: NaN };
        const telemetry = { mode: '2d', mapBearingDeg: bearingDeg, bearingDeg, centerLL: ll };
        this.updateFrom2DTelemetry(telemetry);
    }

    // -------- Common --------
   
    render() {
        if (this.renderer && this.scene && this.camera && this.isVisible) {
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (e) {
                console.error('Mini globe render error:', e);
            }
        }
    }
   
    setVisible(visible) {
        this.isVisible = visible;
        if (this.canvas) {
            this.canvas.style.display = visible ? 'block' : 'none';
        }
        const label = document.getElementById('mini-globe-label');
        if (label) label.style.display = visible ? 'block' : 'none';
        const northLabel = document.getElementById('mini-globe-north-label');
        if (northLabel) northLabel.style.display = visible ? 'block' : 'none';
    }
   
    toggle() {
        this.setVisible(!this.isVisible);
    }
   
    destroy() {
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        const label = document.getElementById('mini-globe-label');
        if (label && label.parentNode) label.parentNode.removeChild(label);
        const northLabel = document.getElementById('mini-globe-north-label');
        if (northLabel && northLabel.parentNode) northLabel.parentNode.removeChild(northLabel);
        if (this.renderer) this.renderer.dispose();
       
        // Reset instance state
        this.canvas = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.miniGlobe = null;
        this.handoffGlobeQuaternion = null;
    }
}
