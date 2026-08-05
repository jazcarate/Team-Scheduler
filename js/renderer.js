'use strict';

class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  }

  /**
   * @param {PhysNode[]} nodes
   * @param {PhysSpring[]} springs
   * @param {Record<string,string[]>|null} assignments  groupPath → [personNames]
   */
  draw(nodes, springs, assignments) {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    /** @type {Record<string,PhysNode>} */ const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);
    const groups  = nodes.filter(n => n.kind === 'group');
    const persons = nodes.filter(n => n.kind === 'person');

    // Hierarchy edges (parent → child, dashed)
    for (const g of groups) {
      for (const childPath of g.meta.children) {
        const child = nodeMap[`g:${childPath}`];
        if (!child) continue;
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(child.x, child.y);
        ctx.strokeStyle = g.color + '44';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Group nodes
    for (const g of groups) {
      const nd = g.meta;
      const isLeaf = nd.children.length === 0;
      const hasSize = nd.sizeMax < 999;

      let ringColor = g.color;
      if (assignments && isLeaf && hasSize) {
        const count = (assignments[nd.path] || []).length;
        if      (count < nd.sizeMin) ringColor = '#f85149';
        else if (count > nd.sizeMax) ringColor = '#e3b341';
        else                         ringColor = '#3fb950';
      }

      const grd = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius * 1.4);
      grd.addColorStop(0, g.color + (isLeaf ? '40' : '22'));
      grd.addColorStop(1, g.color + '00');
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius * 1.4, 0, 2 * Math.PI);
      ctx.fillStyle = grd;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, 2 * Math.PI);
      ctx.strokeStyle = ringColor + (isLeaf ? 'cc' : '77');
      ctx.lineWidth = isLeaf ? 2 : 1;
      ctx.setLineDash(isLeaf ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e0e0e0';
      ctx.font = `${isLeaf ? 'bold ' : ''}11px monospace`;
      ctx.fillText(g.label, g.x, g.y);

      if (isLeaf && hasSize && assignments) {
        const count = (assignments[nd.path] || []).length;
        ctx.fillStyle = ringColor + 'bb';
        ctx.font = '9px monospace';
        ctx.fillText(`${count}/${nd.sizeMax}`, g.x, g.y + g.radius + 11);
      }
    }

    // Attraction springs only (skip background k<0.001 and repulsion rest>500)
    for (const s of springs) {
      if (s.k < 0.001 || s.rest > 500) continue;
      const a = nodeMap[s.a], b = nodeMap[s.b];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const tension = Math.min(1, Math.abs(dist - s.rest) * s.k * 30);
      const alpha = 0.06 + tension * 0.35;
      ctx.strokeStyle = b.kind === 'group'
        ? `rgba(88,166,255,${alpha})`
        : `rgba(200,200,200,${alpha})`;
      ctx.lineWidth = 0.5 + s.k * 500;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Tint persons by assigned group; proximity fallback during sim
    /** @type {Record<string,PhysNode|null>} */ const nearestGroup = {};
    if (assignments) {
      for (const [gPath, members] of Object.entries(assignments)) {
        const gNode = nodeMap[`g:${gPath}`];
        if (!gNode) continue;
        for (const m of members) nearestGroup[`p:${m}`] = gNode;
      }
    }
    const leafNodes = groups.filter(g => g.meta.children.length === 0);
    for (const p of persons) {
      if (nearestGroup[p.id]) continue;
      let best = null, bestDist = Infinity;
      for (const g of leafNodes) {
        const dx = p.x - g.x, dy = p.y - g.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) { bestDist = d; best = g; }
      }
      nearestGroup[p.id] = best;
    }

    // Person nodes
    for (const p of persons) {
      const tintNode = nearestGroup[p.id];
      const tintColor = tintNode ? tintNode.color : '#444';

      ctx.beginPath();
      ctx.arc(p.x, p.y + 2, p.radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
      ctx.fillStyle = tintColor + '88';
      ctx.fill();
      ctx.fillStyle = p.color + '99';
      ctx.fill();

      ctx.strokeStyle = p.pinned ? '#e3b341' : p.color + 'dd';
      ctx.lineWidth = p.pinned ? 2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label.slice(0, 2).toUpperCase(), p.x, p.y);

      ctx.fillStyle = '#c9d1d9bb';
      ctx.font = '9px monospace';
      ctx.fillText(p.label, p.x, p.y + p.radius + 9);

      if (p.pinned) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#e3b341cc';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}
