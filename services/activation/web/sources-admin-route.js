(() => {
  const allowed = new Set(['sources', 'xtream', 'catalog']);
  const openRequestedTab = () => {
    const name = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (!allowed.has(name)) return;
    const button = document.querySelector(`.tab[data-tab="${name}"]`);
    if (button && !button.classList.contains('active')) button.click();
  };
  window.addEventListener('hashchange', openRequestedTab);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(openRequestedTab, 0), { once: true });
  } else {
    setTimeout(openRequestedTab, 0);
  }
})();
