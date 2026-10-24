// App shell: registration, data notice, diagnostic, calibration report,
// slide flow with predict-first and checks, leave and return.

const app = document.getElementById("app");
const progressEl = document.getElementById("progress");
const leaveBtn = document.getElementById("leaveBtn");
const leaveDialog = document.getElementById("leaveDialog");

// ?demo marks a new sign up as a demo learner: the retention quiz opens straight away,
// and the row is flagged so it stays out of the study data.
const DEMO = new URLSearchParams(location.search).has("demo");

if (new URLSearchParams(location.search).has("reset")) {
  Store.resetAll();
  history.replaceState(null, "", location.pathname + (DEMO ? "?demo" : ""));
}

// A refresh keeps the current learner in place. A new tab starts at the landing page.
let state = Store.load(Store.active()) || newState();
let segmentStart = null;
let segmentKey = null;

function newState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    screen: "landing",
    email: null,
    arm: null,
    consentAt: null,
    diagIndex: 0,
    slideIndex: 0,
    slidePhase: "slide", // slide | check | checkFeedback
    revealed: false,
    responses: [],
    predictions: [],
    segmentTime: {},
    exits: [],
    resumes: 0,
  };
}

// ---------- helpers ----------

// Nothing is written before the learner ticks the consent box.
function save() { if (state.consentAt) Store.save(state); }

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function startSegment(key) {
  endSegment();
  segmentKey = key;
  segmentStart = Date.now();
}

function endSegment() {
  if (segmentKey && segmentStart) {
    const ms = Date.now() - segmentStart;
    state.segmentTime[segmentKey] = (state.segmentTime[segmentKey] || 0) + ms;
    save();
  }
  segmentKey = null;
  segmentStart = null;
}

function go(screen) {
  state.screen = screen;
  save();
  render();
}

function setProgress(text) { progressEl.textContent = text || ""; }

// ---------- confusion matrix visual ----------

function matrixView({ values, labels, highlight = [], positive = "fraud", compact = false }) {
  const cell = (key, name) => {
    const v = values ? values[key] : null;
    const content = [];
    if (labels || !values) content.push(el("span", { class: "cell-name", text: name }));
    if (values) content.push(el("span", { class: "cell-value", text: String(v) }));
    return el("td", { class: "cell " + key + (highlight.includes(key) ? " hl" : "") }, content);
  };
  const neg = "not " + positive;
  return el("table", { class: "matrix" + (compact ? " compact" : ""), "aria-label": "Confusion matrix" }, [
    el("tr", {}, [
      el("th", {}),
      el("th", { scope: "col", text: "Predicted " + positive }),
      el("th", { scope: "col", text: "Predicted " + neg }),
    ]),
    el("tr", {}, [
      el("th", { scope: "row", text: "Actually " + positive }),
      cell("tp", "True positive"),
      cell("fn", "False negative"),
    ]),
    el("tr", {}, [
      el("th", { scope: "row", text: "Actually " + neg }),
      cell("fp", "False positive"),
      cell("tn", "True negative"),
    ]),
  ]);
}

function visualView(v) {
  if (!v) return null;
  if (v.kind === "matrix") return matrixView(v);
  return vizCustom(v);
}

// ---------- item rendering and scoring ----------

