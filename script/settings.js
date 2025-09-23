// settings.js - Using Moveable.js only
(function () {
    // Only keep the collapsible state management
    function rememberCollapsibles(rootSel) {
        const root = document.querySelector(rootSel);
        if (!root) return;
        root.querySelectorAll('details.group').forEach(d => {
            const key = (rootSel + ':' + (d.dataset.key || '')).trim();
            const saved = localStorage.getItem(key);
            if (saved !== null) d.open = saved === '1';
            d.addEventListener('toggle', () => {
                localStorage.setItem(key, d.open ? '1' : '0');
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        rememberCollapsibles('#hud-settings');
    });
})();
