/** Every secondary menu has one flexible body and a footer outside its scrolling content. */
export function menuPageMarkup(body: string, actions: string): string {
  return `<div class="menu-page-body">${body}</div><footer class="menu-actions">${actions}</footer>`;
}
