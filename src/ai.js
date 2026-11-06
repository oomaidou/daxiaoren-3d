import * as THREE from 'three';
import { WEAPONS, buildWeaponModel } from './weapons.js';
import { clamp, damp, dampAngle, rand, chance, choose, raySphere, TAU } from './utils.js';

export const RESPONDER_PARAMS = {
  police: {
    label: '警察', speed: 3.35, weaponId: 'policePistol', score: 280,
    damage: 8, range: 46, preferred: [12, 30], spread: 0.68, aimTime: 0.28,
    cooldown: 0.62, burst: 1, burstGap: 0.1, mag: 15, reload: 1.55,
    knifeDamage: 15, armor: 10, lootWeapons: ['policePistol', 'knife'],
    audio: 'enemyPistol', tracer: 0xff9a6b,
  },
  swat: {
    label: '特警', speed: 3.75, weaponId: 'smg', score: 430,
    damage: 5.1, range: 58, preferred: [8, 23], spread: 0.9, aimTime: 0.18,
    cooldown: 1.35, burst: 5, burstGap: 0.075, mag: 30, reload: 1.8,
    knifeDamage: 17, armor: 10, lootWeapons: ['smg', 'knife'],
    audio: 'enemySmg', tracer: 0xffa370,
  },
  militarySniper: {
    label: '军方狙击手', speed: 2.85, weaponId: 'sniper', score: 760,
    damage: 36, range: 115, preferred: [28, 64], spread: 0.18, aimTime: 1.18,
    cooldown: 2.15, burst: 1, burstGap: 0.1, mag: 5, reload: 2.65,
    knifeDamage: 22, armor: 10, lootWeapons: ['sniper', 'knife'],
    audio: 'enemySniper', tracer: 0xffd39d, laser: true,
  },
  militarySMG: {
    label: '军方突击手', speed: 3.55, weaponId: 'smg', score: 650,
    damage: 6.2, range: 66, preferred: [10, 28], spread: 0.75, aimTime: 0.2,
    cooldown: 1.15, burst: 6, burstGap: 0.07, mag: 30, reload: 1.65,
    knifeDamage: 23, armor: 10, lootWeapons: ['smg', 'knife'],
    audio: 'enemySmg', tracer: 0xffb377,
  },
};

function makePanic() {
  return {
    target: null, timer: rand(1, 5), idle: 0, speed: rand(1.1, 1.9),
    panic: 0, stuck: 0, lastX: 0, lastZ: 0, soundCd: rand(1, 6),
  };
}

function randomSidewalkNear(world, x, z, minD, maxD) {
  for (let i = 0; i < 25; i++) {
    const p = world.sidewalkPoints[(Math.random() * world.sidewalkPoints.length) | 0];
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= minD && d <= maxD && world.hasLineOfSight(x, z, p.x, p.z)) return p;
  }
  return null;
}

export class CivilianAI {
  constructor(game, human) {
    this.game = game;
    this.human = human;
    this.world = game.world;
    this.state = makePanic();
    this.radius = 0.34;
    this._dir = new THREE.Vector3();
    this._candidate = new THREE.Vector3();
    this.tempVec = new THREE.Vector3();
    human.ai = this;
    this.curSpeed = 0;
  }

