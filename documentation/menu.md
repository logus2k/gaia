# 3D Earth Globe Menu Integration Guide

## File Structure

Place these files in your project directory:

```
your-project/
├── menu.js          # ES6 Menu Controller Module
├── menu.css         # Menu Styling
├── your-app.html    # Your main HTML file
└── your-app.js      # Your application JavaScript
```

## Integration Steps

### 1. Include Dependencies

Add FontAwesome 6 CDN to your HTML head:

```html
<head>
    <!-- FontAwesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    
    <!-- Menu Styles -->
    <link rel="stylesheet" href="menu.css">
</head>
```

### 2. Create Menu Container

Add a container element where you want the menu to appear:

```html
<body>
    <!-- Your 3D Globe content -->
    <div id="globe-container">
        <!-- Your 3D Earth globe here -->
    </div>
    
    <!-- Menu Container -->
    <div id="menu-container"></div>
</body>
```

### 3. Initialize Menu

Import and initialize the menu in your JavaScript:

```javascript
// Import the MenuController
import { MenuController } from './menu.js';

// Initialize the menu
const menu = new MenuController({
    targetElementId: 'menu-container',
    position: 'top-right',           // top-right, top-left, bottom-right, bottom-left
    layout: 'horizontal',            // horizontal or vertical
    iconSize: 40,                    // Icon size in pixels
    margin: 20                       // Margin from container edges
});
```

## Configuration Options

### Position Options
- `top-right` (default)
- `top-left`
- `bottom-right`  
- `bottom-left`

### Layout Options
- `horizontal` (default) - Icons arranged in a row
- `vertical` - Icons arranged in a column

### Full Configuration Example

```javascript
const menu = new MenuController({
    targetElementId: 'menu-container',    // Required: container element ID
    position: 'top-right',                // Menu corner position
    layout: 'horizontal',                 // Menu layout direction
    iconSize: 40,                         // Icon size in pixels
    margin: 20                            // Distance from container edges
});
```

## Event Handling

Listen for menu toggle events to show/hide your HUD panels:

```javascript
const menuContainer = document.getElementById('menu-container');

// Assistant Panel Toggle
menuContainer.addEventListener('menu-assistant-toggle', (event) => {
    const isActive = event.detail.active;
    
    if (isActive) {
        showAssistantPanel();
    } else {
        hideAssistantPanel();
    }
});

// Search Panel Toggle
menuContainer.addEventListener('menu-search-toggle', (event) => {
    if (event.detail.active) {
        showSearchPanel();
    } else {
        hideSearchPanel();
    }
});

// Data Panel Toggle
menuContainer.addEventListener('menu-data-toggle', (event) => {
    if (event.detail.active) {
        showDataPanel();
    } else {
        hideDataPanel();
    }
});

// Settings Panel Toggle
menuContainer.addEventListener('menu-settings-toggle', (event) => {
    if (event.detail.active) {
        showSettingsPanel();
    } else {
        hideSettingsPanel();
    }
});

// About Panel Toggle
menuContainer.addEventListener('menu-about-toggle', (event) => {
    if (event.detail.active) {
        showAboutPanel();
    } else {
        hideAboutPanel();
    }
});
```

## Menu Options

The menu includes these 5 options with their respective icons:

| Option | Icon | Event Name |
|--------|------|------------|
| Assistant | `fa-robot` | `menu-assistant-toggle` |
| Search | `fa-magnifying-glass` | `menu-search-toggle` |
| Data | `fa-chart-line` | `menu-data-toggle` |
| Settings | `fa-gear` | `menu-settings-toggle` |
| About | `fa-info-circle` | `menu-about-toggle` |

## Public API Methods

### Get Toggle State
```javascript
// Check if a specific option is active
const isAssistantActive = menu.getToggleState('assistant');

// Get all toggle states
const allStates = menu.getAllToggleStates();
console.log(allStates); // { assistant: false, search: true, ... }
```

### Dynamic Configuration
```javascript
// Change menu position
menu.setPosition('bottom-left');

// Change menu layout
menu.setLayout('vertical');

// Change icon size
menu.setIconSize(50);
```

