(function () {
	// Make a panel draggable using a handle inside it
	function makeHudDraggable(panelSel, handleSel) {
		const panel = document.querySelector(panelSel);
		if (!panel) return;
		const handle = panel.querySelector(handleSel) || panel.querySelector('h1');
		if (!handle) return;

		let dragging = false, sx = 0, sy = 0, px = 0, py = 0;

		function onDown(e) {
			if (e.button !== 0) return;
			dragging = true;
			panel.classList.add('dragging');
			const r = panel.getBoundingClientRect();
			sx = e.clientX; sy = e.clientY;
			px = r.left;     py = r.top;
			handle.setPointerCapture?.(e.pointerId);
			e.preventDefault();
		}
		function onMove(e) {
			if (!dragging) return;
			const nx = px + (e.clientX - sx);
			const ny = py + (e.clientY - sy);
			const w = panel.offsetWidth, h = panel.offsetHeight;
			const vw = window.innerWidth, vh = window.innerHeight;
			const m = 8;
			const x = Math.min(vw - w - m, Math.max(m, nx));
			const y = Math.min(vh - h - m, Math.max(m, ny));
			panel.style.left = x + 'px';
			panel.style.top = y + 'px';
			panel.style.right = 'auto';
			panel.style.bottom = 'auto';
		}
		function onUp(e) {
			if (!dragging) return;
			dragging = false;
			panel.classList.remove('dragging');
			handle.releasePointerCapture?.(e.pointerId);
		}

		// Use pointer events for mouse/touch/pen
		handle.addEventListener('pointerdown', onDown);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// Remember which groups are open
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

	// Init for Settings panel
	document.addEventListener('DOMContentLoaded', () => {
		makeHudDraggable('#hud-settings', '.hud-header');
		rememberCollapsibles('#hud-settings');
	});
})();
