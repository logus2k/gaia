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
            panelIds: config.panelIds || ['assistant', 'search', 'data', 'settings', 'about'],
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
            { id: 'assistant', icon: 'smart_toy', label: 'Assistant' },
            { id: 'search', icon: 'search', label: 'Search' },
            { id: 'data', icon: 'description', label: 'Data' },
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
        if (typeof Moveable === 'undefined') { console.warn('Moveable not found: skipping drag for', id); return; }
        const mv = new Moveable(document.body, { target: panel, draggable: true, origin: false });

        let allow = false;
        mv.on('dragStart', e => {
            const t = e.inputEvent && e.inputEvent.target;
            allow = !!(t && (t.closest && (t.closest('h1') && panel.contains(t.closest('h1')))));
            if (allow) panel.style.cursor = 'move';
            if (!allow && e.stop) e.stop();
        });
        mv.on('drag', ({ target, transform }) => { if (allow) target.style.transform = transform; });
        mv.on('dragEnd', () => { allow = false; panel.style.cursor = ''; });

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
