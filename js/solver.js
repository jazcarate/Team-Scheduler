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
 * Lowest Common Ancestor of two area paths in the node tree.
 * Returns the path string of the LCA, or null if the two nodes share no ancestor.
 */
function lcaPath(area1, area2, nodes) {
  if (!area1 || !area2) return null;
  const anc = new Set();
  let cur = area1;
  while (cur) { anc.add(cur); const nd = nodes[cur]; cur = nd ? nd.parent : null; }
  cur = area2;
  while (cur) { if (anc.has(cur)) return cur; const nd = nodes[cur]; cur = nd ? nd.parent : null; }
  return null;
}

/**
 * Closeness score (0–1) between two area paths for co-location scoring.
 *
 *   closeness = 1 / (1 + depth_diff)   when one area is an ancestor of the other
 *   closeness = 0                       when the areas are in different subtrees
 *
 * "Ancestor/descendant" means one person IS in (or above) the container of the other.
 * Alice in Frontend and Bob in Frontend/Lead scores 0.5 (they share a team).
 * Alice in Frontend and Bob in Backend score 0 — different subtrees, fully apart.
 * This preserves the intuition that sibling-branch separation is "fully apart" while
 * rewarding co-location within the same sub-team.
 *
 * Used only for positive (co-location) person-to-person springs.
 * Avoidance springs remain binary — any separation is fully satisfying.
 */
function closeness(area1, area2, nodes) {
  if (!area1 || !area2) return 0;
  if (area1 === area2) return 1;
  const lca = lcaPath(area1, area2, nodes);
  if (!lca || (lca !== area1 && lca !== area2)) return 0;
  function hopsTo(from, to) { let d = 0, c = from; while (c !== to) { d++; c = nodes[c].parent; } return d; }
  return 1 / (1 + hopsTo(area1, lca) + hopsTo(area2, lca));
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
    const relevant = springs.filter(s => s.from === person);
    if (!relevant.length) { happiness[person] = 1; continue; }
    let satisfied = 0, possible = 0;
    for (const s of relevant) {
      const mag = Math.abs(s.force);
      possible += mag;
      const fromArea = assignment[s.from];
      if (!fromArea || !nodes[s.to]) continue;
      if (!nodes[s.to].mobile) {
        const fromAnc = anc[fromArea] || new Set([fromArea]);
        if (s.force > 0 &&  fromAnc.has(s.to)) satisfied += mag;
        if (s.force < 0 && !fromAnc.has(s.to)) satisfied += mag;
      } else {
        const toArea = assignment[s.to];
        if (s.force > 0) satisfied += mag * closeness(fromArea, toArea, nodes);
        else if (toArea !== fromArea) satisfied += mag;
      }
    }
    happiness[person] = possible > 0 ? satisfied / possible : 1;
  }
  return happiness;
}

// Spread bonus constants.
// FILL_MIN: awarded per slot filled up to an area's minimum (beats any single preference).
// FILL_SPREAD: harmonic bonus for the k-th person in an area — decays as area fills,
//   so the solver spreads people rather than stacking. Must stay below 12 so that any
//   co-location preference (+6 = the weakest) can pull two people into the same area.
const FILL_MIN = 50;
const FILL_SPREAD = 10;

/**
 * Cumulative spread score for placing n people into an area.
 * Filling up to the minimum gets the large bonus; beyond that, harmonic decay.
 */
function areaSpreadScore(sizeMin, n) {
  let s = 0;
  for (let k = 0; k < n; k++) {
    s += (sizeMin > 0 && k < sizeMin) ? (sizeMin - k) * FILL_MIN : FILL_SPREAD / (k + 1);
  }
  return s;
}

/**
 * Marginal spread benefit of adding the next person to an area that already has prevCount people.
 */
function spreadDelta(sizeMin, prevCount) {
  return (sizeMin > 0 && prevCount < sizeMin)
    ? (sizeMin - prevCount) * FILL_MIN
    : FILL_SPREAD / (prevCount + 1);
}

/**
 * Solve the optimal assignment of people to areas.
 * Pinned people are treated as immovable constraints; only unpinned people are optimized.
 * The full assignment (pinned + unpinned) is used for capacity counts and scoring, so
 * everyone else is arranged optimally around the pinned positions.
 *
 * Algorithm:
 * 1. Seed assignment with pins
 * 2. Greedy init for unpinned (PEOPLE order, area springs + spread bonus)
 * 3. Hill-climbing: single-move passes over unpinned people until stable
 * 4. Swap passes: exchange two unpinned people (escapes greedy local optima)
 *
 * @param {ParseResult} parsed
 * @param {Record<string,string>} [pins]  person → leaf-area path (manual overrides)
 * @returns {{ assignment: Record<string,string>, happiness: Record<string,number> }}
 */
