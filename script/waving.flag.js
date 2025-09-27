// waving.flag.js

import * as THREE from 'three';


export class WavingFlag {
    /**
     * @param {HTMLElement} mountEl
     * @param {Object} [opts]
     * Visuals & geometry
     * @param {boolean} [opts.transparent=true]     - Canvas alpha background.
     * @param {boolean} [opts.showPole=false]       - Render a pole to the left of the flag.
     * @param {boolean} [opts.useBox=false]         - Use thin box instead of plane.
     * @param {number}  [opts.flagWidth=4]          - Flag width in world units (4×3 requested).
     * @param {number}  [opts.flagHeight=3]         - Flag height in world units.
     * @param {number}  [opts.poleRadius=0.05]
     * @param {number}  [opts.poleGap=0.08]         - Gap between pole and flag edge.
     *
     * Animation
     * @param {{x:number,y:number}} [opts.frequency={x:5,y:3}]
     * @param {number}  [opts.strength=0.22]
     * @param {number}  [opts.animationSpeed=6.0]
     * @param {number}  [opts.segments=128]         - Subdivisions of the flag mesh.
     *
     * Camera & framing
     * @param {number}  [opts.fov=60]
     * @param {number}  [opts.fitMargin=1.10]       - Overall zoom-out padding (≥1).
     * @param {number}  [opts.leftPadFrac=0.04]     - Fraction of view width from the left.
     * @param {number}  [opts.topPadFrac=0.06]      - Fraction of view height from the top.
     *
     * Tight canvas mode (size canvas to content ~flag-only)
     * @param {boolean} [opts.tightCanvas=false]
     * @param {number}  [opts.targetPixelWidth=640] - Canvas width in pixels (4:3 → height).
     * @param {number}  [opts.tightMargin=1.06]     - Small padding when tightCanvas is true.
     *
     * Misc
     * @param {'anonymous'|''} [opts.crossOrigin='anonymous']
     * @param {number}  [opts.dpr=window.devicePixelRatio]
     * @param {string}  [opts.svgUrl]               - Optional initial URL to load.
     * @param {boolean} [opts.wireframe=false]
     */
    constructor(mountEl, opts = {}) {
        if (!mountEl || !(mountEl instanceof HTMLElement)) {
            throw new Error('WavingFlag: mountEl must be an HTMLElement.');
        }

        this.mountEl = mountEl;
        this.options = {
            // visuals & geometry
            transparent: opts.transparent ?? true,
            showPole: opts.showPole ?? false,
            useBox: opts.useBox ?? false,
            flagWidth: opts.flagWidth ?? 4,
            flagHeight: opts.flagHeight ?? 3,
            poleRadius: opts.poleRadius ?? 0.05,
            poleGap: opts.poleGap ?? 0.08,

            // animation
            frequency: { x: opts.frequency?.x ?? 5, y: opts.frequency?.y ?? 3 },
            strength: opts.strength ?? 0.22,
            animationSpeed: opts.animationSpeed ?? 6.0,
            segments: opts.segments ?? 128,

            // camera & framing
            fov: opts.fov ?? 60,
            fitMargin: opts.fitMargin ?? 1.10,
            leftPadFrac: opts.leftPadFrac ?? 0.04,
            topPadFrac: opts.topPadFrac ?? 0.06,

            // tight canvas mode
            tightCanvas: opts.tightCanvas ?? false,
            targetPixelWidth: opts.targetPixelWidth ?? 640,
            tightMargin: opts.tightMargin ?? 1.06,

            // misc
            crossOrigin: opts.crossOrigin ?? 'anonymous',
            dpr: opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
            svgUrl: opts.svgUrl ?? null,
            wireframe: opts.wireframe ?? false,

            offsetXFrac: opts.offsetXFrac ?? 0, // fraction of view width (+right, -left)
            offsetYFrac: opts.offsetYFrac ?? 0, // fraction of view height (+up, -down)
        };

        // --- Three.js core ---
        this.scene = new THREE.Scene();
        if (!this.options.transparent) {
            this.scene.background = new THREE.Color(0x0b0b0b);
        } else {
            this.scene.background = null;
        }

        this.camera = new THREE.PerspectiveCamera(this.options.fov, 1, 0.1, 100);
        this.camera.position.set(0, 0, 6);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: !!this.options.transparent,
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setPixelRatio(this.options.dpr);
        if (this.options.transparent) this.renderer.setClearColor(0x000000, 0);

        // DOM
        if (!this.mountEl.style.position) this.mountEl.style.position = 'relative';
        this.mountEl.appendChild(this.renderer.domElement);

        // Uniforms
        this.uniforms = {
            uFrequency: { value: new THREE.Vector2(this.options.frequency.x, this.options.frequency.y) },
            uTime: { value: 0 },
            uStrength: { value: this.options.strength },
            uTexture: { value: null },
        };

        // Group (flag + optional pole)
        this.flagGroup = new THREE.Group();
        this.scene.add(this.flagGroup);

        this._buildFlagAndPole();
        this._resize();
        this._frameScene(); // initial placement

        // Resize handling
        this._onResize = () => this._resize();
        window.addEventListener('resize', this._onResize, { passive: true });

        // Loop
        this._running = true;
        this._animate = this._animate.bind(this);
        this._raf = requestAnimationFrame(this._animate);

        if (this.options.svgUrl) this.setTextureUrl(this.options.svgUrl);
    }

