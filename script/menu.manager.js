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

        const root = document.getElementById('overlay') || panel.offsetParent || document.body;
        
        // Ensure absolute positioning
        const cs = getComputedStyle(panel);
        if (!cs.position || cs.position === 'static') panel.style.position = 'absolute';

        // Special handling for About panel - remove transform centering
        if (id === 'about') {
            const rect = panel.getBoundingClientRect();
            const parentRect = root.getBoundingClientRect();
            panel.style.transform = 'none';
            panel.style.left = `${rect.left - parentRect.left}px`;
            panel.style.top = `${rect.top - parentRect.top}px`;
        }

        // Determine if panel should be resizable
        const isResizable = (id !== 'settings'); // Settings stays fixed size

        // Drag by title only
        const headerEl = panel.querySelector('h1');

        // Configure Moveable
        const mv = new Moveable(root, {
            target: panel,
            draggable: true,
            resizable: isResizable,
            origin: false,
            renderDirections: isResizable ? ['nw','n','ne','e','se','s','sw','w'] : [],
            keepRatio: false,
            throttleDrag: 1,
            throttleResize: 1,
            snappable: false,
            edge: false,
            resizeFormat: v => `${Math.round(v)}px`
        });

        let allowDrag = false;

        // DRAG HANDLERS
        mv.on('dragStart', e => {
            const t = e.inputEvent && e.inputEvent.target;
            allowDrag = !!(headerEl && t && (t === headerEl || headerEl.contains(t)));
            if (!allowDrag) { 
                e.stop && e.stop(); 
                return; 
            }
        });

        mv.on('drag', ({ target, left, top }) => {
            if (!allowDrag) return;
            
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
            target.style.right = 'auto';
            target.style.bottom = 'auto';
            target.style.transform = 'none';
        });

        mv.on('dragEnd', () => {
            allowDrag = false;
        });

        // RESIZE HANDLERS
        if (isResizable) {
            mv.on('resizeStart', ({ setOrigin, dragStart }) => {
                setOrigin(["%", "%"]);
                
                // Clear any clamp() or complex sizing on assistant panel
                if (id === 'assistant') {
                    const currentWidth = panel.offsetWidth;
                    const currentHeight = panel.offsetHeight;
                    panel.style.width = `${currentWidth}px`;
                    panel.style.height = `${currentHeight}px`;
                }
                
                // Optional: Store initial size
                dragStart && dragStart.set([panel.offsetWidth, panel.offsetHeight]);
            });

            mv.on('resize', ({ width, height, drag }) => {
                // Define min/max constraints per panel type
                let minW = 260, minH = 160;
                let maxW = window.innerWidth - 40;
                let maxH = window.innerHeight - 40;

                // Special constraints for specific panels
                if (id === 'assistant') {
                    minW = 400;
                    minH = 300;
                } else if (id === 'about') {
                    maxW = 600;
                }

                // Apply constraints
                const w = Math.min(maxW, Math.max(minW, width));
                const h = Math.min(maxH, Math.max(minH, height));
                
                // Set the new size
                panel.style.width = `${Math.round(w)}px`;
                panel.style.height = `${Math.round(h)}px`;
                
                // Update position to handle resize from left/top edges
                if (drag) {
                    panel.style.left = `${drag.left}px`;
                    panel.style.top = `${drag.top}px`;
                }
            });

            mv.on('resizeEnd', () => {
                // Optional: Could save panel sizes to localStorage here
            });
        }

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
