// Stellavault Web Clipper — popup logic.
// 1. Reads the saved port from chrome.storage (default 3105 — project port
//    registry; never 3000).
// 2. On click, injects content-script.js into the active tab to grab the
//    selection / page HTML, then POSTs it to the local Publish server's
//    /api/clip endpoint (T3-4). Local-only: http://127.0.0.1:<port>.

const $ = (id) => document.getElementById(id);
const portInput = $('port');
const clipBtn = $('clip');
const statusEl = $('status');

// Hydrate the saved port.
chrome.storage?.local.get(['port'], (res) => {
  if (res && res.port) portInput.value = res.port;
});
portInput.addEventListener('change', () => {
  chrome.storage?.local.set({ port: Number(portInput.value) || 3105 });
});

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

clipBtn.addEventListener('click', async () => {
  clipBtn.disabled = true;
  setStatus('Reading page…');
  try {
    const port = Number(portInput.value) || 3105;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab');

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    });
    const payload = injected && injected[0] && injected[0].result;
    if (!payload) throw new Error('Could not read the page');

    setStatus('Saving to vault…');
    const resp = await fetch(`http://127.0.0.1:${port}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Server returned ${resp.status}`);
    }
    setStatus(`Saved: ${data.fileName}`, 'ok');
  } catch (err) {
    // The most common failure is the Publish server not running.
    setStatus(
      `Clip failed: ${err && err.message ? err.message : err}. Is the Publish server running in the desktop app?`,
      'err',
    );
  } finally {
    clipBtn.disabled = false;
  }
});
