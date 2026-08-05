'use strict';

const EXAMPLE = `# Team Scheduler
# Lines starting with # are comments.
# Roles are just areas with size:1 — same abstraction all the way down.
# PEOPLE is optional per-person: anyone not listed defaults to strength 1.
# Spring force defaults to +6 if omitted.

== PEOPLE ==
# Name      strength (1–10) — only list if not default (1)
Morgan      9
Jordan      8
Carol       7
Alice       6

== STRUCTURE ==
# Name  [size:MIN-MAX]   — indentation defines parent–child
Engineering
  AM           size:1
  PM           size:1
  Frontend     size:2-4
    Lead       size:1
  Backend      size:2-4
    Lead       size:1

== SPRINGS ==
# @Author  From -> To          : Force   (Force defaults to +6)
# "Lead" is ambiguous (exists under both Frontend and Backend).
# Use path syntax — Frontend/Lead vs Backend/Lead — to disambiguate.

@Morgan  Morgan -> Engineering
@Morgan  Morgan -> Engineering/AM   :  +8

@Jordan  Jordan -> Engineering
@Jordan  Jordan -> Engineering/PM   :  +8

@Alice   Alice  -> Frontend         :  +8
@Alice   Alice  -> Frontend/Lead    :  +6
@Alice   Alice  -> Bob              :  +5
@Alice   Alice  -> Morgan           :  -4
@Alice   Alice  -> Jordan           :  -3

# Bob not in PEOPLE → auto-created with strength 1
@Bob     Bob    -> Alice
@Bob     Bob    -> Frontend         :  +4

@Carol   Carol  -> Frontend         :  +7
@Carol   Carol  -> Alice            :  +5
@Carol   Alice  -> Frontend/Lead    :  +7
@Carol   Alice  -> Bob              :  +6

# Dave, Frank, Eve not in PEOPLE → auto-created with strength 1
@Dave    Dave   -> Backend          :  +7
@Dave    Dave   -> Backend/Lead     :  +5

@Frank   Frank  -> Dave
@Frank   Frank  -> Backend          :  +6

@Eve     Eve    -> Backend          :  +5
@Eve     Eve    -> Frank
`;

