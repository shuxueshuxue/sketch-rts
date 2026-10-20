/** `?debug=1`: developer entries in the menus (opening a debug recording, viewing the last one). Players never see
 * them. Like `?perf=1`, the tab remembers the choice across reloads until `?debug=0`. */
export function debugToolsEnabled(): boolean {
  const asked = new URLSearchParams(location.search).get('debug');
  try {
    if (asked === '1') sessionStorage.setItem('debug', '1');
    else if (asked === '0') sessionStorage.removeItem('debug');
    else return sessionStorage.getItem('debug') === '1';
  } catch {
    // Without storage the choice lasts until the next reload.
  }
  return asked === '1';
}
