'use strict';

/**
 * @typedef {Object} PhysNode
 * @property {string} id
 * @property {'person'|'group'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} fx
 * @property {number} fy
 * @property {boolean} fixed    true = never moved by integrator (groups + user-pinned persons)
 * @property {boolean} pinned   true = user manually placed
 * @property {number} mass
 * @property {number} radius
 * @property {string} label     short display name
 * @property {string} color
 * @property {NodeDef} meta
 */

/**
 * @typedef {Object} PhysSpring
 * @property {string} a   node id
 * @property {string} b   node id
 * @property {number} k   spring constant
 * @property {number} rest  rest length in pixels (large = repulsion)
 */

const GROUP_COLORS = ['#1f6feb','#1a7f37','#6f42c1','#a45f23','#0d7377','#8b2635'];
const PERSON_COLORS = ['#58a6ff','#3fb950','#e3b341','#f85149','#c77dff','#ff9a3c',
                       '#79c0ff','#56d364','#ffa657','#ff7b72','#d2a8ff','#7ee787'];

/**
 * Radial tree layout for structural (non-mobile) nodes.
 * @param {string[]} rootPaths
 * @param {Record<string,NodeDef>} nodes
 * @param {number} cx
 * @param {number} cy
 * @returns {Record<string,{x:number,y:number,depth:number,idx:number}>}
 */
function layoutGroups(rootPaths, nodes, cx, cy) {
  /** @type {Record<string,{x:number,y:number,depth:number,idx:number}>} */ const pos = {};
  let seq = 0;

  function place(paths, px, py, radius, depth, startAngle, span) {
    const n = paths.length;
    paths.forEach((path, i) => {
      let x, y;
      if (n === 1) {
        x = px; y = py;
      } else if (depth === 0) {
        const a = startAngle + (2 * Math.PI * i / n);
        x = px + radius * Math.cos(a);
        y = py + radius * Math.sin(a);
      } else {
        const a = startAngle + span * i / (n - 1);
        x = px + radius * Math.cos(a);
        y = py + radius * Math.sin(a);
      }
      pos[path] = { x, y, depth, idx: seq++ };
      const children = nodes[path].children;
      if (children.length > 0) {
        const childR = Math.max(70, radius * 0.5);
        const parentAngle = depth === 0
          ? (n > 1 ? startAngle + 2 * Math.PI * i / n : -Math.PI / 2)
          : startAngle + span * i / Math.max(n - 1, 1);
        const arcSpan = Math.min(Math.PI * 1.5, Math.PI * 0.6 * children.length);
        place(children, x, y, childR, depth + 1, parentAngle - arcSpan / 2, arcSpan);
      }
    });
  }

  place(rootPaths, cx, cy, 220, 0, -Math.PI / 2, 2 * Math.PI);
  return pos;
}

/**
 * Build physics nodes and springs from parsed data.
 * Spring k is weighted by the author's strength (not the from-node's strength).
 * Negative force = repulsion (large rest length pushes nodes apart).
 *
 * @param {ParseResult} parsed
 * @param {number} W
 * @param {number} H
 * @returns {{nodes:PhysNode[], springs:PhysSpring[], nodeMap:Record<string,PhysNode>}}
 */