(function main() {
  const inputEl  = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
  const outputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('output'));
  const canvasEl = /** @type {HTMLCanvasElement}   */ (document.getElementById('canvas'));
  const hintEl   = document.getElementById('hint');
  const btnParse = /** @type {HTMLButtonElement}   */ (document.getElementById('btn-parse'));
  const btnPause = /** @type {HTMLButtonElement}   */ (document.getElementById('btn-pause'));
  const btnReset = /** @type {HTMLButtonElement}   */ (document.getElementById('btn-reset'));
  const btnUnpin = /** @type {HTMLButtonElement}   */ (document.getElementById('btn-unpin'));
  const btnCopy  = /** @type {HTMLButtonElement}   */ (document.getElementById('btn-copy'));
  const statEl   = document.getElementById('stat');

  inputEl.value = EXAMPLE;

  const renderer = new Renderer(canvasEl);

  /** @type {Simulation|null} */ let sim = null;
  /** @type {ParseResult|null} */ let parsed = null;
  /** @type {Record<string,string[]>|null} */ let lastAssignments = null;
  let running = false;
  let rafId = 0;

  // ── Canvas resize ──────────────────────────────────────────────
  let autoStarted = false;
  function resize() {
    const wrap = /** @type {HTMLElement} */ (document.getElementById('canvas-wrap'));
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W === 0 || H === 0) return;
    canvasEl.width  = W * dpr;
    canvasEl.height = H * dpr;
    canvasEl.style.width  = W + 'px';
    canvasEl.style.height = H + 'px';
    if (sim) { sim.W = W; sim.H = H; }
    if (sim && !running) renderer.draw(sim.nodes, sim.springs, lastAssignments);
    if (!autoStarted) { autoStarted = true; startSim(); }
  }
  new ResizeObserver(resize).observe(document.getElementById('canvas-wrap'));
  resize();

  // ── Animation loop ─────────────────────────────────────────────
  function loop() {
    if (!sim || !running) return;
    for (let i = 0; i < 3; i++) sim.step();

    if (sim.steps % 20 === 0) updateOutput();
    renderer.draw(sim.nodes, sim.springs, lastAssignments);

    const converged = sim.energy < 0.15;
    if (statEl) statEl.textContent = `step ${sim.steps} · energy ${sim.energy.toFixed(3)}${converged ? ' · converged' : ''}`;

    if (converged) {
      updateOutput();
      renderer.draw(sim.nodes, sim.springs, lastAssignments);
      running = false;
      syncPauseBtn();
    } else {
      rafId = requestAnimationFrame(loop);
    }
  }

  function updateOutput() {
    if (!sim || !parsed) return;
    lastAssignments = computeAssignments(sim.nodes, sim.nodeMap, parsed.nodes, parsed.mobileNodes, parsed.springs);
    outputEl.value = formatAssignments(lastAssignments, parsed, sim.nodeMap);
  }

  // ── Start / reset ───────────────────────────────────────────────
  function startSim() {
    cancelAnimationFrame(rafId);
    parsed = parseInput(inputEl.value);

    let preamble = '';
    if (parsed.errors.length > 0) {
      preamble = '== PARSE ERRORS ==\n' + parsed.errors.map(e => '  ' + e).join('\n') + '\n\n';
    }
    if (parsed.mobileNodes.length === 0 || parsed.rootNodes.length === 0) {
      outputEl.value = preamble + 'No people or structural nodes found. Check your input.';
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const W = canvasEl.width / dpr, H = canvasEl.height / dpr;
    const { nodes, springs, nodeMap } = buildSim(parsed, W, H);
    sim = new Simulation(nodes, springs);
    sim.W = W; sim.H = H;

    lastAssignments = null;
    if (preamble) outputEl.value = preamble;
    running = true;
    btnPause.disabled = false;
    btnReset.disabled = false;
    if (hintEl) hintEl.style.display = 'none';
    syncUnpinBtn();
    syncPauseBtn();
    rafId = requestAnimationFrame(loop);
  }

  function syncPauseBtn() {
    btnPause.textContent = running ? 'Pause' : 'Resume';
    btnPause.className   = running ? 'btn go' : 'btn';
  }

  function syncUnpinBtn() {
    const hasPins = sim && sim.nodes.some(n => n.pinned);
    btnUnpin.style.display = hasPins ? '' : 'none';
  }

  btnParse.addEventListener('click', startSim);
  btnReset.addEventListener('click', startSim);

  btnPause.addEventListener('click', () => {
    if (!sim) return;
    running = !running;
    syncPauseBtn();
    if (running) { rafId = requestAnimationFrame(loop); }
    else { updateOutput(); }
  });

  btnUnpin.addEventListener('click', () => {
    if (!sim) return;
    for (const n of sim.nodes) {
      if (n.pinned) { n.pinned = false; n.fixed = false; n.vx = 0; n.vy = 0; }
    }
    removePinsFromInput();
    syncUnpinBtn();
    updateOutput();
    renderer.draw(sim.nodes, sim.springs, lastAssignments);
    if (!running) { running = true; syncPauseBtn(); rafId = requestAnimationFrame(loop); }
  });

  btnCopy.addEventListener('click', () => {
    if (!outputEl.value) return;
    navigator.clipboard.writeText(outputEl.value).then(() => {
      btnCopy.textContent = 'Copied!';
      setTimeout(() => btnCopy.textContent = 'Copy', 1500);
    });
  });

  // ── Pin serialization ───────────────────────────────────────────
  function writePinsToInput() {
    if (!sim) return;
    const W = sim.W, H = sim.H;
    const pinEntries = sim.nodes
      .filter(n => n.pinned)
      .map(n => `${n.label}  ${(n.x / W).toFixed(4)}  ${(n.y / H).toFixed(4)}`);

    const filtered = [];
    let inPins = false;
    for (const line of inputEl.value.split('\n')) {
      if (/^==\s*PINS\s*==/i.test(line)) { inPins = true; continue; }
      if (inPins && /^==\s*\S/.test(line)) inPins = false;
      if (!inPins) filtered.push(line);
    }
    while (filtered.length > 0 && !filtered[filtered.length - 1].trim()) filtered.pop();
    if (pinEntries.length > 0) filtered.push('', '== PINS ==', ...pinEntries);
    inputEl.value = filtered.join('\n');
  }

  function removePinsFromInput() {
    const filtered = [];
    let inPins = false;
    for (const line of inputEl.value.split('\n')) {
      if (/^==\s*PINS\s*==/i.test(line)) { inPins = true; continue; }
      if (inPins && /^==\s*\S/.test(line)) inPins = false;
      if (!inPins) filtered.push(line);
    }
    while (filtered.length > 0 && !filtered[filtered.length - 1].trim()) filtered.pop();
    inputEl.value = filtered.join('\n');
  }

  // ── Drag / pin interaction ──────────────────────────────────────
  /** @type {PhysNode|null} */ let dragging = null;
  let dragDx = 0, dragDy = 0, dragStartX = 0, dragStartY = 0;

  canvasEl.addEventListener('mousedown', e => {
    if (!sim) return;
    const rect = canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    for (const n of sim.nodes) {
      const dx = mx - n.x, dy = my - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 4) {
        dragging = n; dragDx = dx; dragDy = dy;
        dragStartX = n.x; dragStartY = n.y;
        canvasEl.style.cursor = 'grabbing';
        break;
      }
    }
  });

  window.addEventListener('mousemove', e => {
    if (!dragging || !sim) return;
    const rect = canvasEl.getBoundingClientRect();
    dragging.x = e.clientX - rect.left - dragDx;
    dragging.y = e.clientY - rect.top  - dragDy;
    dragging.vx = 0; dragging.vy = 0;
    if (!running) renderer.draw(sim.nodes, sim.springs, lastAssignments);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging || !sim) { dragging = null; canvasEl.style.cursor = 'default'; return; }
    const moved = Math.hypot(dragging.x - dragStartX, dragging.y - dragStartY);

    if (dragging.kind === 'person') {
      if (moved > 6) {
        dragging.pinned = true; dragging.fixed = true;
        dragging.vx = 0; dragging.vy = 0;
        writePinsToInput();
        syncUnpinBtn();
        updateOutput();
        if (!running) renderer.draw(sim.nodes, sim.springs, lastAssignments);
      } else if (dragging.pinned) {
        dragging.pinned = false; dragging.fixed = false;
        dragging.vx = 0; dragging.vy = 0;
        writePinsToInput();
        syncUnpinBtn();
        updateOutput();
        if (!running) { running = true; syncPauseBtn(); rafId = requestAnimationFrame(loop); }
      }
    }

    dragging = null;
    canvasEl.style.cursor = 'default';
  });
})();