// Options are shuffled so the right answer is not always in the same place.
// The order is fixed per learner and item, so a reload shows the same order.
// True or false items keep their natural order.
function optionOrder(itemId) {
  const item = ITEMS[itemId];
  if (item.type === "tf") return item.options;
  const seedText = (state.email || R_CODE || "") + ":" + itemId;
  let h = 2166136261;
  for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rand = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  const opts = [...item.options];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

function itemForm(itemId, { onSubmit, submitLabel = "Submit" }) {
  const item = ITEMS[itemId];
  const multi = item.type === "multi";
  const name = "item-" + itemId;
  const form = el("form", { class: "item" });
  form.appendChild(el("p", { class: "stem", text: item.stem }));
  if (item.matrix) form.appendChild(matrixView(item.matrix === true ? { values: MATRIX } : item.matrix));
  const list = el("div", { class: "options", role: multi ? "group" : "radiogroup" });
  optionOrder(itemId).forEach((opt) => {
    const id = name + "-" + opt.key;
    list.appendChild(el("label", { class: "option", for: id }, [
      el("input", { type: multi ? "checkbox" : "radio", name, id, value: opt.key }),
      el("span", { text: opt.text }),
    ]));
  });
  form.appendChild(list);
  const btn = el("button", { type: "submit", class: "primary", text: submitLabel, disabled: true });
  form.appendChild(btn);
  form.addEventListener("change", () => {
    btn.disabled = form.querySelectorAll("input:checked").length === 0;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const chosen = [...form.querySelectorAll("input:checked")].map((i) => i.value);
    if (chosen.length) onSubmit(chosen);
  });
  return form;
}

function scoreItem(itemId, chosen) {
  const item = ITEMS[itemId];
  const correctKeys = item.options.filter((o) => o.correct).map((o) => o.key).sort();
  const picked = [...chosen].sort();
  return correctKeys.length === picked.length && correctKeys.every((k, i) => k === picked[i]);
}

function recordResponse(phase, itemId, chosen, correct) {
  const item = ITEMS[itemId];
  const tags = item.options
    .filter((o) => chosen.includes(o.key) && !o.correct && o.tag)
    .map((o) => o.tag);
  state.responses.push({
    phase, itemId, obj: item.obj, chosen, correct, tags,
    arm: state.arm, at: new Date().toISOString(),
  });
  save();
}

// Feedback differs by arm. Arm A explains, Arm B shows only the correct answer.
function feedbackView(itemId, chosen, correct) {
  const item = ITEMS[itemId];
  const correctOpts = item.options.filter((o) => o.correct);
  const answerText = correctOpts.map((o) => o.text).join(" and ");
  const box = el("div", { class: "feedback " + (correct ? "ok" : "bad") });
  box.appendChild(el("p", { class: "verdict", text: correct ? "Correct." : "Not quite." }));

  if (state.arm === "B") {
    if (!correct) box.appendChild(el("p", { text: "The correct answer is: " + answerText + "." }));
    return box;
  }

  // Arm A: explanatory feedback.
  if (correct) {
    correctOpts.forEach((o) => box.appendChild(el("p", { text: o.explain })));
    return box;
  }
  const wrongPicked = item.options.filter((o) => chosen.includes(o.key) && !o.correct);
  const missed = item.options.filter((o) => o.correct && !chosen.includes(o.key));
  wrongPicked.forEach((o) => {
    box.appendChild(el("p", {}, [el("strong", { text: "You chose \"" + o.text + "\". " }), o.explain]));
    if (o.tag && MISCONCEPTIONS[o.tag]) {
      box.appendChild(el("p", { class: "misconception", text: "Common mix-up: " + MISCONCEPTIONS[o.tag].toLowerCase() + "." }));
    }
  });
  if (item.type === "multi") {
    missed.forEach((o) => box.appendChild(el("p", {}, [el("strong", { text: "You missed \"" + o.text + "\". " }), o.explain])));
  }
  box.appendChild(el("p", { class: "answer", text: "The correct answer is: " + answerText + "." }));
  if (item.type !== "multi") {
    correctOpts.forEach((o) => box.appendChild(el("p", { text: o.explain })));
  }
  return box;
}

// ---------- screens ----------

function renderLanding() {
  setProgress("");
  leaveBtn.hidden = true;
  const signup = el("button", { class: "primary", text: "Sign up as a new user" });
  const signin = el("button", { class: "secondary", text: "Sign in to continue" });
  signup.addEventListener("click", () => go("register"));
  signin.addEventListener("click", () => go("signin"));
  app.replaceChildren(
    el("h1", { text: "Learn to evaluate a classifier" }),
    el("p", { text: "A short module on the confusion matrix, precision, recall and why accuracy can mislead." }),
    el("div", { class: "auth-buttons" }, [
      signup,
      signin,
    ]),
  );
}

function renderSignin() {
  setProgress("");
  leaveBtn.hidden = true;
  const input = el("input", { type: "email", id: "signin-email", required: true, autocomplete: "email", placeholder: "you@example.com" });
  const err = el("p", { class: "error", role: "alert" });
  const btn = el("button", { type: "submit", class: "primary", text: "Continue" });
  const back = el("button", { class: "link-btn", text: "← Back" });
  back.addEventListener("click", () => go("landing"));
  const form = el("form", { novalidate: true }, [
    el("h1", { text: "Sign in" }),
    el("p", { text: "Enter your email to resume your progress." }),
    el("label", { for: "signin-email", text: "Email address" }),
    input,
    err,
    el("div", { class: "row" }, [back, btn]),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      err.textContent = "Please enter a valid email address.";
      return;
    }
    const saved = Store.load(v);
    if (saved) {
      state = saved;
      // If they left with "Leave for now", resumeScreen already holds their place.
      if (state.screen !== "saved") state.resumeScreen = state.screen;
      state.screen = "saved";
      leaveBtn.hidden = false;
      save();
      render();
    } else {
      err.textContent = "No account found with this email. Sign up to get started.";
    }
  });
  app.replaceChildren(form);
  input.focus();
}