### Cleanup
```javascript
// Destroy menu when no longer needed
menu.destroy();
```

## Complete Integration Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Earth Globe App</title>
    
    <!-- FontAwesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    
    <!-- Menu Styles -->
    <link rel="stylesheet" href="menu.css">
    
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #000000;
            color: #00FF41;
            font-family: 'Courier New', monospace;
        }
        
        .hud-panel {
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid rgba(0, 255, 65, 0.3);
            border-radius: 8px;
            padding: 20px;
            display: none;
        }
        
        .hud-panel.active {
            display: block;
        }
        
        #assistant-panel { top: 80px; left: 20px; }
        #search-panel { top: 80px; right: 20px; }
        #data-panel { bottom: 80px; left: 20px; }
        #settings-panel { bottom: 80px; right: 20px; }
        #about-panel { top: 50%; left: 50%; transform: translate(-50%, -50%); }
    </style>
</head>
<body>
    <!-- Your 3D Globe Container -->
    <div id="globe-container">
        <!-- Your 3D Earth globe implementation goes here -->
    </div>
    
    <!-- Menu Container -->
    <div id="menu-container"></div>
    
    <!-- HUD Panels -->
    <div id="assistant-panel" class="hud-panel">
        <h3>AI Assistant</h3>
        <p>Assistant panel content...</p>
    </div>
    
    <div id="search-panel" class="hud-panel">
        <h3>Search</h3>
        <p>Search panel content...</p>
    </div>
    
    <div id="data-panel" class="hud-panel">
        <h3>Data Visualization</h3>
        <p>Data panel content...</p>
    </div>
    
    <div id="settings-panel" class="hud-panel">
        <h3>Settings</h3>
        <p>Settings panel content...</p>
    </div>
    
    <div id="about-panel" class="hud-panel">
        <h3>About</h3>
        <p>About panel content...</p>
    </div>

    <script type="module">
        import { MenuController } from './menu.js';
        
        // Initialize menu
        const menu = new MenuController({
            targetElementId: 'menu-container',
            position: 'top-right',
            layout: 'horizontal',
            iconSize: 40,
            margin: 20
        });
        
        // Get menu container for event listening
        const menuContainer = document.getElementById('menu-container');
        
        // Helper function to toggle panels
        function togglePanel(panelId, isActive) {
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.classList.toggle('active', isActive);
            }
        }
        
        // Event listeners
        menuContainer.addEventListener('menu-assistant-toggle', (e) => {
            togglePanel('assistant-panel', e.detail.active);
        });
        
        menuContainer.addEventListener('menu-search-toggle', (e) => {
            togglePanel('search-panel', e.detail.active);
        });
        
        menuContainer.addEventListener('menu-data-toggle', (e) => {
            togglePanel('data-panel', e.detail.active);
        });
        
        menuContainer.addEventListener('menu-settings-toggle', (e) => {
            togglePanel('settings-panel', e.detail.active);
        });
        
        menuContainer.addEventListener('menu-about-toggle', (e) => {
            togglePanel('about-panel', e.detail.active);
        });
        
        // Initialize your 3D globe here
        // initializeGlobe();
        
        console.log('3D Earth Globe with Menu initialized');
    </script>
</body>
</html>
```

## Styling Customization

### Color Customization
To change the menu colors, modify these CSS variables in `menu.css`:

```css
.globe-menu-button {
    color: #00FF41; /* Default green - change this */
}

.globe-menu-button.active {
    color: #FF8C00; /* Active orange - change this */
}
```

### Responsive Behavior
The menu automatically adapts to mobile devices:
- Icons become larger on smaller screens
- Touch-friendly spacing is applied
- Horizontal menus switch to vertical on very small screens

## Troubleshooting

### Menu Not Appearing
- Ensure `targetElementId` matches an existing element
- Check that FontAwesome 6 CDN is loaded
- Verify `menu.css` is properly linked

### Events Not Firing
- Make sure event listeners are attached to the correct container
- Check browser console for JavaScript errors
- Verify the menu was initialized successfully

### Styling Issues
- Ensure `menu.css` is loaded after FontAwesome
- Check for CSS conflicts with existing styles
- Verify the black background doesn't hide the green icons
