'use strict';
// Claude-design helpers. Display only; no data access.
(function () {
  // Live header clock
  function tick() {
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    document.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = t; });
  }
  tick();
  setInterval(tick, 1000);

  // Band: always two rows, members split evenly (e.g. 5 -> 3 + 2, 6 -> 3 + 3)
  function layoutBand() {
    const grid = document.getElementById('bandGrid');
    if (!grid) return;
    const count = grid.querySelectorAll('.person-card').length;
    const cols = Math.max(1, Math.ceil(count / 2));
    grid.style.setProperty('--band-cols', String(cols));
    grid.classList.toggle('band-dense', cols >= 4);
  }
  function watchBand() {
    const grid = document.getElementById('bandGrid');
    if (!grid) return;
    layoutBand();
    new MutationObserver(() => {
      layoutBand();
      if (typeof window.scheduleAutoFit === 'function') window.scheduleAutoFit();
    }).observe(grid, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBand);
  else watchBand();
})();
