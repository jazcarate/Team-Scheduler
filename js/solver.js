'use strict';

const _now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

// ── Topology ──────────────────────────────────────────────────────────────────

function buildAncestors(nodes) {
  const anc = {};
  for (const path of Object.keys(nodes).filter(p => !nodes[p].mobile)) {
    const s = new Set([path]);
    let cur = nodes[path].parent;
    while (cur) { s.add(cur); cur = nodes[cur] ? nodes[cur].parent : null; }
    anc[path] = s;
  }
  return anc;
}

function lcaPath(area1, area2, nodes) {
  if (!area1 || !area2) return null;
  const seen = new Set();
  let cur = area1;
  while (cur) { seen.add(cur); const nd = nodes[cur]; cur = nd ? nd.parent : null; }
  cur = area2;
  while (cur) { if (seen.has(cur)) return cur; const nd = nodes[cur]; cur = nd ? nd.parent : null; }
  return null;
}

function closeness(area1, area2, nodes) {
  if (!area1 || !area2) return 0;
  if (area1 === area2) return 1;
  const lca = lcaPath(area1, area2, nodes);
  if (!lca || (lca !== area1 && lca !== area2)) return 0;
  function hopsTo(from, to) { let d = 0, c = from; while (c !== to) { d++; c = nodes[c].parent; } return d; }
  return 1 / (1 + hopsTo(area1, lca) + hopsTo(area2, lca));
}

// ── Stage 1a: Individual happiness ───────────────────────────────────────────

/**
 * Raw preference satisfaction score for one person.
 * Positive forces add when satisfied; negative forces subtract when violated.
 */
function computeIndividualHappiness(parsed, person, assignment, anc) {
  const { nodes, prefs } = parsed;
  if (!anc) anc = buildAncestors(nodes);
  const area = assignment[person];
  if (!area) return 0;
  const personAnc = anc[area] || new Set([area]);
  let score = 0;
  for (const s of prefs) {
    if (s.from !== person || !nodes[s.to[0]]) continue;
    if (!nodes[s.to[0]].mobile) {
      if (s.to.some(t => personAnc.has(t))) score += s.force;
    } else if (s.force > 0) {
      score += s.force * closeness(area, assignment[s.to[0]], nodes);
    } else {
      if (assignment[s.to[0]] === area) score += s.force;
    }
  }
  return score;
}

// ── Stage 1b: Total happiness ─────────────────────────────────────────────────

/** Sum of individual happiness scores — the value the solver maximises. */
function computeTotalHappiness(parsed, assignment, anc) {
  if (!anc) anc = buildAncestors(parsed.nodes);
  return parsed.mobileNodes.reduce(
    (sum, p) => sum + computeIndividualHappiness(parsed, p, assignment, anc),
    0
  );
}

// ── Normalised 0–1 happiness per person (UI display only) ─────────────────────

function computeHappiness(parsed, assignment, anc) {
  const { nodes, mobileNodes, prefs } = parsed;
  if (!anc) anc = buildAncestors(nodes);
  const happiness = {};
  for (const person of mobileNodes) {
    const relevant = prefs.filter(s => s.from === person);
    if (!relevant.length) { happiness[person] = 1; continue; }
    let satisfied = 0, possible = 0;
    for (const s of relevant) {
      const mag = Math.abs(s.force);
      possible += mag;
      const fromArea = assignment[person];
      if (!fromArea || !nodes[s.to[0]]) continue;
      if (!nodes[s.to[0]].mobile) {
        const fromAnc = anc[fromArea] || new Set([fromArea]);
        const inAny = s.to.some(t => fromAnc.has(t));
        if (s.force > 0 && inAny) satisfied += mag;
        if (s.force < 0 && !inAny) satisfied += mag;
      } else {
        const toArea = assignment[s.to[0]];
        if (s.force > 0) satisfied += mag * closeness(fromArea, toArea, nodes);
        else if (toArea !== fromArea) satisfied += mag;
      }
    }
    happiness[person] = possible > 0 ? satisfied / possible : 1;
  }
  return happiness;
}

// ── Capacity ──────────────────────────────────────────────────────────────────

