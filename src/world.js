import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  RNG, TAU, clamp, choose, choose as choice, lerp, pointInAABB2D, raySphere,
  segmentIntersectsAABB2D, segmentAABB,
} from './utils.js';

export const MAP_SIZE = 520;
export const HALF_MAP = MAP_SIZE / 2;
export const ROAD_WIDTH = 16;
export const ROAD_LINES = [-216, -144, -72, 0, 72, 144, 216];
export const BLOCK_CENTERS = [-180, -108, -36, 36, 108, 180];
export const BLOCK_HALF = 28;
export const BUILD_HALF = 24;
export const WALK_LIMIT = 246;

const WALL_COLORS = [
  0xdcc8a8, 0xe6d1b1, 0xb8d1bd, 0xa9c4ca, 0xe3ad92, 0xd18f7a,
  0xc6b8ca, 0xedd7b9, 0xb5c7a9, 0xd9b791, 0xc0ced5, 0xe4bfa6,
  0xc4d8cc, 0xdcc3b1, 0xe1d2a9, 0xb8c8d6,
];
const URBAN_WALLS = [
  0xd7c8b0, 0xb4c5c2, 0xc4a58e, 0x8fa5ad, 0xd3ae93, 0xaab7bb,
  0xcab99e, 0xe2d2b6, 0x9fb8b6, 0xceac91, 0xa9b3a8, 0xdacab7,
  0xb4c9cf, 0xd6bca8, 0xc7c49f, 0xaebccd,
];
const ROOF_COLORS = [0x555a5d, 0x704f43, 0x7c4d42, 0x414d4b, 0x5b5b61, 0x876455, 0x3b4a51];
const GLASS_COLORS = [0x93b6bf, 0x7fa3ad, 0xa4c2c8, 0x7396a0, 0xafc9cd];
const LIT_COLORS = [0xffd699, 0xffe7b7, 0xffc176, 0xfff1c9, 0xffd08a];
const CAR_COLORS = [
  0xb7c1c6, 0x39434a, 0x9c3f3d, 0x375b6b, 0xd1c7b6, 0x5f7358,
  0x857e74, 0x2f3438, 0xc57d4c, 0x667d8e, 0xe2ddd2, 0x784a52,
];
const SIGN_TEXTS = ['便利店', '面馆', '咖啡', '五金', '药房', '书店', '洗衣', '面包房', '花店', '酒馆', '水果', '理发'];
const SIGN_BG = ['#f2eadb', '#253337', '#8f342d', '#365d59', '#d98d45'];
const TREE_GREENS = [0x4f7041, 0x5b7f49, 0x42653f, 0x6a8751, 0x3d5c3b, 0x78945d];

function card(a, b, s) {
  const a1 = a + (b - a) * s;
  const b1 = a + (b - a) * (1 - s);
  return [a1, b1];
}

