'use strict';

/**
 * @typedef {Object} NodeDef
 * @property {string} name    short display label (non-unique within the tree)
 * @property {string} path    canonical unique identifier, e.g. "Engineering/Frontend/Lead"
 *                            For people, path === name.
 * @property {boolean} mobile true = person (moves in sim); false = structural area (fixed)
 * @property {number} weight  strength 1–10; author's strength weights outgoing springs
 * @property {number} sizeMin soft lower-bound on total assigned members (0 = unconstrained)
 * @property {number} sizeMax soft upper-bound (999 = unconstrained)
 * @property {string[]} children  child node paths
 * @property {string|null} parent  parent node path
 */

/**
 * @typedef {Object} SpringDef
 * @property {string} author  person whose strength scales this spring
 * @property {string} from    resolved path — source node
 * @property {string} to      resolved path — destination node
 * @property {number} force   positive = attraction, negative = repulsion; default +6
 */

/**
 * @typedef {Object} PinDef
 * @property {number} xf  fractional x (0–1 of canvas width)
 * @property {number} yf  fractional y (0–1 of canvas height)
 */

/**
 * @typedef {Object} ParseResult
 * @property {Record<string,NodeDef>} nodes   all nodes keyed by path
 * @property {string[]} rootNodes             top-level structural node paths
 * @property {string[]} mobileNodes           person node names (= paths for persons)
 * @property {SpringDef[]} springs
 * @property {Record<string,PinDef>} pins     person name → fractional canvas position
 * @property {string[]} errors
 */

/**
 * Resolve a reference to a canonical node path.
 * Supports exact match ("Engineering") and path suffix ("Frontend/Lead").
 * @param {string} ref
 * @param {Record<string,NodeDef>} nodes
 * @param {string[]} errors
 * @returns {string|null}
 */
function resolveRef(ref, nodes, errors) {
  if (ref in nodes) return ref;
  const suffix = '/' + ref;
  const matches = Object.keys(nodes).filter(p => p.endsWith(suffix));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    errors.push(`Ambiguous reference "${ref}" — could be: ${matches.join(', ')}`);
    return null;
  }
  errors.push(`Unknown node: "${ref}"`);
  return null;
}

/** @param {string} text @returns {ParseResult} */
function parseInput(text) {
  /** @type {Record<string,NodeDef>} */ const nodes = {};
  /** @type {string[]} */ const rootNodes = [];
  /** @type {string[]} */ const mobileNodes = [];
  /** @type {Record<string,PinDef>} */ const pins = {};
  /** @type {string[]} */ const errors = [];
  /** @type {Array<{author:string,fromRef:string,toRef:string,force:number|null}>} */
  const rawSprings = [];

  let section = null;
  /** @type {{path:string,indent:number}[]} */ const stack = [];

  for (const raw of text.split('\n')) {
    const stripped = raw.replace(/#.*$/, '');
    if (!stripped.trim()) continue;
    const indent = stripped.length - stripped.trimStart().length;
    const line = stripped.trim();

    if (line.startsWith('==')) {
      const m = line.match(/==\s*([A-Z_]+)/i);
      if (m) section = m[1].toUpperCase();
      stack.length = 0;
      continue;
    }

    if (section === 'PEOPLE') {
      const parts = line.split(/\s+/);
      const name = parts[0];
      if (!name) continue;
      let weight = 5;
      for (const p of parts.slice(1)) {
        const wm = p.match(/^strength:([\d.]+)/i);
        if (wm) { weight = parseFloat(wm[1]) || 5; continue; }
        const n = parseFloat(p);
        if (!isNaN(n)) weight = n;
      }
      if (name in nodes) { errors.push(`Duplicate name: "${name}"`); continue; }
      nodes[name] = { name, path: name, mobile: true, weight, sizeMin: 0, sizeMax: 999, children: [], parent: null };
      mobileNodes.push(name);
      continue;
    }

    if (section === 'STRUCTURE') {
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const parentPath = stack.length > 0 ? stack[stack.length - 1].path : null;

      const parts = line.split(/\s+/);
      const name = parts[0];
      if (!name) continue;
      let sizeMin = 0, sizeMax = 999;
      for (const p of parts.slice(1)) {
        const sm = p.match(/^size:(\d+)(?:-(\d+))?$/i);
        if (sm) {
          sizeMin = parseInt(sm[1], 10);
          sizeMax = sm[2] !== undefined ? parseInt(sm[2], 10) : sizeMin;
        }
      }

      const path = parentPath ? `${parentPath}/${name}` : name;
      if (path in nodes) { errors.push(`Duplicate structural path: "${path}"`); continue; }
      nodes[path] = { name, path, mobile: false, weight: 1, sizeMin, sizeMax, children: [], parent: parentPath };
      if (parentPath) nodes[parentPath].children.push(path);
      else rootNodes.push(path);
      stack.push({ path, indent });
      continue;
    }

    if (section === 'SPRINGS') {
      const m = line.match(/^@(\S+)\s+(.+?)\s*->\s*(.+?)(?:\s*:\s*([-+]?[\d.]+))?\s*$/);
      if (!m) { errors.push(`Bad spring (expected "@Author From -> To" or "@Author From -> To : Force"): ${line}`); continue; }
      rawSprings.push({
        author: m[1].trim(),
        fromRef: m[2].trim(),
        toRef: m[3].trim(),
        force: m[4] !== undefined ? parseFloat(m[4]) : null,
      });
      continue;
    }

    if (section === 'PINS') {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const xf = parseFloat(parts[1]), yf = parseFloat(parts[2]);
        if (!isNaN(xf) && !isNaN(yf)) pins[parts[0]] = { xf, yf };
      }
      continue;
    }
  }

  // Auto-create any persons mentioned in springs but absent from PEOPLE.
  // Only bare names (no '/') that don't suffix-match a structural node are treated as persons.
  const isStructuralRef = (ref) => {
    if (ref in nodes && !nodes[ref].mobile) return true;
    if (ref.includes('/')) return true;
    return Object.keys(nodes).some(p => p.endsWith('/' + ref) && !nodes[p].mobile);
  };
  for (const rs of rawSprings) {
    for (const ref of [rs.author, rs.fromRef, rs.toRef]) {
      if (ref in nodes || isStructuralRef(ref)) continue;
      nodes[ref] = { name: ref, path: ref, mobile: true, weight: 1, sizeMin: 0, sizeMax: 999, children: [], parent: null };
      mobileNodes.push(ref);
    }
  }

  // Resolve springs now that all nodes (including auto-created) are known.
  /** @type {SpringDef[]} */ const springs = [];
  for (const rs of rawSprings) {
    if (!nodes[rs.author] || !nodes[rs.author].mobile) {
      errors.push(`Spring author must be a person: "${rs.author}"`); continue;
    }
    const from = resolveRef(rs.fromRef, nodes, errors);
    const to   = resolveRef(rs.toRef,   nodes, errors);
    if (from !== null && to !== null) {
      springs.push({ author: rs.author, from, to, force: rs.force !== null ? rs.force : 6 });
    }
  }

  return { nodes, rootNodes, mobileNodes, springs, pins, errors };
}
