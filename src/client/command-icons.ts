/** Engraved command glyphs, independent of the operating system's emoji font. */
const COMMAND_PATHS: Record<string, string> = {
    '⌁': 'M10 6l20 20m2-18L12 28M7 5l7 2-5 5zm28 0l-7 2 5 5zM7 30l6 6m16-6l6 6M10 33l-4 4m26-4l4 4',
    '⚔': 'M10 6l20 20m2-18L12 28M7 5l7 2-5 5zm28 0l-7 2 5 5zM7 30l6 6m16-6l6 6M10 33l-4 4m26-4l4 4',
    '⌘': 'M12 33l13-19M17 7l7-3 12 8-5 8-8-5-7 1-4-5zM9 31l5 3-3 5-5-3z',
    '⤓': 'M6 27h30l-5 8H12zM21 4v19m-6-6l6 6 6-6M7 38l6 2 8-2 8 2 7-2',
    '⌖': 'M21 4v8m0 18v8M4 21h8m18 0h8M21 11a10 10 0 1 1 0 20 10 10 0 0 1 0-20M21 18v6m-3-3h6',
    '⇄': 'M8 13h26l-6-6m6 6-6 6M34 29H8l6-6m-6 6 6 6',
    '»': 'M8 10l10 11L8 32m15-22 10 11-10 11',
    '▥': 'M9 8h24v18L21 36 9 26zM15 11v17m6-17v20m6-20v17',
    '⇥': 'M7 21h23m-8-8 8 8-8 8M34 8v26M9 15l5 6-5 6',
};
export function commandIconMarkup(icon: string) {
    const path = COMMAND_PATHS[icon];
    return path ? `<svg class="command-symbol" viewBox="0 0 42 42" aria-hidden="true"><path d="${path}"/></svg>` : undefined;
}