// One screen: what the module is, the data notice, email and consent together,
// so the learner sees the notice before typing anything.
function renderRegister() {
  setProgress("");
  leaveBtn.hidden = true;
  const input = el("input", { type: "email", id: "email", required: true, autocomplete: "email", placeholder: "you@example.com" });
  const box = el("input", { type: "checkbox", id: "consent" });
  const err = el("p", { class: "error", role: "alert" });
  const btn = el("button", { type: "submit", class: "primary", text: "Agree and start", disabled: true });
  const valid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
  const update = () => { btn.disabled = !box.checked; err.textContent = ""; };
  input.addEventListener("input", update);
  box.addEventListener("change", update);
  const back = el("button", { class: "link-btn", text: "← Back" });
  back.addEventListener("click", () => go("landing"));
  const form = el("form", { novalidate: true }, [
    el("h1", { text: "Learn to evaluate a classifier" }),
    el("p", { text: "A short module on the confusion matrix, precision, recall and why accuracy can mislead. It takes 30 to 45 minutes, and you can leave and come back at any time. A short retention quiz follows five to six days later by email." }),
    el("h2", { class: "notice-title", text: "Your data" }),
    el("ul", { class: "notice" }, [
      el("li", { text: "What is stored: your email address and your answers in this module." }),
      el("li", { text: "Why: to save your progress, and to study whether the module helps people learn." }),
      el("li", { text: "Your email is used only to send the retention quiz reminder." }),
      el("li", { text: "All data is deleted after thirty days of inactivity." }),
      el("li", { text: "Taking part is voluntary, and you can stop at any time." }),
    ]),
    el("label", { for: "email", text: "Email address" }),
    input,
    el("label", { class: "option consent", for: "consent" }, [box, el("span", { text: "I have read this notice and agree to take part." })]),
    el("p", { class: "muted", text: "Nothing is stored until you tick the box." }),
    err,
    el("div", { class: "row" }, [back, btn]),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!valid()) { err.textContent = "Please enter a valid email address."; input.focus(); return; }
    if (!box.checked) return;
    const email = Store.norm(input.value);
    // Signing up again would wipe progress and re-draw the arm, so send them to sign in.
    if (Store.exists(email)) {
      err.textContent = "This email already has saved progress. Go back and choose Sign in.";
      return;
    }
    state = newState();
    state.email = email;
    if (DEMO) state.demo = true;
    state.consentAt = new Date().toISOString();
    state.arm = Math.random() < 0.5 ? "A" : "B"; // random assignment at registration
    leaveBtn.hidden = false;
    go("diagIntro");
  });
  app.replaceChildren(form);
  input.focus();
}

function renderDiagIntro() {
  setProgress("Diagnostic");
  const btn = el("button", { class: "primary", text: "Start the diagnostic" });
  btn.addEventListener("click", () => go("diagnostic"));
  app.replaceChildren(
    el("h1", { text: "A quick check first" }),
    el("p", { text: "Eight questions, two for each learning goal. There is no score to worry about. The point is to show you what you already know and where your gaps are, before the lessons start." }),
    btn,
  );
}

function renderDiagnostic() {
  const i = state.diagIndex;
  if (i >= DIAGNOSTIC.length) return go("report");
  const itemId = DIAGNOSTIC[i];
  setProgress("Diagnostic " + (i + 1) + " of " + DIAGNOSTIC.length);
  startSegment("diagnostic");
  app.replaceChildren(
    el("h1", { text: "Question " + (i + 1) }),
    itemForm(itemId, {
      submitLabel: "Next",
      onSubmit: (chosen) => {
        recordResponse("diagnostic", itemId, chosen, scoreItem(itemId, chosen));
        state.diagIndex += 1;
        save();
        renderDiagnostic();
      },
    }),
  );
}

