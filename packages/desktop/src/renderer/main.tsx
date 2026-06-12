import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './lib/runtime-sync.js'; // Stage C: FSRS access tracking + file:changed sync (side-effect)
import './lib/session-persist.js'; // Stage D: session restore/persist + W1-10/11/17 commands (side-effect)

createRoot(document.getElementById('root')!).render(<App />);