function solveAssignments(parsed, pins) {
  const { nodes, mobileNodes, springs } = parsed;
  pins = pins || {};

  // An area is assignable if it is a leaf (terminal slot) OR has an explicit size constraint.
  // Pure container nodes (no size, has children) are skipped — they are structural only.
  const assignableAreas = Object.keys(nodes).filter(p =>
    !nodes[p].mobile && (nodes[p].children.length === 0 || nodes[p].sizeMax < 999)
  );
  if (!assignableAreas.length || !mobileNodes.length) return { assignment: {}, happiness: {} };

  const anc = buildAncestors(nodes);

  // Count everyone in the subtree rooted at `area`, excluding one person.
  function subtreeCount(map, area, exclude) {
    let c = mobileNodes.filter(p => p !== exclude && map[p] === area).length;
    for (const child of nodes[area].children) c += subtreeCount(map, child, exclude);
    return c;
  }

  // Build a subtree-count map for all area nodes in O(people × depth).
  function buildSubtreeCounts(map) {
    const counts = {};
    for (const path of Object.keys(nodes)) if (!nodes[path].mobile) counts[path] = 0;
    for (const person of mobileNodes) {
      let cur = map[person]; if (!cur) continue;
      while (cur) {
        if (cur in counts) counts[cur]++;
        const nd = nodes[cur]; cur = nd ? nd.parent : null;
      }
    }
    return counts;
  }

  // Seed with valid pins; invalid ones (unknown person/area) are silently ignored
  const assignment = {};
  for (const person of mobileNodes) {
    const target = pins[person];
    if (target && target in nodes && !nodes[target].mobile) {
      assignment[person] = target;
    }
  }
  const pinnedSet = new Set(Object.keys(assignment));
  const free = mobileNodes.filter(p => !pinnedSet.has(p));

  // Capacity: walk the ancestor chain so that placing someone in a child also checks
  // parent capacity. Pins bypass the check for themselves (their occupancy is already counted).
  function capacityOk(map, person, area) {
    let cur = area;
    while (cur) {
      const nd = nodes[cur]; if (!nd) break;
      if (nd.sizeMax < 999 && subtreeCount(map, cur, person) >= nd.sizeMax) return false;
      cur = nd.parent;
    }
    return true;
  }

  function totalScore(map) {
    let score = 0;
    const sc = buildSubtreeCounts(map);
    // Preference score (all people — pinned springs also count)
    for (const person of mobileNodes) {
      const area = map[person]; if (!area) continue;
      const personAnc = anc[area] || new Set([area]);
      for (const s of springs) {
        if (s.from !== person || !nodes[s.to]) continue;
        if (!nodes[s.to].mobile) { if (personAnc.has(s.to)) score += s.force; }
        else if (s.force > 0) { score += s.force * closeness(area, map[s.to], nodes); }
        else { if (map[s.to] === area) score += s.force; }
      }
    }
    // Spread score: use subtree counts so placing someone in a child area also credits
    // the parent's minimum-fill progress.
    for (const area of assignableAreas) {
      score += areaSpreadScore(nodes[area].sizeMin, sc[area] || 0);
    }
    return score;
  }

  // Marginal spread improvement when placing one more person into `area` and all its ancestors.
  // Uses gCounts, which are maintained incrementally during greedy.
  const gCounts = buildSubtreeCounts(assignment); // starts with pinned occupancy
  function fullSpreadDelta(area) {
    let delta = 0;
    let cur = area;
    while (cur) {
      const nd = nodes[cur]; if (!nd) break;
      delta += spreadDelta(nd.sizeMin, gCounts[cur] || 0);
      cur = nd.parent;
    }
    return delta;
  }

  // Greedy: place free people in PEOPLE order using area springs + spread bonus
  for (const person of free) {
    let best = assignableAreas[0], bestSc = -Infinity;
    for (const area of assignableAreas) {
      if (!capacityOk(assignment, person, area)) continue;
      const personAnc = anc[area] || new Set([area]);
      let sc = fullSpreadDelta(area);
      for (const s of springs) {
        if (s.from !== person || !nodes[s.to] || nodes[s.to].mobile) continue;
        if (personAnc.has(s.to)) sc += s.force;
      }
      if (sc > bestSc) { bestSc = sc; best = area; }
    }
    assignment[person] = best;
    // Update incremental counts for next person
    let cur = best;
    while (cur) {
      if (cur in gCounts) gCounts[cur]++;
      const nd = nodes[cur]; cur = nd ? nd.parent : null;
    }
  }

  // Hill-climbing: move free people only
  let changed = true;
  for (let iter = 0; changed && iter < 100; iter++) {
    changed = false;
    for (const person of free) {
      const baseline = totalScore(assignment);
      let best = assignment[person], bestSc = baseline;
      for (const area of assignableAreas) {
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

  // Swap passes: exchange two free people in different areas
  let swapChanged = true;
  for (let iter = 0; swapChanged && iter < 50; iter++) {
    swapChanged = false;
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const p1 = free[i], p2 = free[j];
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
