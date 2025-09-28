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
            panelIds: config.panelIds || ['search', 'data', 'assistant', 'about', 'settings'],
            initialVisibility: config.initialVisibility || {},
        };

        this.menuEl = null;
        this.panels = {};
        this.moveables = new Map();
        this.topZ = 10;
        this.positions = new WeakMap();

        this.tx = 0;
        this.ty = 0;

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
            { id: 'about', icon: 'info', label: 'About' },
            { id: 'settings', icon: 'settings', label: 'Settings' }
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
                close.addEventListener('click', (e) => { 
                    e.stopPropagation(); 
                    this.#setPanelDisplay(id, false); 
                    this.#syncMenuBtn(id, false);
                });
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

        const existingMoveable = this.moveables.get(panel);

        if (existingMoveable) {
            existingMoveable.destroy();
            this.moveables.delete(panel);
        }

        const root = document.body;
        const cs = getComputedStyle(panel);

        if (!cs.position || cs.position === 'static') {
            panel.style.position = 'absolute';
            panel.style.transform = 'translate(0px, 0px)';
        }

        const isResizable = (id !== 'settings' && id !== 'about');
        const headerEl = panel.querySelector('h1');

        const mv = new Moveable(root, {
            target: panel,
            draggable: true,
            resizable: isResizable,
            origin: false
        });

        let allowDrag = false;

        const pos = this.positions.get(panel) || { x: 0, y: 0 };
        this.positions.set(panel, pos);

        mv.on('dragStart', e => {
            const t = e.inputEvent && e.inputEvent.target;
            allowDrag = !!(headerEl && t && (t === headerEl || headerEl.contains(t)));
            if (!allowDrag) { e.stop && e.stop(); return; }

            // seed draggable with the current translate so there's no initial jump
            if (e.set) e.set([pos.x, pos.y]);

            e.inputEvent.stopPropagation();
        })
        .on('drag', e => {
            if (!allowDrag) return;
            const [x, y] = e.beforeTranslate;
            pos.x = x; pos.y = y;
            e.target.style.transform = `translate(${x}px, ${y}px)`;
        })
        .on('dragEnd', () => { 
            allowDrag = false; 
        })
        .on('resizeStart', e => {
            // seed resizable’s internal drag with the *current* translate
            e.setOrigin(['%', '%']);
            if (e.dragStart) e.dragStart.set([pos.x, pos.y]);
        })
        .on('resize', e => {
            const { target, width, height, drag } = e;
            const [bx, by] = drag.beforeTranslate;

            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.transform = `translate(${bx}px, ${by}px)`;

            pos.x = bx; pos.y = by;
        })
        .on('resizeEnd', e => {
            this.#applyControlStyles(mv);
            mv.updateRect();
        });

        this.moveables.set(panel, mv);

        mv.updateRect();
        this.#applyControlStyles(mv);
    }

    #applyControlStyles(mv) {

        const box = document.querySelectorAll('.moveable-control-box');
        const controlBox = box[box.length - 1];

        if (!controlBox) return;

        const controls = controlBox.querySelectorAll('.moveable-control');
        const { width, height } = mv.getRect();

        controls.forEach(control => {
            control.classList.add('custom-control');

            if (control.classList.contains('moveable-n') || control.classList.contains('moveable-s')) {
                control.style.width = `${width}px`;
                control.style.marginLeft = `-${width / 2}px`;
            }
            if (control.classList.contains('moveable-w') || control.classList.contains('moveable-e')) {
                control.style.height = `${height}px`;
                control.style.marginTop = `-${height / 2}px`;
            }
        });
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
        
        // Get the current Moveable instance for this panel
        const existingMoveable = this.moveables.get(p);

        if (show) {
            // --- Logic for SHOWING the Panel ---
            p.classList.add('visible');
            this.topZ += 1;
            p.style.zIndex = String(this.topZ);

            // 1. If the panel is being shown, ensure Moveable is active.
            //    Since your #makeDraggable handles creation/recreation, call it here.
            if (!existingMoveable) {
                // If it doesn't exist, create it (this is the key change for visibility)
                this.#makeDraggable(p, id); 
            } else {
                // If it already exists (e.g., if you only deactivated it previously, 
                // though you are using a destroy/recreate pattern) you'd call an activate method.
                // For your current pattern, it's safer to ensure it's created via the call above.
                existingMoveable.updateRect(); // Ensures controls are correctly positioned
            }
            
        } else {
            // --- Logic for HIDING the Panel ---
            p.classList.remove('visible');

            // 2. If the panel is being hidden, DESTROY the Moveable instance.
            if (existingMoveable) {
                existingMoveable.destroy();
                this.moveables.delete(p);
            }
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
