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

function buildTooltipHtml(name, springs, nodes, assignment, isPinned) {
  const pinRow = isPinned ? '<div class="tt-row pinned-note">Manually placed</div>' : '';
  const relevant = springs.filter(s => s.from === name);
  if (!relevant.length) return pinRow + `<div class="tt-row muted">${esc(name)} — no preferences</div>`;

  const myArea = assignment[name];
  const prefRows = relevant.map(s => {
    const isArea = nodes[s.to] && !nodes[s.to].mobile;

    let cls, tick, extraTag = '';
    if (isArea) {
      const sat = s.force > 0 ? (!!myArea && isInOrUnder(myArea, s.to, nodes))
                               : (!!myArea && !isInOrUnder(myArea, s.to, nodes));
      cls = sat ? 'ok' : 'bad'; tick = sat ? '✓' : '✗';
    } else {
      const toArea = assignment[s.to];
      if (s.force > 0) {
        const cl = (myArea && toArea) ? closeness(myArea, toArea, nodes) : 0;
        if (cl >= 1)     { cls = 'ok';      tick = '✓'; }
        else if (cl > 0) {
          cls = 'partial'; tick = '~';
          const lca = lcaPath(myArea, toArea, nodes);
          if (lca) extraTag = ` <span class="tt-via">· ${esc(nodes[lca].name)}</span>`;
        }
        else             { cls = 'bad';     tick = '✗'; }
      } else {
        const sat = (toArea !== myArea);
        cls = sat ? 'ok' : 'bad'; tick = sat ? '✓' : '✗';
      }
    }

    const rel        = isArea ? esc(s.to.split('/').pop()) : esc(s.to);
    const commentTag = s.comment ? ` <span class="tt-comment">${esc(s.comment)}</span>` : '';
    return `<div class="tt-row ${cls}">${tick} ${esc(s.verb)} ${rel}${commentTag}${extraTag}</div>`;
  }).join('');

  return pinRow + prefRows;
}

/**
 * Render the assignment result as a nested HTML card tree.
 * Person cards are draggable; assignable areas have data-area for drop targets.
 * Pinned cards show an × button (data-unpin) to release the override.
 *
 * @param {ParseResult} parsed
 * @param {{ assignment: Record<string,string>, happiness: Record<string,number>, pins: Record<string,string> }} result
 * @param {HTMLElement} container
 */
function renderAssignment(parsed, result, container) {
  const { nodes, rootNodes, springs } = parsed;
  const { assignment, happiness, pins = {} } = result;

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
      const isPinned = name in pins;
      const pinnedClass = isPinned ? ' p-pinned' : '';
      const ttHtml = buildTooltipHtml(name, springs, nodes, assignment, isPinned);
      const unpinBtn = isPinned
        ? `<button class="p-unpin" data-unpin="${esc(name)}" title="Remove pin">×</button>`
        : `<span class="p-pct">${pct}%</span>`;
      return `<div class="p-card${pinnedClass}" draggable="true" data-person="${esc(name)}" style="--hap:${pct}%;--hc:${color}">
        <div class="p-fill"></div>
        <div class="tt">${ttHtml}</div>
        <span class="p-name">${esc(name)}</span>
        ${unpinBtn}
      </div>`;
    }).join('');

    const isAssignable = isLeaf || nd.sizeMax < 999;
    const emptyHtml = isAssignable && direct.length === 0 && nd.children.length === 0
      ? '<div class="a-empty">— no assignment here</div>' : '';
    const areaAttr  = isAssignable ? ` data-area="${esc(path)}"` : '';

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