function renderReport() {
  endSegment();
  setProgress("Your starting point");
  const diag = state.responses.filter((r) => r.phase === "diagnostic");
  const rows = Object.entries(OBJECTIVES).map(([key, label]) => {
    const rs = diag.filter((x) => x.obj === key);
    const right = rs.filter((x) => x.correct).length;
    const known = rs.length > 0 && right === rs.length;
    const partly = !known && right > 0;
    const tag = rs.flatMap((x) => x.tags).find((t) => MISCONCEPTIONS[t]);
    const tagText = !known && tag
      ? "You may be thinking: " + MISCONCEPTIONS[tag].toLowerCase() + "."
      : null;
    return el("li", { class: known ? "known" : (partly ? "partly" : "gap") }, [
      el("strong", { text: (known ? "You already know this: " : (partly ? "Partly there: " : "Likely gap: ")) }),
      label + ".",
      tagText ? el("span", { class: "misconception", text: " " + tagText }) : null,
    ]);
  });
  const btn = el("button", { class: "primary", text: "Start the lessons" });
  btn.addEventListener("click", () => {
    state.slideIndex = 0;
    state.slidePhase = "slide";
    state.revealed = false;
    go("slides");
  });
  app.replaceChildren(
    el("h1", { text: "Here is where you are starting" }),
    el("ul", { class: "report" }, rows),
    el("p", { class: "muted", text: "Everyone sees the same lessons. Watch for the topics marked as gaps." }),
    btn,
  );
}

// ---------- slide navigation ----------
// maxSlide: furthest slide whose content the learner has seen.
// checksDone: slides whose check has been answered, so revisiting never repeats a check.

function navInit() {
  if (state.maxSlide == null) state.maxSlide = -1;
  if (!state.checksDone) state.checksDone = [];
}

function goSlide(i) {
  navInit();
  state.slideIndex = Math.max(0, i);
  state.slidePhase = "slide";
  state.revealed = state.slideIndex <= state.maxSlide;
  save();
  renderSlides();
}

function slideBack() {
  if (state.slideIndex > 0) goSlide(state.slideIndex - 1);
}

function slideForward() {
  navInit();
  const idx = state.slideIndex;
  const slide = SLIDES[idx];
  if (slide.predict && !state.revealed) return; // must predict first on a first visit
  if (slide.check && !state.checksDone.includes(idx)) {
    state.slidePhase = "check";
    save();
    renderSlides();
    return;
  }
  goSlide(idx + 1);
}

function slideNav({ canForward, forwardLabel }) {
  const idx = state.slideIndex;
  const nav = el("div", { class: "slide-nav" });
  nav.appendChild(el("button", {
    class: "arrow secondary", text: "← Back", "aria-label": "Previous slide",
    disabled: idx === 0, onclick: slideBack,
  }));
  nav.appendChild(el("span", { class: "slide-count", text: (idx + 1) + " / " + SLIDES.length }));
  nav.appendChild(el("button", {
    class: "arrow primary", text: forwardLabel + " →", "aria-label": forwardLabel,
    disabled: !canForward, onclick: slideForward,
  }));
  return nav;
}

function renderSlides() {
  navInit();
  const idx = state.slideIndex;
  if (idx >= SLIDES.length) return go("summIntro");
  const slide = SLIDES[idx];
  setProgress("Slide " + (idx + 1) + " of " + SLIDES.length);

  if (state.slidePhase === "check") return renderCheck(slide.check);
  if (state.slidePhase === "checkFeedback") return renderCheckFeedback(slide.check);

  startSegment("slide-" + (idx + 1));
  const parts = [el("h1", { text: slide.title })];

  // Predict first: on a first visit the learner commits before the text appears.
  if (slide.predict && !state.revealed) {
    const choices = el("div", { class: "options" });
    slide.predict.choices.forEach((c) => {
      choices.appendChild(el("button", {
        class: "choice", text: c,
        onclick: () => {
          state.predictions.push({ slide: idx + 1, choice: c, at: new Date().toISOString() });
          state.revealed = true;
          save();
          renderSlides();
        },
      }));
    });
    parts.push(el("div", { class: "predict" }, [
      el("p", { class: "predict-label", text: "Predict first" }),
      el("p", { text: slide.predict.prompt }),
      choices,
    ]));
    parts.push(slideNav({ canForward: false, forwardLabel: "Next" }));
    app.replaceChildren(...parts);
    return;
  }

  if (idx > state.maxSlide) { state.maxSlide = idx; save(); }

  if (slide.predict) {
    const p = [...state.predictions].reverse().find((x) => x.slide === idx + 1);
    if (p) parts.push(el("p", { class: "muted", text: "Your prediction: " + p.choice }));
  }
  parts.push(visualView(slide.visual));
  slide.text.forEach((t) => parts.push(el("p", { class: "slide-text", text: t })));

  const pendingCheck = slide.check && !state.checksDone.includes(idx);
  const last = idx === SLIDES.length - 1;
  parts.push(slideNav({
    canForward: true,
    forwardLabel: pendingCheck ? "Check your understanding" : (last ? "Finish" : "Next"),
  }));
  app.replaceChildren(...parts);
}