function buildSim(parsed, W, H) {
  const { nodes, rootNodes, mobileNodes, springs: springDefs, pins } = parsed;
  /** @type {PhysNode[]} */ const physNodes = [];
  /** @type {PhysSpring[]} */ const physSprings = [];
  /** @type {Record<string,PhysNode>} */ const nodeMap = {};

  const cx = W / 2, cy = H / 2;
  const gpos = layoutGroups(rootNodes, nodes, cx, cy);

  // Structural (fixed) nodes — keyed by full path
  const structuralPaths = Object.keys(nodes).filter(p => !nodes[p].mobile);
  for (const path of structuralPaths) {
    const nd = nodes[path];
    const p = gpos[path] || { x: cx, y: cy, depth: 0, idx: 0 };
    const isLeaf = nd.children.length === 0;
    const capMax = nd.sizeMax < 999 ? nd.sizeMax : 3;
    const r = isLeaf ? Math.min(28 + capMax * 7, 72) : 22;
    const pn = /** @type {PhysNode} */ ({
      id: `g:${path}`, kind: 'group',
      x: p.x, y: p.y, vx: 0, vy: 0, fx: 0, fy: 0,
      fixed: true, pinned: false, mass: 99,
      radius: r, label: nd.name,
      color: GROUP_COLORS[p.idx % GROUP_COLORS.length],
      meta: nd,
    });
    physNodes.push(pn);
    nodeMap[pn.id] = pn;
  }

  // Mobile (person) nodes
  mobileNodes.forEach((name, i) => {
    const nd = nodes[name];
    const pin = pins[name];
    const a = (2 * Math.PI * i / mobileNodes.length) - Math.PI / 2;
    const r = 50 + Math.random() * 80;
    const pn = /** @type {PhysNode} */ ({
      id: `p:${name}`, kind: 'person',
      x: pin ? pin.xf * W : cx + r * Math.cos(a) + (Math.random() - 0.5) * 20,
      y: pin ? pin.yf * H : cy + r * Math.sin(a) + (Math.random() - 0.5) * 20,
      vx: pin ? 0 : (Math.random() - 0.5) * 1.5,
      vy: pin ? 0 : (Math.random() - 0.5) * 1.5,
      fx: 0, fy: 0,
      fixed: !!pin, pinned: !!pin, mass: 1,
      radius: 14, label: name,
      color: PERSON_COLORS[i % PERSON_COLORS.length],
      meta: nd,
    });
    physNodes.push(pn);
    nodeMap[pn.id] = pn;
  });

  // Springs from SpringDef — author's strength weights the force.
  // Negative force: rest=1500 pushes nodes apart (they're always "too close" to rest).
  for (const sd of springDefs) {
    const authorNode = nodeMap[`p:${sd.author}`];
    const srcNode = nodeMap[`p:${sd.from}`] || nodeMap[`g:${sd.from}`];
    const dstNode = nodeMap[`p:${sd.to}`]   || nodeMap[`g:${sd.to}`];
    if (!authorNode || !srcNode || !dstNode) continue;

    const w = authorNode.meta.weight;
    const k = Math.abs(sd.force) * w * 0.0025;
    const isRepulsion = sd.force < 0;
    const naturalRest = dstNode.kind === 'group' ? dstNode.radius + 10 : 35;
    const rest = isRepulsion ? 1500 : naturalRest;

    physSprings.push({ a: srcNode.id, b: dstNode.id, k, rest });
  }

  // Weak background pull to leaf areas for people with no explicit positive group spring.
  const leafGroupIds = Object.keys(nodes)
    .filter(p => !nodes[p].mobile && nodes[p].children.length === 0)
    .map(p => `g:${p}`);
  const peopleWithGroupSprings = new Set(
    springDefs.filter(sd => nodes[sd.to] && !nodes[sd.to].mobile && sd.force > 0).map(sd => sd.from)
  );
  for (const name of mobileNodes) {
    if (peopleWithGroupSprings.has(name)) continue;
    for (const gid of leafGroupIds) {
      physSprings.push({ a: `p:${name}`, b: gid, k: 0.0003, rest: 80 });
    }
  }

  return { nodes: physNodes, springs: physSprings, nodeMap };
}

class Simulation {
  /**
   * @param {PhysNode[]} nodes
   * @param {PhysSpring[]} springs
   */
  constructor(nodes, springs) {
    this.nodes = nodes;
    this.springs = springs;
    this.nodeMap = /** @type {Record<string,PhysNode>} */ ({});
    nodes.forEach(n => this.nodeMap[n.id] = n);
    this.damping = 0.88;
    this.repulsion = 900;
    this.W = 800;
    this.H = 600;
    this.energy = Infinity;
    this.steps = 0;
  }

  step() {
    const { nodes, springs, nodeMap } = this;

    for (const n of nodes) { n.fx = 0; n.fy = 0; }

    for (const s of springs) {
      const a = nodeMap[s.a], b = nodeMap[s.b];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = s.k * (dist - s.rest);
      const nx = dx / dist, ny = dy / dist;
      if (!a.fixed) { a.fx += f * nx; a.fy += f * ny; }
      if (!b.fixed) { b.fx -= f * nx; b.fy -= f * ny; }
    }

    const persons = nodes.filter(n => n.kind === 'person');
    for (let i = 0; i < persons.length; i++) {
      for (let j = i + 1; j < persons.length; j++) {
        const a = persons[i], b = persons[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(dist2);
        if (dist < (a.radius + b.radius) * 4) {
          const f = this.repulsion / dist2;
          const nx = dx / dist, ny = dy / dist;
          a.fx -= f * nx; a.fy -= f * ny;
          b.fx += f * nx; b.fy += f * ny;
        }
      }
    }

    const m = 50;
    for (const n of persons) {
      if (n.fixed) continue;
      const bf = 0.4;
      if (n.x < m)           n.fx += bf * (m - n.x);
      if (n.x > this.W - m)  n.fx += bf * (this.W - m - n.x);
      if (n.y < m)           n.fy += bf * (m - n.y);
      if (n.y > this.H - m)  n.fy += bf * (this.H - m - n.y);
    }

    let energy = 0;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx = (n.vx + n.fx) * this.damping;
      n.vy = (n.vy + n.fy) * this.damping;
      n.x += n.vx;
      n.y += n.vy;
      energy += n.vx * n.vx + n.vy * n.vy;
    }

    this.energy = energy;
    this.steps++;
    return energy;
  }
}