function makeRoofGeometry(w, h, d) {
  // gable roof extruded along local z, ridge along local x
  const hw = w / 2, hd = d / 2;
  const verts = [
    // left slope
    -hw, 0, -hd, -hw, 0, hd, 0, h, hd,
    -hw, 0, -hd, 0, h, hd, 0, h, -hd,
    // right slope
    0, h, -hd, 0, h, hd, hw, 0, hd,
    0, h, -hd, hw, 0, hd, hw, 0, -hd,
    // front triangle
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    // back triangle
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeTriangleGeometry(w, h) {
  const hw = w / 2;
  const verts = [
    -hw, 0, 0, hw, 0, 0, 0, h, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.rng = new RNG(0x51a7c0de);
    this.size = MAP_SIZE;
    this.half = HALF_MAP;
    this.time = 0;
    this.colliders = [];
    this.trees = [];
    this.cars = [];
    this.streetlights = [];
    this.benches = [];
    this.buildings = [];
    this.lots = [];
    this.parks = [];
    this.fences = [];
    this.signs = [];
    this.sidewalkPoints = [];
    this.roadSpawnPoints = [];
    this.supplySpots = [];
    this.fountain = null;
    this.startPos = new THREE.Vector3(4.5, 0, 8.5);
    this._minimapBuildings = [];
    this._geoUnitBox = new THREE.BoxGeometry(1, 1, 1);
    this._geoUnitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
    this._geoUnitCylinder5 = new THREE.CylinderGeometry(1, 1, 1, 5, 1, false);
    this._geoUnitSphere = new THREE.IcosahedronGeometry(1, 1);
    this._geoUnitSphereLow = new THREE.IcosahedronGeometry(1, 0);
    this._signMaterials = new Map();

    this._planCity();
    this._buildGround();
    this._buildStaticGeometry();
    this._buildBoundary();
    this._buildSkyAndLights();
    this._buildSpawnPoints();
    this._planSupplySpots();
    this._buildMinimap();
    this._buildNavGrid();
    this._buildClickables();
  }

  // ---------------------------------------------------------------- planning
  _planCity() {
    const rng = this.rng;
    this.swingSets = [];
    for (let bz = 0; bz < 6; bz++) {
      for (let bx = 0; bx < 6; bx++) {
        const cx = BLOCK_CENTERS[bx];
        const cz = BLOCK_CENTERS[bz];
        const key = `${bx},${bz}`;
        const isPark = key === '2,3' || key === '1,1' || key === '4,4';
        const isDowntown = key === '3,2';
        // A couple of residential pockets sit right in the middle of the city,
        // so the first impression includes pitched roofs and front yards.
        const residentialPockets = new Set(['2,2', '1,3', '4,2']);
        const isUrban = !isPark && !residentialPockets.has(key) &&
          (Math.max(Math.abs(cx), Math.abs(cz)) <= 108 || isDowntown);
        this._planBlock({ bx, bz, cx, cz, key, isPark, isDowntown, isUrban, rng });
      }
    }
    // A few cars and street props near the opening view so the first corner
    // doesn't feel like an empty test level.
    this._addCar(-4.4, 23.5, 0, rng);
    this._addCar(-4.4, 35.0, 0, rng);
    this._addCar(14.4, -11.5, 0, rng);
    this._addCar(23, 42, Math.PI / 2, rng);
    // A few trees and cars outside the block grid, on the green belt.
    for (let i = 0; i < 120; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(225, 250);
      this._addTree(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.9, 1.9));
    }
  }

  _planBlock(info) {
    const { bx, bz, cx, cz, key, isPark, isDowntown, isUrban } = info;
    const rng = this.rng;
    const block = {
      bx, bz, key, cx, cz, type: isPark ? 'park' : isDowntown ? 'downtown' : isUrban ? 'urban' : 'suburb',
      bounds: { minX: cx - BLOCK_HALF, maxX: cx + BLOCK_HALF, minZ: cz - BLOCK_HALF, maxZ: cz + BLOCK_HALF },
    };
    this.blocks = this.blocks || [];
    this.blocks.push(block);
    if (isPark) {
      this._planPark(block, key === '2,3');
      return;
    }
    const lotCenters = [-12, 12];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const lx = cx + lotCenters[i];
        const lz = cz + lotCenters[j];
        const outDirs = [];
        if (i === 0) outDirs.push([-1, 0]);
        else outDirs.push([1, 0]);
        if (j === 0) outDirs.push([0, -1]);
        else outDirs.push([0, 1]);
        const front = rng.chance(0.5) ? outDirs[0] : outDirs[1];
        const yaw = Math.atan2(front[0], front[1]);
        const lot = {
          cx: lx, cz: lz, half: 11.6, front, yaw, block,
          type: isDowntown ? 'downtown' : isUrban ? 'urban' : 'house',
        };
        if (isDowntown) {
          if ((i === 0 && j === 0) || (i === 1 && j === 1)) {
            this._planTower(lot, i, j, rng);
          } else {
            this._planUrban(lot, i, j, rng, true);
          }
        } else if (isUrban) {
          const parking = rng.chance(0.16);
          if (parking) this._planParkingLot(lot, rng);
          else this._planUrban(lot, i, j, rng, false);
        } else {
          const empty = rng.chance(0.08);
          if (empty) {
            lot.type = 'garden';
            this.lots.push(lot);
            this._addTree(lx + rng.range(-5, 5), lz + rng.range(-5, 5), rng.range(0.8, 1.25));
          } else {
            this._planHouse(lot, i, j, rng);
          }
        }
      }
    }
    this._addCurbTrees(block, rng);
    // Parked cars along the curb. Helpful city noise.
    for (let side = 0; side < 4; side++) {
      if (!rng.chance(0.55)) continue;
      const count = rng.int(0, 2);
      for (let n = 0; n < count; n++) {
        if (side === 0) this._addCar(cx + BLOCK_HALF + 2.1, cz + rng.range(-19, 19), 0, rng);
        else if (side === 1) this._addCar(cx - BLOCK_HALF - 2.1, cz + rng.range(-19, 19), Math.PI, rng);
        else if (side === 2) this._addCar(cx + rng.range(-19, 19), cz + BLOCK_HALF + 2.1, Math.PI / 2, rng);
        else this._addCar(cx + rng.range(-19, 19), cz - BLOCK_HALF - 2.1, -Math.PI / 2, rng);
      }
    }
    // Street lamps on the four block corners.
    const lampSpots = [
      [cx - 25.5, cz - 25.5, [1, 1]],
      [cx + 25.5, cz - 25.5, [-1, 1]],
      [cx + 25.5, cz + 25.5, [-1, -1]],
      [cx - 25.5, cz + 25.5, [1, -1]],
    ];
    for (const [x, z, dir] of lampSpots) this.streetlights.push({ x, z, dir });
  }

  _planHouse(lot, i, j, rng) {
    const w = rng.range(9.4, 12.4);
    const d = rng.range(8.0, 10.2);
    const floors = rng.chance(0.36) ? 2 : 1;
    const setback = 2.4 + rng.range(0, 1.4);
    const front = lot.front;
    const x = lot.cx - front[0] * setback;
    const z = lot.cz - front[1] * setback;
    const wall = rng.pick(WALL_COLORS);
    const roof = rng.pick(ROOF_COLORS);
    const floorH = 2.85;
    const height = floors * floorH + 0.25;
    const spec = {
      kind: 'house',
      x, z, w, d, height, floors, yaw: lot.yaw, wall, roof,
      front, trim: rng.chance(0.4) ? 0xf2ede3 : 0xe7dfd0,
      chimney: rng.chance(0.55),
      porch: rng.chance(0.8),
      windows: [],
      doorX: rng.range(-1.1, 1.1),
      lot,
      seed: rng.int(1, 999999),
    };
    lot.type = 'house';
    lot.building = spec;
    lot.walkway = this._frontToSidewalk(lot, w, d, front, 1.1);
    lot.driveway = rng.chance(0.55) ? this._frontToSidewalk(lot, w, d, front, 2.4, -w * 0.32) : null;
    this.lots.push(lot);
    this.buildings.push(spec);
    this._addBuildingCollider(spec);
    this.fences.push(...this._makeHouseFences(lot, spec, rng));
    // Yard decorations
    const side = rng.chance(0.5) ? -1 : 1;
    const sx = x + Math.cos(lot.yaw) * side * (w * 0.55) + Math.sin(lot.yaw) * (d * 0.5 + 2.4);
    const sz = z - Math.sin(lot.yaw) * side * (w * 0.55) + Math.cos(lot.yaw) * (d * 0.5 + 2.4);
    if (rng.chance(0.7)) this._addTree(sx, sz, rng.range(0.72, 1.05));
    if (rng.chance(0.5)) {
      this._addBush(x + Math.sin(lot.yaw) * (d * 0.5 + 1.2) + Math.cos(lot.yaw) * (w * 0.35), z + Math.cos(lot.yaw) * (d * 0.5 + 1.2) - Math.sin(lot.yaw) * (w * 0.35), rng.range(0.5, 0.8));
    }
    if (lot.driveway && rng.chance(0.4)) {
      const dx = x + Math.sin(lot.yaw) * (d * 0.5 + 2.5) + Math.cos(lot.yaw) * (-w * 0.32);
      const dz = z + Math.cos(lot.yaw) * (d * 0.5 + 2.5) - Math.sin(lot.yaw) * (-w * 0.32);
      this._addCar(dx, dz, lot.yaw, rng);
    }
  }

  _planUrban(lot, i, j, rng, downtown) {
    const w = rng.range(13.8, 18.4);
    const d = rng.range(12.8, 18.0);
    const floors = downtown ? rng.int(3, 5) : rng.int(2, 5);
    const setback = 1.1;
    const front = lot.front;
    const x = lot.cx - front[0] * setback;
    const z = lot.cz - front[1] * setback;
    const wall = rng.pick(URBAN_WALLS);
    const roof = rng.pick(ROOF_COLORS);
    const height = floors * 3.25 + 0.55;
    const sign = this.buildings.length % 5 === 0 || rng.chance(0.48);
    const spec = {
      kind: 'urban', x, z, w, d, height, floors, yaw: lot.yaw, wall, roof,
      front, trim: 0xe9e2d3, sign: sign ? rng.pick(SIGN_TEXTS) : null,
      signBg: rng.pick(SIGN_BG),
      shop: sign && floors > 1,
      windows: [], balcony: floors >= 3 && rng.chance(0.35),
      seed: rng.int(1, 999999), downtown,
    };
    lot.type = 'urban';
    lot.building = spec;
    lot.walkway = this._frontToSidewalk(lot, w, d, front, 1.6);
    this.lots.push(lot);
    this.buildings.push(spec);
    this._addBuildingCollider(spec);
    if (spec.sign) this.signs.push({ text: spec.sign, bg: spec.signBg, spec });
    // A little roof clutter for the taller blocks.
    if (height > 14 && rng.chance(0.65)) {
      const ax = Math.sin(spec.yaw) * (d * 0.22) + Math.cos(spec.yaw) * (w * 0.2);
      const az = Math.cos(spec.yaw) * (d * 0.22) - Math.sin(spec.yaw) * (w * 0.2);
      this.buildings.push({
        kind: 'rooftop', x: x + ax, z: z + az, w: 3.5, d: 3.0, height: 1.1,
        baseY: height, yaw: spec.yaw, parent: spec, wall: 0x8f9799,
      });
    }
  }

  _planTower(lot, i, j, rng) {
    const w = rng.range(14.5, 17.8);
    const d = rng.range(14.0, 17.0);
    const floors = rng.int(7, 10);
    const front = lot.front;
    const x = lot.cx - front[0] * 0.8;
    const z = lot.cz - front[1] * 0.8;
    const height = floors * 3.2 + 2.2;
    const spec = {
      kind: 'tower', x, z, w, d, height, floors, yaw: lot.yaw,
      wall: rng.chance(0.5) ? 0xbcc4c5 : 0xd4cabb, roof: 0x545b5d,
      front, trim: 0xe8e1d4, windows: [], sign: null, seed: rng.int(1, 999999),
      downtown: true,
    };
    lot.type = 'urban';
    lot.building = spec;
    lot.walkway = this._frontToSidewalk(lot, w, d, front, 2.0);
    this.lots.push(lot);
    this.buildings.push(spec);
    this._addBuildingCollider(spec);
    this.buildings.push({
      kind: 'rooftop', x: x + 2, z: z - 2, w: 4.5, d: 4, height: 1.7,
      baseY: height, yaw: 0, parent: spec, wall: 0x848f91,
    });
  }

  _planParkingLot(lot, rng) {
    lot.type = 'parking';
    lot.building = null;
    this.lots.push(lot);
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2 ? 1 : -1) * 4.8;
      const oz = (k < 2 ? -1 : 1) * 5.5;
      this._addCar(lot.cx + ox, lot.cz + oz, lot.yaw + (rng.chance(0.5) ? 0 : Math.PI), rng);
    }
  }

  _planPark(block, grand) {
    const rng = this.rng;
    const park = {
      type: 'park', block, cx: block.cx, cz: block.cz, grand,
      minX: block.cx - BUILD_HALF, maxX: block.cx + BUILD_HALF,
      minZ: block.cz - BUILD_HALF, maxZ: block.cz + BUILD_HALF,
      fountain: grand ? { x: block.cx + 1, z: block.cz + 2, r: 5.2 } : null,
      pond: !grand ? { x: block.cx - 7, z: block.cz - 6, rx: 10, rz: 6 } : null,
      playground: !grand ? { x: block.cx + 9, z: block.cz + 9 } : { x: block.cx + 11, z: block.cz - 10 },
    };
    this.parks.push(park);
    if (grand) {
      this.fountain = { ...park.fountain };
      this.colliders.push({
        minX: park.fountain.x - park.fountain.r, maxX: park.fountain.x + park.fountain.r,
        minZ: park.fountain.z - park.fountain.r, maxZ: park.fountain.z + park.fountain.r,
        height: 1.25, type: 'fountain', supportTop: false,
      });
    }
    // Trees ring the park.
    for (let n = 0; n < (grand ? 24 : 17); n++) {
      const x = rng.range(park.minX + 2, park.maxX - 2);
      const z = rng.range(park.minZ + 2, park.maxZ - 2);
      if (Math.hypot(x - park.cx, z - park.cz) < (grand ? 10 : 8)) continue;
      if (park.fountain && Math.hypot(x - park.fountain.x, z - park.fountain.z) < 8) continue;
      if (park.pond && Math.hypot(x - park.pond.x, z - park.pond.z) < 13) continue;
      this._addTree(x, z, rng.range(0.85, 1.5));
    }
    // Benches facing the centre.
    for (let n = 0; n < (grand ? 8 : 5); n++) {
      const a = (n / (grand ? 8 : 5)) * TAU + 0.3;
      const r = grand ? 13.5 : 12;
      this.benches.push({
        x: park.cx + Math.cos(a) * r, z: park.cz + Math.sin(a) * r,
        yaw: -a + Math.PI / 2,
      });
    }
    // Playground pieces.
    if (park.playground) {
      this.playgrounds = this.playgrounds || [];
      this.playgrounds.push(park.playground);
    }
    // A small footpath flower arrangement.
    for (let n = 0; n < (grand ? 24 : 15); n++) {
      const a = rng.range(0, TAU);
      const r = grand ? rng.range(6.5, 11.5) : rng.range(5.2, 10.5);
      const x = park.cx + Math.cos(a) * r;
      const z = park.cz + Math.sin(a) * r;
      if (park.pond && Math.hypot(x - park.pond.x, z - park.pond.z) < 11) continue;
      this._addBush(x, z, rng.range(0.35, 0.6), true);
    }
  }

  _addCurbTrees(block, rng) {
    if (rng.chance(0.4)) {
      const side = rng.int(0, 3);
      let x = block.cx + rng.range(-17, 17);
      let z = block.cz + rng.range(-17, 17);
      if (side === 0) z = block.cz - 26.2;
      if (side === 1) z = block.cz + 26.2;
      if (side === 2) x = block.cx - 26.2;
      if (side === 3) x = block.cx + 26.2;
      this._addTree(x, z, rng.range(0.62, 0.92));
    }
  }

  _addBuildingCollider(spec) {
    const c = Math.abs(Math.cos(spec.yaw));
    const s = Math.abs(Math.sin(spec.yaw));
    const ex = (c * spec.w + s * spec.d) / 2 + 0.35;
    const ez = (s * spec.w + c * spec.d) / 2 + 0.35;
    const col = {
      minX: spec.x - ex, maxX: spec.x + ex,
      minZ: spec.z - ez, maxZ: spec.z + ez,
      height: spec.height + (spec.kind === 'house' ? 2.2 : 0.8),
      type: 'building', spec, supportTop: true,
    };
    spec.collider = col;
    this.colliders.push(col);
    this._minimapBuildings.push({ minX: col.minX, maxX: col.maxX, minZ: col.minZ, maxZ: col.maxZ });
  }

  _addTree(x, z, size = 1, color) {
    this.trees.push({ x, z, size, color: color || this.rng.pick(TREE_GREENS) });
  }

  _addBush(x, z, size = 0.5, flowers = false) {
    this.trees.push({ x, z, size, color: this.rng.pick(TREE_GREENS), bush: true, flowers });
  }

  _addCar(x, z, yaw, rng) {
    if (this.cars.some(c => Math.hypot(c.x - x, c.z - z) < 4)) return;
    this.cars.push({
      x, z, yaw,
      color: rng.pick(CAR_COLORS),
      type: rng.chance(0.08) ? 'van' : 'car',
      seed: rng.int(1, 10000),
    });
  }

  _frontToSidewalk(lot, w, d, front, width, lateral = 0) {
    const startX = lot.cx - front[0] * 1 + front[1] * lateral;
    const startZ = lot.cz - front[1] * 1 - front[0] * lateral;
    const endX = lot.cx + front[0] * 12 + front[1] * lateral;
    const endZ = lot.cz + front[1] * 12 - front[0] * lateral;
    return { x1: startX, z1: startZ, x2: endX, z2: endZ, width };
  }

  _makeHouseFences(lot, spec, rng) {
    if (!rng.chance(0.62)) return [];
    const f = lot.front;
    const fx = lot.cx + f[0] * (lot.half - 0.7);
    const fz = lot.cz + f[1] * (lot.half - 0.7);
    const px = f[1], pz = -f[0];
    const segments = [];
    const gap = 1.5;
    // two front segments with a path gap
    for (const sign of [-1, 1]) {
      const a = sign * gap;
      const b = sign * (lot.half - 0.8);
      segments.push({
        x1: fx + px * a, z1: fz + pz * a,
        x2: fx + px * (a + b * 0.5), z2: fz + pz * (a + b * 0.5),
      });
      segments.push({
        x1: fx + px * (a + b * 0.5), z1: fz + pz * (a + b * 0.5),
        x2: fx + px * b, z2: fz + pz * b,
      });
    }
    return segments;
  }

  _planSupplySpots() {
    const desired = [
      [-20, 10], [24, -24], [-80, 20], [64, 56], [-118, -118],
      [92, -44], [-152, 70], [146, 128], [-206, -52], [44, 184],
      [-68, -150], [190, -168],
    ];
    for (const [x, z] of desired) {
      let best = null, bd = Infinity;
      for (const p of this.sidewalkPoints) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        const duplicate = this.supplySpots.some(s => Math.hypot(s.x - best.x, s.z - best.z) < 8);
        if (!duplicate) this.supplySpots.push({ x: best.x, z: best.z });
      }
    }
  }

  // ------------------------------------------------------------------ ground
  _buildGround() {
    const canvas = document.createElement('canvas');
    const S = 4096;
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    const rng = new RNG(777123);
    const px = v => ((v + HALF_MAP) / MAP_SIZE) * S;
    const pz = v => ((v + HALF_MAP) / MAP_SIZE) * S;
    const len = v => (v / MAP_SIZE) * S;

    // grass base
    ctx.fillStyle = '#667750';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 4200; i++) {
      const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(0.8, 5);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(58,76,44,.22)' : 'rgba(127,140,90,.14)';
      ctx.beginPath(); ctx.ellipse(x, y, r * 2, r, rng.range(0, TAU), 0, TAU); ctx.fill();
    }

    // broad asphalt roads
    ctx.fillStyle = '#3d4142';
    for (const road of ROAD_LINES) {
      ctx.fillRect(px(road - ROAD_WIDTH / 2), 0, len(ROAD_WIDTH), S);
      ctx.fillRect(0, pz(road - ROAD_WIDTH / 2), S, len(ROAD_WIDTH));
    }
    // slight asphalt variation
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S), y = rng.range(0, S);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(20,24,25,.16)' : 'rgba(160,162,155,.05)';
      ctx.beginPath(); ctx.ellipse(x, y, rng.range(1, 11), rng.range(0.5, 4), rng.range(0, TAU), 0, TAU); ctx.fill();
    }

    // blocks (sidewalk + interior)
    for (const block of this.blocks) {
      const b = block.bounds;
      const inner = 4.2;
      // sidewalk
      ctx.fillStyle = '#aaa89e';
      ctx.fillRect(px(b.minX), pz(b.minZ), len(b.maxX - b.minX), len(b.maxZ - b.minZ));
      // sidewalk slab joints
      ctx.strokeStyle = 'rgba(80,82,76,.17)';
      ctx.lineWidth = 1.5;
      for (let x = b.minX; x < b.maxX; x += 3.1) {
        ctx.beginPath(); ctx.moveTo(px(x), pz(b.minZ)); ctx.lineTo(px(x), pz(b.maxZ)); ctx.stroke();
      }
      for (let z = b.minZ; z < b.maxZ; z += 3.1) {
        ctx.beginPath(); ctx.moveTo(px(b.minX), pz(z)); ctx.lineTo(px(b.maxX), pz(z)); ctx.stroke();
      }
      if (block.type === 'park') {
        ctx.fillStyle = '#5f7d50';
      } else if (block.type === 'downtown') {
        ctx.fillStyle = '#9a9d96';
      } else if (block.type === 'urban') {
        ctx.fillStyle = '#9b998c';
      } else {
        ctx.fillStyle = '#708558';
      }
      ctx.fillRect(px(b.minX + inner), pz(b.minZ + inner), len(b.maxX - b.minX - inner * 2), len(b.maxZ - b.minZ - inner * 2));
      // grass noise inside lot
      if (block.type !== 'downtown') {
        for (let n = 0; n < 90; n++) {
          const x = rng.range(b.minX + inner, b.maxX - inner);
          const z = rng.range(b.minZ + inner, b.maxZ - inner);
          ctx.fillStyle = rng.chance(0.5) ? 'rgba(90,112,67,.16)' : 'rgba(177,169,133,.10)';
          ctx.beginPath(); ctx.arc(px(x), pz(z), rng.range(1, 6), 0, TAU); ctx.fill();
        }
      }
      // curb line
      ctx.strokeStyle = '#dad4c4';
      ctx.lineWidth = len(0.18);
      ctx.strokeRect(px(b.minX + 0.25), pz(b.minZ + 0.25), len(b.maxX - b.minX - 0.5), len(b.maxZ - b.minZ - 0.5));
    }

    // crosswalks + lane lines
    for (const rx of ROAD_LINES) {
      for (const rz of ROAD_LINES) {
        // pedestrian crossings on all four approaches
        const edge = ROAD_WIDTH / 2 + 1.6;
        for (const side of [-1, 1]) {
          const cx = px(rx + side * edge);
          const cz = pz(rz);
          for (let s = -ROAD_WIDTH / 2 + 1; s < ROAD_WIDTH / 2 - 0.5; s += 1.35) {
            ctx.fillStyle = 'rgba(228,226,211,.82)';
            ctx.fillRect(cx - len(1.15) / 2, pz(rz + s), len(1.15), len(0.58));
          }
          const cx2 = px(rx);
          const cz2 = pz(rz + side * edge);
          for (let s = -ROAD_WIDTH / 2 + 1; s < ROAD_WIDTH / 2 - 0.5; s += 1.35) {
            ctx.fillStyle = 'rgba(228,226,211,.82)';
            ctx.fillRect(px(rx + s), cz2 - len(1.15) / 2, len(0.58), len(1.15));
          }
        }
      }
    }
    ctx.strokeStyle = 'rgba(238,223,139,.9)';
    ctx.lineWidth = len(0.16);
    ctx.setLineDash([len(2.4), len(3.2)]);
    for (const road of ROAD_LINES) {
      for (let a = -HALF_MAP; a < HALF_MAP; a += 74) {
        // vertical gaps at intersections
        ctx.beginPath();
        ctx.moveTo(px(road), pz(a + 10));
        ctx.lineTo(px(road), pz(a + 62));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(a + 10), pz(road));
        ctx.lineTo(px(a + 62), pz(road));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // white edge lines
    ctx.strokeStyle = 'rgba(224,222,209,.42)';
    ctx.lineWidth = len(0.23);
    for (const road of ROAD_LINES) {
      for (const off of [-ROAD_WIDTH / 2 + 0.9, ROAD_WIDTH / 2 - 0.9]) {
        ctx.beginPath(); ctx.moveTo(px(road + off), 0); ctx.lineTo(px(road + off), S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, pz(road + off)); ctx.lineTo(S, pz(road + off)); ctx.stroke();
      }
    }

    // lots: paths, parking, plazas
    for (const lot of this.lots) {
      if (lot.type === 'parking') {
        ctx.fillStyle = '#4c4f4d';
        ctx.fillRect(px(lot.cx - 11.5), pz(lot.cz - 11.5), len(23), len(23));
        ctx.strokeStyle = 'rgba(225,221,203,.55)';
        ctx.lineWidth = len(0.13);
        for (let k = -8; k <= 8; k += 4) {
          ctx.beginPath();
          ctx.moveTo(px(lot.cx + k), pz(lot.cz - 8)); ctx.lineTo(px(lot.cx + k), pz(lot.cz + 8));
          ctx.stroke();
        }
      }
      if (lot.type === 'house' && lot.building) {
        // lawn slightly darker / textured
        ctx.fillStyle = 'rgba(79,103,63,.30)';
        ctx.fillRect(px(lot.cx - 11.5), pz(lot.cz - 11.5), len(23), len(23));
      }
      if (lot.walkway) {
        const w = lot.walkway;
        ctx.strokeStyle = 'rgba(202,197,180,.9)';
        ctx.lineWidth = len(w.width);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px(w.x1), pz(w.z1)); ctx.lineTo(px(w.x2), pz(w.z2)); ctx.stroke();
      }
      if (lot.driveway) {
        const w = lot.driveway;
        ctx.strokeStyle = 'rgba(94,96,91,.82)';
        ctx.lineWidth = len(w.width);
        ctx.beginPath(); ctx.moveTo(px(w.x1), pz(w.z1)); ctx.lineTo(px(w.x2), pz(w.z2)); ctx.stroke();
      }
    }

    // Parks paths, ponds, plaza.
    for (const park of this.parks) {
      if (park.grand) {
        // ring path around fountain
        ctx.strokeStyle = 'rgba(202,190,155,.95)';
        ctx.lineWidth = len(3.4);
        ctx.beginPath(); ctx.arc(px(park.cx), pz(park.cz), len(12.5), 0, TAU); ctx.stroke();
        ctx.lineWidth = len(2.0);
        ctx.beginPath(); ctx.moveTo(px(park.cx - 26), pz(park.cz + 4)); ctx.lineTo(px(park.cx + 26), pz(park.cz + 4)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px(park.cx + 2), pz(park.cz - 26)); ctx.lineTo(px(park.cx + 2), pz(park.cz + 26)); ctx.stroke();
        // fountain water ring
        ctx.fillStyle = '#b8b09b';
        ctx.beginPath(); ctx.arc(px(park.fountain.x), pz(park.fountain.z), len(6.1), 0, TAU); ctx.fill();
        ctx.fillStyle = '#4f8a95';
        ctx.beginPath(); ctx.arc(px(park.fountain.x), pz(park.fountain.z), len(4.7), 0, TAU); ctx.fill();
        ctx.fillStyle = '#88c0c6';
        ctx.beginPath(); ctx.arc(px(park.fountain.x), pz(park.fountain.z), len(3.5), 0, TAU); ctx.fill();
      } else {
        if (park.pond) {
          ctx.fillStyle = '#526f51';
          ctx.beginPath(); ctx.ellipse(px(park.pond.x), pz(park.pond.z), len(park.pond.rx + 2.2), len(park.pond.rz + 2.2), 0.2, 0, TAU); ctx.fill();
          ctx.fillStyle = '#487e86';
          ctx.beginPath(); ctx.ellipse(px(park.pond.x), pz(park.pond.z), len(park.pond.rx), len(park.pond.rz), 0.2, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(139,190,188,.26)';
          ctx.beginPath(); ctx.ellipse(px(park.pond.x - 2), pz(park.pond.z - 1), len(park.pond.rx * .4), len(park.pond.rz * .16), .3, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(196,184,151,.9)';
        ctx.lineWidth = len(2.1);
        ctx.beginPath(); ctx.moveTo(px(park.cx - 24), pz(park.cz + 18)); ctx.quadraticCurveTo(px(park.cx), pz(park.cz), px(park.cx + 24), pz(park.cz - 18)); ctx.stroke();
        // little sports court
        if (park.playground) {
          ctx.fillStyle = 'rgba(113,122,106,.8)';
          ctx.fillRect(px(park.playground.x - 7), pz(park.playground.z - 5), len(14), len(10));
          ctx.strokeStyle = 'rgba(231,228,211,.8)';
          ctx.lineWidth = len(0.18);
          ctx.strokeRect(px(park.playground.x - 6.4), pz(park.playground.z - 4.4), len(12.8), len(8.8));
          ctx.beginPath(); ctx.moveTo(px(park.playground.x), pz(park.playground.z - 4.4)); ctx.lineTo(px(park.playground.x), pz(park.playground.z + 4.4)); ctx.stroke();
        }
      }
    }

    // asphalt cracks and sidewalk scars
    ctx.strokeStyle = 'rgba(24,27,27,.2)';
    for (let i = 0; i < 360; i++) {
      const x = rng.range(0, S), y = rng.range(0, S);
      ctx.lineWidth = rng.range(0.7, 2);
      ctx.beginPath();
      let cx = x, cy = y;
      ctx.moveTo(cx, cy);
      for (let n = 0; n < 3; n++) {
        cx += rng.range(-12, 12); cy += rng.range(-12, 12);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    // supply spots / manholes for visual interest
    for (let i = 0; i < 90; i++) {
      const x = rng.range(-HALF_MAP + 15, HALF_MAP - 15), z = rng.range(-HALF_MAP + 15, HALF_MAP - 15);
      ctx.strokeStyle = 'rgba(23,26,27,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(x), pz(z), len(0.45), 0, TAU); ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0.0 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.005;
    plane.receiveShadow = true;
    this.scene.add(plane);
    this.ground = plane;

    // ground beyond the city, so the world doesn't end visually
    const outer = new THREE.Mesh(
      new THREE.CircleGeometry(800, 64),
      new THREE.MeshStandardMaterial({ color: 0x596a48, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.06;
    this.scene.add(outer);
  }

  // ---------------------------------------------------------- static geometry
  _colorGeometry(geo, color, jitter = 0) {
    let g = geo;
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    const count = g.attributes.position.count;
    const arr = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    if (jitter) c.offsetHSL(0, 0, ((Math.random() * 2 - 1) * jitter));
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  _buildStaticGeometry() {
    const solid = [];
    const glass = [];
    const lit = [];
    const bulbs = [];

    const boxTmp = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const add = (bucket, geo, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, jitter = 0, baseMatrix = null) => {
      euler.set(rx, ry, rz);
      quat.setFromEuler(euler);
      pos.set(x, y, z);
      scale.set(sx, sy, sz);
      boxTmp.compose(pos, quat, scale);
      if (baseMatrix) boxTmp.premultiply(baseMatrix);
      geo.applyMatrix4(boxTmp);
      bucket.push(this._colorGeometry(geo, color, jitter));
    };
    const box = (x, y, z, w, h, d, color, ry = 0, rx = 0, rz = 0, jit = 0.0, base = null) =>
      add(solid, this._geoUnitBox.clone(), color, x, y, z, w, h, d, rx, ry, rz, jit, base);
    const glassBox = (x, y, z, w, h, d, color, ry = 0, rx = 0, rz = 0, base = null, isLit = false) =>
      add(isLit ? lit : glass, this._geoUnitBox.clone(), color, x, y, z, w, h, d, rx, ry, rz, 0, base);
    const cyl = (x, y, z, rt, rb, h, seg, color, rx = 0, ry = 0, rz = 0, jit = 0, base = null) => {
      const geo = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
      add(solid, geo, color, x, y, z, 1, 1, 1, rx, ry, rz, jit, base);
    };
    const sphere = (x, y, z, r, color, sx = 1, sy = 1, sz = 1, low = false, base = null) => {
      const geo = (low ? this._geoUnitSphereLow : this._geoUnitSphere).clone();
      add(solid, geo, color, x, y, z, r * sx, r * sy, r * sz, 0, 0, 0, 0, base);
    };

    // -------------------------------------------------------------- buildings
    const horizontalWindows = (baseMatrix, spec, y, side, count) => {
      const glassCol = choice(GLASS_COLORS);
      const span = side === 'front' || side === 'back' ? spec.w : spec.d;
      for (let c = 0; c < count; c++) {
        const fx = (c - (count - 1) / 2) * (span / count);
        if (side === 'front' || side === 'back') {
          const zz = (side === 'front' ? 1 : -1) * (spec.d / 2 + 0.035);
          const litWindow = Math.random() < 0.16;
          glassBox(fx, y, zz, 0.94, 1.08, 0.06,
            litWindow ? choice(LIT_COLORS) : glassCol, side === 'front' ? 0 : Math.PI, 0, 0, baseMatrix, litWindow);
          box(fx, y - 0.65, zz + (side === 'front' ? 0.02 : -0.02), 1.04, 0.08, 0.11, spec.trim, 0, 0, 0, 0, baseMatrix);
          box(fx, y + 0.57, zz + (side === 'front' ? 0.02 : -0.02), 1.02, 0.055, 0.09, spec.trim, 0, 0, 0, 0, baseMatrix);
        } else {
          const xx = (side === 'left' ? -1 : 1) * (spec.w / 2 + 0.035);
          const litWindow = Math.random() < 0.16;
          glassBox(xx, y, fx, 0.06, 1.08, 0.94,
            litWindow ? choice(LIT_COLORS) : glassCol, Math.PI / 2, 0, 0, baseMatrix, litWindow);
          box(xx, y - 0.65, fx, 0.11, 0.08, 1.04, spec.trim, 0, 0, 0, 0, baseMatrix);
          box(xx, y + 0.57, fx, 0.09, 0.055, 1.02, spec.trim, 0, 0, 0, 0, baseMatrix);
        }
      }
    };

    const buildingWindows = (spec, baseMatrix) => {
      const front = spec.front;
      const kind = spec.kind;
      const cols = Math.max(2, Math.floor((spec.w - 0.6) / 2.3));
      const colsSide = Math.max(2, Math.floor((spec.d - 0.8) / 2.5));
      const rows = spec.floors;
      const floorH = spec.height / Math.max(1, spec.floors);
      if (kind === 'house') {
        // front windows on each floor, door on the ground
        for (let fl = 0; fl < rows; fl++) {
          const y = 1.7 + fl * 2.85;
          const offs = kind === 'house' && fl === 0 ? [-spec.w * 0.27, spec.w * 0.29] : [-spec.w * 0.27, spec.w * 0.27];
          for (const ox of offs) {
            const isLit = Math.random() < 0.25;
            glassBox(ox, y, spec.d / 2 + 0.035, 1.05, 1.15, 0.07,
              isLit ? choice(LIT_COLORS) : choice(GLASS_COLORS), 0, 0, 0, baseMatrix, isLit);
            box(ox, y - 0.62, spec.d / 2 + 0.06, 1.25, 0.09, 0.13, 0xf0e9db, 0, 0, 0, 0, baseMatrix);
            // mullions
            box(ox, y, spec.d / 2 + 0.085, 0.075, 1.14, 0.04, 0xf1eadc, 0, 0, 0, 0, baseMatrix);
            box(ox, y, spec.d / 2 + 0.085, 1.02, 0.055, 0.04, 0xf1eadc, 0, 0, 0, 0, baseMatrix);
          }
          // side windows
          for (const side of [-1, 1]) {
            for (let c = 0; c < 2; c++) {
              const zz = (c - 0.5) * (spec.d * 0.35);
              glassBox(side * (spec.w / 2 + 0.035), y, zz, 0.06, 1.02, 0.88,
                Math.random() < 0.2 ? choice(LIT_COLORS) : choice(GLASS_COLORS), Math.PI / 2, 0, 0, baseMatrix, Math.random() < 0.18);
              box(side * (spec.w / 2 + 0.06), y - 0.58, zz, 0.13, 0.08, 1.04, 0xf0e9db, 0, 0, 0, 0, baseMatrix);
            }
          }
        }
      } else {
        // ground floor
        if (spec.shop || kind === 'tower' || spec.kind === 'urban') {
          for (let c = 0; c < Math.min(3, cols); c++) {
            const ox = (c - (Math.min(3, cols) - 1) / 2) * (spec.w / Math.min(3, cols));
            if (Math.abs(ox) < 1.25) continue; // door space
            glassBox(ox, 1.5, spec.d / 2 + 0.04, (spec.w / Math.min(3, cols)) * 0.7, 2.1, 0.07,
              choice(GLASS_COLORS), 0, 0, 0, baseMatrix, false);
            box(ox, 0.35, spec.d / 2 + 0.1, (spec.w / Math.min(3, cols)) * 0.74, 0.2, 0.16, 0x545b5c, 0, 0, 0, 0, baseMatrix);
          }
        }
        for (let fl = 1; fl < rows; fl++) {
          const y = fl * 3.25 + 1.35;
          horizontalWindows(baseMatrix, spec, y, 'front', cols);
          horizontalWindows(baseMatrix, spec, y, 'back', Math.max(2, cols - 1));
          horizontalWindows(baseMatrix, spec, y, 'left', colsSide);
          horizontalWindows(baseMatrix, spec, y, 'right', colsSide);
        }
      }
    };

    for (const spec of this.buildings) {
      if (spec.kind === 'rooftop') continue;
      const yaw = spec.yaw;
      const base = new THREE.Matrix4().makeRotationY(yaw);
      base.setPosition(spec.x, 0, spec.z);
      const w = spec.w, d = spec.d, h = spec.height;
      const frontOffset = spec.front ? 0 : 0;

      if (spec.kind === 'house') {
        const floorH = 2.85;
        const bodyH = spec.floors * floorH;
        // footpath/step
        box(spec.doorX, 0.11, d / 2 + 0.62, 2.0, 0.22, 0.9, 0xc5bdae, 0, 0, 0, 0, base);
        box(0, bodyH / 2 + 0.22, 0, w, bodyH, d, spec.wall, 0, 0, 0, 0, base);
        // siding lines
        for (let yy = 0.55; yy < bodyH; yy += 0.72) {
          box(0, yy + 0.12, 0.025, w + 0.03, 0.025, d + 0.05, 0x000000, 0, 0, 0, 0, base);
        }
        // roof
        const rh = 1.4 + (w - 8) * 0.18;
        const roofGeo = makeRoofGeometry(w + 0.9, rh, d + 0.9);
        add(solid, roofGeo, spec.roof, 0, bodyH + 0.22, 0, 1, 1, 1, 0, 0, 0, 0, base);
        box(0, bodyH + 0.24, 0, w + 0.2, 0.12, d + 0.2, 0xd7d1c3, 0, 0, 0, 0, base);
        // gable ends
        const tri = makeTriangleGeometry(w, rh * 0.92);
        const triGeo = this._colorGeometry(tri, spec.wall);
        // place on front and back by manually applying local matrices
        const m1 = new THREE.Matrix4().makeTranslation(0, bodyH + 0.2, d / 2 + 0.02);
        const g1 = triGeo.clone(); g1.applyMatrix4(m1); base && g1.applyMatrix4(base); solid.push(g1);
        const m2 = new THREE.Matrix4().makeTranslation(0, bodyH + 0.2, -d / 2 - 0.02);
        const m3 = new THREE.Matrix4().makeRotationY(Math.PI);
        const g2 = triGeo.clone(); g2.applyMatrix4(m3); g2.applyMatrix4(m2); base && g2.applyMatrix4(base); solid.push(g2);
        triGeo.dispose();
        if (spec.chimney) {
          box(w * 0.3, bodyH + rh * 0.65, -d * 0.24, 0.8, rh * 1.15, 0.8, 0x845a4e, 0, 0, 0, 0, base);
        }
        // porch roof
        if (spec.porch) {
          box(0, 2.62, d / 2 + 1.05, w * 0.52, 0.18, 2.5, spec.roof, 0, 0.08, 0, 0, base);
          for (const sx of [-1, 1]) box(sx * w * 0.2, 1.31, d / 2 + 2.2, 0.16, 2.55, 0.16, 0xe9e2d4, 0, 0, 0, 0, base);
          box(0, 0.09, d / 2 + 1.4, w * 0.54, 0.18, 1.2, 0xc9c0b0, 0, 0, 0, 0, base);
        }
        // door
        box(spec.doorX, 1.28, d / 2 + 0.055, 1.06, 2.2, 0.09, 0x594238, 0, 0, 0, 0, base);
        sphere(spec.doorX + 0.33, 1.18, d / 2 + 0.13, 0.055, 0xd9b96a, 1, 1, 1, false, base);
        // front shutters / eave
        box(spec.doorX, 2.45, d / 2 + 0.12, 1.5, 0.12, 0.22, spec.trim, 0, 0, 0, 0, base);
        buildingWindows(spec, base);
        // house awning over porch is enough, add front shrubs
      } else if (spec.kind === 'tower' || spec.kind === 'urban') {
        const bodyH = h;
        // podium for towers
        if (spec.kind === 'tower') {
          box(0, 2.2, 0, w + 1.6, 4.4, d + 1.6, 0xb8b2a4, 0, 0, 0, 0, base);
          box(0, 4.48, 0, w + 1.15, 0.28, d + 1.15, 0xb9a78e, 0, 0, 0, 0, base);
        }
        box(0, bodyH / 2, 0, w, bodyH, d, spec.wall, 0, 0, 0, 0, base);
        // vertical corner trims
        for (const sx of [-1, 1]) {
          box(sx * w / 2, bodyH / 2, d / 2 - 0.1, 0.38, bodyH, 0.38, spec.trim, 0, 0, 0, 0, base);
          box(sx * w / 2, bodyH / 2, -d / 2 + 0.1, 0.38, bodyH, 0.38, spec.trim, 0, 0, 0, 0, base);
        }
        // floor bands
        if (spec.floors >= 3) {
          for (let fl = 1; fl < spec.floors; fl++) {
            box(0, fl * (bodyH / spec.floors), 0, w + 0.08, 0.12, d + 0.08, spec.trim, 0, 0, 0, 0, base);
          }
        }
        // entrance
        box(0, 1.35, d / 2 + 0.05, 1.8, 2.7, 0.15, 0x4b5557, 0, 0, 0, 0, base);
        box(0, 2.78, d / 2 + 0.12, 2.35, 0.15, 0.4, spec.trim, 0, 0, 0, 0, base);
        // awning on shops
        if (spec.shop) {
          const aw = Math.min(w * 0.7, 8.2);
          for (let s = 0; s < 4; s++) {
            box((s - 1.5) * (aw / 4), 2.88, d / 2 + 0.86, aw / 4 - 0.03, 0.13, 1.68,
              s % 2 ? 0xe8e1d5 : 0xbd4f43, 0, -0.12, 0, 0, base);
          }
        }
        // rooftop parapet
        const ph = 0.8;
        box(0, bodyH + ph / 2, d / 2 - 0.18, w + 0.1, ph, 0.34, spec.trim, 0, 0, 0, 0, base);
        box(0, bodyH + ph / 2, -d / 2 + 0.18, w + 0.1, ph, 0.34, spec.trim, 0, 0, 0, 0, base);
        box(w / 2 - 0.18, bodyH + ph / 2, 0, 0.34, ph, d + 0.1, spec.trim, 0, 0, 0, 0, base);
        box(-w / 2 + 0.18, bodyH + ph / 2, 0, 0.34, ph, d + 0.1, spec.trim, 0, 0, 0, 0, base);
        // rooftop water tank / antenna
        const tankX = (w * 0.22), tankZ = -(d * 0.2);
        cyl(tankX, bodyH + 1.45, tankZ, 1.2, 1.3, 1.6, 8, 0x8f958f, 0, 0, 0, 0, base);
        box(tankX, bodyH + 0.54, tankZ, 2.2, 0.15, 2.2, 0x747d7d, 0, 0, 0, 0, base);
        if (spec.kind === 'tower') {
          box(-w * 0.22, bodyH + 1.15, d * 0.15, 2.0, 2.2, 2.0, 0x9ba3a0, 0, 0, 0, 0, base);
          cyl(w * 0.05, bodyH + 3.2, 0.1, 0.06, 0.12, 5.6, 5, 0xaeb1aa, 0, 0, 0, 0, base);
          box(w * 0.05, bodyH + 5.1, 0.1, 0.65, 0.08, 0.06, 0x4b5151, 0, 0, 0, 0, base);
        } else if (spec.floors >= 4) {
          box(-w * 0.22, bodyH + 0.75, -d * 0.1, 1.8, 1.5, 1.7, 0x9ba3a0, 0, 0, 0, 0, base);
        }
        // balconies
        if (spec.balcony) {
          for (let fl = 2; fl < Math.min(spec.floors, 5); fl += 2) {
            const y = fl * (bodyH / spec.floors) + 0.9;
            box(0, y, d / 2 + 0.5, w * 0.58, 0.12, 1.0, spec.trim, 0, 0, 0, 0, base);
            box(0, y + 0.4, d / 2 + 0.96, w * 0.58, 0.72, 0.08, 0x474e4f, 0, 0, 0, 0, base);
          }
        }
        buildingWindows(spec, base);
      } else if (spec.kind === 'rooftop') {
        box(0, spec.baseY + spec.height / 2, 0, spec.w, spec.height, spec.d, spec.wall, 0, 0, 0, 0, base);
        for (let n = 0; n < 4; n++) {
          box(0, spec.baseY + 0.05 + n * 0.24, spec.d / 2 + 0.01, spec.w, 0.07, spec.d, 0x5c6264, 0, 0, 0, 0, base);
        }
      }
    }

    // -------------------------------------------------------------- fences
    for (const f of this.fences) {
      this._buildFence(f, solid);
    }

    // ---------------------------------------------------------- benches/tables
    for (const b of this.benches) {
      if (!b) continue;
      const rot = new THREE.Matrix4().makeRotationY(b.yaw || 0);
      rot.setPosition(b.x, 0, b.z);
      for (let s = -1; s <= 1; s++) box(s * 0.45, 0.48, 0, 0.75, 0.09, 0.42, 0x8b684b, 0, 0, 0, 0, rot);
      box(0, 0.81, -0.2, 1.65, 0.3, 0.08, 0x8b684b, 0, 0, 0, 0, rot);
      for (const s of [-1, 1]) {
        box(s * 0.66, 0.28, 0, 0.09, 0.55, 0.4, 0x3e4343, 0, 0, 0, 0, rot);
        box(s * 0.66, 0.28, -0.18, 0.09, 0.55, 0.09, 0x3e4343, 0, 0, 0, 0, rot);
      }
    }

    // -------------------------------------------------------------- fountain
    if (this.fountain) {
      const f = this.fountain;
      cyl(f.x, 0.36, f.z, f.r, f.r + 0.2, 0.72, 24, 0xb7b09b);
      cyl(f.x, 0.55, f.z, f.r - 0.55, f.r - 0.45, 0.35, 24, 0x8fbdc1);
      cyl(f.x, 0.72, f.z, f.r - 0.9, f.r - 0.8, 0.08, 24, 0x85b7be);
      cyl(f.x, 1.35, f.z, 0.55, 0.9, 1.75, 8, 0xa9a18e);
      cyl(f.x, 2.25, f.z, 0.28, 0.4, 0.25, 8, 0x8fa5a4);
      sphere(f.x, 2.8, f.z, 0.5, 0xc6d4d1, 1, 1.2, 1, false);
      for (let n = 0; n < 6; n++) {
        const a = n / 6 * TAU;
        cyl(f.x + Math.cos(a) * 2.8, 2.0, f.z + Math.sin(a) * 2.8, 0.08, 0.08, 2.7, 5, 0x9ccdd0);
      }
    }

    // ----------------------------------------------------------- playgrounds
    if (this.playgrounds) {
      for (const p of this.playgrounds) {
        // swing frame
        for (const s of [-1, 1]) {
          box(p.x + s * 2.6, 1.45, p.z, 0.12, 2.9, 0.12, 0xd4b84c, 0, 0, 0, 0, null);
          box(p.x + s * 2.6, 1.45, p.z, 0.12, 2.9, 0.12, 0xd4b84c, 0, 0, 0.5, 0, null);
        }
        box(p.x, 2.91, p.z, 5.35, 0.11, 0.11, 0xd4b84c);
        for (const s of [-1, 1]) {
          box(p.x + s * 1.35, 2.25, p.z, 0.035, 1.35, 0.035, 0x555b5c);
          box(p.x + s * 1.35, 1.57, p.z, 0.75, 0.08, 0.35, 0x3c4343);
        }
        // slide
        box(p.x + 5.3, 0.6, p.z + 1.2, 2.4, 0.2, 2.0, 0xd45b45, 0, 0, -0.5);
        box(p.x + 3.75, 1.3, p.z + 1.2, 0.18, 2.6, 2.0, 0x4f87a0);
        box(p.x + 3.75, 2.62, p.z + 1.2, 1.3, 0.18, 2.0, 0xe4bf56);
        // seesaw
        box(p.x - 4.1, 0.6, p.z + 1.5, 3.2, 0.14, 0.3, 0x5e8c73, 0, 0, 0.16);
        cyl(p.x - 4.1, 0.22, p.z + 1.5, 0.16, 0.2, 0.44, 6, 0x60696a);
      }
    }

    // --------------------------------------------------------------- trees
    for (const t of this.trees) {
      if (t.bush) {
        const r = t.size * 1.75;
        sphere(t.x, r * 0.72, t.z, r, t.color, 1.15, 0.72, 1.15, true);
        if (t.flowers) {
          for (let n = 0; n < 5; n++) {
            const a = Math.random() * TAU, rr = Math.random() * r * 0.8;
            sphere(t.x + Math.cos(a) * rr, r * 0.82 + Math.random() * r * 0.4, t.z + Math.sin(a) * rr,
              0.11, Math.random() < 0.5 ? 0xf1dcc8 : 0xe9b0a0, 1, 1, 1, true);
          }
        }
        continue;
      }
      const s = t.size;
      cyl(t.x, 1.35 * s, t.z, 0.11 * s, 0.24 * s, 2.7 * s, 5, 0x66503b, 0, Math.random() * TAU, 0);
      const r = 1.55 * s;
      sphere(t.x, 3.2 * s, t.z, r * 1.1, t.color, 1.1, 1.0, 1.05, true);
      sphere(t.x - r * 0.55, 2.9 * s, t.z + r * 0.2, r * 0.7, t.color, 1, 1.1, 0.95, true);
      sphere(t.x + r * 0.5, 3.45 * s, t.z - r * 0.25, r * 0.68, t.color, 0.95, 1, 1, true);
    }

    // --------------------------------------------------------------- bushes by houses
    // (A few random hedges at the edges of house lots.)
    for (const lot of this.lots) {
      if (lot.type !== 'house') continue;
      const rng = this.rng;
      if (!rng.chance(0.5)) continue;
      const bx = lot.cx + lot.front[0] * 9.6 + lot.front[1] * 8.2;
      const bz = lot.cz + lot.front[1] * 9.6 - lot.front[0] * 8.2;
      sphere(bx, 0.55, bz, 0.62, 0x486a41, 1.5, 0.8, 1.1, true);
    }

    // ---------------------------------------------------------- parked cars
    for (const c of this.cars) this._buildCar(solid, glass, lit, c);

    // ---------------------------------------------------------- street lamps
    for (const l of this.streetlights) {
      this._buildStreetLight(solid, bulbs, l);
    }

    // -------------------------------------------------------------- skyline
    // Distant blocks seen through the haze.
    for (let i = 0; i < 54; i++) {
      const a = (i / 54) * TAU + this.rng.range(-0.03, 0.03);
      const r = this.rng.range(300, 600);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = this.rng.range(14, 42), d = this.rng.range(14, 42);
      const h = this.rng.range(12, 95);
      box(x, h / 2, z, w, h, d, this.rng.chance(0.5) ? 0x7c8c90 : 0x8c9697, this.rng.range(0, TAU));
    }

    // --------------------------------------------------------------- merge all
    const solidGeo = mergeGeometries(solid, false);
    const glassGeo = mergeGeometries(glass, false);
    const litGeo = mergeGeometries(lit, false);
    const bulbGeo = mergeGeometries(bulbs, false);
    const solidMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.015,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.16, metalness: 0.32,
      emissive: 0x17282d, emissiveIntensity: 0.55,
    });
    const litMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const addMesh = (geo, mat, cast, receive) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast; m.receiveShadow = receive;
      this.scene.add(m);
      return m;
    };
    this.cityMesh = addMesh(solidGeo, solidMat, true, true);
    this.glassMesh = addMesh(glassGeo, glassMat, false, true);
    this.litMesh = addMesh(litGeo, litMat, false, false);
    this.bulbMesh = addMesh(bulbGeo, bulbMat, false, false);
    for (const g of solid) g.dispose?.();
    solid.length = 0;
    for (const g of glass) g.dispose?.();
    for (const g of lit) g.dispose?.();
    for (const g of bulbs) g.dispose?.();

    // Signs are separate textured planes.
    for (const sign of this.signs) this._buildSign(sign);

    // A big rooftop billboard on the tallest downtown tower.
    const tower = this.buildings.find(b => b.kind === 'tower');
    if (tower) this._buildBillboard(tower.x, tower.z, '平静生活 · 文明街区', 0xc45b48, 0x2e383a, tower.height + 4.4, tower.yaw);
  }

  _buildFence(f, solid) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1;
    const length = Math.hypot(dx, dz);
    const count = Math.max(1, Math.floor(length / 0.62));
    const yaw = Math.atan2(dx, dz);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = f.x1 + dx * t, z = f.z1 + dz * t;
      const geo = this._geoUnitBox.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0.58, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        new THREE.Vector3(0.11, 1.16, 0.11),
      );
      geo.applyMatrix4(m);
      solid.push(this._colorGeometry(geo, 0xeee8d9));
    }
    for (const y of [0.45, 0.92]) {
      const geo = this._geoUnitBox.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((f.x1 + f.x2) / 2, y, (f.z1 + f.z2) / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        new THREE.Vector3(0.075, 0.08, length),
      );
      geo.applyMatrix4(m);
      solid.push(this._colorGeometry(geo, 0xeee8d9));
    }
  }

  _buildCar(solid, glass, lit, car) {
    const rot = new THREE.Matrix4().makeRotationY(car.yaw);
    rot.setPosition(car.x, 0, car.z);
    const isVan = car.type === 'van';
    const body = isVan ? 0xdedbd0 : car.color;
    const geo = this._geoUnitBox.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.54, 0), new THREE.Quaternion(),
      new THREE.Vector3(isVan ? 2.0 : 1.82, isVan ? 0.72 : 0.55, isVan ? 4.8 : 4.1),
    );
    geo.applyMatrix4(m); geo.applyMatrix4(rot);
    solid.push(this._colorGeometry(geo, body, 0.02));
    const cabinGeo = this._geoUnitBox.clone();
    const cm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, isVan ? 1.25 : 1.08, isVan ? -0.15 : -0.25),
      new THREE.Quaternion(),
      new THREE.Vector3(isVan ? 1.82 : 1.6, isVan ? 1.35 : 0.7, isVan ? 3.2 : 2.1),
    );
    cabinGeo.applyMatrix4(cm); cabinGeo.applyMatrix4(rot);
    solid.push(this._colorGeometry(cabinGeo, body, 0.02));
    // windows
    const gGeo = this._geoUnitBox.clone();
    const gm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, isVan ? 1.4 : 1.11, isVan ? 0.35 : 0.82),
      new THREE.Quaternion(),
      new THREE.Vector3(isVan ? 1.55 : 1.38, isVan ? 0.55 : 0.45, 0.06),
    );
    gGeo.applyMatrix4(gm); gGeo.applyMatrix4(rot);
    glass.push(this._colorGeometry(gGeo, 0x344c56));
    // wheels
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 8);
        const wm = new THREE.Matrix4().compose(
          new THREE.Vector3(sx * 0.86, 0.34, sz * (isVan ? 1.55 : 1.32)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
          new THREE.Vector3(1, 1, 1),
        );
        wheel.applyMatrix4(wm); wheel.applyMatrix4(rot);
        solid.push(this._colorGeometry(wheel, 0x1e2324));
      }
    }
    // head and tail lights
    for (const sx of [-1, 1]) {
      const l = this._geoUnitBox.clone();
      const lm = new THREE.Matrix4().compose(
        new THREE.Vector3(sx * 0.58, 0.65, (isVan ? 2.42 : 2.07)),
        new THREE.Quaternion(), new THREE.Vector3(0.34, 0.16, 0.05),
      );
      l.applyMatrix4(lm); l.applyMatrix4(rot);
      lit.push(this._colorGeometry(l, 0xffe6b0));
      const t = this._geoUnitBox.clone();
      const tm = new THREE.Matrix4().compose(
        new THREE.Vector3(sx * 0.58, 0.65, -(isVan ? 2.42 : 2.07)),
        new THREE.Quaternion(), new THREE.Vector3(0.3, 0.14, 0.05),
      );
      t.applyMatrix4(tm); t.applyMatrix4(rot);
      lit.push(this._colorGeometry(t, 0xa33b33));
    }
  }

  _buildStreetLight(solid, bulbs, light) {
    const [dx, dz] = light.dir;
    const yaw = Math.atan2(dx, dz);
    const base = new THREE.Matrix4().makeRotationY(yaw);
    base.setPosition(light.x, 0, light.z);
    const box = (x, y, z, w, h, d, color) => {
      const geo = this._geoUnitBox.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z), new THREE.Quaternion(),
        new THREE.Vector3(w, h, d),
      );
      geo.applyMatrix4(m); geo.applyMatrix4(base);
      solid.push(this._colorGeometry(geo, color));
    };
    box(0, 2.8, 0, 0.15, 5.6, 0.15, 0x4b5152);
    box(0, 5.56, 0.55, 0.13, 0.13, 1.35, 0x4b5152);
    box(0, 5.42, 1.15, 0.52, 0.2, 0.75, 0x31393b);
    const bulbGeo = this._geoUnitBox.clone();
    const bm = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 5.3, 1.15), new THREE.Quaternion(),
      new THREE.Vector3(0.34, 0.04, 0.52),
    );
    bulbGeo.applyMatrix4(bm); bulbGeo.applyMatrix4(base);
    bulbs.push(this._colorGeometry(bulbGeo, 0xffd191));
    // small base
    box(0, 0.18, 0, 0.3, 0.36, 0.3, 0x3c4243);
  }

  _buildSign(sign) {
    const spec = sign.spec;
    const key = sign.text + sign.bg;
    let mat = this._signMaterials.get(key);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = sign.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const light = sign.bg === '#f2eadb';
      ctx.strokeStyle = light ? '#303637' : 'rgba(255,239,205,.8)';
      ctx.lineWidth = 7;
      ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
      ctx.fillStyle = light ? '#303637' : '#fff1cf';
      ctx.font = '700 80px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sign.text, canvas.width / 2, 80);
      ctx.fillStyle = light ? 'rgba(48,54,55,.55)' : 'rgba(255,241,207,.55)';
      ctx.font = '500 20px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('NEIGHBOURHOOD  ·  EST. 1998', canvas.width / 2, 132);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this._signMaterials.set(key, mat);
    }
    const w = Math.min(spec.w * 0.55, 5.6);
    const h = w * 0.25;
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    const yaw = spec.yaw;
    const front = new THREE.Vector3(0, 0, spec.d / 2 + 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.position.set(spec.x + front.x, 3.45, spec.z + front.z);
    m.rotation.y = yaw;
    this.scene.add(m);
    // A projecting blade sign is more visually interesting from the side.
    if (Math.random() < 0.5) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.2, h * 1.6), mat);
      const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const front2 = new THREE.Vector3(0, 0, spec.d / 2 + 0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      blade.position.set(spec.x + front2.x + side.x * (spec.w * 0.35), 4.25, spec.z + front2.z + side.z * (spec.w * 0.35));
      blade.rotation.y = yaw + Math.PI / 2;
      this.scene.add(blade);
    }
  }

  _buildBillboard(x, z, text, bg, fg, baseY = 13.6, yaw = Math.PI) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 384;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = typeof bg === 'number' ? '#' + bg.toString(16).padStart(6, '0') : bg;
    ctx.fillRect(0, 0, 1024, 384);
    ctx.strokeStyle = 'rgba(255,244,217,.8)';
    ctx.lineWidth = 10; ctx.strokeRect(16, 16, 992, 352);
    ctx.fillStyle = '#fff4d9';
    ctx.textAlign = 'center';
    ctx.font = '800 104px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(text, 512, 198);
    ctx.font = '500 27px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,244,217,.68)';
    ctx.fillText('THE QUIET DISTRICT  ·  KEEP IT CALM', 512, 268);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), mat);
    m.position.set(x, baseY, z);
    m.rotation.y = yaw + Math.PI;
    this.scene.add(m);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b4243, roughness: 0.7 });
    const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const off of [-5.8, 5.8]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.4, 0.25), poleMat);
      pole.position.set(x + side.x * off, baseY - 3, z + side.z * off);
      pole.castShadow = true;
      this.scene.add(pole);
    }
  }

  // ---------------------------------------------------------------- boundary
  _buildBoundary() {
    const solid = [];
    const addBox = (x, y, z, w, h, d, color) => {
      const geo = this._geoUnitBox.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d),
      );
      geo.applyMatrix4(m);
      solid.push(this._colorGeometry(geo, color));
    };
    const fenceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35 });
    const seg = 7;
    for (let s = -HALF_MAP + 6; s <= HALF_MAP - 6; s += seg) {
      for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
        const x = axis === 'x' ? s : sign * (HALF_MAP - 7);
        const z = axis === 'z' ? s : sign * (HALF_MAP - 7);
        addBox(x, 0.7, z, axis === 'x' ? 0.08 : seg, 1.4, axis === 'z' ? 0.08 : seg, 0x283234);
        addBox(x, 1.2, z, axis === 'x' ? 0.06 : seg, 0.06, axis === 'z' ? 0.06 : seg, 0x8a958c);
        if (Math.round((s + HALF_MAP) / seg) % 3 === 0) {
          addBox(x, 1.45, z, 0.12, 2.9, 0.12, 0x3c4849);
        }
      }
    }
    const geo = mergeGeometries(solid, false);
    const mesh = new THREE.Mesh(geo, fenceMaterial);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    for (const g of solid) g.dispose?.();
    // Dense tree line outside the fence.
    const rng = new RNG(3719);
    for (let i = 0; i < 240; i++) {
      const side = rng.int(0, 3);
      const s = rng.range(-HALF_MAP, HALF_MAP);
      const d = rng.range(8, 35);
      let x = 0, z = 0;
      if (side === 0) { x = s; z = HALF_MAP + d; }
      if (side === 1) { x = s; z = -HALF_MAP - d; }
      if (side === 2) { x = HALF_MAP + d; z = s; }
      if (side === 3) { x = -HALF_MAP - d; z = s; }
      this._addDistantTree(x, z, rng.range(1.1, 2.2));
    }
    this._buildDistantForest();
  }

  _addDistantTree(x, z, s) {
    this._distantTrees = this._distantTrees || [];
    this._distantTrees.push({ x, z, s });
  }

  _buildDistantForest() {
    if (!this._distantTrees) return;
    const solid = [];
    for (const t of this._distantTrees) {
      const trunk = new THREE.CylinderGeometry(0.13 * t.s, 0.28 * t.s, 3 * t.s, 5);
      const tm = new THREE.Matrix4().makeTranslation(t.x, 1.5 * t.s, t.z);
      trunk.applyMatrix4(tm);
      solid.push(this._colorGeometry(trunk, 0x584737));
      for (let n = 0; n < 2; n++) {
        const geo = new THREE.IcosahedronGeometry(1, 0);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(t.x + (n ? 0.6 : -0.4) * t.s, (3.2 + n * 0.7) * t.s, t.z + (n ? -0.4 : 0.4) * t.s),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, n * 1.3, 0)),
          new THREE.Vector3(1.7 * t.s, 2.0 * t.s, 1.7 * t.s),
        );
        geo.applyMatrix4(m);
        solid.push(this._colorGeometry(geo, n ? 0x405a3e : 0x4e6d43));
      }
    }
    const geo = mergeGeometries(solid, false);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    for (const g of solid) g.dispose?.();
  }

  // -------------------------------------------------------------- sky/lights
  _buildSkyAndLights() {
    this.scene.fog = new THREE.Fog(0xd2dbd1, 175, 570);
    const skyGeo = new THREE.SphereGeometry(760, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x6ea7c7) },
        midColor: { value: new THREE.Color(0xd9e3da) },
        horizonColor: { value: new THREE.Color(0xf1d2ac) },
        sunDir: { value: new THREE.Vector3(-0.62, 0.34, -0.7).normalize() },
        sunColor: { value: new THREE.Color(0xffc27e) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 topColor; uniform vec3 midColor; uniform vec3 horizonColor;
        uniform vec3 sunDir; uniform vec3 sunColor;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(horizonColor, midColor, smoothstep(0.02, 0.34, h));
          col = mix(col, topColor, smoothstep(0.32, 0.92, h));
          float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 180.0);
          float glow = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 10.0);
          col += sunColor * sun * 3.0 + sunColor * glow * 0.22;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    const hemi = new THREE.HemisphereLight(0xc7dced, 0x9a8b6f, 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffddb5, 2.35);
    sun.position.set(-75, 110, -80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x9db8d1, 0.33);
    fill.position.set(100, 40, 80);
    this.scene.add(fill);

    // low-poly cloud sprites
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 256; cloudCanvas.height = 128;
    const cctx = cloudCanvas.getContext('2d');
    const cloudRng = new RNG(99);
    for (let i = 0; i < 15; i++) {
      const x = cloudRng.range(40, 216), y = cloudRng.range(55, 85), r = cloudRng.range(22, 52);
      const grd = cctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,250,238,.7)');
      grd.addColorStop(0.55, 'rgba(255,245,230,.4)');
      grd.addColorStop(1, 'rgba(255,240,220,0)');
      cctx.fillStyle = grd;
      cctx.beginPath(); cctx.arc(x, y, r, 0, TAU); cctx.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, depthWrite: false, opacity: 0.55, fog: false,
    });
    this.clouds = [];
    const crng = new RNG(8481);
    for (let i = 0; i < 13; i++) {
      const sp = new THREE.Sprite(cloudMat);
      const a = crng.range(0, TAU);
      const r = crng.range(120, 500);
      sp.position.set(Math.cos(a) * r, crng.range(100, 170), Math.sin(a) * r);
      const s = crng.range(90, 210);
      sp.scale.set(s, s * 0.45, 1);
      sp.userData.speed = crng.range(0.5, 1.2);
      this.scene.add(sp);
      this.clouds.push(sp);
    }
    // sun disc sprite
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 256; sunCanvas.height = 256;
    const sctx = sunCanvas.getContext('2d');
    const sg = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sg.addColorStop(0, 'rgba(255,238,195,1)');
    sg.addColorStop(0.18, 'rgba(255,211,145,.9)');
    sg.addColorStop(0.55, 'rgba(255,179,111,.20)');
    sg.addColorStop(1, 'rgba(255,160,100,0)');
    sctx.fillStyle = sg; sctx.fillRect(0, 0, 256, 256);
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      opacity: 0.9, fog: false,
    }));
    sunSprite.position.set(-420, 190, -500);
    sunSprite.scale.set(150, 150, 1);
    this.scene.add(sunSprite);
  }

  // --------------------------------------------------------------- spawn data
  _buildSpawnPoints() {
    const rng = new RNG(481516);
    // Dense sidewalk points around every block, offset into the footpath.
    for (const block of this.blocks) {
      const ext = BLOCK_HALF - 2.4;
      const step = 3.2;
      for (let s = -ext; s <= ext; s += step) {
        const offsets = [
          { x: s, z: -ext }, { x: s, z: ext }, { x: -ext, z: s }, { x: ext, z: s },
        ];
        for (const o of offsets) {
          if (rng.chance(0.32)) continue;
          const x = block.cx + o.x + rng.range(-0.35, 0.35);
          const z = block.cz + o.z + rng.range(-0.35, 0.35);
          if (this._pointBlocked(x, z, 0.42)) continue;
          this.sidewalkPoints.push({ x, z });
        }
      }
    }
    // Road spawn points for responders and their vehicles.
    for (const road of ROAD_LINES) {
      for (let s = -HALF_MAP + 18; s <= HALF_MAP - 18; s += 11) {
        if (ROAD_LINES.some(r => Math.abs(s - r) < 14)) continue;
        for (const off of [-4.2, 4.2]) {
          this.roadSpawnPoints.push({ x: road + off, z: s, yaw: 0 });
          this.roadSpawnPoints.push({ x: s, z: road + off, yaw: Math.PI / 2 });
        }
      }
    }
    // Guarantee a generous crowd around the starting block.
    this.sidewalkPoints.sort((a, b) => Math.abs(a.x) + Math.abs(a.z) - Math.abs(b.x) - Math.abs(b.z));
  }

  _pointBlocked(x, z, pad = 0) {
    for (const c of this.colliders) {
      if (pointInAABB2D(x, z, c, pad)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ minimap
  _buildMinimap() {
    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    const px = v => ((v + HALF_MAP) / MAP_SIZE) * S;
    const len = v => (v / MAP_SIZE) * S;
    ctx.fillStyle = '#11191b';
    ctx.fillRect(0, 0, S, S);
    // blocks
    for (const block of this.blocks) {
      const b = block.bounds;
      ctx.fillStyle = block.type === 'park' ? '#243d2c' : '#232d2d';
      ctx.fillRect(px(b.minX), px(b.minZ), len(b.maxX - b.minX), len(b.maxZ - b.minZ));
      ctx.strokeStyle = '#394644';
      ctx.lineWidth = 2;
      ctx.strokeRect(px(b.minX), px(b.minZ), len(b.maxX - b.minX), len(b.maxZ - b.minZ));
    }
    // roads
    ctx.strokeStyle = '#4c5958';
    ctx.lineWidth = len(ROAD_WIDTH);
    for (const road of ROAD_LINES) {
      ctx.beginPath(); ctx.moveTo(px(road), 0); ctx.lineTo(px(road), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, px(road)); ctx.lineTo(S, px(road)); ctx.stroke();
    }
    // lane hint
    ctx.strokeStyle = 'rgba(207,193,143,.25)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 10]);
    for (const road of ROAD_LINES) {
      ctx.beginPath(); ctx.moveTo(px(road), 0); ctx.lineTo(px(road), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, px(road)); ctx.lineTo(S, px(road)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // buildings
    for (const b of this._minimapBuildings) {
      ctx.fillStyle = '#121b1c';
      ctx.fillRect(px(b.minX), px(b.minZ), len(b.maxX - b.minX), len(b.maxZ - b.minZ));
      ctx.strokeStyle = 'rgba(138,156,148,.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px(b.minX), px(b.minZ), len(b.maxX - b.minX), len(b.maxZ - b.minZ));
    }
    // parks
    for (const p of this.parks) {
      ctx.fillStyle = 'rgba(65,101,61,.65)';
      ctx.fillRect(px(p.minX + 4), px(p.minZ + 4), len(p.maxX - p.minX - 8), len(p.maxZ - p.minZ - 8));
    }
    // border
    ctx.strokeStyle = '#65736b';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, S - 12, S - 12);
    this.minimapCanvas = canvas;
    this.minimapScale = S / MAP_SIZE;
  }

  // --------------------------------------------------------------- navigation
  _buildNavGrid() {
    this.navCell = 2.4;
    this.navN = Math.ceil(MAP_SIZE / this.navCell);
    this.navBlocked = new Uint8Array(this.navN * this.navN);
    this.navDist = new Int32Array(this.navN * this.navN);
    this.navQueue = new Int32Array(this.navN * this.navN);
    this.navDist.fill(-1);
    const pad = 0.5;
    for (let gz = 0; gz < this.navN; gz++) {
      for (let gx = 0; gx < this.navN; gx++) {
        const x = (gx + 0.5) * this.navCell - HALF_MAP;
        const z = (gz + 0.5) * this.navCell - HALF_MAP;
        let blocked = Math.abs(x) > WALK_LIMIT - 1.2 || Math.abs(z) > WALK_LIMIT - 1.2;
        if (!blocked) {
          for (const c of this.colliders) {
            if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) {
              blocked = true; break;
            }
          }
        }
        this.navBlocked[gz * this.navN + gx] = blocked ? 1 : 0;
      }
    }
    this.flowX = 0; this.flowZ = 0;
    this.flowDirty = true;
    this.flowTimer = 0;
  }

  _nearestOpenCell(gx, gz) {
    if (gx >= 0 && gz >= 0 && gx < this.navN && gz < this.navN && !this.navBlocked[gz * this.navN + gx]) {
      return gz * this.navN + gx;
    }
    for (let r = 1; r <= 14; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = gx + dx, z = gz + dz;
          if (x < 0 || z < 0 || x >= this.navN || z >= this.navN) continue;
          const idx = z * this.navN + x;
          if (!this.navBlocked[idx]) return idx;
        }
      }
    }
    return -1;
  }

  updateFlowField(px, pz, force = false) {
    const gx = Math.floor((px + HALF_MAP) / this.navCell);
    const gz = Math.floor((pz + HALF_MAP) / this.navCell);
    if (!force && !this.flowDirty && this.flowTimer < 0.85 && Math.hypot(px - this.flowX, pz - this.flowZ) < 3) {
      return;
    }
    this.flowDirty = false;
    this.flowTimer = 0;
    this.flowX = px; this.flowZ = pz;
    const start = this._nearestOpenCell(gx, gz);
    const dist = this.navDist;
    dist.fill(-1);
    if (start < 0) return;
    const q = this.navQueue;
    let head = 0, tail = 0;
    q[tail++] = start;
    dist[start] = 0;
    const n = this.navN;
    while (head < tail) {
      const idx = q[head++];
      const d = dist[idx] + 1;
      const x = idx % n, z = (idx / n) | 0;
      if (x > 0) {
        const ni = idx - 1;
        if (dist[ni] < 0 && !this.navBlocked[ni]) { dist[ni] = d; q[tail++] = ni; }
      }
      if (x < n - 1) {
        const ni = idx + 1;
        if (dist[ni] < 0 && !this.navBlocked[ni]) { dist[ni] = d; q[tail++] = ni; }
      }
      if (z > 0) {
        const ni = idx - n;
        if (dist[ni] < 0 && !this.navBlocked[ni]) { dist[ni] = d; q[tail++] = ni; }
      }
      if (z < n - 1) {
        const ni = idx + n;
        if (dist[ni] < 0 && !this.navBlocked[ni]) { dist[ni] = d; q[tail++] = ni; }
      }
    }
  }

  getFlowDirection(x, z, out) {
    const n = this.navN;
    const gx = clamp(Math.floor((x + HALF_MAP) / this.navCell), 0, n - 1);
    const gz = clamp(Math.floor((z + HALF_MAP) / this.navCell), 0, n - 1);
    const idx = gz * n + gx;
    let best = idx, bestD = this.navDist[idx] >= 0 ? this.navDist[idx] : Infinity;
    const options = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    for (const [dx, dz] of options) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (this.navBlocked[nz * n + nx]) continue;
      if (dx && dz) {
        if (this.navBlocked[gz * n + nx] || this.navBlocked[nz * n + gx]) continue;
      }
      const d = this.navDist[nz * n + nx];
      if (d >= 0 && d < bestD) { bestD = d; best = nz * n + nx; }
    }
    if (best === idx || !isFinite(bestD)) return false;
    const bx = (best % n + 0.5) * this.navCell - HALF_MAP;
    const bz = (((best / n) | 0) + 0.5) * this.navCell - HALF_MAP;
    const dx = bx - x, dz = bz - z;
    const len = Math.hypot(dx, dz) || 1;
    out.set(dx / len, 0, dz / len);
    return true;
  }

  // ----------------------------------------------------------------- geometry
  update(dt, playerPos) {
    this.time += dt;
    this.flowTimer += dt;
    if (this.sun && playerPos) {
      const sx = playerPos.x - 75, sz = playerPos.z - 80;
      this.sun.position.set(sx, 110, sz);
      this.sun.target.position.set(playerPos.x, 0, playerPos.z);
      this.sun.target.updateMatrixWorld();
    }
    if (this.clouds) {
      for (const c of this.clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 560) c.position.x = -560;
      }
    }
  }

  // ------------------------------------------------------------------ helpers
  collideCircle(pos, radius) {
    const lim = WALK_LIMIT;
    pos.x = clamp(pos.x, -lim, lim);
    pos.z = clamp(pos.z, -lim, lim);
    for (const c of this.colliders) {
      if (pos.x + radius < c.minX || pos.x - radius > c.maxX || pos.z + radius < c.minZ || pos.z - radius > c.maxZ) continue;
      const closestX = clamp(pos.x, c.minX, c.maxX);
      const closestZ = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - closestX, dz = pos.z - closestZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += dx / d * (radius - d);
          pos.z += dz / d * (radius - d);
        } else {
          const l = pos.x - c.minX, r = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z;
          const m = Math.min(l, r, t, b);
          if (m === l) pos.x = c.minX - radius;
          else if (m === r) pos.x = c.maxX + radius;
          else if (m === t) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
  }

  hasLineOfSight(ax, az, bx, bz) {
    for (const c of this.colliders) {
      if (c.height < 1.0) continue;
      if (Math.abs(c.minX - bx) > 200) continue;
      if (segmentIntersectsAABB2D(ax, az, bx, bz, c, 0.06)) {
        // A low fountain isn't high enough to hide behind from eye level.
        if (c.type === 'fountain') continue;
        return false;
      }
    }
    return true;
  }

  groundHeightAt(x, z) {
    let h = 0;
    for (const c of this.colliders) {
      if (!c.supportTop) continue;
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) h = Math.max(h, c.height);
    }
    return h;
  }

  cameraCollision(origin, target, padding = 0.25) {
    // Return a point along origin->target that doesn't clip geometry or ground.
    const dir = new THREE.Vector3().subVectors(target, origin);
    const dist = dir.length();
    if (dist < 0.001) return target;
    dir.normalize();
    let nearest = dist;
    for (const c of this.colliders) {
      if (c.type === 'fountain') continue;
      const min = new THREE.Vector3(c.minX - padding, 0.12, c.minZ - padding);
      const max = new THREE.Vector3(c.maxX + padding, c.height + padding, c.maxZ + padding);
      const t = segmentAABB(origin, dir, min, max, nearest);
      if (t !== null && t > 0) nearest = Math.min(nearest, t - 0.05);
    }
    // Keep the camera above ground.
    if (dir.y < -0.001) {
      const tGround = (0.35 - origin.y) / dir.y;
      if (tGround > 0) nearest = Math.min(nearest, tGround);
    }
    nearest = Math.max(0.6, nearest);
    return new THREE.Vector3().copy(origin).addScaledVector(dir, nearest);
  }

  pickHuman(origin, dir, maxDist, humans, includeDead = false) {
    let bestHit = null;
    const head = new THREE.Vector3();
    const body = new THREE.Vector3();
    const lower = new THREE.Vector3();
    for (const h of humans) {
      if (!includeDead && h.dead) continue;
      if (h.removed) continue;
      h.getHeadPosition(head);
      const ox = head.x - origin.x, oz = head.z - origin.z;
      if (ox * ox + oz * oz > maxDist * maxDist) continue;
      // Head sphere plus two torso/leg spheres give the little people a usable
      // full-height hitbox without needing a physics engine.
      const down = (h.state === 'dead' || h.state === 'sleep' || h.state === 'downed' || h.grabbed);
      let tHead, tUpper, tLower;
      if (down) {
        h.getBodyCenter(body);
        tHead = raySphere(origin, dir, body, 0.34 * h.scale);
        tUpper = -1;
        tLower = -1;
      } else {
        tHead = raySphere(origin, dir, head, 0.235 * h.scale);
        const base = h.root.position;
        body.set(base.x, base.y + 1.16 * h.scale, base.z);
        lower.set(base.x, base.y + 0.58 * h.scale, base.z);
        tUpper = raySphere(origin, dir, body, 0.43 * h.scale);
        tLower = raySphere(origin, dir, lower, 0.3 * h.scale);
      }
      let t = -1, part = null;
      if (tHead >= 0 && (t < 0 || tHead < t)) { t = tHead; part = 'head'; }
      if (tUpper >= 0 && (t < 0 || tUpper < t)) { t = tUpper; part = 'body'; }
      if (tLower >= 0 && (t < 0 || tLower < t)) { t = tLower; part = 'body'; }
      if (t < 0 || t > maxDist) continue;
      if (bestHit && t >= bestHit.dist) continue;
      const point = new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
      if (this.isOccluded(origin, point)) continue;
      bestHit = { human: h, dist: t, part, point };
    }
    return bestHit;
  }

  isOccluded(origin, point) {
    const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.001) return false;
    for (const c of this.colliders) {
      if (c.type === 'fountain') continue;
      const dir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
      const min = new THREE.Vector3(c.minX, 0.12, c.minZ);
      const max = new THREE.Vector3(c.maxX, c.height, c.maxZ);
      const t = segmentAABB(origin, dir, min, max, dist);
      if (t !== null && t < dist - 0.15) return true;
    }
    return false;
  }

  raycastStatic(origin, dir, maxDist) {
    let best = maxDist;
    let hitNormal = new THREE.Vector3(0, 1, 0);
    for (const c of this.colliders) {
      if (c.type === 'fountain') continue;
      const min = new THREE.Vector3(c.minX, 0.05, c.minZ);
      const max = new THREE.Vector3(c.maxX, c.height, c.maxZ);
      const t = segmentAABB(origin, dir, min, max, best);
      if (t !== null && t >= 0 && t < best) {
        best = t;
        hitNormal.set(0, 1, 0);
      }
    }
    // ground
    if (dir.y < -0.0001) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < best) { best = t; hitNormal.set(0, 1, 0); }
    }
    if (best < maxDist) {
      return { dist: best, point: new THREE.Vector3(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best), normal: hitNormal };
    }
    // sky/far point
    return { dist: maxDist, point: new THREE.Vector3(origin.x + dir.x * maxDist, origin.y + dir.y * maxDist, origin.z + dir.z * maxDist), normal: hitNormal };
  }

  getRandomSidewalkPoint(minDist = 0, maxDist = Infinity, fromX = 0, fromZ = 0) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = this.sidewalkPoints[(Math.random() * this.sidewalkPoints.length) | 0];
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d >= minDist && d <= maxDist) return p;
    }
    for (const p of this.sidewalkPoints) {
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d >= minDist && d <= maxDist) return p;
    }
    return this.sidewalkPoints[0];
  }

  getRoadSpawn(minDist, maxDist, fromX, fromZ) {
    const valid = [];
    for (const p of this.roadSpawnPoints) {
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d >= minDist && d <= maxDist) valid.push(p);
    }
    if (!valid.length) {
      for (const p of this.roadSpawnPoints) {
        const d = Math.hypot(p.x - fromX, p.z - fromZ);
        if (d >= 35 && d <= 160) valid.push(p);
      }
    }
    if (!valid.length) return this.roadSpawnPoints[0];
    return valid[(Math.random() * valid.length) | 0];
  }

  getSupplySpots() { return this.supplySpots; }

  spawnPlayerPoint() {
    return this.startPos.clone();
  }

  _buildClickables() { /* reserved for future use */ }
}

export { card };