function renderCheck(itemId) {
  const checkNo = SLIDES.slice(0, state.slideIndex + 1).filter((s) => s.check).length;
  setProgress("Check " + checkNo + " of 5");
  startSegment("check-" + checkNo);
  const back = el("button", { class: "secondary", text: "← Back to slide", onclick: () => goSlide(state.slideIndex) });
  app.replaceChildren(
    el("h1", { text: "Check " + checkNo }),
    itemForm(itemId, {
      onSubmit: (chosen) => {
        const correct = scoreItem(itemId, chosen);
        recordResponse("check", itemId, chosen, correct);
        state.lastCheck = { itemId, chosen, correct };
        if (!state.checksDone.includes(state.slideIndex)) state.checksDone.push(state.slideIndex);
        state.slidePhase = "checkFeedback";
        save();
        renderSlides();
      },
    }),
    back,
  );
}

function renderCheckFeedback(itemId) {
  const last = state.lastCheck || { itemId, chosen: [], correct: false };
  const btn = el("button", { class: "primary", text: "Continue →" });
  btn.addEventListener("click", () => goSlide(state.slideIndex + 1));
  app.replaceChildren(
    el("h1", { text: "Feedback" }),
    el("p", { class: "stem", text: ITEMS[itemId].stem }),
    feedbackView(itemId, last.chosen, last.correct),
    btn,
  );
}

// Keyboard: left and right arrow keys move between slides.
document.addEventListener("keydown", (e) => {
  if (state.screen !== "slides" || state.slidePhase !== "slide") return;
  if (leaveDialog.open) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); slideBack(); }
  if (e.key === "ArrowRight") { e.preventDefault(); slideForward(); }
});

function resultsString() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

// ---------- final (summative) quiz ----------

function renderSummIntro() {
  endSegment();
  if ((state.summIndex || 0) >= SUMMATIVE.length) return go("summary");
  setProgress("Final quiz");
  const btn = el("button", { class: "primary", text: "Start the final quiz" });
  btn.addEventListener("click", () => { state.summIndex = state.summIndex || 0; go("summative"); });
  app.replaceChildren(
    el("h1", { text: "Final quiz" }),
    el("p", { text: "Four questions, one for each learning goal. You will see how you did, with feedback, after the last one." }),
    btn,
  );
}

function renderSummative() {
  const i = state.summIndex || 0;
  if (i >= SUMMATIVE.length) return go("summary");
  const itemId = SUMMATIVE[i];
  setProgress("Final quiz " + (i + 1) + " of " + SUMMATIVE.length);
  startSegment("summative");
  app.replaceChildren(
    el("h1", { text: "Question " + (i + 1) }),
    itemForm(itemId, {
      submitLabel: i === SUMMATIVE.length - 1 ? "Finish" : "Next",
      onSubmit: (chosen) => {
        recordResponse("summative", itemId, chosen, scoreItem(itemId, chosen));
        state.summIndex = i + 1;
        save();
        renderSummative();
      },
    }),
  );
}

