// Apply saved theme immediately to avoid flash
(function () {
  const saved = localStorage.getItem('plegados-theme') || 'dark';
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

function _applyThemeIcons() {
  const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
  document.querySelectorAll('.theme-toggle, .theme-toggle-float').forEach(btn => {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('plegados-theme', next);
  _applyThemeIcons();
}

document.addEventListener('DOMContentLoaded', function () {
  _applyThemeIcons();
  document.querySelectorAll('.theme-toggle, .theme-toggle-float').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
});
