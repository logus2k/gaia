/*
// Usage: const menuManager = new MenuManager();
// Custom configuration
const menuManager = new MenuManager({
    menuPosition: 'top-left',
    menuLayout: 'vertical',
    menuIconSize: 50,
    initialVisibility: {
        settings: true,  // Show settings panel by default
        data: true       // Show data panel by default
    }
});
*/


export class MenuManager {

    constructor(config = {}) {
        this.cfg = {
            menuTargetId: config.menuTargetId || 'application-menu-container',
            menuPosition: config.menuPosition || 'top-right',
            iconSize: config.menuIconSize || 40,
            margin: config.menuMargin || 16,
            panelIds: config.panelIds || ['search', 'data', 'assistant', 'settings', 'about'],
            initialVisibility: config.initialVisibility || {},
        };

        this.menuEl = null;
        this.panels = {};
        this.moveables = new Map();
        this.topZ = 1000;

        this.#initMenu();
        this.#initPanels();
        this.#applyInitialVisibility();
    }

    // ------------------ public API ------------------
    showPanel(name) { this.#setPanelDisplay(name, true); }
    hidePanel(name) { this.#setPanelDisplay(name, false); }
    hideAll() { this.cfg.panelIds.forEach(id => this.hidePanel(id)); }
    destroy() {
        this.moveables.forEach(m => m.destroy && m.destroy());
        this.moveables.clear();
        if (this.menuEl && this.menuEl.parentNode) this.menuEl.parentNode.removeChild(this.menuEl);
        this.cfg.panelIds.forEach(id => {
            const p = this.panels[id];
            if (!p) return;
            const btn = p.querySelector('.pm-close');
            if (btn) btn.remove();
            p.style.cursor = '';
            p.onmousedown = null;
        });
    }

    // ------------------ internals ------------------
    #initMenu() {
        const target = document.getElementById(this.cfg.menuTargetId);
        if (!target) throw new Error(`Menu target #${this.cfg.menuTargetId} not found`);

        const wrap = document.createElement('div');
        wrap.className = `pm-menu pm-${this.cfg.menuPosition.replace(/\s+/g, '-')}`;
        wrap.style.setProperty('--pm-icon', `${this.cfg.iconSize}px`);
        wrap.style.setProperty('--pm-m', `${this.cfg.margin}px`);

        const items = [
            { id: 'search', icon: 'search', label: 'Search' },
            { id: 'data', icon: 'description', label: 'Data Explorer' },
            { id: 'assistant', icon: 'smart_toy', label: 'Assistant' },
            { id: 'settings', icon: 'settings', label: 'Settings' },
            { id: 'about', icon: 'info', label: 'About' },
        ];

        items.forEach(({ id, icon, label }) => {
            if (!this.cfg.panelIds.includes(id)) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.title = label;
            const i = document.createElement('span');
            i.className = 'material-symbols-outlined';
            i.textContent = icon;
            b.appendChild(i);
            b.addEventListener('click', () => {
                const isVisible = this.#isPanelShown(id);
                this.#setPanelDisplay(id, !isVisible);
                b.classList.toggle('active', !isVisible);
            });
            wrap.appendChild(b);
        });

        target.appendChild(wrap);
        this.menuEl = wrap;
    }

    #initPanels() {
        this.cfg.panelIds.forEach(id => {
            const el = document.getElementById(`hud-${id}`);
            if (!el) return;
            this.panels[id] = el;
            if (!getComputedStyle(el).position || getComputedStyle(el).position === 'static') {
                el.style.position = 'absolute';
            }

            if (!el.querySelector('.pm-close')) {
                const close = document.createElement('button');
                close.className = 'pm-close';
                close.textContent = '×';
                close.addEventListener('click', (e) => { e.stopPropagation(); this.#setPanelDisplay(id, false); this.#syncMenuBtn(id, false); });
                el.appendChild(close);
            }

            this.#makeDraggable(el, id);

            el.addEventListener('mousedown', () => {
                this.topZ += 1; el.style.zIndex = String(this.topZ);
            });
        });
    }




    #makeDraggable(panel, id) {
        if (typeof Moveable === 'undefined') {
            console.warn('Moveable not found: skipping drag/resize for', id);
            return;
        }

        // Root container for coordinates (all HUDs live in #overlay)
        const root = document.getElementById('overlay') || panel.offsetParent || document.body;

        // Ensure absolute positioning. DO NOT write transform/inset/overflow/etc.
        const cs = getComputedStyle(panel);
        if (!cs.position || cs.position === 'static') panel.style.position = 'absolute';

        // Drag by title only
        const headerEl = panel.querySelector('h1');

        // One Moveable per panel — all panels draggable + resizable
        const mv = new Moveable(root, {
            target: panel,
            draggable: true,
            resizable: true,
            origin: false,
            renderDirections: ['nw','n','ne','e','se','s','sw','w'],
            keepRatio: false,
            throttleDrag: 1,
            throttleResize: 1,
            snappable: false,
        });

        const toPx = v => (v === '' || v === 'auto') ? 0 : parseFloat(v) || 0;

        let allowDrag = false;
        let start = null;

        mv.on('dragStart', e => {
            const t = e.inputEvent && e.inputEvent.target;
            // strictly title-only
            allowDrag = !!(headerEl && t && (t === headerEl || headerEl.contains(t)));
            if (!allowDrag) { e.stop && e.stop(); return; }

            const pcs = getComputedStyle(panel);
            const parentRect = (root === document.body
                ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
                : root.getBoundingClientRect());
            const rect = panel.getBoundingClientRect();

            // Detect the current anchoring on each axis
            const usesRight  = pcs.right  !== 'auto' && pcs.right  !== '';
            const usesBottom = pcs.bottom !== 'auto' && pcs.bottom !== '';

            // Current anchors (px)
            const curLeft   = toPx(pcs.left);
            const curTop    = toPx(pcs.top);
            const curRight  = toPx(pcs.right);
            const curBottom = toPx(pcs.bottom);

            // Derive when CSS had 'auto'
            const derivedRight  = (parentRect.left + parentRect.width)  - (rect.left + rect.width);
            const derivedBottom = (parentRect.top  + parentRect.height) - (rect.top  + rect.height);

            start = {
                usesRight,
                usesBottom,
                left:   usesRight  ? null : (curLeft   || (rect.left - parentRect.left)),
                right:  usesRight  ? (curRight  || derivedRight)  : null,
                top:    usesBottom ? null : (curTop    || (rect.top  - parentRect.top)),
                bottom: usesBottom ? (curBottom || derivedBottom) : null
            };
        });

        mv.on('drag', ({ beforeDelta }) => {
            if (!allowDrag || !start) return;
            const [dx, dy] = beforeDelta;

            // Horizontal: keep original anchor
            if (start.usesRight) {
                const newRight = Math.max(0, start.right - dx);         // moving right => smaller 'right'
                panel.style.right = `${Math.round(newRight)}px`;
                panel.style.left  = 'auto';
            } else {
                const newLeft = Math.max(0, start.left + dx);
                panel.style.left  = `${Math.round(newLeft)}px`;
                panel.style.right = 'auto';
            }

            // Vertical: keep original anchor
            if (start.usesBottom) {
                const newBottom = Math.max(0, start.bottom - dy);       // moving down => smaller 'bottom'
                panel.style.bottom = `${Math.round(newBottom)}px`;
                panel.style.top    = 'auto';
            } else {
                const newTop = Math.max(0, start.top + dy);
                panel.style.top    = `${Math.round(newTop)}px`;
                panel.style.bottom = 'auto';
            }
        });

        mv.on('dragEnd', () => {
            allowDrag = false;
            start = null;
        });
        
        // --- Resize (width/height only; preserve anchors) ---
        mv.on('resizeStart', ({ set }) => {
            set([panel.offsetWidth, panel.offsetHeight]);
        });

        mv.on('resize', ({ width, height }) => {
            const w = Math.max(260, width);
            const h = Math.max(160, height);
            panel.style.width  = `${Math.round(w)}px`;
            panel.style.height = `${Math.round(h)}px`;
            // Note: we never touch left/right/top/bottom here
        });

        this.moveables.set(panel, mv);
    }





    #applyInitialVisibility() {
        Object.entries(this.cfg.initialVisibility).forEach(([id, vis]) => {
            if (!this.panels[id]) return;
            this.#setPanelDisplay(id, !!vis);
            this.#syncMenuBtn(id, !!vis);
        });
    }

    #setPanelDisplay(id, show) {
        const p = this.panels[id];
        if (!p) return;
        if (show) {
            p.classList.add('visible');
            this.topZ += 1;
            p.style.zIndex = String(this.topZ);
        } else {
            p.classList.remove('visible');
        }
    }

    #isPanelShown(id) {
        const p = this.panels[id];
        return !!p && p.classList.contains('visible');
    }

    #syncMenuBtn(id, active) {
        if (!this.menuEl) return;
        const btns = Array.from(this.menuEl.querySelectorAll('button'));
        const idx = this.cfg.panelIds.indexOf(id);
        const b = btns[idx];
        if (b) b.classList.toggle('active', !!active);
    }
}