function retentionLink() {
  return location.origin + location.pathname + "?retention=" + state.retentionCode;
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

// Page 1 after the final quiz: the score and feedback on each question.
function renderSummary() {
  endSegment();
  setProgress("Final quiz results");
  if (!state.completedAt) state.completedAt = new Date().toISOString();
  if (!state.retentionCode) {
    state.retentionCode = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  }
  save();

  const latest = SUMMATIVE.map((itemId) =>
    [...state.responses].reverse().find((x) => x.phase === "summative" && x.itemId === itemId)).filter(Boolean);
  const right = latest.filter((r) => r.correct).length;

  const review = el("div", { class: "review" });
  latest.forEach((r, n) => {
    const item = ITEMS[r.itemId];
    review.appendChild(el("h3", { text: "Question " + (n + 1) }));
    review.appendChild(el("p", { class: "stem", text: item.stem }));
    if (item.matrix) review.appendChild(matrixView(item.matrix === true ? { values: MATRIX, compact: true } : { ...item.matrix, compact: true }));
    review.appendChild(feedbackView(r.itemId, r.chosen, r.correct));
  });

  const btn = el("button", { class: "primary", text: "Continue →", onclick: () => go("next") });
  app.replaceChildren(
    el("h1", { text: "You scored " + right + " of " + latest.length + " on the final quiz" }),
    review,
    btn,
  );
}

function calendarLink(opens) {
  const day = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(opens.getTime() + 864e5);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: "Precision and Recall: retention quiz",
    dates: day(opens) + "/" + day(end),
    details: "Your 5-minute retention quiz: " + retentionLink(),
  });
  return "https://calendar.google.com/calendar/render?" + q.toString();
}

// Page 2: what happens next, and the certificate once the retention quiz is passed.
function renderNext() {
  endSegment();
  setProgress("Done");
  const days = state.demo ? 0 : RETENTION_DAYS;
  const opens = new Date(new Date(state.completedAt).getTime() + days * 864e5);

  let result = null;
  try { result = (JSON.parse(localStorage.getItem("pr-retention-" + state.retentionCode)) || {}).result || null; } catch (e) {}

  const link = el("input", { type: "text", class: "link-box", readonly: true, value: retentionLink(), "aria-label": "Your retention quiz link" });
  link.addEventListener("focus", () => link.select());
  const copy = el("button", { class: "secondary", text: "Copy link" });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(retentionLink()); copy.textContent = "Copied"; }
    catch (e) { link.focus(); link.select(); }
  });
  const cal = el("a", { class: "secondary button-link", href: calendarLink(opens), target: "_blank", rel: "noopener", text: "Add to calendar" });

  const parts = [el("h1", { text: "One last step: the retention quiz" })];

  if (state.demo) {
    parts.push(
      el("p", { class: "demo-note", text: "🧪 Demo mode: the retention quiz is open now, so you can complete the full journey in one session." }),
      el("a", { class: "primary button-link", href: retentionLink(), text: "Take the retention quiz now →" }),
    );
  } else {
    parts.push(
      el("p", { text: "A short retention quiz checks what you still remember. It has eight new questions and takes about five minutes." }),
      el("p", {}, [el("strong", { text: "It opens in " + days + " days, on " + formatDate(opens) + "." }), " We will email you the link. It works on any device."]),
      el("p", { class: "muted", text: "You can also save the link now and open it on any device:" }),
    );
  }
  parts.push(link, el("div", { class: "row left" }, [copy, cal]));

  // Certificate section
  const passed = result && result.passed;
  const cert = passed
    ? el("a", { class: "primary button-link", href: retentionLink(), text: "Download certificate" })
    : el("button", { class: "primary", disabled: true, title: "Complete the retention quiz to unlock", text: "Download certificate" });

  parts.push(
    el("h2", { class: "notice-title", text: "Your certificate" }),
    el("p", { class: "muted", text: passed
      ? "You scored " + result.score + " of " + RETENTION.length + " on the retention quiz. ✓"
      : "Complete the retention quiz and score 6 or more to earn your certificate." }),
    cert,
  );

  app.replaceChildren(...parts);
}

// Shown after "Leave for now", and whenever someone reopens the page mid-session.
function renderSaved() {
  setProgress("");
  leaveBtn.hidden = true;
  const btn = el("button", { class: "primary", text: "Resume where I left off" });
  btn.addEventListener("click", () => {
    state.resumes += 1;
    leaveBtn.hidden = false;
    go(state.resumeScreen || "slides");
  });
  const fresh = el("button", { class: "link-btn", text: "Not you? Start as a new learner" });
  // Hands the tab to someone else. This learner's progress stays saved for sign-in.
  fresh.addEventListener("click", () => {
    endSegment();
    Store.forget();
    state = newState();
    render();
  });
  app.replaceChildren(
    el("h1", { text: "Welcome back" }),
    el("p", { text: "Your place is saved for " + (state.email || "this browser") + "." }),
    btn,
    el("p", { class: "muted fresh-row" }, [fresh]),
  );
}

