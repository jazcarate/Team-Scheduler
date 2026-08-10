'use strict';

/**
 * @typedef {Object} NodeDef
 * @property {string} name    short display label (non-unique within the tree)
 * @property {string} path    canonical unique identifier, e.g. "Engineering/Frontend/Lead"
 *                            For people, path === name.
 * @property {boolean} mobile true = person; false = structural area
 * @property {number} sizeMin soft lower-bound on total assigned members (0 = unconstrained)
 * @property {number} sizeMax soft upper-bound (999 = unconstrained)
 * @property {string[]} children  child node paths
 * @property {string|null} parent  parent node path
 */

/**
 * @typedef {Object} PreferenceDef
 * @property {string} from     resolved path — person whose placement this affects (must be in PEOPLE)
 * @property {string} to       resolved path — destination node
 * @property {number} force    positive = attraction, negative = avoidance
 * @property {string} verb     'prefers' | 'strongly prefers' | 'requires' | 'avoids' | 'strongly avoids'
 * @property {string} comment  optional inline comment (text after # on the preference line)
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
 * Supports exact match and path suffix ("Frontend/Lead").
 * @param {string} ref
 * @param {Record<string,NodeDef>} nodes
 * @param {string[]} errors
 * @returns {string|null}
 */
function resolveRef(ref, nodes, errors) {
  if (ref in nodes) return ref;
  const refLow = ref.toLowerCase();
  // Case-insensitive exact match
  const ci = Object.keys(nodes).find(p => p.toLowerCase() === refLow);
  if (ci) return ci;
  // Case-insensitive suffix match
  const suffixLow = '/' + refLow;
  const matches = Object.keys(nodes).filter(p => p.toLowerCase().endsWith(suffixLow));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    errors.push(`Ambiguous reference "${ref}" — could be: ${matches.join(', ')}`);
    return null;
  }
  errors.push(`Unknown node: "${ref}"`);
  return null;
}

// Ordered longest-first to avoid prefix clashes (e.g. "strongly prefers" before "prefers")
const PREF_VERBS = [
  ['strongly prefers', 8],
  ['strongly avoids',  -8],
  ['prefers',          6],
  ['avoids',           -6],
  ['requires',         100],
];

/** @param {string} text @returns {ParseResult} */
function parseInput(text) {
  /** @type {Record<string,NodeDef>} */ const nodes = {};
  /** @type {string[]} */ const rootNodes = [];
  /** @type {string[]} */ const mobileNodes = [];
  /** @type {string[]} */ const errors = [];
  /** @type {Array<{fromRef:string,toRef:string,force:number,verb:string,comment:string}>} */
  const rawPrefs = [];

  let section = null;
  /** @type {{path:string,indent:number}[]} */ const stack = [];

  for (const raw of text.split('\n')) {
    // Strip trailing comments for structural scanning; PREFERENCES re-reads raw for inline comments
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
      const name = line.split(/\s+/)[0];
      if (!name) continue;
      if (name in nodes) { errors.push(`Duplicate name: "${name}"`); continue; }
      nodes[name] = { name, path: name, mobile: true, sizeMin: 0, sizeMax: 999, children: [], parent: null };
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
      nodes[path] = { name, path, mobile: false, sizeMin, sizeMax, children: [], parent: parentPath };
      if (parentPath) nodes[parentPath].children.push(path);
      else rootNodes.push(path);
      stack.push({ path, indent });
      continue;
    }

    if (section === 'PREFERENCES') {
      // Use the original raw line so the inline # comment is preserved
      const rawLine = raw.trim();
      if (!rawLine || rawLine.startsWith('#')) continue;

      let matched = false;
      for (const [verb, force] of PREF_VERBS) {
        // Allow one or more spaces between words in multi-word verbs
        const verbRe = verb.replace(/\s+/g, '\\s+');
        const m = rawLine.match(new RegExp(`^(\\S+)\\s+${verbRe}\\s+(\\S+)(?:\\s*#\\s*(.+))?$`, 'i'));
        if (m) {
          rawPrefs.push({ fromRef: m[1], toRef: m[2], force, verb, comment: (m[3] || '').trim() });
          matched = true;
          break;
        }
      }
      if (!matched) {
        errors.push(`Bad preference (expected "Name prefers/avoids/requires Target  # comment"): ${rawLine.split('#')[0].trim()}`);
      }
      continue;
    }
  }

  // Resolve preferences
  /** @type {PreferenceDef[]} */ const springs = [];
  for (const rp of rawPrefs) {
    const from = resolveRef(rp.fromRef, nodes, errors);
    const to   = resolveRef(rp.toRef,   nodes, errors);
    if (from !== null && to !== null) {
      if (!nodes[from].mobile) {
        errors.push(`Preference "from" must be a person from == PEOPLE ==: "${rp.fromRef}"`); continue;
      }
      springs.push({ from, to, force: rp.force, verb: rp.verb, comment: rp.comment });
    }
  }

  return { nodes, rootNodes, mobileNodes, springs, errors };
}
