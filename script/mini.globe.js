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
    }
   
    init() {
        this.createCanvas();
        this.setupRenderer();
        this.createScene();
        this.addOrientationIndicators();
        this.addLabel();
       
        // Initial render to test
        this.render();
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
            opacity: 0.15 // Much more transparent
        });
        this.miniGlobe = new THREE.Mesh(geometry, material);
        this.scene.add(this.miniGlobe);
       
        // Add some basic lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
    }
   
    addOrientationIndicators() {
        if (!this.miniGlobe) return;
       
        // North pole indicator (thick red line)
        const northGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const northMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: false
        });
        const northPole = new THREE.Mesh(northGeometry, northMaterial);
        northPole.position.set(0, 1.1, 0); // Slightly above the globe surface
        this.miniGlobe.add(northPole);
       
        // South pole indicator (thick blue line)
        const southGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8);
        const southMaterial = new THREE.MeshBasicMaterial({
            color: 0x0066ff
        });
        const southPole = new THREE.Mesh(southGeometry, southMaterial);
        southPole.position.set(0, -1.1, 0); // Slightly below the globe surface
        this.miniGlobe.add(southPole);
       
        // Equator ring (green)
        const ringGeometry = new THREE.TorusGeometry(1.01, 0.015, 8, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00
        });
        const equatorRing = new THREE.Mesh(ringGeometry, ringMaterial);
        equatorRing.rotation.x = Math.PI / 2;
        this.miniGlobe.add(equatorRing);
       
        // Prime meridian indicator (yellow line)
        const lineGeometry = new THREE.CylinderGeometry(0.015, 0.015, 2.05, 8);
        const lineMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00
        });
        const meridianLine = new THREE.Mesh(lineGeometry, lineMaterial);
        meridianLine.position.set(1, 0, 0);
        meridianLine.rotation.z = Math.PI / 2;
        this.miniGlobe.add(meridianLine);
       
        // Add graticule
        this.addGraticule();
    }
   
    addGraticule() {
        if (!this.miniGlobe) return;
       
        const graticuleGroup = new THREE.Group();
       
        // Latitude lines (horizontal circles)
        for (let lat = -75; lat <= 75; lat += 15) {
            if (lat === 0) continue; // Skip equator (already drawn)
           
            const radius = Math.cos(THREE.MathUtils.degToRad(lat));
            const height = Math.sin(THREE.MathUtils.degToRad(lat));
           
            const latGeometry = new THREE.TorusGeometry(radius, 0.00625, 8, 32);
            const latMaterial = new THREE.MeshBasicMaterial({
                color: 0xaaaaaa,
                transparent: true,
                opacity: 0.8
            });
            const latLine = new THREE.Mesh(latGeometry, latMaterial);
            latLine.position.y = height;
            latLine.rotation.x = Math.PI / 2;
            graticuleGroup.add(latLine);
        }
       
        // Longitude lines (meridians)
        for (let lon = 0; lon < 360; lon += 15) {
            if (lon === 0) continue; // Skip prime meridian (already drawn)
           
            const lonGeometry = new THREE.CircleGeometry(1, 32);
            const lonMaterial = new THREE.LineBasicMaterial({
                color: 0xaaaaaa,
                transparent: true,
                opacity: 0.8
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
        label.style.bottom = '20px';
        label.style.right = '10px';
        label.style.color = '#00ff41'; // Classic terminal green
        label.style.fontSize = '12px';
        label.style.fontFamily = 'Monaco, "Lucida Console", "Courier New", monospace'; // Monospace terminal font
        label.style.textAlign = 'center';
        label.style.width = this.size + 'px';
        label.style.background = 'transparent'; // Transparent background
        label.style.padding = '6px';
        label.style.borderRadius = '4px';
        label.style.zIndex = '10000';
        label.style.textShadow = '0 0 8px #00ff41'; // Green glow effect like old terminals
        label.style.fontWeight = 'normal';
        label.textContent = '';
        label.id = 'mini-globe-label';
        document.body.appendChild(label);
       
        // Add N label overlaid on the canvas
        this.addPoleLabels();
    }
   
    addPoleLabels() {
        // North label
        const northLabel = document.createElement('div');
        northLabel.style.position = 'fixed';
        northLabel.style.bottom = this.size + 'px'; // Adjusted to be closer to north pole line
        northLabel.style.right = (20 + this.size/2 - 6) + 'px';
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
    }
   
    updateFromMainGlobe(globe, currentCenterLatLon, screenNorthBearingDegAt, map2dVisible) {
        if (!this.miniGlobe || !globe) return;
       
        // Copy exact rotation from main globe
        this.miniGlobe.quaternion.copy(globe.quaternion);
       
        // Update label with current bearing info
        const label = document.getElementById('mini-globe-label');
        if (label) {
            try {
                if (typeof currentCenterLatLon === 'function' && typeof screenNorthBearingDegAt === 'function') {
                    const centerLL = currentCenterLatLon();
                    const bearing = screenNorthBearingDegAt(centerLL);
                    const mode = map2dVisible ? '2D' : '3D';
                    label.textContent = `${mode}: ${bearing.toFixed(1)}°`;
                } else {
                    const mode = map2dVisible ? '2D' : '3D';
                    label.textContent = `${mode} Mode`;
                }
            } catch (e) {
                label.textContent = 'Error';
                console.warn('Mini globe update error:', e);
            }
        }
       
        this.render();
    }
   
    updateFrom2DMap(bearing, currentCenterLatLon, _handoffGlobeQuaternion) {
        if (!this.miniGlobe) return;
       
        // For now, just show a simple Y-axis rotation based on bearing
        const yRotation = THREE.MathUtils.degToRad(-bearing);
        this.miniGlobe.rotation.y = yRotation;
       
        // Update label
        const label = document.getElementById('mini-globe-label');
        if (label) {
            label.textContent = `2D: ${bearing.toFixed(1)}°`;
            label.style.color = 'yellow';
        }
       
        this.render();
    }
   
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
        if (label) {
            label.style.display = visible ? 'block' : 'none';
        }
        const northLabel = document.getElementById('mini-globe-north-label');
        if (northLabel) {
            northLabel.style.display = visible ? 'block' : 'none';
        }
    }
   
    toggle() {
        this.setVisible(!this.isVisible);
    }
   
    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        const label = document.getElementById('mini-globe-label');
        if (label && label.parentNode) {
            label.parentNode.removeChild(label);
        }
        const northLabel = document.getElementById('mini-globe-north-label');
        if (northLabel && northLabel.parentNode) {
            northLabel.parentNode.removeChild(northLabel);
        }
       
        if (this.renderer) {
            this.renderer.dispose();
        }
       
        // Reset instance state
        this.canvas = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.miniGlobe = null;
        this.handoffGlobeQuaternion = null;
    }
   
    // Main update method to be called from animation loop
    update(globe, currentCenterLatLon, screenNorthBearingDegAt, map2dVisible, map2d, _handoffGlobeQuaternion) {
        try {
            if (map2dVisible && map2d) {
                // In 2D mode: show what the orientation should be based on current 2D bearing
                const bearing = map2d.getBearing();
                this.updateFrom2DMap(bearing, currentCenterLatLon, _handoffGlobeQuaternion);
            } else {
                // In 3D mode: mirror the main globe exactly
                this.updateFromMainGlobe(globe, currentCenterLatLon, screenNorthBearingDegAt, map2dVisible);
            }
        } catch (e) {
            console.warn('Mini globe update failed:', e);
            // Fallback: just render the current state
            this.render();
        }
    }
}