// ---------- leave and return ----------

leaveBtn.addEventListener("click", () => {
  document.getElementById("leaveReason").value = "";
  leaveDialog.showModal();
});

leaveDialog.addEventListener("close", () => {
  if (leaveDialog.returnValue !== "leave") return;
  endSegment();
  state.exits.push({
    screen: state.screen,
    slide: state.screen === "slides" ? state.slideIndex + 1 : null,
    reason: document.getElementById("leaveReason").value.trim(),
    at: new Date().toISOString(),
  });
  state.resumeScreen = state.screen;
  go("saved");
});

window.addEventListener("pagehide", () => { endSegment(); Store.beacon(); });

// Time on task only counts while the page is visible.
let pausedSegment = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (segmentKey) { pausedSegment = segmentKey; endSegment(); }
  } else if (pausedSegment) {
    startSegment(pausedSegment);
    pausedSegment = null;
  }
});

// ---------- router ----------

const SCREENS = {
  landing: renderLanding,
  register: renderRegister,
  notice: renderRegister,
  signin: renderSignin,
  diagIntro: renderDiagIntro,
  diagnostic: renderDiagnostic,
  report: renderReport,
  slides: renderSlides,
  end: renderSummIntro, // older saves used "end" for the finish screen
  summIntro: renderSummIntro,
  summative: renderSummative,
  summary: renderSummary,
  next: renderNext,
  saved: renderSaved,
};

