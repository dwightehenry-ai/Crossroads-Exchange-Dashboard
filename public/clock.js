'use strict';
// Live clock for the Claude-design header. Display only; no data access.
(function () {
  function tick() {
    const now = new Date();
    const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    document.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = t; });
  }
  tick();
  setInterval(tick, 1000);
})();