  update(dt) {
    const h = this.human;
    if (!h.canAct() || h.thrownMode) {
      h.setLocomotion(0, false, false);
      return;
    }
    const s = this.state;
    const px = this.game.player.root.position.x;
    const pz = this.game.player.root.position.z;
    const dx = h.root.position.x - px;
    const dz = h.root.position.z - pz;
    const dist = Math.hypot(dx, dz);
    const recentlyShot = this.game.time - this.game.lastGunshotTime < 5.0;
    const alarm = recentlyShot && dist < 82;
    const dangerClose = this.game.player && !this.game.player.dead && dist < 13 && this.game.wanted > 0;
    if (alarm || dangerClose) {
      s.panic = Math.max(s.panic, alarm ? 5.5 : 3.0);
    }
    s.panic = Math.max(0, s.panic - dt);
    s.soundCd -= dt;

    if (s.panic > 0) {
      if (s.soundCd <= 0) {
        s.soundCd = rand(2.6, 6.5);
        this.game.audio?.play('panic', {
          volume: clamp(0.5 - dist / 150, 0.09, 0.5),
          pan: this.game.audio.panFor(h.root.position) || 0,
        });
      }
      // Run away from the player with a tangential swerve.
      let ax = dx / (dist || 1), az = dz / (dist || 1);
      const side = Math.sin(this.game.time * 0.8 + h.id) * 0.5;
      ax += -az * side;
      az += ax * side * 0.4;
      const desired = this.avoidWalls(ax, az, h.root.position.x, h.root.position.z);
      const hurtPenalty = h.hp < 40 ? 0.68 : 1;
      this.curSpeed = damp(this.curSpeed, (4.55 + (h.type === 'civilian' ? clamp(0.6 - h.scale * 0.4, 0, 0.3) : 0)) * hurtPenalty, 7, dt);
      const nx = h.root.position.x + desired.x * this.curSpeed * dt;
      const nz = h.root.position.z + desired.z * this.curSpeed * dt;
      const p = this.tempVec.set(nx, 0, nz);
      this.world.collideCircle(p, this.radius);
      h.root.position.x = p.x;
      h.root.position.z = p.z;
      h.root.position.y = 0;
      h.setFacing(Math.atan2(desired.x, desired.z));
      h.setLocomotion(this.curSpeed, true, true);
      this.bobFootstep(dt);
      return;
    }

    // Wander / idle.
    s.timer -= dt;
    if (s.idle > 0) {
      s.idle -= dt;
      this.curSpeed = damp(this.curSpeed, 0, 6, dt);
      h.setLocomotion(0, false, false);
      if (s.idle <= 0) {
        s.timer = rand(1, 4);
        s.target = null;
      }
      return;
    }
    if (!s.target || s.timer <= 0 || Math.hypot(s.target.x - h.root.position.x, s.target.z - h.root.position.z) < 1.4) {
      if (chance(0.2)) {
        s.idle = rand(0.8, 3.8);
      }
      s.timer = rand(6, 13);
      s.target = randomSidewalkNear(this.world, h.root.position.x, h.root.position.z, 4, 23);
      if (!s.target) s.target = { x: h.root.position.x + rand(-8, 8), z: h.root.position.z + rand(-8, 8) };
    }
    if (!s.target) {
      h.setLocomotion(0, false, false);
      return;
    }
    let ax = s.target.x - h.root.position.x;
    let az = s.target.z - h.root.position.z;
    const d = Math.hypot(ax, az) || 1;
    ax /= d; az /= d;
    const desired = this.avoidWalls(ax, az, h.root.position.x, h.root.position.z);
    this.curSpeed = damp(this.curSpeed, Math.min(s.speed, 1.55) * (h.hp < 40 ? 0.66 : 1), 5, dt);
    const nx = h.root.position.x + desired.x * this.curSpeed * dt;
    const nz = h.root.position.z + desired.z * this.curSpeed * dt;
    const p = this.tempVec.set(nx, 0, nz);
    this.world.collideCircle(p, this.radius);
    if (Math.hypot(p.x - h.root.position.x, p.z - h.root.position.z) < this.curSpeed * dt * 0.25) {
      s.stuck += dt;
      if (s.stuck > 0.8) { s.target = null; s.stuck = 0; }
    } else s.stuck = 0;
    h.root.position.x = p.x;
    h.root.position.z = p.z;
    h.root.position.y = 0;
    h.setFacing(Math.atan2(desired.x, desired.z));
    h.setLocomotion(this.curSpeed, false, true);
    this.bobFootstep(dt);
  }

  avoidWalls(dx, dz, x, z) {
    const angles = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4];
    const out = this._dir;
    const base = Math.atan2(dx, dz);
    const step = 1.2;
    for (const a of angles) {
      const ang = base + a;
      const nx = x + Math.sin(ang) * step;
      const nz = z + Math.cos(ang) * step;
      const p = this._candidate.set(nx, 0, nz);
      this.world.collideCircle(p, 0.38);
      if (Math.hypot(p.x - nx, p.z - nz) < 0.08) {
        out.set(Math.sin(ang), 0, Math.cos(ang));
        return out;
      }
    }
    out.set(dx, 0, dz);
    return out;
  }

  bobFootstep(dt) {
    this.game.audio?.footstepNear(this.human, this.curSpeed, dt);
  }
}

