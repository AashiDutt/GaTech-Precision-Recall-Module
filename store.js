// Storage layer.
// 1. Every save is written to this browser first (localStorage), so nothing is lost
//    if the network drops.
// 2. The same state is then sent to Supabase, into one row per learner in the
//    "sessions" table.
// Each learner gets an anonymous Supabase account at consent. Row level security
// means that account can only read and write its own row.

const STORE_KEY = "pr-module-v1";
const AUTH_KEY = "pr-module-auth";

const Store = (() => {
  let currentEmail = null; // track current learner's email
  let auth = null;
  let pending = null;      // latest state waiting to be sent
  let timer = null;
  let inFlight = false;
  const status = { lastSyncedAt: null, lastError: null };

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try {
      const json = JSON.stringify(value);
      localStorage.setItem(key, json);
    } catch (e) {
      console.error("[store] Failed to write to localStorage:", e.message);
      console.error("[store] Key:", key, "Error:", e);
    }
  }

  function normalizeEmail(email) {
    return email ? email.toLowerCase().trim() : email;
  }

  function getStoreKey(email) {
    const normalized = normalizeEmail(email);
    return normalized ? `pr-module-v1-${normalized}` : STORE_KEY;
  }

  function getAuthKey(email) {
    const normalized = normalizeEmail(email);
    return normalized ? `pr-module-auth-${normalized}` : AUTH_KEY;
  }

  function initAuth(email) {
    currentEmail = normalizeEmail(email);
    auth = readJSON(getAuthKey(currentEmail));
  }

  function headers(extra = {}) {
    const h = { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...extra };
    if (auth && auth.access_token) h.Authorization = "Bearer " + auth.access_token;
    return h;
  }

  function keepAuth(data) {
    auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_id: data.user && data.user.id,
    };
    writeJSON(getAuthKey(currentEmail), auth);
  }

  // Anonymous sign-in. Called once, when the learner ticks the consent box.
  async function signIn() {
    const res = await fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    if (!res.ok) throw new Error("sign-in failed: " + res.status);
    keepAuth(await res.json());
  }

  async function refresh() {
    const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: auth.refresh_token }),
    });
    if (!res.ok) throw new Error("refresh failed: " + res.status);
    keepAuth(await res.json());
  }

  async function ensureAuth() {
    if (!auth || !auth.refresh_token) return signIn();
    if (Date.now() > auth.expires_at - 60 * 1000) return refresh();
  }

  function row(state) {
    return {
      user_id: auth.user_id,
      email: state.email,
      arm: state.arm,
      consent_at: state.consentAt,
      screen: state.screen,
      state,
      updated_at: new Date().toISOString(),
    };
  }

  async function upsert(state, keepalive = false) {
    return fetch(SUPABASE_URL + "/rest/v1/sessions?on_conflict=user_id", {
      method: "POST",
      keepalive,
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(row(state)),
    });
  }

  async function push() {
    if (inFlight || !pending) return;
    inFlight = true;
    const state = pending;
    pending = null;
    try {
      await ensureAuth();
      let res = await upsert(state);
      if (res.status === 401) { await refresh(); res = await upsert(state); }
      if (!res.ok) throw new Error("save failed: " + res.status + " " + (await res.text()));
      status.lastSyncedAt = new Date().toISOString();
      status.lastError = null;
    } catch (e) {
      status.lastError = String(e.message || e);
      if (!pending) pending = state; // retry on the next save
      console.warn("[store]", status.lastError);
    } finally {
      inFlight = false;
      if (pending) schedule();
    }
  }

  function schedule(ms = 800) {
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }


  return {
    status,
    load() {
      const storeKey = getStoreKey(currentEmail);
      console.log("[store] load() called with currentEmail:", currentEmail, "key:", storeKey);
      return readJSON(storeKey);
    },
    loadByEmail(email) {
      const storeKey = getStoreKey(email);
      console.log("[store] Looking for email:", email, "key:", storeKey);
      try {
        const raw = localStorage.getItem(storeKey);
        console.log("[store] localStorage.getItem returned:", raw ? "✓ data found" : "✗ no data");
        if (raw) {
          console.log("[store] All localStorage keys:", Object.keys(localStorage));
        }
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error("[store] Error loading by email:", e);
        return null;
      }
    },
    save(state) {
      const key = getStoreKey(state.email);
      console.log("[store] Saving state for email:", state.email, "key:", key);
      if (state.email) initAuth(state.email);
      writeJSON(key, state);
      console.log("[store] State saved. Checking localStorage:", localStorage.getItem(key) ? "✓ found" : "✗ not found");
      pending = state;
      schedule(auth ? 800 : 50); // first save: sign in straight away
    },
    clear() {
      try {
        localStorage.removeItem(getStoreKey(currentEmail));
        localStorage.removeItem(getAuthKey(currentEmail));
      } catch (e) {}
      auth = null;
      currentEmail = null;
      pending = null;
    },
    flush: push,
    // Last chance to send when the tab closes. app.js calls this on pagehide.
    beacon() {
      if (pending && auth && auth.access_token) {
        try { upsert(pending, true); } catch (e) {}
      }
    },
  };
})();
