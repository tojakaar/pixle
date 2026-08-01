/**
 * Lightweight verification of EditSession + follow-up resolution.
 * Run: node --experimental-strip-types is unavailable for TS imports,
 * so this mirrors the critical math/contracts in plain JS for CI smoke.
 */

import assert from "node:assert/strict";

// —— Inline mirrors of scale + follow-up patterns (keep in sync with engine) ——

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function scaleDelta(before, after, factor) {
  return clamp(before + (after - before) * factor, -100, 100);
}

const AMPLIFY = [
  { re: /^(a little more|a bit more|slightly more)\.?$/i, factor: 1.25 },
  { re: /^(much more|a lot more)\.?$/i, factor: 1.6 },
  { re: /^(more|stronger|make it stronger)\.?$/i, factor: 1.35 },
];
const REDUCE = [
  { re: /^(not that much|too much|a bit less|a little less)\.?$/i, factor: 0.65 },
  { re: /^(less|softer|make it softer)\.?$/i, factor: 0.7 },
];
const UNDO = /^(undo that|undo|undo it)\.?$/i;
const REDO = /^(redo that|redo|redo it)\.?$/i;
const COOLER = /^(cooler|cool it|cool them|cool them slightly|slightly cooler)\.?$/i;

function resolve(prompt, session) {
  const t = prompt.trim();
  if (UNDO.test(t)) {
    const action = session.actions.at(-1);
    return action ? { kind: "undo", action } : null;
  }
  if (REDO.test(t)) {
    const action = session.redoStack.at(-1);
    return action ? { kind: "redo", action } : null;
  }
  const active = session.actions.at(-1);
  if (!active) return null;
  for (const { re, factor } of AMPLIFY) {
    if (re.test(t)) return { kind: "amplify", factor, action: active };
  }
  for (const { re, factor } of REDUCE) {
    if (re.test(t)) return { kind: "reduce", factor, action: active };
  }
  if (COOLER.test(t)) {
    return {
      kind: "cooler",
      temperatureDelta: /slightly/i.test(t) ? -8 : -12,
      action: active,
    };
  }
  return null;
}

function createSession() {
  return { actions: [], redoStack: [], activeActionId: null };
}

function append(session, action) {
  session.actions.push(action);
  session.activeActionId = action.id;
  session.redoStack = [];
  return action;
}

function conversationalUndo(session) {
  if (!session.actions.length) return null;
  const undone = session.actions.pop();
  session.redoStack.push(undone);
  session.activeActionId = session.actions.at(-1)?.id ?? null;
  return undone;
}

function conversationalRedo(session) {
  if (!session.redoStack.length) return null;
  const redone = session.redoStack.pop();
  session.actions.push(redone);
  session.activeActionId = redone.id;
  return redone;
}

function groupByTarget(actions) {
  const order = [];
  const map = new Map();
  for (const a of actions) {
    const key = a.target ?? "__global__";
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { targetLabel: a.targetLabel, actions: [] });
    }
    map.get(key).actions.push(a);
  }
  return order.map((k) => map.get(k));
}

// —— Scenario: Darken sky → a little more → greener → not that much → undo → redo → warm → cool ——

const session = createSession();

const sky1 = append(session, {
  id: "1",
  target: "sky",
  targetLabel: "Sky",
  beforeExposure: 0,
  exposure: -0.4,
  summary: "Darken sky",
});

let fu = resolve("A little more.", session);
assert.equal(fu.kind, "amplify");
assert.equal(fu.factor, 1.25);
const skyExposure2 = scaleDelta(sky1.beforeExposure, sky1.exposure, fu.factor);
assert.ok(skyExposure2 < sky1.exposure); // more darkening

append(session, {
  id: "2",
  target: "sky",
  targetLabel: "Sky",
  beforeExposure: sky1.exposure,
  exposure: skyExposure2,
  summary: "A little more · Sky",
});

append(session, {
  id: "3",
  target: "vegetation",
  targetLabel: "Vegetation",
  beforeGreenSat: 0,
  greenSat: 18,
  summary: "Greener trees",
});

fu = resolve("Not that much.", session);
assert.equal(fu.kind, "reduce");
assert.equal(fu.factor, 0.65);
assert.equal(fu.action.target, "vegetation");
const green2 = scaleDelta(0, 18, 0.65);
assert.ok(Math.abs(green2 - 11.7) < 1e-9);

append(session, {
  id: "4",
  target: "vegetation",
  targetLabel: "Vegetation",
  beforeGreenSat: 18,
  greenSat: green2,
  summary: "Not that much · Vegetation",
});

const undone = conversationalUndo(session);
assert.equal(undone.id, "4");
assert.equal(session.actions.length, 3);

const redone = conversationalRedo(session);
assert.equal(redone.id, "4");
assert.equal(session.actions.length, 4);

append(session, {
  id: "5",
  target: "buildings",
  targetLabel: "Buildings",
  temperature: 20,
  summary: "Warm buildings",
});

fu = resolve("Cool them slightly.", session);
assert.equal(fu.kind, "cooler");
assert.equal(fu.temperatureDelta, -8);
assert.equal(fu.action.target, "buildings");

// Global edit still appends under Global group
append(session, {
  id: "6",
  target: null,
  targetLabel: "Global",
  exposure: 0.2,
  summary: "Brighten",
});

const groups = groupByTarget(session.actions);
assert.deepEqual(
  groups.map((g) => g.targetLabel),
  ["Sky", "Vegetation", "Buildings", "Global"],
);
assert.equal(groups[0].actions.length, 2);

// Ambiguous follow-up with empty session → no resolve (caller must clarify)
assert.equal(resolve("a little more", createSession()), null);

console.log("verify-edit-session: all checks passed");