function render() {
  leaveBtn.hidden = !state.consentAt; // screens before consent and "saved" hide it again
  (SCREENS[state.screen] || renderRegister)();
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------- retention quiz ----------
// Opened from the emailed link (?retention=<code>), on any device, without signing in.
// The code is a long random string saved with the learner's row at the end of the module.
// Two database functions check the code and store the answers. Nothing else is readable.

const R_CODE = new URLSearchParams(location.search).get("retention");
const R_KEY = "pr-retention-" + R_CODE;
let rstate = null;

function rSave() { try { localStorage.setItem(R_KEY, JSON.stringify(rstate)); } catch (e) {} }

function rShow(...nodes) {
  leaveBtn.hidden = true;
  app.replaceChildren(...nodes);
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function rError(msg, retry) {
  const btn = el("button", { class: "primary", text: "Try again", onclick: retry });
  rShow(el("h1", { text: "Something went wrong" }), el("p", { text: msg }), btn);
}

async function startRetention() {
  setProgress("Retention quiz");
  try { rstate = JSON.parse(localStorage.getItem(R_KEY)); } catch (e) {}
  if (rstate && rstate.result) return renderRetentionResult();
  rShow(el("h1", { text: "Retention quiz" }), el("p", { class: "muted", text: "Checking your link..." }));
  let info;
  try {
    const rows = await Store.rpc("retention_lookup", { p_code: R_CODE });
    info = rows && rows[0];
  } catch (e) {
    return rError("Could not reach the server. Check your connection and try again.", startRetention);
  }
  if (!info) {
    return rShow(el("h1", { text: "Link not recognised" }),
      el("p", { text: "This retention link is not valid. Please use the exact link from your email." }));
  }
  if (info.done) {
    return rShow(el("h1", { text: "Already done" }),
      el("p", { text: "You have already taken the retention quiz. Thank you for taking part." }));
  }
  const opens = new Date(info.opens_at);
  if (Date.now() < opens.getTime()) {
    return rShow(el("h1", { text: "Not open yet" }),
      el("p", { text: "The retention quiz opens on " + formatDate(opens) + ". Come back then with this same link." }));
  }
  if (!rstate || typeof rstate.index !== "number") rstate = { index: 0, answers: [], startedAt: new Date().toISOString() };
  rSave();
  if (rstate.index > 0) return renderRetentionItem();
  const btn = el("button", { class: "primary", text: "Start the quiz", onclick: renderRetentionItem });
  rShow(
    el("h1", { text: "Retention quiz" }),
    el("p", { text: "Eight new questions on the same ideas as the module. Answer from memory, without notes. You will see your score and the answers at the end." }),
    el("p", { text: "Score 6 or more to earn your certificate." }),
    btn,
  );
}

function renderRetentionItem() {
  const i = rstate.index;
  if (i >= RETENTION.length) return submitRetention();
  const itemId = RETENTION[i];
  setProgress("Retention quiz " + (i + 1) + " of " + RETENTION.length);
  rShow(
    el("h1", { text: "Question " + (i + 1) }),
    itemForm(itemId, {
      submitLabel: i === RETENTION.length - 1 ? "Finish" : "Next",
      onSubmit: (chosen) => {
        const item = ITEMS[itemId];
        rstate.answers.push({
          itemId, obj: item.obj, chosen, correct: scoreItem(itemId, chosen),
          tags: item.options.filter((o) => chosen.includes(o.key) && !o.correct && o.tag).map((o) => o.tag),
          at: new Date().toISOString(),
        });
        rstate.index = i + 1;
        rSave();
        renderRetentionItem();
      },
    }),
  );
}

async function submitRetention() {
  const score = rstate.answers.filter((a) => a.correct).length;
  const passed = score >= RETENTION_PASS;
  rShow(el("h1", { text: "Saving your answers" }), el("p", { class: "muted", text: "One moment..." }));
  let status;
  try {
    status = await Store.rpc("retention_submit", {
      p_code: R_CODE, p_answers: rstate.answers, p_score: score, p_passed: passed, p_started_at: rstate.startedAt,
    });
  } catch (e) {
    return rError("Your answers are kept on this device, but they could not be sent. Check your connection and try again.", submitRetention);
  }
  if (status !== "ok" && status !== "done") {
    return rError("The server did not accept your answers (" + status + "). Please contact the study team.", submitRetention);
  }
  rstate.result = { score, passed, at: new Date().toISOString() };
  rSave();
  renderRetentionResult();
}

function renderRetentionResult() {
  const { score, passed, at } = rstate.result;
  setProgress("Retention quiz");
  const review = el("div", { class: "review" });
  rstate.answers.forEach((a, n) => {
    const item = ITEMS[a.itemId];
    const right = item.options.filter((o) => o.correct);
    const box = el("div", { class: "feedback " + (a.correct ? "ok" : "bad") }, [
      el("p", { class: "verdict", text: a.correct ? "Correct." : "Not quite." }),
      el("p", { class: "answer", text: "The correct answer is: " + right.map((o) => o.text).join(" and ") + "." }),
      ...right.map((o) => el("p", { text: o.explain })),
    ]);
    review.append(el("h3", { text: "Question " + (n + 1) }), el("p", { class: "stem", text: item.stem }), box);
  });

  const parts = [
    el("h1", { text: "You scored " + score + " of " + RETENTION.length }),
  ];
  if (passed) {
    const name = el("input", { type: "text", id: "cert-name", placeholder: "Your name", autocomplete: "name" });
    const holder = el("div");
    const make = el("button", { class: "primary", text: "Show my certificate" });
    make.addEventListener("click", () => {
      holder.replaceChildren(certificateView(name.value.trim() || "Learner", score, at),
        el("button", { class: "primary", text: "Print or save as PDF", onclick: () => window.print() }));
    });
    parts.push(
      el("p", { text: "Well done. You remembered the key ideas five days later, so you have earned the certificate." }),
      el("label", { for: "cert-name", text: "Name to print on the certificate (not saved)" }),
      name, make, holder,
    );
  } else {
    parts.push(el("p", { text: "The certificate needs 6 of 8. Thank you for coming back and taking part. The answers below show what to review." }));
  }
  parts.push(el("h2", { class: "notice-title", text: "Your answers" }), review);
  rShow(...parts);
}

function certificateView(name, score, at) {
  return el("div", { class: "certificate" }, [
    el("p", { class: "cert-kicker", text: "Certificate of retention" }),
    el("p", { class: "cert-name", text: name }),
    el("p", { text: "completed the Precision and Recall module and scored " + score + " of " + RETENTION.length + " on the retention quiz, taken at least five days after the lessons." }),
    el("p", { class: "cert-skills", text: "Confusion matrix · Precision and recall · Choosing a metric by the cost of each error · Why accuracy misleads" }),
    el("p", { class: "cert-foot", text: new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + " · A CS6460 student project" }),
  ]);
}

if (R_CODE) startRetention();
else render();