export class ResponderAI {
  constructor(game, human, type = 'police') {
    this.game = game;
    this.human = human;
    this.world = game.world;
    this.type = type;
    this.params = RESPONDER_PARAMS[type] || RESPONDER_PARAMS.police;
    this.clip = this.params.mag;
    this.reloadTimer = 0;
    this.fireCooldown = rand(0.5, 1.4);
    this.burstLeft = 0;
    this.burstGap = 0;
    this.aimTimer = 0;
    this.strafe = chance(0.5) ? 1 : -1;
    this.strafeTimer = rand(1.2, 2.6);
    this.radius = 0.37;
    this.currentVisualWeapon = this.params.weaponId;
    human.setWeapon(this.params.weaponId);
    this.los = false;
    this.losTimer = 0;
    this.meleeMode = false;
    this.stuckTimer = 0;
    this.lastX = human.root.position.x;
    this.lastZ = human.root.position.z;
    this.temp = new THREE.Vector3();
    this.temp2 = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    this.playerCenter = new THREE.Vector3();
    this.movingSpeed = 0;
    this.spotTimer = 0;
    this.alertDelay = rand(0.1, 0.55);
    this.footTimer = 0;
    this.laser = null;
    if (this.params.laser) this.makeLaser();
    human.ai = this;
  }