function buildSubtreeCounts(nodes, mobileNodes, assignment) {
  const counts = {};
  for (const p of Object.keys(nodes)) if (!nodes[p].mobile) counts[p] = 0;
  for (const person of mobileNodes) {
    let cur = assignment[person]; if (!cur) continue;
    while (cur) { if (cur in counts) counts[cur]++; const nd = nodes[cur]; cur = nd ? nd.parent : null; }
  }
  return counts;
}

function isCapacityValid(nodes, mobileNodes, assignment) {
  const counts = buildSubtreeCounts(nodes, mobileNodes, assignment);
  for (const p of Object.keys(nodes)) {
    if (!nodes[p].mobile && nodes[p].sizeMax < 999 && counts[p] > nodes[p].sizeMax) return false;
  }
  return true;
}

// ── Deterministic pseudo-random (FNV-1a hash + LCG) ──────────────────────────

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeLCG(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s; };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand() % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Solver ────────────────────────────────────────────────────────────────────

/**
 * Assign free people to areas to maximise computeTotalHappiness.
 *
 * Phase 1 — deterministic pseudo-random seed
 *   Each free person is placed in a randomly-shuffled area order (seed derived
 *   from the input, so same input → same output every time).
 *
 * Phase 2 — preference-guided improvement loop
 *   Each round: find the least happy free person and build candidate moves
 *   directly from their preferences:
 *     • Area prefs (+): move person to each matching area; swap with anyone there.
 *     • Area prefs (−): move person out if they're currently in the avoided area.
 *     • Person prefs (+): try every area for this person (closeness gradient);
 *       also move the other person closer; or swap.
 *     • Person prefs (−): if sharing an area, try moving either person out.
 *   Score every candidate by Δ computeTotalHappiness. Apply the best improving
 *   move (or skip to next person if none improve). Restart until no one can improve.
 */
