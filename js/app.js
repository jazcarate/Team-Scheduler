'use strict';

const EXAMPLE = `== PEOPLE ==
Alice
Carol
Bob
Dave

== STRUCTURE ==
Engineering
  Frontend  size:2-4
  Backend   size:2-3

== PREFERENCES ==
Alice strongly prefers Frontend
Carol prefers Alice
Carol strongly prefers Frontend
Bob prefers Backend
Dave prefers Backend
Dave avoids Carol
`;

const LS_KEY = 'scheduler_v2';
const LS_TTL = 10 * 24 * 60 * 60 * 1000;

function saveToStorage(text, pins) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ v: text, pins: pins || {}, ts: Date.now() }));
  } catch (e) { }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > LS_TTL) { localStorage.removeItem(LS_KEY); return null; }
    return { text: data.v, pins: data.pins || {} };
  } catch (e) { return null; }
}

(function () {
  const inputEl   = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
  const vizEl     = /** @type {HTMLElement} */ (document.getElementById('viz-wrap'));
  const infoBarEl = /** @type {HTMLElement} */ (document.getElementById('info-bar'));
  const btnSolve  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-solve'));
  const btnReset  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset'));
  const btnUndo   = /** @type {HTMLButtonElement} */ (document.getElementById('btn-undo'));
  const btnRedo   = /** @type {HTMLButtonElement} */ (document.getElementById('btn-redo'));
  const btnCopyMd = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-md'));
  const statEl    = document.getElementById('stat');

  // ── State ──────────────────────────────────────────────────────
  let currentParsed     = null;
  let currentAssignment = null;
  let currentHappiness  = null;
  let currentPins       = {};

  // ── Undo / Redo ────────────────────────────────────────────────
  /** @type {Array<{assignment:object,pins:object,happiness:object}>} */
  const undoStack = [];
  const redoStack = [];

  function snapshotState() {
    return {
      assignment: Object.assign({}, currentAssignment),
      pins:       Object.assign({}, currentPins),
      happiness:  Object.assign({}, currentHappiness),
    };
  }

  function pushUndo() {
    if (!currentAssignment) return;
    undoStack.push(snapshotState());
    redoStack.length = 0;
    syncUndoButtons();
  }

  function applySnapshot(snap) {
    currentAssignment = Object.assign({}, snap.assignment);
    currentPins       = Object.assign({}, snap.pins);
    currentHappiness  = Object.assign({}, snap.happiness);
    renderState();
    syncUndoButtons();
  }

  function syncUndoButtons() {
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState());
    applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState());
    applySnapshot(redoStack.pop());
  }

  // ── Init ───────────────────────────────────────────────────────
  const stored = loadFromStorage();
  inputEl.value = stored ? stored.text : EXAMPLE;
  currentPins   = stored ? stored.pins : {};
  run();
  syncUndoButtons();

  // ── Persistence ────────────────────────────────────────────────
  let saveTimer = null;
  inputEl.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToStorage(inputEl.value, currentPins), 800);
  });

  // ── Buttons ────────────────────────────────────────────────────
  btnSolve.addEventListener('click', () => { pushUndo(); run(); });

  btnReset.addEventListener('click', () => {
    pushUndo();
    currentPins = {};
    saveToStorage(inputEl.value, currentPins);
    run();
  });

  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);

  btnCopyMd.addEventListener('click', copyMd);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  // ── Unpin click (event delegation) ────────────────────────────
  vizEl.addEventListener('click', e => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-unpin]');
    if (!btn) return;
    e.stopPropagation();
    pushUndo();
    delete currentPins[btn.dataset.unpin];
    // Stay in staging — recompute happiness but don't re-solve
    if (currentParsed && currentAssignment) {
      currentHappiness = computeHappiness(currentParsed, currentAssignment);
    }
    saveToStorage(inputEl.value, currentPins);
    renderState();
  });

  // ── Drag-and-drop ──────────────────────────────────────────────
  vizEl.addEventListener('dragstart', e => {
    const card = /** @type {HTMLElement} */ (e.target).closest('[data-person]');
    if (!card) return;
    const person = card.dataset.person;
    e.dataTransfer.setData('text/plain', person);
    e.dataTransfer.effectAllowed = 'move';
    highlightPreferences(person);
  });

  document.addEventListener('dragend', () => {
    clearDragHighlights();
  });

  // ── Info bar ───────────────────────────────────────────────────
  vizEl.addEventListener('mouseover', e => {
    const card = /** @type {HTMLElement} */ (e.target).closest('[data-person]');
    if (!card || !currentParsed || !currentAssignment) return;
    showInfoBar(card.dataset.person);
  });

  vizEl.addEventListener('mouseout', e => {
    const card = /** @type {HTMLElement} */ (e.target).closest('[data-person]');
    const to   = /** @type {HTMLElement} */ (e.relatedTarget);
    if (!card) return;
    if (!to || !card.contains(to)) hideInfoBar();
  });

  vizEl.addEventListener('dragover', e => {
    const leaf = /** @type {HTMLElement} */ (e.target).closest('[data-area]');
    if (!leaf) return;
    e.preventDefault();
    leaf.classList.add('drag-over');
  });

  vizEl.addEventListener('dragleave', e => {
    const leaf = /** @type {HTMLElement} */ (e.target).closest('[data-area]');
    if (leaf) leaf.classList.remove('drag-over');
  });

  vizEl.addEventListener('drop', e => {
    const leaf = /** @type {HTMLElement} */ (e.target).closest('[data-area]');
    if (!leaf) return;
    e.preventDefault();
    leaf.classList.remove('drag-over');
    const person = e.dataTransfer.getData('text/plain');
    if (!person || !currentParsed || !currentAssignment) return;
    const area = leaf.dataset.area;
    if (currentAssignment[person] === area) return; // no-op

    pushUndo();
    currentPins[person] = area;
    currentAssignment[person] = area;
    // Recompute happiness without re-solving (staging: other people stay put)
    currentHappiness = computeHappiness(currentParsed, currentAssignment);
    saveToStorage(inputEl.value, currentPins);
    renderState();
  });

  // ── Drag preference highlights ─────────────────────────────────
  function escAttr(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function hlClass(force) {
    if (force >= 99) return 'drag-req';
    if (force >= 8)  return 'drag-pref-2';
    if (force > 0)   return 'drag-pref-1';
    if (force <= -8) return 'drag-avd-2';
    return 'drag-avd-1';
  }

  function hlBadgeClass(force) {
    if (force >= 99) return 'pref-badge-req';
    if (force >= 8)  return 'pref-badge-2';
    if (force > 0)   return 'pref-badge-1';
    if (force <= -8) return 'pref-badge-n2';
    return 'pref-badge-n1';
  }

  function highlightPreferences(person) {
    if (!currentParsed || !currentAssignment) return;
    const { nodes, springs } = currentParsed;

    // Strongest preference per area element
    /** @type {Map<Element,{force:number,verb:string,label:string}>} */
    const areaHL = new Map();
    // Strongest preference per person element
    /** @type {Map<Element,{force:number}>} */
    const personHL = new Map();

    function addAreaHL(path, force, verb, label) {
      const el = vizEl.querySelector(`[data-area="${escAttr(path)}"]`);
      if (!el) return;
      const ex = areaHL.get(el);
      if (!ex || Math.abs(force) > Math.abs(ex.force)) areaHL.set(el, { force, verb, label });
    }

    function addPersonHL(name, force) {
      if (name === person) return;
      const el = vizEl.querySelector(`[data-person="${escAttr(name)}"]`);
      if (!el) return;
      const ex = personHL.get(el);
      if (!ex || Math.abs(force) > Math.abs(ex.force)) personHL.set(el, { force });
    }

    // Person's own preferences
    for (const s of springs) {
      if (s.from !== person) continue;
      const nd = nodes[s.to]; if (!nd) continue;
      if (!nd.mobile) {
        // Area spring: highlight area
        addAreaHL(s.to, s.force, s.verb, s.verb);
      } else {
        // Person spring: highlight that person's card directly
        addPersonHL(s.to, s.force);
        // Also highlight their current area so you know where to drag
        const toArea = currentAssignment[s.to];
        if (toArea) addAreaHL(toArea, s.force, s.verb, `${s.verb} ${s.to}`);
      }
    }

    // Others who prefer to be near this person — highlight their cards + area
    for (const s of springs) {
      if (s.to !== person || s.force <= 0) continue;
      if (!nodes[s.from] || !nodes[s.from].mobile) continue;
      addPersonHL(s.from, s.force);
      const fromArea = currentAssignment[s.from];
      if (fromArea) addAreaHL(fromArea, s.force, s.verb, s.from);
    }

    // Dim source area
    const srcArea = currentAssignment[person];
    if (srcArea) {
      const el = vizEl.querySelector(`[data-area="${escAttr(srcArea)}"]`);
      if (el) el.classList.add('drag-source');
    }

    // Apply area highlights + badges
    for (const [el, info] of areaHL) {
      el.classList.add(hlClass(info.force));
      const badge = document.createElement('div');
      badge.className = `pref-badge ${hlBadgeClass(info.force)}`;
      badge.setAttribute('data-drag-badge', '');
      badge.textContent = info.label;
      el.appendChild(badge);
    }

    // Apply person card highlights
    for (const [el, info] of personHL) {
      el.classList.add(hlClass(info.force));
    }
  }

  const HL_CLASSES = ['drag-pref-1','drag-pref-2','drag-req','drag-avd-1','drag-avd-2','drag-source'];

  function clearDragHighlights() {
    vizEl.querySelectorAll(HL_CLASSES.map(c => `.${c}`).join(',')).forEach(el =>
      el.classList.remove(...HL_CLASSES));
    vizEl.querySelectorAll('[data-drag-badge]').forEach(el => el.remove());
  }

  // ── Info bar ───────────────────────────────────────────────────
  function showInfoBar(person) {
    const { nodes, springs } = currentParsed;
    const myArea   = currentAssignment[person];
    const relevant = springs.filter(s => s.from === person);
    const isPinned = person in currentPins;

    let html = `<span class="ib-name">${escHtml(person)}</span>`;
    if (isPinned) html += `<span class="ib-pinned">pinned</span>`;

    if (!relevant.length) {
      html += `<span class="ib-none">no preferences</span>`;
    } else {
      for (const s of relevant) {
        const isArea = nodes[s.to] && !nodes[s.to].mobile;
        let cls, label;
        if (isArea) {
          const sat = s.force > 0
            ? (!!myArea && isInOrUnder(myArea, s.to, nodes))
            : (!!myArea && !isInOrUnder(myArea, s.to, nodes));
          cls   = sat ? 'ok' : 'bad';
          label = `${s.verb} ${s.to}`;
        } else {
          const toArea = currentAssignment[s.to];
          if (s.force > 0) {
            const cl = (myArea && toArea) ? closeness(myArea, toArea, nodes) : 0;
            if      (cl >= 1) { cls = 'ok';      label = `${s.verb} ${s.to}`; }
            else if (cl >  0) {
              const lca = lcaPath(myArea, toArea, nodes);
              cls   = 'partial';
              label = `${s.verb} ${s.to}` + (lca ? ` via ${lca}` : '');
            }
            else              { cls = 'bad';     label = `${s.verb} ${s.to}`; }
          } else {
            cls   = (toArea !== myArea) ? 'ok' : 'bad';
            label = `${s.verb} ${s.to}`;
          }
        }
        const tick = cls === 'ok' ? '✓' : cls === 'partial' ? '~' : '✗';
        const comment = s.comment ? ` · ${s.comment}` : '';
        html += `<span class="ib-chip ${cls}">${tick} ${escHtml(label + comment)}</span>`;
      }
    }

    infoBarEl.innerHTML = html;
    infoBarEl.classList.add('active');
  }

  function hideInfoBar() {
    infoBarEl.classList.remove('active');
  }

  // ── Core ───────────────────────────────────────────────────────
  function run() {
    saveToStorage(inputEl.value, currentPins);
    const parsed = parseInput(inputEl.value);
    currentParsed = parsed;

    if (parsed.mobileNodes.length === 0 && parsed.rootNodes.length === 0) {
      vizEl.innerHTML = '<div class="viz-msg">Fill in the editor to get started.</div>';
      return;
    }

    let errHtml = '';
    if (parsed.errors.length) {
      errHtml = '<div class="viz-errors">' +
        parsed.errors.map(e => `<div class="viz-error">⚠ ${escHtml(e)}</div>`).join('') +
        '</div>';
      if (parsed.mobileNodes.length === 0 || parsed.rootNodes.length === 0) {
        vizEl.innerHTML = errHtml; return;
      }
    }

    // Drop stale pins before solving
    for (const person of Object.keys(currentPins)) {
      const area = currentPins[person];
      if (!parsed.mobileNodes.includes(person) || !(area in parsed.nodes) || parsed.nodes[area].mobile) {
        delete currentPins[person];
      }
    }

    const result = solveAssignments(parsed, currentPins);
    currentAssignment = Object.assign({}, result.assignment);
    currentHappiness  = result.happiness;

    renderState();
    if (errHtml) vizEl.insertAdjacentHTML('afterbegin', errHtml);

    const nPeople = parsed.mobileNodes.length;
    const nAreas  = Object.keys(parsed.nodes).filter(p => !parsed.nodes[p].mobile).length;
    if (statEl) statEl.textContent = `${nPeople} people · ${nAreas} areas`;
  }

  function renderState() {
    if (!currentParsed || !currentAssignment) return;
    renderAssignment(
      currentParsed,
      { assignment: currentAssignment, happiness: currentHappiness, pins: currentPins },
      vizEl,
    );
  }

  // ── Export ─────────────────────────────────────────────────────
  function copyMd() {
    if (!currentParsed || !currentAssignment) return;

    const { nodes, rootNodes } = currentParsed;
    const lines = [];

    function walk(path, depth) {
      const nd = nodes[path];
      lines.push('#'.repeat(depth + 1) + ' ' + nd.name);
      if (nd.children.length) {
        for (const child of nd.children) walk(child, depth + 1);
      } else {
        const people = Object.entries(currentAssignment)
          .filter(([, a]) => a === path).map(([n]) => n);
        if (people.length) {
          for (const name of people) lines.push(`- ${name}`);
        } else {
          lines.push('- —');
        }
      }
      lines.push('');
    }

    for (const root of rootNodes) walk(root, 1);

    navigator.clipboard.writeText(lines.join('\n').trimEnd() + '\n').then(() => {
      const orig = btnCopyMd.textContent;
      btnCopyMd.textContent = 'Copied!';
      setTimeout(() => { btnCopyMd.textContent = orig; }, 1500);
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