  makeLaser() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(0, 0, 1),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xff4a38, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.laser = new THREE.Line(geo, mat);
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    this.game.scene.add(this.laser);
  }

  update(dt) {
    const h = this.human;
    const game = this.game;
    if (!h.canAct() || game.player.dead) {
      h.setLocomotion(0, false, false);
      h.setAiming(false);
      this.hideLaser();
      return;
    }
    this.alertDelay -= dt;
    if (this.alertDelay > 0) {
      h.setLocomotion(0, false, false);
      h.setAiming(false);
      this.hideLaser();
      return;
    }
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      h.setAiming(false);
      this.hideLaser();
      // Reloading soldiers back away slowly if the player is close.
      this.move(dt, this.dirFromPlayer(-1, 0), this.params.speed * 0.35);
      if (this.reloadTimer <= 0) {
        this.clip = this.params.mag;
        this.fireCooldown = 0.25;
      }
      return;
    }
    const player = game.player;
    const target = player.root.position;
    player.getBodyCenter(this.playerCenter);
    const dx = target.x - h.root.position.x;
    const dz = target.z - h.root.position.z;
    const dist = Math.hypot(dx, dz);
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.13;
      this.los = this.world.hasLineOfSight(h.root.position.x, h.root.position.z, target.x, target.z) &&
        !game.isSmokeBlocked(h.root.position.x, h.root.position.z, target.x, target.z);
    }
    const p = this.params;
    this.fireCooldown -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(1.2, 2.8);
      if (chance(0.4)) this.strafe *= -1;
    }

    // Melee if extremely close.
    const wantMelee = this.los && dist < 3.15;
    if (wantMelee !== this.meleeMode) {
      this.meleeMode = wantMelee;
      if (wantMelee) {
        h.setWeapon('knife');
        this.currentVisualWeapon = 'knife';
        this.aimTimer = 0;
      } else {
        h.setWeapon(p.weaponId);
        this.currentVisualWeapon = p.weaponId;
      }
    }

    if (this.meleeMode) {
      h.setAiming(false);
      this.hideLaser();
      h.setFacing(Math.atan2(dx, dz));
      if (dist > 2.0) {
        this.moveTowards(dt, target.x, target.z, p.speed * 1.15, this.los);
      } else {
        h.setLocomotion(0, false, false);
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 1.08;
          h.playMeleeSwing?.(0.34);
          game.audio?.play('knife', { volume: 0.65, pan: game.audio.panFor(h.root.position) });
          game.audio?.play('playerHurt', { volume: 0.35 });
          game.damagePlayer(p.knifeDamage, {
            source: 'melee', ignoreArmor: true, hitPart: 'body',
            point: player.getBodyCenter(), dir: new THREE.Vector3(-dx, 0, -dz).normalize(),
            from: h,
          });
        }
      }
      this.updateLaserForSniper();
      return;
    }

    const inRange = dist <= p.range;
    const tooClose = dist < p.preferred[0] - 0.5;
    const tooFar = dist > p.preferred[1];
    let movingX = 0, movingZ = 0;
    let speed = 0;

    if (this.los && inRange) {
      // Hold a fire position, strafe and keep preferred distance.
      h.setAiming(true);
      if (tooClose) {
        const back = this.dirFromPlayer(-1, 0);
        movingX = back.x; movingZ = back.z; speed = p.speed * 0.8;
      } else if (tooFar) {
        const fwd = this.dirFromPlayer(1, 0);
        movingX = fwd.x; movingZ = fwd.z; speed = p.speed * 0.72;
      } else {
        const side = this.dirFromPlayer(0, this.strafe);
        movingX = side.x; movingZ = side.z; speed = p.speed * 0.27;
      }
      h.setFacing(Math.atan2(dx, dz));
      this.aimTimer += dt;
      if (p.laser) {
        const aimProgress = clamp(this.aimTimer / p.aimTime, 0, 1);
        this.showLaser(aimProgress);
      }
      if (this.aimTimer >= p.aimTime && this.fireCooldown <= 0) {
        this.fireWeapon(dist);
      }
    } else {
      h.setAiming(false);
      this.aimTimer = Math.max(0, this.aimTimer - dt * 2);
      this.hideLaser();
      if (!this.los) {
        // Follow the crowd-flow field around buildings.
        const flow = this.world.getFlowDirection(h.root.position.x, h.root.position.z, this.dir);
        if (flow) {
          movingX = this.dir.x; movingZ = this.dir.z;
        } else {
          const f = this.dirFromPlayer(1, 0);
          movingX = f.x; movingZ = f.z;
        }
        speed = p.speed;
        h.setFacing(Math.atan2(movingX, movingZ));
      } else if (tooFar) {
        const f = this.dirFromPlayer(1, 0);
        movingX = f.x; movingZ = f.z;
        speed = p.speed;
        h.setFacing(Math.atan2(dx, dz));
      } else {
        h.setFacing(Math.atan2(dx, dz));
        this.aimTimer += dt;
        if (p.laser) this.showLaser(clamp(this.aimTimer / p.aimTime, 0, 1));
        if (this.aimTimer >= p.aimTime && this.fireCooldown <= 0 && dist <= p.range) this.fireWeapon(dist);
      }
    }

    // Separation so the squad doesn't stack into a single block of armour.
    if (speed > 0) {
      const sep = this.separation();
      movingX += sep.x * 0.5;
      movingZ += sep.z * 0.5;
      const l = Math.hypot(movingX, movingZ);
      if (l > 0.001) { movingX /= l; movingZ /= l; }
      this.temp.set(movingX, 0, movingZ);
      this.move(dt, this.temp, speed);
      h.setLocomotion(speed * clamp(l, 0.2, 1), false, true);
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = 0.42;
        game.audio?.footstepNear(h, speed, 1);
      }
    } else {
      h.setLocomotion(0, false, false);
    }

    // If stuck against a wall, nudge sideways using the flow field.
    const traveled = Math.hypot(h.root.position.x - this.lastX, h.root.position.z - this.lastZ);
    if (speed > 1 && traveled < speed * dt * 0.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.45) {
        const flow = this.world.getFlowDirection(h.root.position.x, h.root.position.z, this.dir);
        if (flow) this.move(dt, this.dir, p.speed);
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = 0;
    this.lastX = h.root.position.x;
    this.lastZ = h.root.position.z;
    this.spotTimer += dt;
    this.burstGap -= dt;
  }

  dirFromPlayer(forward, side) {
    const p = this.human.root.position;
    const t = this.game.player.root.position;
    let dx = t.x - p.x, dz = t.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    if (forward === 0) return this.temp2.set(-dz * side, 0, dx * side);
    return this.temp2.set(dx * forward - dz * side * 0.65, 0, dz * forward + dx * side * 0.65).normalize();
  }

  separation() {
    const out = new THREE.Vector3();
    const p = this.human.root.position;
    for (const other of this.game.responders) {
      if (other === this) continue;
      const dx = p.x - other.human.root.position.x;
      const dz = p.z - other.human.root.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 9 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        out.x += dx / d * (1 - d / 3) * 0.7;
        out.z += dz / d * (1 - d / 3) * 0.7;
      }
    }
    return out;
  }

  move(dt, dir, speed) {
    if (speed < 0.01) return;
    const h = this.human;
    if (h.hp < 40) speed *= 0.78;
    const nx = h.root.position.x + dir.x * speed * dt;
    const nz = h.root.position.z + dir.z * speed * dt;
    this.temp.set(nx, 0, nz);
    this.world.collideCircle(this.temp, this.radius);
    h.root.position.x = this.temp.x;
    h.root.position.z = this.temp.z;
    h.root.position.y = 0;
    this.movingSpeed = speed;
  }

  moveTowards(dt, tx, tz, speed, los) {
    const h = this.human;
    let dx = tx - h.root.position.x, dz = tz - h.root.position.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    if (!los) {
      const flow = this.world.getFlowDirection(h.root.position.x, h.root.position.z, this.dir);
      if (flow) { dx = this.dir.x; dz = this.dir.z; }
    }
    const dir = this.temp2.set(dx, 0, dz);
    this.move(dt, dir, speed);
    h.setFacing(Math.atan2(dx, dz));
    h.setLocomotion(speed, false, true);
    h.setAiming(false);
  }

  fireWeapon(dist) {
    const h = this.human;
    const p = this.params;
    if (this.clip <= 0) {
      this.reloadTimer = p.reload;
      this.clip = 0;
      h.setAiming(false);
      this.hideLaser();
      return;
    }
    if (this.burstLeft <= 0) this.burstLeft = p.burst;
    this.clip--;
    this.burstLeft--;
    this.burstGap = p.burstGap;
    if (this.burstLeft <= 0) {
      this.fireCooldown = p.cooldown;
      this.burstLeft = 0;
    } else {
      this.fireCooldown = p.burstGap;
    }
    this.aimTimer = 0;

    const player = this.game.player;
    const err = p.spread * (0.7 + dist / 42) * (1 + Math.min(0.8, player.getHorizontalSpeed?.() * 0.07 || 0));
    const target = this.playerCenter;
    const aimX = target.x + rand(-err, err);
    const aimZ = target.z + rand(-err, err);
    const aimY = target.y + rand(-0.25, 0.45);
    this.aimPoint.set(aimX, aimY, aimZ);
    h.getMuzzlePosition(this.muzzle);
    const rawDir = new THREE.Vector3().subVectors(this.aimPoint, this.muzzle);
    const len = rawDir.length();
    if (len < 0.05) return;
    rawDir.normalize();
    const range = p.range + 22;
    const wall = this.world.raycastStatic(this.muzzle, rawDir, range);
    let end = wall.point;
    let hitPlayer = false;
    let hitPart = 'body';
    const head = player.getHeadPosition(new THREE.Vector3());
    const body = player.getBodyCenter(new THREE.Vector3());
    const tHead = raySphere(this.muzzle, rawDir, head, 0.22 * player.scale);
    const tBody = raySphere(this.muzzle, rawDir, body, 0.44 * player.scale);
    let t = Infinity;
    if (tHead >= 0 && tHead < t) { t = tHead; hitPart = 'head'; }
    if (tBody >= 0 && tBody < t) { t = tBody; hitPart = 'body'; }
    if (isFinite(t) && t < wall.dist + 0.1 && t <= range) {
      hitPlayer = true;
      end = new THREE.Vector3().copy(this.muzzle).addScaledVector(rawDir, t);
      const finalDamage = p.damage * (hitPart === 'head' ? 1.45 : 1);
      this.game.damagePlayer(finalDamage, {
        source: 'bullet', point: end, dir: rawDir, hitPart, from: h,
      });
    } else {
      this.game.effects.impact(wall.point, wall.normal, chance(0.35) ? 'metal' : 'concrete');
    }
    this.game.effects.tracer(this.muzzle, end, { color: p.tracer, life: 0.075 });
    this.game.effects.muzzleFlash(this.muzzle, { scale: p.laser ? 0.75 : 0.46 });
    this.game.audio?.play(p.audio, {
      volume: clamp(0.55 - dist / 250, 0.09, 0.5),
      pan: this.game.audio.panFor(h.root.position),
    });
    this.game.lastGunshotTime = this.game.time;
    // Make the character flinch visually from recoil.
    h.triggerRecoil(p.laser ? 1.3 : 0.55);
    this.hideLaser();
    // Muzzle flash point light for close shots would be too much; sprite is enough.
  }

  showLaser(progress) {
    if (!this.laser) return;
    const h = this.human;
    const player = this.game.player;
    h.getMuzzlePosition(this.muzzle);
    const target = player.getBodyCenter(new THREE.Vector3());
    const pos = this.laser.geometry.attributes.position;
    pos.setXYZ(0, this.muzzle.x, this.muzzle.y, this.muzzle.z);
    pos.setXYZ(1, target.x, target.y, target.z);
    pos.needsUpdate = true;
    this.laser.visible = true;
    this.laser.material.opacity = 0.22 + progress * 0.64;
  }

  hideLaser() {
    if (this.laser) this.laser.visible = false;
  }

  updateLaserForSniper() {
    if (this.params.laser) this.hideLaser();
  }

  onRemove() {
    this.hideLaser();
    if (this.laser) {
      this.game.scene.remove(this.laser);
      this.laser.geometry.dispose();
      this.laser.material.dispose();
      this.laser = null;
    }
  }
}
