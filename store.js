// Storage layer.
// 1. Every save is written to this browser first (localStorage), so nothing is lost
//    if the network drops.
// 2. The same state is then sent to Supabase, into one row per learner in the
//    "sessions" table.
// Each learner (email) has their own saved state and their own anonymous Supabase
// login, so two people on one browser never share progress or a database row.
// Row level security means each login can only read and write its own row.

const KEY_PREFIX = "pr-module-v1-";       // + email: saved state
const AUTH_PREFIX = "pr-module-auth-";    // + email: Supabase login for that learner
const ACTIVE_KEY = "pr-module-active";    // sessionStorage: who is using this tab
const LEGACY_KEYS = ["pr-module-v1", "pr-module-auth", "pr-module-emails"];

const Store = (() => {
  const auths = {};           // email -> auth, cached from localStorage
  const pending = new Map();  // email -> latest state waiting to be sent
  let timer = null;
  let inFlight = false;
  const status = { lastSyncedAt: null, lastError: null };

  // Old builds kept one shared key for everyone. Remove it so it can't come back.
  try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch (e) {}

  function norm(email) { return (email || "").toLowerCase().trim(); }

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error("[store] could not write to this browser:", e.message); }
  }

  function getAuth(email) {
    if (!(email in auths)) auths[email] = readJSON(AUTH_PREFIX + email);
    return auths[email];
  }

  function keepAuth(email, data) {
    const auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_id: data.user && data.user.id,
    };
    auths[email] = auth;
    writeJSON(AUTH_PREFIX + email, auth);
    return auth;
  }

  // Anonymous sign-in. Called once per learner, on their first save after consent.
  async function signIn(email) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    if (!res.ok) throw new Error("sign-in failed: " + res.status);
    return keepAuth(email, await res.json());
  }

  async function refresh(email) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: getAuth(email).refresh_token }),
    });
    if (!res.ok) throw new Error("refresh failed: " + res.status);
    return keepAuth(email, await res.json());
  }

  async function ensureAuth(email) {
    const auth = getAuth(email);
    if (!auth || !auth.refresh_token) return signIn(email);
    if (Date.now() > auth.expires_at - 60 * 1000) return refresh(email);
    return auth;
  }

  function upsert(auth, state, keepalive = false) {
    return fetch(SUPABASE_URL + "/rest/v1/sessions?on_conflict=user_id", {
      method: "POST",
      keepalive,
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        Authorization: "Bearer " + auth.access_token,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: auth.user_id,
        email: state.email,
        arm: state.arm,
        consent_at: state.consentAt,
        screen: state.screen,
        state,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // Sends every learner's latest state, each with that learner's own login.
  async function push() {
    if (inFlight || pending.size === 0) return;
    inFlight = true;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [email, state] of batch) {
      try {
        let auth = await ensureAuth(email);
        let res = await upsert(auth, state);
        if (res.status === 401) { auth = await refresh(email); res = await upsert(auth, state); }
        if (!res.ok) throw new Error("save failed: " + res.status + " " + (await res.text()));
        status.lastSyncedAt = new Date().toISOString();
        status.lastError = null;
      } catch (e) {
        status.lastError = String(e.message || e);
        if (!pending.has(email)) pending.set(email, state); // retry on the next round
        console.warn("[store]", status.lastError);
      }
    }
    inFlight = false;
    if (pending.size) schedule(3000);
  }

  function schedule(ms = 800) {
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }

  return {
    status,
    norm,
    // Saved state for one email on this browser, or null.
    load(email) { return email ? readJSON(KEY_PREFIX + norm(email)) : null; },
    exists(email) { return !!this.load(email); },
    // Email of the learner using this tab. Survives a refresh, not closing the tab.
    active() { try { return sessionStorage.getItem(ACTIVE_KEY); } catch (e) { return null; } },
    save(state) {
      const email = norm(state.email);
      if (!email) return;
      writeJSON(KEY_PREFIX + email, state);
      try { sessionStorage.setItem(ACTIVE_KEY, email); } catch (e) {}
      pending.set(email, state);
      schedule(getAuth(email) ? 800 : 50); // first save: sign in straight away
    },
    // Stop using this tab as the current learner. Their saved progress is kept.
    forget() {
      try { sessionStorage.removeItem(ACTIVE_KEY); } catch (e) {}
      push();
    },
    // Testing only (?reset): removes every learner saved in this browser.
    resetAll() {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(KEY_PREFIX) || k.startsWith(AUTH_PREFIX))
          .forEach((k) => localStorage.removeItem(k));
        sessionStorage.removeItem(ACTIVE_KEY);
      } catch (e) {}
      for (const k of Object.keys(auths)) delete auths[k];
      pending.clear();
    },
    flush: push,
    // Last chance to send when the tab closes. app.js calls this on pagehide.
    beacon() {
      for (const [email, state] of pending) {
        const auth = getAuth(email);
        if (auth && auth.access_token) { try { upsert(auth, state, true); } catch (e) {} }
      }
    },
  };
})();
