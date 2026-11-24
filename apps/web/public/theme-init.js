/*
 * Runs before the first paint, from <head>, so the page never flashes the wrong theme.
 * The choice is Light unless the person picked Dark or System.
 * src/lib/theme.ts holds the same rule for the running app, and a test keeps the two
 * in step.
 */
(function () {
  var dark = false;
  try {
    var choice = window.localStorage.getItem('turnkeel.theme');
    dark =
      choice === 'dark' ||
      (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    // No storage: Light.
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#18181b' : '#ffffff');
})();
