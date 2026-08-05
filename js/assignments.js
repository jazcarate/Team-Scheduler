'use strict';

/**
 * Assign each person to a structural node.
 *
 * For each person, sums weighted spring scores across all springs where they are
 * the "from" node (regardless of who authored the spring). The group with the
 * highest total score wins. Author's strength weights each spring contribution.
 *
 * Fallback: nearest leaf area by Euclidean distance.
 *
 * @param {PhysNode[]} physNodes
 * @param {Record<string,PhysNode>} nodeMap
 * @param {Record<string,NodeDef>} nodes
 * @param {string[]} mobileNodes
 * @param {SpringDef[]} springs
 * @returns {Record<string,string[]>}  groupPath → [personNames]
 */
function computeAssignments(physNodes, nodeMap, nodes, mobileNodes, springs) {
  const allGroupPaths = Object.keys(nodes).filter(p => !nodes[p].mobile);
  const leafGroupPaths = allGroupPaths.filter(p => nodes[p].children.length === 0);
  /** @type {Record<string,string[]>} */ const result = {};
  allGroupPaths.forEach(p => result[p] = []);

  for (const physNode of physNodes) {
    if (physNode.kind !== 'person') continue;
    const pPath = physNode.meta.path;

    // Sum weighted attraction scores to each structural node
    /** @type {Record<string,number>} */ const groupScores = {};
    for (const s of springs) {
      if (s.from !== pPath || s.force <= 0) continue;
      if (!nodes[s.to] || nodes[s.to].mobile) continue;
      const authorWeight = nodes[s.author] ? nodes[s.author].weight : 1;
      groupScores[s.to] = (groupScores[s.to] || 0) + s.force * authorWeight;
    }

    let bestGroup = null, bestScore = 0;
    for (const [group, score] of Object.entries(groupScores)) {
      if (score > bestScore) { bestScore = score; bestGroup = group; }
    }

    if (bestGroup) {
      result[bestGroup].push(pPath);
    } else {
      let nearest = null, nearestDist = Infinity;
      for (const gp of leafGroupPaths) {
        const gNode = nodeMap[`g:${gp}`];
        if (!gNode) continue;
        const dx = physNode.x - gNode.x, dy = physNode.y - gNode.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) { nearestDist = d; nearest = gp; }
      }
      if (nearest) result[nearest].push(pPath);
    }
  }

  return result;
}

/**
 * Count all people assigned within a group and all its descendants.
 * @param {string} path
 * @param {Record<string,string[]>} assignments
 * @param {Record<string,NodeDef>} nodes
 * @returns {number}
 */
function countAll(path, assignments, nodes) {
  const direct = (assignments[path] || []).length;
  return direct + nodes[path].children.reduce((s, c) => s + countAll(c, assignments, nodes), 0);
}

/**
 * Format assignments as human-readable output.
 * @param {Record<string,string[]>} assignments
 * @param {ParseResult} parsed
 * @param {Record<string,PhysNode>} nodeMap
 * @returns {string}
 */
function formatAssignments(assignments, parsed, nodeMap) {
  const { nodes, rootNodes } = parsed;
  const lines = ['== ASSIGNMENTS ==', ''];

  function renderGroup(path, depth) {
    const nd = nodes[path];
    const pad = '  '.repeat(depth);
    const isLeaf = nd.children.length === 0;
    const total = countAll(path, assignments, nodes);
    const hasSize = nd.sizeMax < 999;

    lines.push(pad + nd.name);

    if (hasSize) {
      const note = total > nd.sizeMax ? ' ⚠ over capacity'
                 : total < nd.sizeMin ? ' ⚠ under capacity' : '';
      lines.push(pad + `  # ${total} / ${nd.sizeMin}–${nd.sizeMax}${note}`);
    } else if (total > 0 || isLeaf) {
      lines.push(pad + `  # ${total} members`);
    }

    const direct = assignments[path] || [];
    for (const m of direct) lines.push(pad + `  - ${m}`);

    if (!isLeaf) nd.children.forEach(child => renderGroup(child, depth + 1));

    lines.push('');
  }

  rootNodes.forEach(r => renderGroup(r, 0));
  return lines.join('\n');
}
