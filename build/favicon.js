/**
 * Keeps the favicon in step with the page's colour scheme. The page switches between its
 * light and dark palettes with `prefers-color-scheme`, so the favicon follows the same
 * media query, including when it changes while the page is open.
 *
 * index.html declares the icon links with `data-favicon="svg" | "png"`; their href is
 * pointed at icons/favicon-<light|dark>.<svg|png>.
 */
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
export function syncFavicon() {
    const theme = darkScheme.matches ? 'dark' : 'light';
    for (const link of document.querySelectorAll('link[data-favicon]')) {
        const href = `./icons/favicon-${theme}.${link.dataset.favicon}`;
        // Only touch changed links: re-setting the same href would abort the icon's in-flight request.
        if (link.getAttribute('href') !== href)
            link.setAttribute('href', href);
    }
}
export function followColorScheme() {
    syncFavicon();
    darkScheme.addEventListener('change', syncFavicon);
}
//# sourceMappingURL=favicon.js.map