    // ---------- Public API ----------

    start() {
        if (this._running) return;
        this._running = true;
        this._raf = requestAnimationFrame(this._animate);
    }

    stop() {
        if (!this._running) return;
        this._running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    configure({
        frequency, strength, animationSpeed, wireframe, segments,
        leftPadFrac, topPadFrac, fitMargin, showPole, transparent,
        tightCanvas, targetPixelWidth, tightMargin
    } = {}) {
        if (frequency) {
            if (typeof frequency.x === 'number') this.uniforms.uFrequency.value.x = frequency.x;
            if (typeof frequency.y === 'number') this.uniforms.uFrequency.value.y = frequency.y;
        }
        if (typeof strength === 'number') this.uniforms.uStrength.value = strength;
        if (typeof animationSpeed === 'number') this.options.animationSpeed = animationSpeed;
        if (typeof wireframe === 'boolean') {
            this.options.wireframe = wireframe;
            this.flagMesh.material.wireframe = wireframe;
            if (this.pole) this.pole.material.wireframe = wireframe;
        }
        if (typeof leftPadFrac === 'number') this.options.leftPadFrac = leftPadFrac;
        if (typeof topPadFrac === 'number') this.options.topPadFrac = topPadFrac;
        if (typeof fitMargin === 'number') this.options.fitMargin = fitMargin;

        if (typeof showPole === 'boolean' && showPole !== this.options.showPole) {
            this.options.showPole = showPole;
            // rebuild to add/remove pole cleanly
            this._rebuildFlag();
        }

        if (typeof transparent === 'boolean' && transparent !== this.options.transparent) {
            this.options.transparent = transparent;
            this.scene.background = transparent ? null : new THREE.Color(0x0b0b0b);
            this.renderer.setClearColor(0x000000, transparent ? 0 : 1);
        }

        if (typeof tightCanvas === 'boolean') this.options.tightCanvas = tightCanvas;
        if (typeof targetPixelWidth === 'number') this.options.targetPixelWidth = targetPixelWidth;
        if (typeof tightMargin === 'number') this.options.tightMargin = tightMargin;

        if (typeof segments === 'number' && segments !== this.options.segments) {
            this.options.segments = segments;
            this._rebuildFlag();
        }

        this._frameScene();
    }

    /**
     * Load an SVG URL as a crisp texture (hi-res rasterization).
     */
    async setTextureUrl(url) {
        if (!url) return;

        const targetW = 2048; // high-res 4:3 raster
        const targetH = 1536;

        try {
            const res = await fetch(url, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let svgText = await res.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgText, 'image/svg+xml');
            const svg = doc.documentElement;
            if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('Not an <svg>');

            const hasViewBox = svg.hasAttribute('viewBox');
            const toNum = (v) => (v ? parseFloat(String(v).replace(/[^0-9.\-eE]/g, '')) : NaN);
            let w = toNum(svg.getAttribute('width'));
            let h = toNum(svg.getAttribute('height'));

            if (!hasViewBox) {
                if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
                } else {
                    svg.setAttribute('viewBox', `0 0 4 3`);
                }
            }

            svg.setAttribute('width', `${targetW}`);
            svg.setAttribute('height', `${targetH}`);
            if (!svg.getAttribute('preserveAspectRatio')) {
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            }

            const fixedSvg = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([fixedSvg], { type: 'image/svg+xml' });
            const objUrl = URL.createObjectURL(blob);

            const img = new Image();
            img.crossOrigin = this.options.crossOrigin;
            img.src = objUrl;
            await img.decode();

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, targetW, targetH);
            ctx.drawImage(img, 0, 0, targetW, targetH);
            URL.revokeObjectURL(objUrl);

            let tex = this.uniforms.uTexture.value;
            if (!tex) {
                tex = new THREE.CanvasTexture(canvas);
                this.uniforms.uTexture.value = tex;
            } else {
                tex.image = canvas;
                tex.needsUpdate = true;
            }

            tex.colorSpace = THREE.SRGBColorSpace;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            this.flagMesh.scale.set(1, 1, 1);

            this._frameScene();
        } catch (err) {
            console.error('WavingFlag: failed to load/rasterize SVG:', err);
        }
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this._onResize);

        if (this.flagMesh) {
            this.flagGroup.remove(this.flagMesh);
            this.flagMesh.geometry?.dispose();
            this.flagMesh.material?.uniforms?.uTexture?.value?.dispose?.();
            this.flagMesh.material?.dispose();
            this.flagMesh = null;
        }
        if (this.pole) {
            this.flagGroup.remove(this.pole);
            this.pole.geometry?.dispose();
            this.pole.material?.dispose();
            this.pole = null;
        }

        this.renderer.renderLists?.dispose?.();
        this.renderer.dispose();
        if (this.renderer.domElement?.parentNode === this.mountEl) {
            this.mountEl.removeChild(this.renderer.domElement);
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.flagGroup = null;
        this.uniforms = null;
    }

    // ---------- Internals ----------

    _buildFlagAndPole() {
        const { flagWidth, flagHeight, segments, wireframe, useBox, poleRadius, poleGap, showPole } = this.options;

        const geom = useBox
            ? new THREE.BoxGeometry(flagWidth, flagHeight, 0.02, segments, segments, 1)
            : new THREE.PlaneGeometry(flagWidth, flagHeight, segments, segments);

        const vertexShader = `
      uniform mat4 projectionMatrix;
      uniform mat4 modelMatrix;
      uniform mat4 viewMatrix;
      uniform vec2 uFrequency;
      uniform float uTime;
      uniform float uStrength;

      attribute vec3 position;
      attribute vec2 uv;

      varying float vDark;
      varying vec2 vUv;

      void main() {
          float halfW = float(${flagWidth}) * 0.5;
          float xNorm = clamp((position.x + halfW) / (2.0 * halfW), 0.0, 1.0);

          float vWave = sin(position.x * uFrequency.x - uTime) * xNorm * uStrength;
          vWave += sin(position.y * uFrequency.y - uTime) * xNorm * uStrength * 0.5;

          vec4 modelPosition = modelMatrix * vec4(position, 1.0);

          modelPosition.x += sin(position.y + 1.575) * 0.25; // subtle curl
          modelPosition.y += sin(position.x * 2.0 + uTime * 0.5) * 0.05 * xNorm;
          modelPosition.z += vWave;

          gl_Position = projectionMatrix * viewMatrix * modelPosition;

          vUv = uv;
          vDark = vWave;
      }
    `;

        const fragmentShader = `
      precision mediump float;
      varying float vDark;
      uniform sampler2D uTexture;
      varying vec2 vUv;
      void main() {
          vec4 texColor = texture2D(uTexture, vUv);
          texColor.rgb *= vDark + 0.95;
          gl_FragColor = texColor;
      }
    `;

        const material = new THREE.RawShaderMaterial({
            vertexShader,
            fragmentShader,
            side: THREE.DoubleSide,
            wireframe,
            uniforms: this.uniforms,
            transparent: false,
        });

        this.flagMesh = new THREE.Mesh(geom, material);
        this.flagMesh.position.set(0, 0, 0);
        this.flagMesh.rotation.set(0, 0, 0);
        this.flagGroup.add(this.flagMesh);

        // Optional pole
        if (showPole) {
            const poleHeight = flagHeight * 2.2;
            const poleGeo = new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 20);
            const poleMat = new THREE.MeshBasicMaterial({ color: 0x333333, wireframe });
            this.pole = new THREE.Mesh(poleGeo, poleMat);

            const leftEdgeX = -flagWidth * 0.5;
            this.pole.position.set(leftEdgeX - poleGap, 0, 0);
            this.flagGroup.add(this.pole);
        } else {
            this.pole = null;
        }
    }

    _rebuildFlag() {
        const tex = this.uniforms.uTexture.value;

        // Remove old mesh + pole
        if (this.flagMesh) {
            this.flagGroup.remove(this.flagMesh);
            this.flagMesh.geometry?.dispose();
            this.flagMesh.material?.dispose();
            this.flagMesh = null;
        }
        if (this.pole) {
            this.flagGroup.remove(this.pole);
            this.pole.geometry?.dispose();
            this.pole.material?.dispose();
            this.pole = null;
        }

        this._buildFlagAndPole();
        this.uniforms.uTexture.value = tex;

        this._frameScene();
    }

    _containerSize() {
        const r = this.mountEl.getBoundingClientRect();
        return { width: Math.max(1, r.width | 0), height: Math.max(1, r.height | 0) };
    }

    _resize() {
        if (this.options.tightCanvas) {
            // In tight mode, _frameScene sets size/aspect; just reframe.
            this._frameScene();
            return;
        }
        const { width, height } = this._containerSize();
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this._frameScene();
    }

    /**
     * Fit content and place:
     *  - Left edge: pole (if visible) or flag left, at leftPadFrac of view width.
     *  - Top edge:  flag's top, at topPadFrac of view height.
     * Deterministic: resets group transform before measuring/placing.
     */
    _frameScene() {
        const fov = this.camera.fov * (Math.PI / 180);

        // 1) Baseline
        this.flagGroup.position.set(0, 0, 0);
        this.scene.updateMatrixWorld(true);

        // 2) Decide canvas size/aspect
        if (this.options.tightCanvas) {
            const w = Math.max(1, Math.floor(this.options.targetPixelWidth));
            const h = Math.max(1, Math.floor(w * (3 / 4))); // 4:3
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        } else {
            const { width, height } = this._containerSize();
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        // 3) Boxes: group for fitting; flag for top; left edge depends on pole visibility
        const fitBox = new THREE.Box3().setFromObject(this.flagGroup);
        const flagBox = new THREE.Box3().setFromObject(this.flagMesh);
        const leftBox = (this.options.showPole ? fitBox : flagBox);

        const size = new THREE.Vector3();
        fitBox.getSize(size);

        // 4) Compute distance to fit with margin
        const margin = this.options.tightCanvas ? this.options.tightMargin : this.options.fitMargin;
        const targetH = size.y * margin;
        const targetW = size.x * margin;

        const distH = targetH / (2 * Math.tan(fov / 2));
        const distW = (targetW / this.camera.aspect) / (2 * Math.tan(fov / 2));
        const dist = Math.max(distH, distW);

        // 5) View size at that distance
        const viewHalfH = Math.tan(fov / 2) * dist;
        const viewHalfW = viewHalfH * this.camera.aspect;
        const viewW = viewHalfW * 2;
        const viewH = viewHalfH * 2;

        // 6) Desired edges in view space
        const padLeft = (this.options.leftPadFrac ?? 0.04) * viewW;
        const padTop = (this.options.topPadFrac ?? 0.06) * viewH;

        const desiredMinX = -viewHalfW + padLeft;
        const desiredFlagTop = viewHalfH - padTop;

        // current edges...
        const curMinX = leftBox.min.x;
        const curFlagTop = flagBox.max.y;

        // base translation
        let dx = desiredMinX - curMinX;
        let dy = desiredFlagTop - curFlagTop;

        // >>> NEW: fractional nudges in view space (converted to world units)
        dx += (this.options.offsetXFrac ?? 0) * viewW; // +right, -left
        dy += (this.options.offsetYFrac ?? 0) * viewH; // +up, -down

        this.flagGroup.position.set(dx, dy, 0);

        // 9) Camera
        this.camera.position.set(0, 0, dist + 0.75);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        this.scene.updateMatrixWorld(true);
    }

    _animate(ts) {
        if (!this._running) return;
        this.uniforms.uTime.value = (ts * 0.001) * this.options.animationSpeed;
        this.renderer.render(this.scene, this.camera);
        this._raf = requestAnimationFrame(this._animate);
    }
}
