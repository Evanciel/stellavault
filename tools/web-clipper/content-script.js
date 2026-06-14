// Stellavault Web Clipper — content script.
// Injected on demand (chrome.scripting.executeScript from the popup) to read the
// current selection + page metadata, then returns it to the popup. It does NOT
// POST anything itself — the popup owns the network call so the host_permission
// + port stay in one place.

(() => {
  const selection = window.getSelection ? String(window.getSelection() || '') : '';
  // When nothing is selected, fall back to the main article / body HTML so the
  // user can still clip a whole page. We send raw HTML; the desktop endpoint
  // converts it to markdown (and strips scripts/styles).
  const article = document.querySelector('article, main, [role="main"]');
  const html = selection ? '' : (article ? article.innerHTML : document.body.innerHTML);
  return {
    url: location.href,
    title: document.title || location.hostname,
    selection,
    html,
  };
})();