function solveAssignments(parsed, pins) {
  const { nodes, mobileNodes, prefs } = parsed;
  pins = pins || {};

  const assignableAreas = Object.keys(nodes).filter(p =>
    !nodes[p].mobile && (nodes[p].children.length === 0 || nodes[p].sizeMax < 999)
  );
  if (!assignableAreas.length || !mobileNodes.length)
    return { assignment: {}, happiness: {}, timing: {} };

  const anc = buildAncestors(nodes);

  // Seed with valid pins
  const assignment = {};
  for (const person of mobileNodes) {
    const target = pins[person];
    if (target && target in nodes && !nodes[target].mobile) assignment[person] = target;
  }
  const pinnedSet = new Set(Object.keys(assignment));
  const free = mobileNodes.filter(p => !pinnedSet.has(p));

  const label = p => p.split('/').pop(); // short display name for logs

  // ── Phase 1: deterministic pseudo-random placement ───────────────────────

  const seedStr = [...mobileNodes, ...Object.keys(nodes).sort(),
    ...prefs.map(p => `${p.from}${p.force}${p.toRef}`)].join('|');
  const seed = hashStr(seedStr);
  const rand = makeLCG(seed);

  console.log(`[Phase 1] Placing ${free.length} people (seed ${seed})`);
  for (const person of free) {
    const order = shuffle([...assignableAreas], rand);
    let placed = false;
    for (const area of order) {
      assignment[person] = area;
      if (isCapacityValid(nodes, mobileNodes, assignment)) { placed = true; break; }
    }
    if (!placed) assignment[person] = order[0];
    console.log(`  ${person} → ${label(assignment[person])}`);
  }
  console.log(`  Initial total happiness: ${computeTotalHappiness(parsed, assignment, anc).toFixed(1)}`);

  // ── Phase 2: preference-guided improvement ───────────────────────────────

  console.log('\n[Phase 2] Preference-guided improvement');
  const t0 = _now();
  let moves = 0;
  let anyImproved = true;

  while (anyImproved) {
    anyImproved = false;

    const baseTotal = computeTotalHappiness(parsed, assignment, anc);

    // Least happy free person first
    const ranked = [...free].sort((a, b) =>
      computeIndividualHappiness(parsed, a, assignment, anc) -
      computeIndividualHappiness(parsed, b, assignment, anc)
    );

    for (const person of ranked) {
      const personPrefs = prefs.filter(s => s.from === person);
      if (!personPrefs.length) continue; // no preferences, nothing to guide

      const score = computeIndividualHappiness(parsed, person, assignment, anc);
      console.log(`  Focusing on ${person} (score ${score.toFixed(1)}, in ${label(assignment[person])})`);

      // Build candidate moves guided by this person's preferences
      const candidates = [];
      const seen = new Set();

      function addMove(who, to) {
        if (!to || to === assignment[who]) return;
        const key = `mv:${who}:${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ type: 'move', who, to });
      }

      function addSwap(a, b) {
        if (!b || assignment[a] === assignment[b]) return;
        const key = `sw:${[a, b].sort().join(':')}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ type: 'swap', a, b });
      }

      for (const s of personPrefs) {
        const isArea = !nodes[s.to[0]].mobile;

        if (isArea && s.force > 0) {
          // Prefers an area: try moving there; swap with anyone already in it
          for (const area of assignableAreas) {
            if (s.to.some(t => (anc[area] || new Set([area])).has(t))) {
              addMove(person, area);
              for (const other of free) {
                if (other !== person && assignment[other] === area) addSwap(person, other);
              }
            }
          }
        } else if (isArea && s.force < 0) {
          // Avoids an area: if currently in it, try moving anywhere else
          const cur = assignment[person];
          if (cur && s.to.some(t => (anc[cur] || new Set([cur])).has(t))) {
            for (const area of assignableAreas) addMove(person, area);
          }
        } else if (!isArea) {
          const other = s.to[0];
          const isFree = !pinnedSet.has(other);

          if (s.force > 0) {
            // Wants to be near other: try all areas for this person (closeness is a
            // gradient — any area might improve it); also bring the other person closer
            for (const area of assignableAreas) addMove(person, area);
            if (isFree) addMove(other, assignment[person]);
            if (isFree) addSwap(person, other);
          } else {
            // Avoids other: if sharing an area, try moving either of them out
            if (assignment[other] === assignment[person]) {
              for (const area of assignableAreas) addMove(person, area);
              if (isFree) for (const area of assignableAreas) addMove(other, area);
            }
          }
        }
      }

      console.log(`    ${candidates.length} candidates from preferences`);

      // Score every candidate, pick the best improvement
      let bestDelta = 0, bestMove = null;

      for (const cand of candidates) {
        let delta;
        if (cand.type === 'move') {
          const prev = assignment[cand.who];
          assignment[cand.who] = cand.to;
          if (isCapacityValid(nodes, mobileNodes, assignment)) {
            delta = computeTotalHappiness(parsed, assignment, anc) - baseTotal;
            if (delta > bestDelta) { bestDelta = delta; bestMove = cand; }
          }
          assignment[cand.who] = prev;
        } else {
          const prevA = assignment[cand.a], prevB = assignment[cand.b];
          assignment[cand.a] = prevB; assignment[cand.b] = prevA;
          if (isCapacityValid(nodes, mobileNodes, assignment)) {
            delta = computeTotalHappiness(parsed, assignment, anc) - baseTotal;
            if (delta > bestDelta) { bestDelta = delta; bestMove = cand; }
          }
          assignment[cand.a] = prevA; assignment[cand.b] = prevB;
        }
      }

      if (bestMove) {
        if (bestMove.type === 'move') {
          console.log(`    → Move ${bestMove.who} to ${label(bestMove.to)} (Δ${bestDelta.toFixed(1)})`);
          assignment[bestMove.who] = bestMove.to;
        } else {
          console.log(`    → Swap ${bestMove.a} (${label(assignment[bestMove.a])}) ↔ ${bestMove.b} (${label(assignment[bestMove.b])}) (Δ${bestDelta.toFixed(1)})`);
          const tmp = assignment[bestMove.a];
          assignment[bestMove.a] = assignment[bestMove.b];
          assignment[bestMove.b] = tmp;
        }
        moves++;
        anyImproved = true;
        break; // restart — re-rank by happiness after this move
      } else {
        console.log(`    No improvement found for ${person}, trying next`);
      }
    }
  }

  const totalMs = _now() - t0;
  console.log(`\n[Done] Total happiness: ${computeTotalHappiness(parsed, assignment, anc).toFixed(1)} — ${moves} moves (${totalMs.toFixed(1)}ms)`);

  return {
    assignment,
    happiness: computeHappiness(parsed, assignment, anc),
    timing: { totalMs: Math.round(totalMs * 10) / 10, moves },
  };
}
