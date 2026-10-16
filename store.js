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
  let auth = readJSON(AUTH_KEY);
  let pending = null;      // latest state waiting to be sent
  let timer = null;
  let inFlight = false;
  const status = { lastSyncedAt: null, lastError: null };

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
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
    writeJSON(AUTH_KEY, auth);
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
    load() { return readJSON(STORE_KEY); },
    save(state) {
      writeJSON(STORE_KEY, state);
      pending = state;
      schedule(auth ? 800 : 50); // first save: sign in straight away
    },
    clear() {
      try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(AUTH_KEY); } catch (e) {}
      auth = null;
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
