// Slide visuals. Each one is drawn in code (inline SVG or HTML), so it scales on
// phones and follows light and dark mode through the CSS colour variables.
// Uses el() and matrixView() from app.js, which loads after this file.

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function svgRoot(w, h, label, children) {
  return svg("svg", { viewBox: `0 0 ${w} ${h}`, class: "viz", role: "img", "aria-label": label }, children);
}

function arrow(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 9;
  const p1 = [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)];
  const p2 = [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)];
  return svg("g", { class: "v-line" }, [
    svg("line", { x1, y1, x2, y2 }),
    svg("polygon", { points: `${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, class: "v-arrowhead" }),
  ]);
}

function person(x, y, cls) {
  return svg("g", { class: cls }, [
    svg("circle", { cx: x, cy: y, r: 9 }),
    svg("path", { d: `M${x - 14},${y + 34} Q${x - 14},${y + 13} ${x},${y + 13} Q${x + 14},${y + 13} ${x + 14},${y + 34} Z` }),
  ]);
}

// Slide 1: cases go into the model and come out with a label.
function vizFlow() {
  const cards = [];
  for (let i = 0; i < 5; i++) {
    cards.push(svg("rect", { x: 20 + i * 4, y: 40 + i * 12, width: 92, height: 30, rx: 5, class: "v-card" }));
  }
  cards.push(svg("text", { x: 70, y: 160, class: "v-label big", "text-anchor": "middle" }, "Transactions"));
  return svgRoot(600, 172, "Transactions go into a model, which labels each one fraud or not fraud", [
    ...cards,
    arrow(130, 85, 222, 85),
    svg("rect", { x: 228, y: 50, width: 130, height: 70, rx: 12, class: "v-model" }),
    svg("text", { x: 293, y: 91, class: "v-model-text", "text-anchor": "middle" }, "Model"),
    arrow(362, 72, 450, 40),
    arrow(362, 98, 450, 130),
    svg("rect", { x: 456, y: 18, width: 128, height: 44, rx: 8, class: "v-pos" }),
    svg("text", { x: 520, y: 46, class: "v-label big strong", "text-anchor": "middle" }, "Fraud"),
    svg("rect", { x: 456, y: 108, width: 128, height: 44, rx: 8, class: "v-neg" }),
    svg("text", { x: 520, y: 136, class: "v-label big strong", "text-anchor": "middle" }, "Not fraud"),
  ]);
}

// Slide 3: the two mistakes side by side.
function vizTwoMistakes() {
  const card = (title, sub, says, truth, cost, sick) => el("div", { class: "viz-card" }, [
    svgRoot(120, 60, sick ? "A sick patient" : "A healthy patient", [person(60, 14, sick ? "v-person sick" : "v-person")]),
    el("p", { class: "viz-card-title", text: title }),
    el("p", { class: "viz-card-sub", text: sub }),
    el("ul", { class: "viz-facts" }, [
      el("li", { text: "Test says: " + says }),
      el("li", { text: "Truth: " + truth }),
      el("li", { text: "Cost: " + cost }),
    ]),
  ]);
  return el("div", { class: "viz-pair" }, [
    card("False alarm", "False positive", "cancer", "healthy", "one extra test", false),
    card("Missed case", "False negative", "healthy", "cancer", "no treatment", true),
  ]);
}

// Slides 9 and 14: precision reads the column, recall reads the row.
function vizReadMatrix(v) {
  const half = (caption, highlight, value) => el("figure", { class: "viz-half" }, [
    matrixView({ values: MATRIX, highlight, compact: true }),
    el("figcaption", {}, [el("strong", { text: caption[0] }), " " + caption[1], el("span", { class: "viz-value", text: value })]),
  ]);
  const p = v.captions ? v.captions[0] : ["Precision", "looks down the \"predicted fraud\" column. Of the flags, how many were right?"];
  const r = v.captions ? v.captions[1] : ["Recall", "looks across the \"actually fraud\" row. Of the real fraud, how much was caught?"];
  return el("div", { class: "viz-pair" }, [
    half(p, ["tp", "fp"], "40 / 50 = 0.80"),
    half(r, ["tp", "fn"], "40 / 60 = 0.67"),
  ]);
}

// Slide 10: move the slider to see precision and recall pull against each other.
const TRADEOFF_STEPS = [
  { tp: 10, fn: 50, fp: 0, tn: 940 },
  { tp: 25, fn: 35, fp: 3, tn: 937 },
  { tp: 40, fn: 20, fp: 10, tn: 930 }, // the shared example
  { tp: 50, fn: 10, fp: 40, tn: 900 },
  { tp: 58, fn: 2, fp: 150, tn: 790 },
];

function vizTradeoff() {
  const wrap = el("div", { class: "viz-tradeoff" });
  const slider = el("input", {
    type: "range", min: 0, max: TRADEOFF_STEPS.length - 1, step: 1, value: 2,
    id: "tradeoff", "aria-label": "How many cases the model flags",
  });
  const out = el("div");
  const bar = (name, value) => el("div", { class: "viz-bar" }, [
    el("span", { class: "viz-bar-name", text: name }),
    el("span", { class: "viz-bar-track" }, [el("span", { class: "viz-bar-fill", style: `width:${Math.round(value * 100)}%` })]),
    el("span", { class: "viz-bar-num", text: value.toFixed(2) }),
  ]);
  const draw = () => {
    const i = Number(slider.value);
    const v = TRADEOFF_STEPS[i];
    const precision = v.tp / (v.tp + v.fp);
    const recall = v.tp / (v.tp + v.fn);
    out.replaceChildren(
      matrixView({ values: v, highlight: ["fn", "fp"], compact: true }),
      el("div", { class: "viz-bars" }, [bar("Precision", precision), bar("Recall", recall)]),
      el("p", { class: "viz-note", text: i === 2 ? "This is the model you have seen so far." : (i < 2 ? "Fewer flags: fewer false alarms, more missed fraud." : "More flags: more fraud caught, more false alarms.") }),
    );
  };
  slider.addEventListener("input", draw);
  draw();
  wrap.append(
    el("div", { class: "viz-slider" }, [
      el("span", { text: "Flag fewer" }), slider, el("span", { text: "Flag more" }),
    ]),
    out,
  );
  return wrap;
}

// Slide 11: what a day of 50 reviews looks like under two models.
function vizQueues() {
  const queue = (fraud, title, sub) => {
    const cells = [];
    for (let i = 0; i < 50; i++) {
      const col = i % 10, row = Math.floor(i / 10);
      cells.push(svg("rect", { x: col * 24, y: row * 24, width: 20, height: 20, rx: 3, class: i < fraud ? "v-pos-fill" : "v-neg-fill" }));
    }
    return el("div", { class: "viz-card" }, [
      el("p", { class: "viz-card-title", text: title }),
      el("p", { class: "viz-card-sub", text: sub }),
      svgRoot(236, 116, title + ": " + sub, cells),
    ]);
  };
  return el("figure", { class: "viz-fig" }, [
    el("div", { class: "viz-pair tight" }, [
      queue(40, "Model A", "40 of 50 flags are real fraud. Precision 0.80"),
      queue(15, "Model B", "15 of 50 flags are real fraud. Precision 0.30"),
    ]),
    el("figcaption", { class: "viz-legend" }, [
      el("span", { class: "legend-item" }, [el("span", { class: "key pos" }), "Real fraud"]),
      el("span", { class: "legend-item" }, [el("span", { class: "key neg" }), "Normal purchase, a wasted review"]),
    ]),
  ]);
}

// Slide 12: weigh the two errors. The heavier side picks the metric.
function vizScales() {
  const scale = (heavyLeft) => {
    const tilt = heavyLeft ? 14 : -14;
    const lx = 40, rx = 200, ly = 40 + tilt, ry = 40 - tilt;
    return svgRoot(240, 130, heavyLeft ? "The false alarm side is heavier" : "The missed case side is heavier", [
      svg("polygon", { points: "120,40 104,118 136,118", class: "v-stand" }),
      svg("line", { x1: lx, y1: ly, x2: rx, y2: ry, class: "v-beam" }),
      svg("line", { x1: lx, y1: ly, x2: lx, y2: ly + 22, class: "v-beam thin" }),
      svg("line", { x1: rx, y1: ry, x2: rx, y2: ry + 22, class: "v-beam thin" }),
      svg("rect", { x: lx - 34, y: ly + 22, width: 68, height: heavyLeft ? 30 : 16, rx: 4, class: heavyLeft ? "v-weight heavy" : "v-weight" }),
      svg("rect", { x: rx - 34, y: ry + 22, width: 68, height: heavyLeft ? 16 : 30, rx: 4, class: heavyLeft ? "v-weight" : "v-weight heavy" }),
      svg("text", { x: lx, y: 16, class: "v-label small", "text-anchor": "middle" }, "False alarm"),
      svg("text", { x: rx, y: 16, class: "v-label small", "text-anchor": "middle" }, "Missed case"),
    ]);
  };
  const card = (heavyLeft, title, sub) => el("div", { class: "viz-card" }, [
    scale(heavyLeft),
    el("p", { class: "viz-card-title", text: title }),
    el("p", { class: "viz-card-sub", text: sub }),
  ]);
  return el("div", { class: "viz-pair" }, [
    card(true, "Favor precision", "False alarms cost more"),
    card(false, "Favor recall", "Misses cost more"),
  ]);
}

function vizCustom(v) {
  switch (v.kind) {
    case "flow": return vizFlow();
    case "twoMistakes": return vizTwoMistakes();
    case "readMatrix": return vizReadMatrix(v);
    case "tradeoff": return vizTradeoff();
    case "queues": return vizQueues();
    case "scales": return vizScales();
    default: return null;
  }
}
