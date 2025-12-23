// waving_flag_final.js - Production version with destruction safeguards

import * as THREE from 'three';

export class WavingFlag {
    constructor(mountEl, opts = {}, sharedRenderer = null) {
        if (!mountEl || !(mountEl instanceof HTMLElement)) {
            throw new Error('WavingFlag: mountEl must be an HTMLElement.');
        }

        this.mountEl = mountEl;
        this.renderer = sharedRenderer;
        this._ownsRenderer = !sharedRenderer;
        this._destroyed = false; // Track destruction state

        this.options = {
            transparent: opts.transparent ?? true,
            showPole: opts.showPole ?? false,
            useBox: opts.useBox ?? false,
            flagWidth: opts.flagWidth ?? 4,
            flagHeight: opts.flagHeight ?? 3,
            poleRadius: opts.poleRadius ?? 0.05,
            poleGap: opts.poleGap ?? 0.08,
            frequency: { x: opts.frequency?.x ?? 5, y: opts.frequency?.y ?? 3 },
            strength: opts.strength ?? 0.22,
            animationSpeed: opts.animationSpeed ?? 6.0,
            segments: opts.segments ?? 128,
            fov: opts.fov ?? 60,
            fitMargin: opts.fitMargin ?? 1.10,
            leftPadFrac: opts.leftPadFrac ?? 0.04,
            topPadFrac: opts.topPadFrac ?? 0.06,
            tightCanvas: opts.tightCanvas ?? false,
            targetPixelWidth: opts.targetPixelWidth ?? 640,
            tightMargin: opts.tightMargin ?? 1.06,
            crossOrigin: opts.crossOrigin ?? 'anonymous',
            dpr: opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
            svgUrl: opts.svgUrl ?? null,
            wireframe: opts.wireframe ?? false,
            offsetXFrac: opts.offsetXFrac ?? 0,
            offsetYFrac: opts.offsetYFrac ?? 0,
        };

        const style = this.mountEl.style;
        if (!style.position) style.position = 'relative';

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.camera = new THREE.PerspectiveCamera(this.options.fov, 1, 0.1, 100);
        this.camera.position.set(0, 0, 6);
        this.camera.lookAt(0, 0, 0);

        if (!this.renderer) {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: !!this.options.transparent,
            });
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.setPixelRatio(this.options.dpr);
            if (this.options.transparent) this.renderer.setClearColor(0x000000, 0);
            this.mountEl.appendChild(this.renderer.domElement);
        }

        this.uniforms = {
            uFrequency: { value: new THREE.Vector2(this.options.frequency.x, this.options.frequency.y) },
            uTime: { value: 0 },
            uStrength: { value: this.options.strength },
            uTexture: { value: null },
        };

        this.flagGroup = new THREE.Group();
        this.scene.add(this.flagGroup);

        this._buildFlagAndPole();
        this._resize();
        this._frameScene();

        if (this._ownsRenderer) {
            this._onResize = () => this._resize();
            window.addEventListener('resize', this._onResize, { passive: true });
            this._running = true;
            this._animate = this._animate.bind(this);
            this._raf = requestAnimationFrame(this._animate);
        }

        if (this.options.svgUrl) {
            this.setTextureUrl(this.options.svgUrl);
        }
    }

    update(timeMs) {
        if (this._destroyed) return; // Guard against destroyed instance
        if (typeof timeMs === 'number') {
            this.uniforms.uTime.value = (timeMs * 0.001) * this.options.animationSpeed;
        }
    }

    render() {
        // Critical guard: don't render if destroyed
        if (this._destroyed) {
            return;
        }

        if (!this.renderer) {
            return;
        }

        const rect = this.mountEl.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;

        const r = this.renderer;
        const canvas = r.domElement;
        const dpr = r.getPixelRatio();

        const prevViewport = r.getViewport(new THREE.Vector4());
        const prevScissor = r.getScissor(new THREE.Vector4());
        const prevScissorTest = r.getScissorTest();

        const x = Math.floor(rect.left * dpr);
        const y = Math.floor((canvas.clientHeight - rect.bottom) * dpr);
        const w = Math.floor(rect.width * dpr);
        const h = Math.floor(rect.height * dpr);

        r.setScissorTest(true);
        r.setViewport(x, y, w, h);
        r.setScissor(x, y, w, h);

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();

        r.render(this.scene, this.camera);

        r.setViewport(prevViewport);
        r.setScissor(prevScissor);
        r.setScissorTest(prevScissorTest);
    }

    async setTextureUrl(url) {
        if (!url || this._destroyed) return;

        const targetW = 2048;
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
            if (!hasViewBox) {
                const w = svg.getAttribute('width') || '100';
                const h = svg.getAttribute('height') || '100';
                svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
            svg.setAttribute('width', targetW);
            svg.setAttribute('height', targetH);

            const serializer = new XMLSerializer();
            svgText = serializer.serializeToString(svg);

            const img = new Image();
            img.crossOrigin = this.options.crossOrigin;
            img.src = 'data:image/svg+xml;base64,' + btoa(svgText);
            await img.decode();

            // Check if destroyed during async operation
            if (this._destroyed) return;

            const gl = this.renderer.getContext();
            const MAX = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            const w = Math.min(targetW, MAX);
            const h = Math.min(targetH, MAX);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;

            if (!this._destroyed) {
                this.uniforms.uTexture.value = tex;
            } else {
                tex.dispose(); // Clean up if destroyed during load
            }
        } catch (err) {
            console.error('WavingFlag setTextureUrl error:', err);
        }
    }

    destroy() {
        if (this._destroyed) return; // Prevent double-destroy
        this._destroyed = true;

        if (this._ownsRenderer) {
            this.stop();
            if (this._onResize) {
                window.removeEventListener('resize', this._onResize);
                this._onResize = null;
            }
        }

        if (this.flagMesh) {
            this.scene.remove(this.flagMesh);
            this.flagMesh.geometry?.dispose();
            this.flagMesh.material?.dispose();
            this.flagMesh = null;
        }

        if (this.pole) {
            this.scene.remove(this.pole);
            this.pole.geometry?.dispose();
            this.pole.material?.dispose();
            this.pole = null;
        }

        if (this.uniforms?.uTexture?.value) {
            this.uniforms.uTexture.value.dispose();
        }

        if (this._ownsRenderer && this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }

        // Nullify references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.flagGroup = null;
        this.uniforms = null;
        this.mountEl = null;
    }

    stop() {
        if (!this._ownsRenderer || !this._running) return;
        this._running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

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
          float halfW = ${flagWidth.toFixed(1)} * 0.5;
          float xNorm = clamp((position.x + halfW) / (2.0 * halfW), 0.0, 1.0);
          float vWave = sin(position.x * uFrequency.x - uTime) * xNorm * uStrength;
          vWave += sin(position.y * uFrequency.y - uTime) * xNorm * uStrength * 0.5;
          vec4 modelPosition = modelMatrix * vec4(position, 1.0);
          modelPosition.x += sin(position.y + 1.575) * 0.25;
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
            transparent: true,
        });

        this.flagMesh = new THREE.Mesh(geom, material);
        this.flagGroup.add(this.flagMesh);

        if (showPole) {
            const poleHeight = flagHeight * 2.2;
            const poleGeo = new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 20);
            const poleMat = new THREE.MeshBasicMaterial({ color: 0x333333, wireframe });
            this.pole = new THREE.Mesh(poleGeo, poleMat);
            const leftEdgeX = -flagWidth * 0.5;
            this.pole.position.set(leftEdgeX - poleGap, 0, 0);
            this.flagGroup.add(this.pole);
        }
    }

    _resize() {
        if (!this._ownsRenderer) return;
        if (this.options.tightCanvas) {
            this._frameScene();
            return;
        }
        const { width, height } = this._containerSize();
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this._frameScene();
    }

    _containerSize() {
        const r = this.mountEl.getBoundingClientRect();
        return { width: Math.max(1, r.width | 0), height: Math.max(1, r.height | 0) };
    }

    _frameScene() {
        const fov = this.camera.fov * (Math.PI / 180);
        this.flagGroup.position.set(0, 0, 0);
        this.scene.updateMatrixWorld(true);

        if (this._ownsRenderer && this.options.tightCanvas) {
            const w = Math.max(1, Math.floor(this.options.targetPixelWidth));
            const h = Math.max(1, Math.floor(w * (3 / 4)));
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        } else if (this._ownsRenderer) {
            const { width, height } = this._containerSize();
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        } else {
            const { width, height } = this._containerSize();
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        const fitBox = new THREE.Box3().setFromObject(this.flagGroup);
        const flagBox = new THREE.Box3().setFromObject(this.flagMesh);
        const leftBox = (this.options.showPole ? fitBox : flagBox);

        const size = new THREE.Vector3();
        fitBox.getSize(size);

        const margin = this.options.tightCanvas ? this.options.tightMargin : this.options.fitMargin;
        const targetH = size.y * margin;
        const targetW = size.x * margin;

        const distH = targetH / (2 * Math.tan(fov / 2));
        const distW = (targetW / this.camera.aspect) / (2 * Math.tan(fov / 2));
        const dist = Math.max(distH, distW);

        const viewHalfH = Math.tan(fov / 2) * dist;
        const viewHalfW = viewHalfH * this.camera.aspect;
        const viewW = viewHalfW * 2;
        const viewH = viewHalfH * 2;

        const padLeft = (this.options.leftPadFrac ?? 0.04) * viewW;
        const padTop = (this.options.topPadFrac ?? 0.06) * viewH;

        const desiredMinX = -viewHalfW + padLeft;
        const desiredFlagTop = viewHalfH - padTop;

        const curMinX = leftBox.min.x;
        const curFlagTop = flagBox.max.y;

        let dx = desiredMinX - curMinX;
        let dy = desiredFlagTop - curFlagTop;

        dx += (this.options.offsetXFrac ?? 0) * viewW;
        dy += (this.options.offsetYFrac ?? 0) * viewH;

        this.flagGroup.position.set(dx, dy, 0);

        this.camera.position.set(0, 0, dist + 0.75);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        this.scene.updateMatrixWorld(true);
    }

    _animate(ts) {
        if (!this._running || this._destroyed) return;
        this.uniforms.uTime.value = (ts * 0.001) * this.options.animationSpeed;
        this.renderer.render(this.scene, this.camera);
        this._raf = requestAnimationFrame(this._animate);
    }
}
