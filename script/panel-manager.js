/**
 * PanelManager - ES6 Class for managing HUD panels with menu integration
 * Handles panel visibility, dragging, close buttons, and menu synchronization
 */


import { MenuController } from '../script/menu.js';


export class PanelManager {

    constructor(config = {}) {
        this.config = {
            menuTargetId: config.menuTargetId || 'application-menu-container',
            menuPosition: config.menuPosition || 'top-right',
            menuLayout: config.menuLayout || 'horizontal',
            menuIconSize: config.menuIconSize || 40,
            menuMargin: config.menuMargin || 20,
            initialVisibility: config.initialVisibility || {},
            ...config
        };

        this.panels = {};
        this.menu = null;
        this.panelStates = {};

        this.init();
    }

    init() {
        this.initializeMenu();
        this.initializePanels();
        this.addCloseButtons();
        this.makePanelsDraggable();
        this.attachMenuEvents();
        this.setInitialStates();
    }

    initializeMenu() {
        this.menu = new MenuController({
            targetElementId: this.config.menuTargetId,
            position: this.config.menuPosition,
            layout: this.config.menuLayout,
            iconSize: this.config.menuIconSize,
            margin: this.config.menuMargin
        });
    }

    initializePanels() {
        const panelIds = ['assistant', 'search', 'data', 'settings', 'about'];
        
        panelIds.forEach(panelId => {
            const element = document.getElementById(`hud-${panelId}`);
            if (element) {
                this.panels[panelId] = element;
                this.panelStates[panelId] = false;
            }
        });
    }

    togglePanel(panelName, isActive) {
        const panel = this.panels[panelName];
        if (!panel) {
            console.warn(`Panel ${panelName} not found`);
            return;
        }

        this.panelStates[panelName] = isActive;
        panel.style.display = isActive ? 'block' : 'none';
        
        // Sync menu state
        this.menu.setToggleState(panelName, isActive);
        
        console.log(`${panelName} panel: ${isActive ? 'shown' : 'hidden'}`);
    }

    addCloseButtons() {
        Object.entries(this.panels).forEach(([panelName, panel]) => {
            if (!panel || panel.querySelector('.panel-close-btn')) return;
            
            const closeBtn = this.createCloseButton(panelName);
            
            // Ensure panel has relative positioning
            panel.style.position = 'absolute';
            panel.appendChild(closeBtn);
        });
    }

    createCloseButton(panelName) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'panel-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close panel';
        
        // Style the close button
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '20px',
            height: '20px',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: '1',
            zIndex: '10',
            transition: 'all 0.2s ease'
        });
        
        // Hover effects
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(129, 129, 129, 0.8)';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        
        // Close functionality
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel(panelName, false);
        });
        
        return closeBtn;
    }

    makePanelsDraggable() {
        Object.values(this.panels).forEach(panel => {
            if (!panel) return;
            
            const header = panel.querySelector('h1');
            if (!header) return;
            
            this.setupPanelDrag(panel, header);
        });
    }

    setupPanelDrag(panel, header) {
        header.style.cursor = 'move';
        header.style.userSelect = 'none';
        header.style.paddingRight = '30px'; // Room for close button
        
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        
        const startDrag = (e) => {
            if (e.target.classList.contains('panel-close-btn')) return;
            
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            initialX = e.clientX - rect.left;
            initialY = e.clientY - rect.top;
            
            document.body.style.cursor = 'move';
            panel.style.zIndex = '2000';
        };
        
        const doDrag = (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            // Keep within viewport bounds
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            
            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));
            
            panel.style.left = currentX + 'px';
            panel.style.top = currentY + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        };
        
        const stopDrag = () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = 'default';
                panel.style.zIndex = '1000';
            }
        };
        
        header.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    }

    attachMenuEvents() {
        const menuContainer = document.getElementById(this.config.menuTargetId);
        if (!menuContainer) {
            console.error('Menu container not found');
            return;
        }

        // Create event listeners for each panel
        Object.keys(this.panels).forEach(panelName => {
            menuContainer.addEventListener(`menu-${panelName}-toggle`, (e) => {
                this.togglePanel(panelName, e.detail.active);
            });
        });
    }

    setInitialStates() {
        // Set all panels hidden by default
        Object.values(this.panels).forEach(panel => {
            if (panel) panel.style.display = 'none';
        });

        // Apply any configured initial visibility
        Object.entries(this.config.initialVisibility).forEach(([panelName, isVisible]) => {
            if (this.panels[panelName]) {
                this.togglePanel(panelName, isVisible);
            }
        });
    }

    // Public API methods
    showPanel(panelName) {
        this.togglePanel(panelName, true);
    }

    hidePanel(panelName) {
        this.togglePanel(panelName, false);
    }

    isPanelVisible(panelName) {
        return this.panelStates[panelName] || false;
    }

    getAllPanelStates() {
        return { ...this.panelStates };
    }

    hideAllPanels() {
        Object.keys(this.panels).forEach(panelName => {
            this.hidePanel(panelName);
        });
    }

    showAllPanels() {
        Object.keys(this.panels).forEach(panelName => {
            this.showPanel(panelName);
        });
    }

    getMenu() {
        return this.menu;
    }

    getPanels() {
        return { ...this.panels };
    }

    destroy() {
        // Clean up event listeners and elements
        if (this.menu) {
            this.menu.destroy();
        }
        
        // Remove close buttons
        Object.values(this.panels).forEach(panel => {
            if (panel) {
                const closeBtn = panel.querySelector('.panel-close-btn');
                if (closeBtn) {
                    closeBtn.remove();
                }
            }
        });
        
        console.log('PanelManager destroyed');
    }
}
