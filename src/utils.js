import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return clamp((v - a) / (b - a), 0, 1); }
export function damp(current, target, lambda, dt) { return lerp(current, target, 1 - Math.exp(-lambda * dt)); }
export function dampAngle(current, target, lambda, dt) {
  let diff = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return current + diff * (1 - Math.exp(-lambda * dt));
}
export function rand(min = 0, max = 1) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function chance(p) { return Math.random() < p; }
export function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic random generator (mulberry32)
export class RNG {
  constructor(seed = 123456789) { this.seed = seed >>> 0; }
  next() {
    this.seed |= 0;
    this.seed = (this.seed + 0x6D2B79F5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
}

export function formatNumber(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function makeCanvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.anisotropy) tex.anisotropy = opts.anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Ray-sphere intersection. Returns positive t or -1.
export function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(h);
  return t2 >= 0 ? t2 : -1;
}

// Infinite vertical cylinder (y range clamped), ray direction should be normalised.
export function rayCylinderY(origin, dir, cx, cz, radius, yMin, yMax) {
  const ox = origin.x - cx, oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - radius * radius;
  let t = -1;
  if (a < 1e-8) {
    if (c > 0) return -1;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t0 = (-b - sq) / (2 * a);
    const t1 = (-b + sq) / (2 * a);
    if (t0 >= 0) t = t0; else if (t1 >= 0) t = t1;
    if (t < 0) return -1;
  }
  const y = origin.y + dir.y * (t < 0 ? 0 : t);
  if (t >= 0 && y >= yMin && y <= yMax) return t;
  // Ray exits through cap within the cylinder, approximate by checking cap planes if needed.
  return -1;
}

export function pointSegmentDistanceSq(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 1e-8 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = clamp(t, 0, 1);
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  const dz = a.z + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz;
}

export function segmentIntersectsSphere(a, b, center, radius) {
  const r2 = radius * radius;
  return pointSegmentDistanceSq(center, a, b) <= r2;
}

export function segmentAABB(origin, dir, min, max, maxDist = Infinity) {
  let tmin = 0, tmax = maxDist;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min[axis] || o > max[axis]) return null;
    } else {
      let t1 = (min[axis] - o) / d;
      let t2 = (max[axis] - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function segmentIntersectsAABB2D(x1, z1, x2, z2, b, pad = 0) {
  // slab test in 2D
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dz = z2 - z1;
  const minx = b.minX - pad, maxx = b.maxX + pad;
  const minz = b.minZ - pad, maxz = b.maxZ + pad;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < minx || x1 > maxx) return false;
  } else {
    let t1 = (minx - x1) / dx, t2 = (maxx - x1) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z1 < minz || z1 > maxz) return false;
  } else {
    let t1 = (minz - z1) / dz, t2 = (maxz - z1) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax >= 0 && tmin <= 1;
}

export function pointInAABB2D(x, z, b, pad = 0) {
  return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
}

export function resolveCircleAABB(pos, radius, b, pad = 0) {
  const minX = b.minX - pad, maxX = b.maxX + pad;
  const minZ = b.minZ - pad, maxZ = b.maxZ + pad;
  const closestX = clamp(pos.x, minX, maxX);
  const closestZ = clamp(pos.z, minZ, maxZ);
  let dx = pos.x - closestX;
  let dz = pos.z - closestZ;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x += (dx / d) * (radius - d);
    pos.z += (dz / d) * (radius - d);
  } else {
    // center inside box: push out along nearest side
    const left = pos.x - minX, right = maxX - pos.x, top = pos.z - minZ, bottom = maxZ - pos.z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = minX - radius;
    else if (m === right) pos.x = maxX + radius;
    else if (m === top) pos.z = minZ - radius;
    else pos.z = maxZ + radius;
  }
  return true;
}

export const WEAPON_NAMES = {
  bio: '生物枪',
  bow: '猎弓',
  pistol: '手枪',
  grenade: '手榴弹',
  tranq: '迷药枪',
  policePistol: '警用手枪',
  smg: '冲锋枪',
  sniper: '狙击枪',
  knife: '战术匕首',
};

export const TYPE_LABEL = {
  civilian: '居民',
  police: '警察',
  swat: '特警',
  militarySniper: '军人 · 狙击手',
  militarySMG: '军人 · 突击手',
};


export function disposeObject3D(obj, disposeMaterials = false) {
  if (!obj) return;
  obj.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (disposeMaterials && node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (m && m.dispose) m.dispose();
      }
    }
  });
}
