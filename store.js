// Storage layer. For now this saves to the browser (localStorage).
// Week of Oct 26: replace load/save with Supabase or Firebase calls.
// Keep the same function names so app.js does not change.

const STORE_KEY = "pr-module-v1";

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  save(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage full or blocked. The results string export is the fallback.
    }
  },
  clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  },
};
