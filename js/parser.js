'use strict';

/**
 * @typedef {Object} NodeDef
 * @property {string} name    short display label (non-unique within the tree)
 * @property {string} path    canonical unique identifier, e.g. "Engineering/Frontend/Lead"
 *                            For people, path === name.
 * @property {boolean} mobile true = person; false = structural area
 * @property {number} weight  strength 1–10; author's strength weights outgoing preferences
 * @property {number} sizeMin soft lower-bound on total assigned members (0 = unconstrained)
 * @property {number} sizeMax soft upper-bound (999 = unconstrained)
 * @property {string[]} children  child node paths
 * @property {string|null} parent  parent node path
 */

/**
 * @typedef {Object} PreferenceDef
 * @property {string} author  person whose strength scales this preference
 * @property {string} from    resolved path — source node
 * @property {string} to      resolved path — destination node
 * @property {number} force   positive = attraction, negative = avoidance; default +6
 */

/**
 * @typedef {Object} ParseResult
 * @property {Record<string,NodeDef>} nodes   all nodes keyed by path
 * @property {string[]} rootNodes             top-level structural node paths
 * @property {string[]} mobileNodes           person node names (= paths for persons)
 * @property {PreferenceDef[]} springs
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
  /** @type {string[]} */ const errors = [];
  /** @type {Array<{author:string,fromRef:string,toRef:string,force:number|null}>} */
  const rawPrefs = [];

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

    if (section === 'PREFERENCES') {
      // Shorthand: @Author From+Target (each sign beyond first adds ±2; + → +6, ++ → +8, - → -6, -- → -8)
      const short = line.match(/^@(\S+)\s+(\S+?)(\++|-+)(\S+)\s*$/);
      if (short) {
        const signs = short[3];
        const neg = signs[0] === '-';
        const force = (neg ? -1 : 1) * Math.min(4 + signs.length * 2, 10);
        rawPrefs.push({ author: short[1], fromRef: short[2], toRef: short[4], force });
        continue;
      }
      // Verbose: @Author From -> To : Force
      const m = line.match(/^@(\S+)\s+(.+?)\s*->\s*(.+?)(?:\s*:\s*([-+]?[\d.]+))?\s*$/);
      if (!m) { errors.push(`Bad preference (expected "@Author From -> To" or "@Author From+Target"): ${line}`); continue; }
      rawPrefs.push({
        author: m[1].trim(),
        fromRef: m[2].trim(),
        toRef: m[3].trim(),
        force: m[4] !== undefined ? parseFloat(m[4]) : null,
      });
      continue;
    }
  }

  // Auto-create any persons mentioned in preferences but absent from PEOPLE.
  // Only bare names (no '/') that don't suffix-match a structural node are treated as persons.
  const isStructuralRef = (ref) => {
    if (ref in nodes && !nodes[ref].mobile) return true;
    if (ref.includes('/')) return true;
    return Object.keys(nodes).some(p => p.endsWith('/' + ref) && !nodes[p].mobile);
  };
  for (const rp of rawPrefs) {
    for (const ref of [rp.author, rp.fromRef, rp.toRef]) {
      if (ref in nodes || isStructuralRef(ref)) continue;
      nodes[ref] = { name: ref, path: ref, mobile: true, weight: 1, sizeMin: 0, sizeMax: 999, children: [], parent: null };
      mobileNodes.push(ref);
    }
  }

  // Resolve preferences now that all nodes (including auto-created) are known.
  /** @type {PreferenceDef[]} */ const springs = [];
  for (const rp of rawPrefs) {
    if (!nodes[rp.author] || !nodes[rp.author].mobile) {
      errors.push(`Preference author must be a person: "${rp.author}"`); continue;
    }
    const from = resolveRef(rp.fromRef, nodes, errors);
    const to = resolveRef(rp.toRef, nodes, errors);
    if (from !== null && to !== null) {
      springs.push({ author: rp.author, from, to, force: rp.force !== null ? rp.force : 6 });
    }
  }

  return { nodes, rootNodes, mobileNodes, springs, errors };
}
