'use strict';

(() => {
  const valid = new Set(['sources', 'xtream', 'catalog']);
  const nameFromHash = () => {
    const value = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
    return valid.has(value) ? value : null;
  };

  const openHashTab = () => {
    const name = nameFromHash();
    if (!name) return;
    const button = document.querySelector(`.tab[data-tab="${name}"]`);
    if (button && !button.classList.contains('active')) button.click();
  };

  document.querySelectorAll('.tab[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const name = button.dataset.tab;
      if (valid.has(name) && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    });
  });

  window.addEventListener('hashchange', openHashTab);
  openHashTab();
})();
