'use strict';

function isInOrUnder(area, targetPath, nodes) {
  let cur = area;
  while (cur) {
    if (cur === targetPath) return true;
    cur = nodes[cur] ? nodes[cur].parent : null;
  }
  return false;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTooltipHtml(name, springs, nodes, assignment) {
  const authored = springs.filter(s => s.author === name);
  if (!authored.length) return `<div class="tt-row muted">${esc(name)} — no preferences</div>`;

  const myArea = assignment[name];
  return authored.map(s => {
    let satisfied = false;
    const isArea = nodes[s.to] && !nodes[s.to].mobile;
    if (isArea) {
      satisfied = s.force > 0 && !!myArea && isInOrUnder(myArea, s.to, nodes);
    } else {
      const toArea = assignment[s.to];
      satisfied = s.force > 0 ? (toArea !== undefined && toArea === myArea) : (toArea !== myArea);
    }

    const sign = s.force > 0 ? '+' : '';
    const rel  = isArea ? `→ ${s.to.split('/').pop()}` : (s.force > 0 ? `↔ ${s.to}` : `≠ ${s.to}`);
    const cls  = satisfied ? 'ok' : 'bad';
    const tick = satisfied ? '✓' : '✗';
    return `<div class="tt-row ${cls}">${tick} ${sign}${s.force} ${esc(rel)}</div>`;
  }).join('');
}

/**
 * Render the assignment result as a nested HTML card tree.
 * Person cards are draggable; leaf areas have data-area for drop targets.
 *
 * @param {ParseResult} parsed
 * @param {{ assignment: Record<string,string>, happiness: Record<string,number> }} result
 * @param {HTMLElement} container
 */
function renderAssignment(parsed, result, container) {
  const { nodes, rootNodes, springs } = parsed;
  const { assignment, happiness } = result;

  function countSubtree(path) {
    const direct = Object.values(assignment).filter(a => a === path).length;
    return direct + (nodes[path].children || []).reduce((s, c) => s + countSubtree(c), 0);
  }

  function renderNode(path) {
    const nd = nodes[path];
    const isLeaf = nd.children.length === 0;
    const total = countSubtree(path);
    const direct = Object.entries(assignment).filter(([, a]) => a === path).map(([n]) => n);

    const sizeHtml = nd.sizeMax < 999
      ? `<span class="a-size">${nd.sizeMin === nd.sizeMax ? nd.sizeMin : nd.sizeMin + '–' + nd.sizeMax}</span>`
      : '';

    const capClass = nd.sizeMax < 999 && total > nd.sizeMax ? ' cap-over'
                   : nd.sizeMin > 0  && total < nd.sizeMin ? ' cap-under' : '';

    const childrenHtml = nd.children.map(c => renderNode(c)).join('');

    const peopleHtml = direct.map(name => {
      const hap = happiness[name] ?? 1;
      const pct = Math.round(hap * 100);
      const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
      const ttHtml = buildTooltipHtml(name, springs, nodes, assignment);
      return `<div class="p-card" draggable="true" data-person="${esc(name)}" style="--hap:${pct}%;--hc:${color}">
        <div class="p-fill"></div>
        <div class="tt">${ttHtml}</div>
        <span class="p-name">${esc(name)}</span>
        <span class="p-pct">${pct}%</span>
      </div>`;
    }).join('');

    const emptyHtml = isLeaf && direct.length === 0 ? '<div class="a-empty">— no assignment here</div>' : '';
    const areaAttr  = isLeaf ? ` data-area="${esc(path)}"` : '';

    return `<div class="a-node ${isLeaf ? 'a-leaf' : 'a-par'}${capClass}"${areaAttr}>
      <div class="a-head">
        <span class="a-name">${esc(nd.name)}</span>${sizeHtml}<span class="a-cnt">${total || ''}</span>
      </div>
      ${nd.children.length ? `<div class="a-kids">${childrenHtml}</div>` : ''}
      ${peopleHtml ? `<div class="p-list">${peopleHtml}</div>` : ''}${emptyHtml}
    </div>`;
  }

  container.innerHTML = `<div class="viz-root">${rootNodes.map(renderNode).join('')}</div>`;
}
