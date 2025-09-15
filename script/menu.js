/**
 * MenuController - ES6 Module for 3D Earth Globe Application Menu
 * Handles toggle button states, positioning, and event emission
 */

export class MenuController {

    constructor(config = {}) {

        this.config = {
            targetElementId: config.targetElementId || 'menu-container',
            position: config.position || 'top-right',  // ✅ FIXED: Removed '-horizontal'
            layout: config.layout || 'horizontal',
            iconSize: config.iconSize || 40,
            margin: config.margin || 20,
            ...config
        };

        this.menuOptions = [
            { id: 'assistant', icon: 'smart_toy', label: 'Assistant' },
            { id: 'search', icon: 'search', label: 'Search' },
            { id: 'data', icon: 'analytics', label: 'Data' },
            { id: 'settings', icon: 'settings', label: 'Settings' },
            { id: 'about', icon: 'info', label: 'About' }
        ];

        this.toggleStates = {};
        this.menuElement = null;

        this.init();
    }

    init() {
        this.initializeStates();
        this.createMenuElement();
        this.attachEventListeners();
        this.updateResponsive();
        window.addEventListener('resize', () => this.updateResponsive());
    }

    initializeStates() {
        this.menuOptions.forEach(option => {
            this.toggleStates[option.id] = false;
        });
    }

    createMenuElement() {
        const targetElement = document.getElementById(this.config.targetElementId);
        if (!targetElement) {
            throw new Error(`Target element with id '${this.config.targetElementId}' not found`);
        }

        this.menuElement = document.createElement('div');
        this.menuElement.className = 'globe-menu';
        this.menuElement.setAttribute('data-position', this.config.position);
        this.menuElement.setAttribute('data-layout', this.config.layout);

        const menuList = document.createElement('ul');
        menuList.className = 'globe-menu-list';

        this.menuOptions.forEach(option => {
            const listItem = document.createElement('li');
            listItem.className = 'globe-menu-item';

            const button = document.createElement('button');
            button.className = 'globe-menu-button';
            button.setAttribute('data-option', option.id);
            button.setAttribute('aria-label', option.label);
            button.setAttribute('title', option.label);

            const icon = document.createElement('span');
            icon.className = "material-symbols-outlined";
            icon.textContent = `${option.icon}`;
            icon.style.fontSize = `${this.config.iconSize * 0.6}px`;

            button.appendChild(icon);
            listItem.appendChild(button);
            menuList.appendChild(listItem);
        });

        this.menuElement.appendChild(menuList);
        targetElement.appendChild(this.menuElement);

        this.applyPosition();
        this.applyIconSize();
    }

    attachEventListeners() {
        const buttons = this.menuElement.querySelectorAll('.globe-menu-button');
        console.log('Attaching event listeners to', buttons.length, 'buttons');
        
        buttons.forEach((button, index) => {
            console.log(`Button ${index}:`, button.getAttribute('data-option'));
            
            button.addEventListener('click', (e) => {
                console.log('Button clicked:', e.currentTarget.getAttribute('data-option'));
                this.handleToggle(e);
            });
            
            button.addEventListener('mouseenter', (e) => {
                console.log('Button hovered:', e.currentTarget.getAttribute('data-option'));
            });
        });
    }

    handleToggle(event) {
        const optionId = event.currentTarget.getAttribute('data-option');
        const newState = !this.toggleStates[optionId];
        
        this.setToggleState(optionId, newState);
        this.emitToggleEvent(optionId, newState);
    }

    setToggleState(optionId, state) {
        this.toggleStates[optionId] = state;
        const button = this.menuElement.querySelector(`[data-option="${optionId}"]`);
        
        if (button) {
            if (state) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        }
    }

    emitToggleEvent(optionId, state) {
        const event = new CustomEvent(`menu-${optionId}-toggle`, {
            detail: {
                option: optionId,
                active: state,
                menuInstance: this
            },
            bubbles: true
        });
        
        this.menuElement.dispatchEvent(event);
    }

    applyPosition() {
        const [vertical, horizontal] = this.config.position.split('-');
        const margin = this.config.margin;

        // Reset all position styles
        this.menuElement.style.top = 'auto';
        this.menuElement.style.bottom = 'auto';
        this.menuElement.style.left = 'auto';
        this.menuElement.style.right = 'auto';

        // Apply vertical positioning
        if (vertical === 'top') {
            this.menuElement.style.top = `${margin}px`;
        } else {
            this.menuElement.style.bottom = `${margin}px`;
        }

        // Apply horizontal positioning
        if (horizontal === 'right') {
            this.menuElement.style.right = `${margin}px`;
        } else {
            this.menuElement.style.left = `${margin}px`;
        }
    }

    applyIconSize() {
        const buttons = this.menuElement.querySelectorAll('.globe-menu-button');
        buttons.forEach(button => {
            button.style.width = `${this.config.iconSize}px`;
            button.style.height = `${this.config.iconSize}px`;
            
            const icon = button.querySelector('span');
            if (icon) {
                icon.style.fontSize = `${this.config.iconSize * 0.6}px`;
            }
        });
    }

    updateResponsive() {
        if (window.innerWidth < 768) {
            this.menuElement.classList.add('mobile');
        } else {
            this.menuElement.classList.remove('mobile');
        }
    }

    // Public API methods
    getToggleState(optionId) {
        return this.toggleStates[optionId] || false;
    }

    getAllToggleStates() {
        return { ...this.toggleStates };
    }

    setPosition(position) {
        this.config.position = position;
        this.menuElement.setAttribute('data-position', position);
        this.applyPosition();
    }

    setLayout(layout) {
        this.config.layout = layout;
        this.menuElement.setAttribute('data-layout', layout);
    }

    setIconSize(size) {
        this.config.iconSize = size;
        this.applyIconSize();
    }

    destroy() {
        if (this.menuElement && this.menuElement.parentNode) {
            this.menuElement.parentNode.removeChild(this.menuElement);
        }
        window.removeEventListener('resize', () => this.updateResponsive());
    }
}
