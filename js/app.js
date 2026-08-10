'use strict';

const EXAMPLE = `# Edit preferences below and click Solve.
# Shorthand: @Author Person+Person (+6), @Author Person++Person (+8)
#            @Author Person-Person (-6), @Author Person--Person (-8)

== PEOPLE ==
# Name   strength (1–10) — omit to default to strength 1
Alice   7

== STRUCTURE ==
# Name  [size:MIN-MAX]   — indentation = parent–child
Engineering
  Frontend  size:2-4
  Backend   size:2-3

== PREFERENCES ==
# Verbose:   @Author From -> Area  : Force
# Shorthand: @Author From+Person   (Force defaults to ±6)
@Alice  Alice -> Frontend  :  +8
@Carol  Carol+Alice
@Carol  Carol -> Frontend  :  +7
@Bob    Bob -> Backend
@Dave   Dave -> Backend    :  +6
@Dave   Dave-Carol
`;

const LS_KEY = 'scheduler_input_v1';
const LS_TTL = 10 * 24 * 60 * 60 * 1000; // 10 days

function saveToStorage(text) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ v: text, ts: Date.now() })); } catch (e) { }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { v, ts } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL) { localStorage.removeItem(LS_KEY); return null; }
    return v;
  } catch (e) { return null; }
}

(function () {
  const inputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
  const vizEl = /** @type {HTMLElement} */ (document.getElementById('viz-wrap'));
  const btnSolve = /** @type {HTMLButtonElement} */ (document.getElementById('btn-solve'));
  const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset'));
  const btnCopyMd = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-md'));
  const statEl = document.getElementById('stat');

  // ── State ──────────────────────────────────────────────────────
  let currentParsed = null;
  let currentAssignment = null;
  let currentHappiness = null;

  // ── Init ───────────────────────────────────────────────────────
  inputEl.value = loadFromStorage() ?? EXAMPLE;
  run();

  // ── Input persistence (debounced) ──────────────────────────────
  let saveTimer = null;
  inputEl.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToStorage(inputEl.value), 800);
  });

  // ── Buttons ────────────────────────────────────────────────────
  btnSolve.addEventListener('click', run);

  btnReset.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    inputEl.value = EXAMPLE;
    run();
  });

  btnCopyMd.addEventListener('click', copyMd);

  // ── Drag-and-drop (event delegation on stable container) ───────
  vizEl.addEventListener('dragstart', e => {
    const card = /** @type {HTMLElement} */ (e.target).closest('[data-person]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.person);
    e.dataTransfer.effectAllowed = 'move';
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
    currentAssignment[person] = leaf.dataset.area;
    currentHappiness = computeHappiness(currentParsed, currentAssignment);
    renderState();
  });

  // ── Core ───────────────────────────────────────────────────────
  function run() {
    saveToStorage(inputEl.value);
    const parsed = parseInput(inputEl.value);
    currentParsed = parsed;

    if (parsed.mobileNodes.length === 0 && parsed.rootNodes.length === 0) {
      vizEl.innerHTML = '<div class="viz-msg">Add people and structure to get started.</div>';
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

    const result = solveAssignments(parsed);
    currentAssignment = result.assignment;
    currentHappiness = result.happiness;

    renderState();
    if (errHtml) vizEl.insertAdjacentHTML('afterbegin', errHtml);

    const nPeople = parsed.mobileNodes.length;
    const nAreas = Object.keys(parsed.nodes).filter(p => !parsed.nodes[p].mobile).length;
    if (statEl) statEl.textContent = `${nPeople} people · ${nAreas} areas`;
  }

  function renderState() {
    if (!currentParsed || !currentAssignment) return;
    renderAssignment(currentParsed, { assignment: currentAssignment, happiness: currentHappiness }, vizEl);
  }

  // ── Export ─────────────────────────────────────────────────────
  function copyMd() {
    if (!currentParsed || !currentAssignment) return;

    const { nodes, rootNodes } = currentParsed;
    const lines = [];

    function walk(path, depth) {
      const nd = nodes[path];
      const hashes = '#'.repeat(depth + 1);
      lines.push(`${hashes} ${nd.name}`);
      if (nd.children.length) {
        for (const child of nd.children) walk(child, depth + 1);
      } else {
        // leaf — list assigned people
        const people = Object.entries(currentAssignment)
          .filter(([, a]) => a === path)
          .map(([n]) => n);
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
