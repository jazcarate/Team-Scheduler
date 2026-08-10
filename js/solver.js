'use strict';

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

/**
 * Compute per-author happiness (0–1) given an assignment map.
 * Exported so app.js can recompute after manual drag-and-drop overrides.
 */
function computeHappiness(parsed, assignment, anc) {
  const { nodes, mobileNodes, springs } = parsed;
  if (!anc) anc = buildAncestors(nodes);
  const happiness = {};
  for (const person of mobileNodes) {
    const authored = springs.filter(s => s.author === person);
    if (!authored.length) { happiness[person] = 1; continue; }
    let satisfied = 0, possible = 0;
    for (const s of authored) {
      const mag = Math.abs(s.force);
      possible += mag;
      const fromArea = assignment[s.from];
      if (!fromArea || !nodes[s.to]) continue;
      if (!nodes[s.to].mobile) {
        const fromAnc = anc[fromArea] || new Set([fromArea]);
        if (s.force > 0 && fromAnc.has(s.to)) satisfied += mag;
      } else {
        const toArea = assignment[s.to];
        if (s.force > 0 && toArea === fromArea) satisfied += mag;
        if (s.force < 0 && toArea !== fromArea) satisfied += mag;
      }
    }
    happiness[person] = possible > 0 ? satisfied / possible : 1;
  }
  return happiness;
}

/**
 * Solve the optimal assignment of people to areas by maximising total preference satisfaction.
 * 1. Greedy init (highest-weight first, area springs only)
 * 2. Hill-climbing: single-move passes until stable
 * 3. Swap passes: try swapping two people between areas (escapes greedy local optima)
 *
 * @param {ParseResult} parsed
 * @returns {{ assignment: Record<string,string>, happiness: Record<string,number> }}
 */
function solveAssignments(parsed) {
  const { nodes, mobileNodes, springs } = parsed;

  const leafAreas = Object.keys(nodes).filter(p => !nodes[p].mobile && nodes[p].children.length === 0);
  if (!leafAreas.length || !mobileNodes.length) return { assignment: {}, happiness: {} };

  const anc = buildAncestors(nodes);
  const weight = n => (nodes[n] ? nodes[n].weight : 1);

  function totalScore(map) {
    let score = 0;
    for (const person of mobileNodes) {
      const area = map[person];
      if (!area) continue;
      const personAnc = anc[area] || new Set([area]);
      for (const s of springs) {
        if (s.from !== person || !nodes[s.to]) continue;
        const sw = weight(s.author);
        if (!nodes[s.to].mobile) {
          if (s.force > 0 && personAnc.has(s.to)) score += s.force * sw;
        } else {
          if (map[s.to] === area) score += s.force * sw;
        }
      }
    }
    return score;
  }

  function capacityOk(map, person, area) {
    const nd = nodes[area];
    if (!nd || nd.sizeMax >= 999) return true;
    return mobileNodes.filter(p => p !== person && map[p] === area).length < nd.sizeMax;
  }

  // Greedy: assign highest-weight people first, area springs only
  const sorted = [...mobileNodes].sort((a, b) => weight(b) - weight(a));
  const assignment = {};
  for (const person of sorted) {
    let best = leafAreas[0], bestSc = -Infinity;
    for (const area of leafAreas) {
      if (!capacityOk(assignment, person, area)) continue;
      const personAnc = anc[area] || new Set([area]);
      let sc = 0;
      for (const s of springs) {
        if (s.from !== person || !nodes[s.to] || nodes[s.to].mobile) continue;
        if (s.force > 0 && personAnc.has(s.to)) sc += s.force * weight(s.author);
      }
      if (sc > bestSc) { bestSc = sc; best = area; }
    }
    assignment[person] = best;
  }

  // Hill-climbing: single-move passes
  let changed = true;
  for (let iter = 0; changed && iter < 100; iter++) {
    changed = false;
    for (const person of sorted) {
      const baseline = totalScore(assignment);
      let best = assignment[person], bestSc = baseline;
      for (const area of leafAreas) {
        if (area === assignment[person] || !capacityOk(assignment, person, area)) continue;
        const prev = assignment[person];
        assignment[person] = area;
        const sc = totalScore(assignment);
        if (sc > bestSc) { bestSc = sc; best = area; }
        assignment[person] = prev;
      }
      if (best !== assignment[person]) { assignment[person] = best; changed = true; }
    }
  }

  // Swap passes: try exchanging two people in different areas
  // Fixes cases where greedy placed the wrong person in a capacity-1 slot.
  let swapChanged = true;
  for (let iter = 0; swapChanged && iter < 50; iter++) {
    swapChanged = false;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const p1 = sorted[i], p2 = sorted[j];
        if (assignment[p1] === assignment[p2]) continue;
        const baseline = totalScore(assignment);
        const a1 = assignment[p1], a2 = assignment[p2];
        assignment[p1] = a2; assignment[p2] = a1;
        if (totalScore(assignment) > baseline) {
          swapChanged = true;
        } else {
          assignment[p1] = a1; assignment[p2] = a2;
        }
      }
    }
  }

  return { assignment, happiness: computeHappiness(parsed, assignment, anc) };
}
