// App shell: registration, data notice, diagnostic, calibration report,
// slide flow with predict-first and checks, leave and return.

const app = document.getElementById("app");
const progressEl = document.getElementById("progress");
const leaveBtn = document.getElementById("leaveBtn");
const leaveDialog = document.getElementById("leaveDialog");

if (new URLSearchParams(location.search).has("reset")) {
  Store.clear();
  history.replaceState(null, "", location.pathname);
}

let state = Store.load() || newState();
let segmentStart = null;
let segmentKey = null;

function newState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    screen: "register",
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

function matrixView({ values, labels, highlight = [], positive = "fraud" }) {
  const cell = (key, name) => {
    const v = values ? values[key] : null;
    const content = [];
    if (labels || !values) content.push(el("span", { class: "cell-name", text: name }));
    if (values) content.push(el("span", { class: "cell-value", text: String(v) }));
    return el("td", { class: "cell " + key + (highlight.includes(key) ? " hl" : "") }, content);
  };
  const neg = "not " + positive;
  return el("table", { class: "matrix", "aria-label": "Confusion matrix" }, [
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
  return el("div", { class: "visual-placeholder" }, [
    el("span", { class: "ph-label", text: "Visual (coming in week of Nov 2)" }),
    el("p", { text: v.text }),
  ]);
}

// ---------- item rendering and scoring ----------

function itemForm(itemId, { onSubmit, submitLabel = "Submit" }) {
  const item = ITEMS[itemId];
  const multi = item.type === "multi";
  const name = "item-" + itemId;
  const form = el("form", { class: "item" });
  form.appendChild(el("p", { class: "stem", text: item.stem }));
  if (item.matrix) form.appendChild(matrixView({ values: MATRIX }));
  const list = el("div", { class: "options", role: multi ? "group" : "radiogroup" });
  item.options.forEach((opt) => {
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

function renderRegister() {
  setProgress("");
  leaveBtn.hidden = true;
  const input = el("input", { type: "email", id: "email", required: true, autocomplete: "email", placeholder: "you@example.com" });
  const err = el("p", { class: "error", role: "alert" });
  const form = el("form", { novalidate: true }, [
    el("h1", { text: "Learn to evaluate a classifier" }),
    el("p", { text: "A short module on the confusion matrix, precision, recall and why accuracy can mislead. It takes 30 to 45 minutes, and you can leave and come back at any time." }),
    el("p", { text: "A short retention quiz follows five to six days later by email." }),
    el("label", { for: "email", text: "Email address" }),
    input, err,
    el("button", { type: "submit", class: "primary", text: "Continue" }),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      err.textContent = "Please enter a valid email address.";
      return;
    }
    state.email = v;
    go("notice");
  });
  app.replaceChildren(form);
  input.focus();
}

function renderNotice() {
  setProgress("");
  const box = el("input", { type: "checkbox", id: "consent" });
  const btn = el("button", { class: "primary", text: "Agree and start", disabled: true });
  box.addEventListener("change", () => { btn.disabled = !box.checked; });
  btn.addEventListener("click", () => {
    state.consentAt = new Date().toISOString();
    state.arm = Math.random() < 0.5 ? "A" : "B"; // random assignment at registration
    leaveBtn.hidden = false;
    go("diagIntro");
  });
  app.replaceChildren(
    el("h1", { text: "Before you start: your data" }),
    el("ul", { class: "notice" }, [
      el("li", { text: "What is stored: your email address and your answers in this module." }),
      el("li", { text: "Why: to save your progress, and to study whether the module helps people learn." }),
      el("li", { text: "Your email is used only to send the retention quiz reminder." }),
      el("li", { text: "All data is deleted after thirty days of inactivity." }),
      el("li", { text: "Taking part is voluntary, and you can stop at any time." }),
    ]),
    el("label", { class: "option consent", for: "consent" }, [box, el("span", { text: "I have read this notice and agree to take part." })]),
    el("p", { class: "muted", text: "Nothing is stored until you tick the box." }),
    btn,
  );
}

function renderDiagIntro() {
  setProgress("Diagnostic");
  const btn = el("button", { class: "primary", text: "Start the diagnostic" });
  btn.addEventListener("click", () => go("diagnostic"));
  app.replaceChildren(
    el("h1", { text: "A quick check first" }),
    el("p", { text: "Four questions, one for each learning goal. There is no score to worry about. The point is to show you what you already know and where your gaps are, before the lessons start." }),
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
    const r = diag.find((x) => x.obj === key);
    const known = r && r.correct;
    const tagText = r && !r.correct && r.tags.length
      ? "You may be thinking: " + MISCONCEPTIONS[r.tags[0]].toLowerCase() + "."
      : null;
    return el("li", { class: known ? "known" : "gap" }, [
      el("strong", { text: (known ? "You already know this: " : "Likely gap: ") }),
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

function renderSlides() {
  const idx = state.slideIndex;
  if (idx >= SLIDES.length) return go("end");
  const slide = SLIDES[idx];
  setProgress("Slide " + (idx + 1) + " of " + SLIDES.length);

  if (state.slidePhase === "check") return renderCheck(slide.check);
  if (state.slidePhase === "checkFeedback") return renderCheckFeedback(slide.check);

  startSegment("slide-" + (idx + 1));
  const parts = [el("h1", { text: slide.title })];

  // Predict first: the learner commits before the text appears.
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
    app.replaceChildren(...parts);
    return;
  }

  if (slide.predict) {
    const p = [...state.predictions].reverse().find((x) => x.slide === idx + 1);
    if (p) parts.push(el("p", { class: "muted", text: "Your prediction: " + p.choice }));
  }
  parts.push(visualView(slide.visual));
  slide.text.forEach((t) => parts.push(el("p", { class: "slide-text", text: t })));

  const nav = el("div", { class: "row" });
  if (idx > 0) {
    nav.appendChild(el("button", { class: "secondary", text: "← Back", onclick: () => {
      state.slideIndex -= 1; state.slidePhase = "slide"; state.revealed = true; save(); renderSlides();
    } }));
  } else {
    nav.appendChild(el("button", { class: "secondary", text: "← Back", disabled: true }));
  }
  nav.appendChild(el("button", { class: "primary", text: (slide.check ? "Check your understanding" : "Next") + " →", onclick: () => {
    if (slide.check) { state.slidePhase = "check"; }
    else { state.slideIndex += 1; state.revealed = false; }
    save(); renderSlides();
  } }));
  parts.push(nav);
  app.replaceChildren(...parts);
}

function renderCheck(itemId) {
  const checkNo = SLIDES.slice(0, state.slideIndex + 1).filter((s) => s.check).length;
  setProgress("Check " + checkNo + " of 5");
  startSegment("check-" + checkNo);
  app.replaceChildren(
    el("h1", { text: "Check " + checkNo }),
    itemForm(itemId, {
      onSubmit: (chosen) => {
        const correct = scoreItem(itemId, chosen);
        recordResponse("check", itemId, chosen, correct);
        state.lastCheck = { itemId, chosen, correct };
        state.slidePhase = "checkFeedback";
        save();
        renderSlides();
      },
    }),
  );
}

function renderCheckFeedback(itemId) {
  const last = state.lastCheck || { itemId, chosen: [], correct: false };
  const btn = el("button", { class: "primary", text: "Continue" });
  btn.addEventListener("click", () => {
    state.slideIndex += 1;
    state.slidePhase = "slide";
    state.revealed = false;
    save();
    renderSlides();
  });
  app.replaceChildren(
    el("h1", { text: "Feedback" }),
    el("p", { class: "stem", text: ITEMS[itemId].stem }),
    feedbackView(itemId, last.chosen, last.correct),
    btn,
  );
}

function resultsString() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

function renderEnd() {
  endSegment();
  setProgress("Done");
  state.completedAt = state.completedAt || new Date().toISOString();
  save();
  const area = el("textarea", { class: "results", rows: 4, readonly: true });
  area.value = resultsString();
  app.replaceChildren(
    el("h1", { text: "You have finished the lessons" }),
    el("p", { text: "The summative quiz, completion summary and retention quiz are added in the next build (Milestone 2)." }),
    el("details", {}, [
      el("summary", { text: "Results string (backup if saving fails)" }),
      el("p", { class: "muted", text: "Copy this and paste it into the course form if asked." }),
      area,
    ]),
  );
}

function renderSaved() {
  setProgress("");
  leaveBtn.hidden = true;
  const btn = el("button", { class: "primary", text: "Resume where I left off" });
  btn.addEventListener("click", () => {
    state.resumes += 1;
    leaveBtn.hidden = false;
    go(state.resumeScreen || "slides");
  });
  app.replaceChildren(
    el("h1", { text: "Your place is saved" }),
    el("p", { text: "Come back to this page any time to pick up where you stopped." }),
    btn,
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

window.addEventListener("pagehide", endSegment);

// ---------- router ----------

const SCREENS = {
  register: renderRegister,
  notice: renderNotice,
  diagIntro: renderDiagIntro,
  diagnostic: renderDiagnostic,
  report: renderReport,
  slides: renderSlides,
  end: renderEnd,
  saved: renderSaved,
};

function render() {
  (SCREENS[state.screen] || renderRegister)();
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

if (state.consentAt && state.screen !== "saved") {
  leaveBtn.hidden = false;
  state.resumes += 1;
  save();
}
if (!state.consentAt) Store.clear();
render();
