import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './lib/runtime-sync.js'; // Stage C: FSRS access tracking + file:changed sync (side-effect)

createRoot(document.getElementById('root')!).render(<App />);
