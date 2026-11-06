import * as THREE from 'three';
import { clamp, rand, chance } from './utils.js';

const MAX_BLOOD = 560;
const MAX_DUST = 320;
const MAX_SPARKS = 260;
const MAX_TRACERS = 90;
const MAX_POOLS = 170;

function makeSplatTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 54);
  grd.addColorStop(0, 'rgba(120,12,12,.92)');
  grd.addColorStop(0.5, 'rgba(105,9,9,.55)');
  grd.addColorStop(1, 'rgba(85,4,4,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.random() * 41;
    const rr = 2 + Math.random() * 9;
    ctx.fillStyle = `rgba(${70 + Math.random() * 45},3,3,${0.28 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMuzzleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,236,1)');
  grd.addColorStop(0.16, 'rgba(255,230,151,.96)');
  grd.addColorStop(0.44, 'rgba(255,151,55,.55)');
  grd.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,236,174,.8)';
  for (let i = 0; i < 5; i++) {
    ctx.rotate(Math.PI * 2 / 5);
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(0, -74); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(232,235,230,.72)');
  grd.addColorStop(.35, 'rgba(215,220,214,.58)');
  grd.addColorStop(.72, 'rgba(185,193,188,.24)');
  grd.addColorStop(1, 'rgba(160,170,166,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 40;
    const rr = 7 + Math.random() * 20;
    ctx.fillStyle = `rgba(208,213,207,${.05 + Math.random() * .09})`;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class ParticlePool {
  constructor(scene, geometry, material, max, gravity = 18, drag = 0.99) {
    this.scene = scene;
    this.gravity = gravity;
    this.drag = drag;
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 3;
    this.scene.add(this.mesh);
    this.particles = [];
    this.cursor = 0;
    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._color = new THREE.Color();
    // Hide all initially.
    for (let i = 0; i < max; i++) {
      this._matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(config) {
    const p = {
      x: config.x, y: config.y, z: config.z,
      vx: config.vx || 0, vy: config.vy || 0, vz: config.vz || 0,
      life: config.life || 0.8, maxLife: config.life || 0.8,
      size: config.size || 0.05, sx: config.sx || 1, sy: config.sy || 1, sz: config.sz || 1,
      color: config.color || 0xffffff,
      gravity: config.gravity ?? this.gravity,
      rotation: Math.random() * Math.PI,
      spin: rand(-8, 8),
      floor: config.floor ?? 0.03,
    };
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.particles[idx]) this.particles[idx] = p;
    else this.particles[idx] = p;
    this.mesh.setColorAt(idx, this._color.setHex(p.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    // Reset all transient effects for a clean restart.
    for (const pool of [this.blood, this.dust, this.sparks]) {
      pool.particles = [];
      pool.cursor = 0;
      for (let i = 0; i < pool.max; i++) {
        pool._matrix.makeScale(0, 0, 0);
        pool.mesh.setMatrixAt(i, pool._matrix);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const t of this.tracers) t.active = false;
    this.tracerPositions.fill(0);
    this.tracerColors.fill(0);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
    for (const e of this.explosions) {
      this.scene.remove(e.group);
      e.sphereMat.dispose(); e.ringMat.dispose();
    }
    this.explosions.length = 0;
    for (let i = 0; i < MAX_POOLS; i++) {
      this.poolMat4.makeScale(0, 0, 0);
      this.poolMesh.setMatrixAt(i, this.poolMat4);
    }
    this.poolMesh.instanceMatrix.needsUpdate = true;
    this.poolCursor = 0;
    for (const entry of this.flashSprites) { entry.sprite.visible = false; entry.life = 0; }
    this.flashLight.intensity = 0;
    this.explosionLight.intensity = 0;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this._matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._matrix);
        this.particles[i] = null;
        dirty = true;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= this.drag; p.vz *= this.drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy *= -0.18;
        p.vx *= 0.4; p.vz *= 0.4;
        p.life = Math.min(p.life, 0.18);
      }
      p.rotation += p.spin * dt;
      const t = p.life / p.maxLife;
      const fade = t > 0.7 ? 1 : t / 0.7;
      this._pos.set(p.x, p.y, p.z);
      this._quat.setFromEuler(new THREE.Euler(p.rotation, p.rotation * 0.7, 0));
      this._scale.set(p.size * p.sx * fade, p.size * p.sy * fade, p.size * p.sz * fade);
      this._matrix.compose(this._pos, this._quat, this._scale);
      this.mesh.setMatrixAt(i, this._matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.time = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._color = new THREE.Color();

    this.blood = new ParticlePool(
      scene,
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_BLOOD, 22, 0.985,
    );
    this.dust = new ParticlePool(
      scene,
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24, depthWrite: false }),
      MAX_DUST, 4.5, 0.94,
    );
    this.sparks = new ParticlePool(
      scene,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX_SPARKS, 15, 0.985,
    );

    this.tracerPositions = new Float32Array(MAX_TRACERS * 6);
    this.tracerColors = new Float32Array(MAX_TRACERS * 6);
    this.tracers = new Array(MAX_TRACERS).fill(null).map(() => ({ active: false, life: 0, maxLife: 0.1, a: new THREE.Vector3(), b: new THREE.Vector3(), color: 0xffd28a }));
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.tracerLines.frustumCulled = false;
    this.scene.add(this.tracerLines);

    // Blood pools on the ground.
    this.splatTex = makeSplatTexture();
    this.poolMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.splatTex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
      MAX_POOLS,
    );
    this.poolMesh.frustumCulled = false;
    this.poolMesh.renderOrder = 2;
    this.poolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.poolMesh);
    this.poolCursor = 0;
    this.poolMat4 = new THREE.Matrix4();
    this.poolQuat = new THREE.Quaternion();
    this.poolScale = new THREE.Vector3();
    this.poolPos = new THREE.Vector3();
    this.poolColor = new THREE.Color();
    for (let i = 0; i < MAX_POOLS; i++) {
      this.poolMat4.makeScale(0, 0, 0);
      this.poolMesh.setMatrixAt(i, this.poolMat4);
      this.poolMesh.setColorAt(i, this.poolColor.setHex(0x7a0808));
    }
    this.poolMesh.instanceMatrix.needsUpdate = true;
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true;

    // Muzzle flashes
    this.flashTex = makeMuzzleTexture();
    this.flashSprites = [];
    this.flashMat = new THREE.SpriteMaterial({
      map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, opacity: 0.9,
    });
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(this.flashMat.clone());
      sp.visible = false;
      sp.frustumCulled = false;
      this.scene.add(sp);
      this.flashSprites.push({ sprite: sp, life: 0, maxLife: 0.06, baseScale: 1 });
    }
    this.flashCursor = 0;
    this.flashLight = new THREE.PointLight(0xffb468, 0, 10, 2);
    this.scene.add(this.flashLight);
    this.flashLightLife = 0;
    this.explosionLight = new THREE.PointLight(0xff8a45, 0, 24, 2);
    this.scene.add(this.explosionLight);
    this.explosionLightLife = 0;

    this.explosions = [];
    this.smokeSphere = new THREE.IcosahedronGeometry(1, 1);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    this.smokeTexture = makeSmokeTexture();
    this.game = game;
  }

  createSmokeCloud(position, radius = 6.5) {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    const material = new THREE.SpriteMaterial({
      map: this.smokeTexture, color: 0xd6ddd7, transparent: true, opacity: 0.0,
      depthWrite: false, depthTest: true, fog: true,
    });
    const puffs = [];
    const count = 30;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * radius * 0.72;
      const base = new THREE.Vector3(Math.cos(a) * r, rand(0.4, 3.9), Math.sin(a) * r);
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(base);
      const s = rand(2.2, 4.8);
      sprite.scale.set(s, s, 1);
      sprite.renderOrder = 2;
      group.add(sprite);
      puffs.push({
        sprite, base, phase: rand(0, Math.PI * 2),
        drift: new THREE.Vector3(rand(-0.22, 0.22), rand(0.1, 0.36), rand(-0.22, 0.22)),
        baseScale: s,
      });
    }
    this.scene.add(group);
    return {
      group, material, puffs, radius,
      age: 0,
      life: 12,
      update(dt) {
        this.age += dt;
        const fadeIn = clamp(this.age / 0.9, 0, 1);
        const fadeOut = clamp((this.life - this.age) / 2.0, 0, 1);
        material.opacity = 0.34 * fadeIn * fadeOut;
        for (const p of puffs) {
          p.sprite.position.set(
            p.base.x + p.drift.x * this.age + Math.sin(this.age * 0.5 + p.phase) * 0.22,
            p.base.y + p.drift.y * this.age,
            p.base.z + p.drift.z * this.age + Math.cos(this.age * 0.43 + p.phase) * 0.22,
          );
          const grow = 1 + this.age * 0.045;
          p.sprite.scale.set(p.baseScale * grow, p.baseScale * grow, 1);
        }
      },
      dispose() {
        group.parent?.remove(group);
        material.dispose();
      },
    };
  }

  bloodBurst(point, direction, intensity = 1, opts = {}) {
    if (opts.armor) {
      this.armorSpark(point, direction);
      return;
    }
    const count = Math.min(28, Math.floor(7 + intensity * 8));
    const colors = [0x6f0808, 0x8e1010, 0xa41616, 0x5c0505, 0x7d1a13];
    for (let i = 0; i < count; i++) {
      const spread = intensity * 2.6;
      const speed = rand(1.2, 5.2) * Math.min(2.2, 0.65 + intensity * 0.55);
      const vx = (direction?.x || 0) * speed * 0.7 + rand(-spread, spread);
      const vy = rand(0.4, 3.8) * Math.min(2, 0.5 + intensity * 0.65);
      const vz = (direction?.z || 0) * speed * 0.7 + rand(-spread, spread);
      this.blood.spawn({
        x: point.x + rand(-0.12, 0.12), y: point.y + rand(-0.12, 0.12), z: point.z + rand(-0.12, 0.12),
        vx, vy, vz, life: rand(0.45, 1.1), size: rand(0.025, 0.08) * (0.8 + intensity * 0.25),
        color: colors[(Math.random() * colors.length) | 0], gravity: 19, floor: 0.04,
      });
    }
  }

  armorSpark(point, direction) {
    for (let i = 0; i < 10; i++) {
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: rand(-3.6, 3.6) - (direction?.x || 0) * 1.2,
        vy: rand(0.5, 3.2),
        vz: rand(-3.6, 3.6) - (direction?.z || 0) * 1.2,
        life: rand(0.14, 0.36), size: rand(0.015, 0.04),
        color: chance(0.45) ? 0xfff0b8 : 0xffb35f, gravity: 16, floor: 0.04,
      });
    }
    this.game.audio?.play('armor', { volume: 0.35, pan: 0 });
  }

  bloodDrip(x, y, z) {
    this.blood.spawn({
      x: x + rand(-0.14, 0.14), y, z: z + rand(-0.14, 0.14),
      vx: rand(-0.2, 0.2), vy: rand(0.1, 0.6), vz: rand(-0.2, 0.2),
      life: rand(0.5, 1.2), size: rand(0.018, 0.04), color: 0x7a0a0a, gravity: 17,
    });
  }

  bloodPool(x, y, z, scale = 1) {
    const i = this.poolCursor;
    this.poolCursor = (this.poolCursor + 1) % MAX_POOLS;
    const size = clamp(0.55 + scale * rand(0.4, 1.15), 0.55, 2.4);
    this.poolPos.set(x + rand(-0.18, 0.18), y + 0.018, z + rand(-0.18, 0.18));
    this.poolQuat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rand(0, Math.PI * 2)));
    this.poolScale.set(size, size * rand(0.75, 1.15), size);
    this.poolMat4.compose(this.poolPos, this.poolQuat, this.poolScale);
    this.poolMesh.setMatrixAt(i, this.poolMat4);
    this.poolColor.setHSL(0.0, rand(0.55, 0.8), rand(0.13, 0.23));
    this.poolMesh.setColorAt(i, this.poolColor);
    this.poolMesh.instanceMatrix.needsUpdate = true;
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true;
  }

  dustBurst(point, count = 6, colors = [0x8e836f, 0xa69a83, 0x6d6558]) {
    for (let i = 0; i < count; i++) {
      this.dust.spawn({
        x: point.x + rand(-0.25, 0.25), y: point.y + rand(-0.15, 0.25), z: point.z + rand(-0.25, 0.25),
        vx: rand(-1.5, 1.5), vy: rand(0.2, 1.8), vz: rand(-1.5, 1.5),
        life: rand(0.35, 1.0), size: rand(0.08, 0.28), sx: 1.4, sy: 1, sz: 1.1,
        color: colors[(Math.random() * colors.length) | 0], gravity: 2.4, floor: 0.02,
      });
    }
  }

  impact(point, normal, material = 'concrete') {
    const col = material === 'metal' ? [0x9ca29c, 0x6f7473] : [0xa0927b, 0x8a806f, 0xb1a691];
    for (let i = 0; i < 5; i++) {
      this.dust.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: (normal?.x || 0) * rand(0.8, 2.6) + rand(-1.2, 1.2),
        vy: (normal?.y || 0.4) * rand(0.8, 2.2) + rand(0.1, 1.4),
        vz: (normal?.z || 0) * rand(0.8, 2.6) + rand(-1.2, 1.2),
        life: rand(0.2, 0.55), size: rand(0.05, 0.16), color: col[(Math.random() * col.length) | 0],
        gravity: 4, floor: 0.02,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: (normal?.x || 0) * rand(0.6, 2) + rand(-2.4, 2.4),
        vy: (normal?.y || 0.6) * rand(0.8, 2.4) + rand(0.3, 2.2),
        vz: (normal?.z || 0) * rand(0.6, 2) + rand(-2.4, 2.4),
        life: rand(0.1, 0.32), size: rand(0.015, 0.035),
        color: chance(0.5) ? 0xffdb91 : 0xffa85c, gravity: 13, floor: 0.02,
      });
    }
  }

  sleepPuff(point) {
    for (let i = 0; i < 8; i++) {
      this.dust.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: rand(-0.8, 0.8), vy: rand(0.2, 1.2), vz: rand(-0.8, 0.8),
        life: rand(0.3, 0.8), size: rand(0.05, 0.16),
        color: chance(0.6) ? 0x9fd6c4 : 0xc9e1cc, gravity: 1.2, floor: 0.02,
      });
    }
  }

  tracer(start, end, options = {}) {
    let slot = this.tracers.find(t => !t.active);
    if (!slot) slot = this.tracers[(Math.random() * MAX_TRACERS) | 0];
    slot.active = true;
    slot.life = options.life || 0.085;
    slot.maxLife = slot.life;
    slot.a.copy(start);
    slot.b.copy(end);
    slot.color = options.color || 0xffd38a;
  }

  muzzleFlash(position, options = {}) {
    const entry = this.flashSprites[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashSprites.length;
    const sp = entry.sprite;
    sp.position.copy(position);
    sp.visible = true;
    sp.material.opacity = 0.95;
    sp.material.rotation = Math.random() * Math.PI * 2;
    const s = options.scale || rand(0.5, 0.9);
    sp.scale.set(s, s, 1);
    entry.life = options.life || 0.055;
    entry.maxLife = entry.life;
    entry.baseScale = s;
    entry.isPlayer = !!options.player;
    if (options.player) {
      this.flashLight.position.copy(position);
      this.flashLight.intensity = options.light || 5.5;
      this.flashLightLife = 0.08;
    }
  }

  explosion(position, radius = 7) {
    // fireball
    const group = new THREE.Group();
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xff9a45, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sphere = new THREE.Mesh(this.smokeSphere, sphereMat);
    sphere.position.copy(position);
    sphere.scale.setScalar(0.5);
    group.add(sphere);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd187, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    ring.position.y = 0.08;
    ring.scale.setScalar(0.9);
    group.add(ring);
    this.scene.add(group);
    this.explosions.push({ group, sphere, ring, sphereMat, ringMat, age: 0, life: 0.85, radius });
    // smoke/dust/sparks
    for (let i = 0; i < 22; i++) {
      this.dust.spawn({
        x: position.x + rand(-1.2, 1.2), y: position.y + rand(-0.2, 1.2), z: position.z + rand(-1.2, 1.2),
        vx: rand(-4, 4), vy: rand(0.2, 3), vz: rand(-4, 4),
        life: rand(0.7, 1.8), size: rand(0.28, 0.8), sx: 1.3, sy: 1, sz: 1.2,
        color: [0x3c3a35, 0x585249, 0x766b5b][(Math.random() * 3) | 0],
        gravity: 1.5, floor: 0.02,
      });
    }
    for (let i = 0; i < 28; i++) {
      this.sparks.spawn({
        x: position.x, y: position.y + 0.2, z: position.z,
        vx: rand(-13, 13), vy: rand(3, 13), vz: rand(-13, 13),
        life: rand(0.3, 0.85), size: rand(0.03, 0.08),
        color: [0xffc55f, 0xff8a31, 0xffefad][(Math.random() * 3) | 0],
        gravity: 18, floor: 0.05,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.blood.spawn({
        x: position.x, y: position.y + 0.4, z: position.z,
        vx: rand(-8, 8), vy: rand(2, 8), vz: rand(-8, 8),
        life: rand(0.5, 1.1), size: rand(0.04, 0.1), color: 0x5e0606, gravity: 20, floor: 0.03,
      });
    }
    this.explosionLight.position.copy(position);
    this.explosionLight.intensity = 16;
    this.explosionLightLife = 0.24;
    this.dustBurst(position, 12);
  }

  update(dt) {
    this.time += dt;
    this.blood.update(dt);
    this.dust.update(dt);
    this.sparks.update(dt);

    // tracers
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) {
        this.tracerPositions.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        this.tracerPositions.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      this.tracerPositions[i * 6] = t.a.x;
      this.tracerPositions[i * 6 + 1] = t.a.y;
      this.tracerPositions[i * 6 + 2] = t.a.z;
      this.tracerPositions[i * 6 + 3] = t.b.x;
      this.tracerPositions[i * 6 + 4] = t.b.y;
      this.tracerPositions[i * 6 + 5] = t.b.z;
      const k = t.life / t.maxLife;
      const c = this._color.setHex(t.color).multiplyScalar(Math.max(0.05, k));
      for (let v = 0; v < 2; v++) {
        this.tracerColors[i * 6 + v * 3] = c.r;
        this.tracerColors[i * 6 + v * 3 + 1] = c.g;
        this.tracerColors[i * 6 + v * 3 + 2] = c.b;
      }
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;

    // flashes
    for (const entry of this.flashSprites) {
      if (!entry.sprite.visible) continue;
      entry.life -= dt;
      if (entry.life <= 0) { entry.sprite.visible = false; continue; }
      const k = entry.life / entry.maxLife;
      entry.sprite.material.opacity = k * 0.95;
      const s = entry.baseScale * (0.75 + (1 - k) * 0.6);
      entry.sprite.scale.set(s, s, 1);
    }
    if (this.flashLightLife > 0) {
      this.flashLightLife -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLightLife / 0.08) * 5.5;
    }
    if (this.explosionLightLife > 0) {
      this.explosionLightLife -= dt;
      this.explosionLight.intensity = Math.max(0, this.explosionLightLife / 0.24) * 16;
    }

    // explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.age += dt;
      const t = e.age / e.life;
      if (t >= 1) {
        this.scene.remove(e.group);
        e.sphereMat.dispose(); e.ringMat.dispose();
        this.explosions.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - t, 3);
      e.sphere.scale.setScalar(0.4 + ease * e.radius * 0.72);
      e.sphereMat.opacity = 0.82 * (1 - t);
      e.ring.scale.setScalar(0.8 + ease * e.radius * 1.25);
      e.ringMat.opacity = 0.62 * (1 - t) ** 1.6;
      e.ring.rotation.z += dt * 0.35;
      e.sphere.position.y = 0.3 + ease * 0.8;
    }
  }
}
