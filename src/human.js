import * as THREE from 'three';
import { buildWeaponModel, WEAPONS } from './weapons.js';
import { clamp, damp, dampAngle, lerp, rand, chance, choose, TYPE_LABEL, TAU, disposeObject3D } from './utils.js';

const MAT_CACHE = new Map();
function mat(color, roughness = 0.82, metalness = 0.0, emissive = 0, emissiveIntensity = 0) {
  const key = `${color}-${roughness}-${metalness}-${emissive}-${emissiveIntensity}`;
  if (!MAT_CACHE.has(key)) {
    MAT_CACHE.set(key, new THREE.MeshStandardMaterial({
      color, roughness, metalness, emissive, emissiveIntensity,
    }));
  }
  return MAT_CACHE.get(key);
}

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  sphereLow: new THREE.SphereGeometry(1, 7, 5),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cap: new THREE.CylinderGeometry(1, 1, 1, 8),
};

const SKIN_TONES = [0xf0c7a4, 0xe6b48d, 0xd39a73, 0xb87a55, 0x8f5d40, 0x6d4632, 0xf2d1b4];
const HAIR_COLORS = [0x33271f, 0x1f1c1b, 0x5a3b27, 0x7c5539, 0x9c764f, 0x3d2c22, 0x9b8a76];
const SHIRT_COLORS = [
  0xb84d43, 0x466f8b, 0x66855c, 0xd4a246, 0x8b6386, 0xd0d3c5, 0x3b4146,
  0x879f9b, 0xc57755, 0x65739b, 0xa85a64, 0x7f9160, 0xd0b688, 0x5f7f89,
];
const PANTS_COLORS = [0x33414e, 0x252c34, 0x4d4a43, 0x605442, 0x263137, 0x4b5163, 0x75523f];
const SHOE_COLORS = [0x1e2324, 0x2d2622, 0xddd6c6, 0x3d3a34, 0x5e4a3c];
const HAT_COLORS = [0x333b43, 0xb54436, 0xd8c592, 0x586b54, 0x895c45];

const FACE_MATS = [];
function getFaceMaterial(style = 0) {
  if (FACE_MATS[style]) return FACE_MATS[style];
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 96);
  // eyes
  ctx.fillStyle = '#201b19';
  ctx.beginPath(); ctx.ellipse(39, 44, 10, 12, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(89, 44, 10, 12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(42, 39, 3.2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(92, 39, 3.2, 0, TAU); ctx.fill();
  if (style === 1) {
    ctx.strokeStyle = '#201b19'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(28, 27); ctx.lineTo(52, 33); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(100, 27); ctx.lineTo(76, 33); ctx.stroke();
  }
  ctx.strokeStyle = '#6e3730'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath();
  if (style === 2) { ctx.moveTo(53, 76); ctx.quadraticCurveTo(64, 70, 75, 76); }
  else { ctx.moveTo(53, 72); ctx.quadraticCurveTo(64, 82, 75, 72); }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Slight alpha the outer edge of the plane so it doesn't look like a sticker.
  const faceMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, alphaTest: 0.08, toneMapped: false,
  });
  FACE_MATS[style] = faceMat;
  return faceMat;
}

function makeAppearance(type) {
  const skin = choose(SKIN_TONES);
  const rng = Math.random();
  if (type === 'police') {
    return {
      skin, hair: 0x2a2420, shirt: 0x334b60, pants: 0x252e3c, shoes: 0x171c20,
      vest: 0x182532, vestTrim: 0x46617a, hat: 'cap', hatColor: 0x20364b, face: 1,
      uniform: 'police',
    };
  }
  if (type === 'swat') {
    return {
      skin, hair: 0x211e1b, shirt: 0x333b3e, pants: 0x252b2e, shoes: 0x101416,
      vest: 0x14191b, vestTrim: 0x4b5758, hat: 'helmet', hatColor: 0x20282b, face: 1,
      uniform: 'swat', visor: true,
    };
  }
  if (type === 'militarySniper' || type === 'militarySMG') {
    return {
      skin, hair: 0x2d2b23, shirt: 0x68704f, pants: 0x4d543b, shoes: 0x2b2c24,
      vest: 0x3d452f, vestTrim: 0x252d20, hat: 'helmet', hatColor: 0x5a6543, face: 0,
      uniform: 'military', visor: false, backpack: true,
    };
  }
  if (type === 'player') {
    return {
      skin: 0xe7b58c, hair: 0x2d2420, shirt: 0x256c67, pants: 0x2b3038,
      shoes: 0x2f3337, hat: 'cap', hatColor: 0xc99b3e, face: 0, uniform: 'player',
      backpack: true, scarf: true,
    };
  }
  return {
    skin, hair: choose(HAIR_COLORS), shirt: choose(SHIRT_COLORS), pants: choose(PANTS_COLORS),
    shoes: choose(SHOE_COLORS), hat: rng < 0.18 ? choose(['cap', 'beanie', 'bucket']) : null,
    hatColor: choose(HAT_COLORS), face: Math.floor(Math.random() * 3), uniform: 'civilian',
    backpack: rng > 0.72, shorts: Math.random() < 0.22,
  };
}

export class Human {
  constructor(game, config = {}) {
    this.game = game;
    this.world = game.world;
    this.type = config.type || 'civilian';
    this.isPlayer = this.type === 'player';
    this.isResponder = this.type !== 'civilian' && !this.isPlayer;
    this.id = ++Human.nextId;
    this.dead = false;
    this.state = 'normal';
    this.removed = false;
    this.grabbed = false;
    this.sedated = false;
    this.sleepTimer = 0;
    this.downedTimer = 0;
    this.cleanupTimer = -1;
    this.hp = 100;
    this.maxHp = 100;
    this.prone = false;
    this.armorMax = this.isResponder || this.isPlayer ? 10 : 0;
    this.armorPlates = config.armorPlates ?? (this.isResponder || this.isPlayer ? 10 : 0);
    this.weaponId = config.weaponId || null;
    this.meleeTimer = 0;
    this.meleeDuration = 0.34;
    this.horizontalSpeed = 0;
    this.looted = false;
    this.hasLoot = false;
    this.bleedTimer = 0;
    this.bleedRate = 0;
    this.hitFlash = 0;
    this.flinch = 0;
    this.lastDamageWeapon = null;
    this.woundCount = 0;
    this.flinchDir = 1;
    this.recoil = 0;
    this.moveAmount = 0;
    this.moving = false;
    this.sprinting = false;
    this.aiming = false;
    this.aimAmount = 0;
    this.animPhase = Math.random() * TAU;
    this.targetFacing = config.heading ?? 0;
    this.facing = this.targetFacing;
    this.thrownMode = false;
    this.vel = new THREE.Vector3();
    this.fallVelocity = 0;
    this.lastFootstep = 0;
    this.deathTime = 0;
    this.bodyY = 0.84;
    this.woundTime = 0;
    this.lootTable = config.lootTable || null;
    this.serial = config.serial || '';
    this.name = config.name || TYPE_LABEL[this.type] || '小人';
    this.scale = config.scale || (this.type === 'civilian' ? 0.84 + Math.random() * 0.14 : 0.99 + Math.random() * 0.035);
    this.appearance = config.appearance || makeAppearance(this.type);
    this.root = new THREE.Group();
    this.root.position.set(config.x || 0, config.y || 0, config.z || 0);
    this.root.rotation.y = this.facing;
    this.root.scale.setScalar(this.scale);
    this.bob = new THREE.Group();
    this.root.add(this.bob);
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = 0.84;
    this.bob.add(this.bodyPivot);
    this.weaponHolder = null;
    this.weaponModel = null;
    this.muzzle = null;
    this.constructBody();
    this.setWeapon(this.weaponId, false);
    this.syncArmorVisual();
    this.game.scene.add(this.root);
    this.height = 1.78 * this.scale;
  }

  static nextId = 0;

  addMesh(parent, geometry, material, x, y, z, sx, sy, sz, cast = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = cast && this.type !== 'civilian';
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  constructBody() {
    const a = this.appearance;
    const skinMat = mat(a.skin, 0.76);
    const shirtMat = mat(a.shirt, 0.9);
    const pantsMat = mat(a.pants, 0.92);
    const shoeMat = mat(a.shoes, 0.65);
    const hairMat = mat(a.hair, 0.86);
    this.skinMat = skinMat;
    this.shirtMat = shirtMat;
    const hip = new THREE.Group();
    hip.position.y = 0;
    this.bodyPivot.add(hip);
    // Torso is deliberately a little big; little people have big heads.
    this.torso = this.addMesh(this.bodyPivot, GEO.box, shirtMat, 0, 0.30, 0, 0.49, 0.62, 0.29);
    this.addMesh(this.bodyPivot, GEO.box, pantsMat, 0, -0.02, 0, 0.455, 0.18, 0.28);
    this.addMesh(this.bodyPivot, GEO.cyl, skinMat, 0, 0.62, 0, 0.09, 0.11, 0.09);
    // Collar
    this.addMesh(this.bodyPivot, GEO.box, mat(0xe4ded1, 0.9), 0, 0.545, 0.16, 0.2, 0.06, 0.03);
    // Head group
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 0.64;
    this.bodyPivot.add(this.headGroup);
    this.headMesh = this.addMesh(this.headGroup, GEO.sphere, skinMat, 0, 0.075, 0.012, 0.217, 0.235, 0.207);
    // Ears (kept minimal, part of silhouette)
    this.addMesh(this.headGroup, GEO.sphereLow, skinMat, -0.205, 0.06, 0.0, 0.045, 0.062, 0.035);
    this.addMesh(this.headGroup, GEO.sphereLow, skinMat, 0.205, 0.06, 0.0, 0.045, 0.062, 0.035);
    // Face
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.205), getFaceMaterial(a.face || 0));
    face.position.set(0, 0.055, 0.216);
    this.headGroup.add(face);
    this.face = face;
    this.constructHairOrHat(a);
    // Arms (right is +x)
    this.leftArm = this.createArm(-0.31, 0.50, shirtMat, skinMat, false);
    this.rightArm = this.createArm(0.31, 0.50, shirtMat, skinMat, true);
    // Legs
    this.leftLeg = this.createLeg(-0.13, 0, pantsMat, shoeMat, a);
    this.rightLeg = this.createLeg(0.13, 0, pantsMat, shoeMat, a);
    // Belt and vest
    if (this.isResponder || this.isPlayer) {
      this.addMesh(this.bodyPivot, GEO.box, mat(0x25292a, 0.65, 0.1), 0, 0.035, 0, 0.47, 0.07, 0.3);
    }
    this.vestGroup = new THREE.Group();
    this.bodyPivot.add(this.vestGroup);
    const vestMat = mat(a.vest || 0x1e2932, 0.68, 0.08);
    const vestTrim = mat(a.vestTrim || 0x45555e, 0.7);
    const vestW = a.uniform === 'swat' ? 0.59 : 0.55;
    const vestD = a.uniform === 'swat' ? 0.38 : 0.34;
    this.addMesh(this.vestGroup, GEO.box, vestMat, 0, 0.33, 0, vestW, 0.46, vestD);
    this.addMesh(this.vestGroup, GEO.box, vestTrim, 0, 0.48, 0.17, vestW * 0.75, 0.05, 0.02);
    this.addMesh(this.vestGroup, GEO.box, vestTrim, -0.17, 0.28, 0.185, 0.14, 0.17, 0.045);
    this.addMesh(this.vestGroup, GEO.box, vestTrim, 0.17, 0.28, 0.185, 0.14, 0.17, 0.045);
    if (a.uniform === 'police') {
      this.addMesh(this.vestGroup, GEO.box, mat(0xd8c15e, 0.6, 0.2), -0.17, 0.35, 0.19, 0.09, 0.02, 0.01);
      this.addMesh(this.vestGroup, GEO.box, mat(0xd8c15e, 0.6, 0.2), 0.17, 0.35, 0.19, 0.09, 0.02, 0.01);
      const badge = this.addMesh(this.vestGroup, GEO.box, mat(0xd6b95d, 0.4, 0.4), -0.19, 0.4, 0.19, 0.055, 0.07, 0.015);
      badge.rotation.z = 0.08;
    }
    if (a.uniform === 'military') {
      this.addMesh(this.vestGroup, GEO.box, mat(0x2b3323, 0.9), -0.18, 0.31, 0.19, 0.12, 0.16, 0.04);
      this.addMesh(this.vestGroup, GEO.box, mat(0x2b3323, 0.9), 0.18, 0.31, 0.19, 0.12, 0.16, 0.04);
    }
    if (a.uniform === 'swat') {
      this.addMesh(this.vestGroup, GEO.box, mat(0x353d3f, 0.5, 0.1), -0.17, 0.31, 0.2, 0.15, 0.17, 0.05);
      this.addMesh(this.vestGroup, GEO.box, mat(0x353d3f, 0.5, 0.1), 0.17, 0.31, 0.2, 0.15, 0.17, 0.05);
      this.addMesh(this.vestGroup, GEO.box, mat(0xcfd5cb, 0.7), 0.24, 0.44, 0.185, 0.07, 0.03, 0.012);
    }
    this.vestGroup.visible = false;
    // Backpack for the player / some walkers
    if (a.backpack) {
      const packColor = a.uniform === 'military' ? 0x4b523d : a.uniform === 'player' ? 0x5f574a : 0x514f48;
      this.addMesh(this.bodyPivot, GEO.box, mat(packColor, 0.95), 0, 0.33, -0.205, 0.25, 0.27, 0.11);
      this.addMesh(this.bodyPivot, GEO.box, mat(0x8a7b64, 0.9), 0, 0.455, -0.208, 0.23, 0.06, 0.12);
      this.addMesh(this.bodyPivot, GEO.box, mat(0x302f2b, 0.8), 0, 0.3, -0.27, 0.09, 0.18, 0.025);
      if (a.uniform === 'player') {
        this.addMesh(this.bodyPivot, GEO.box, mat(0xe6ddc6, 0.7), 0.07, 0.38, -0.266, 0.08, 0.06, 0.02);
      }
      for (const sx of [-1, 1]) {
        this.addMesh(this.bodyPivot, GEO.box, mat(0x2d2b27, 0.8), sx * 0.17, 0.43, -0.15, 0.035, 0.18, 0.035);
      }
    }
    if (a.scarf) {
      this.addMesh(this.bodyPivot, GEO.box, mat(0xa9443e, 0.9), 0, 0.54, 0.05, 0.32, 0.07, 0.28);
      this.addMesh(this.bodyPivot, GEO.box, mat(0xa9443e, 0.9), 0.12, 0.39, -0.19, 0.09, 0.28, 0.03);
    }
    if (a.shorts) {
      // Visual cue only: a brighter hem covers the top part of the trousers.
      this.addMesh(this.leftLeg, GEO.box, mat(a.pants, 0.95), 0, -0.22, 0, 1.02, 0.38, 1.02);
      this.addMesh(this.rightLeg, GEO.box, mat(a.pants, 0.95), 0, -0.22, 0, 1.02, 0.38, 1.02);
    }
    // Soft contact shadow disc
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64; shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d');
    const sg = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    sg.addColorStop(0, 'rgba(15,18,16,.42)');
    sg.addColorStop(0.65, 'rgba(15,18,16,.16)');
    sg.addColorStop(1, 'rgba(15,18,16,0)');
    sctx.fillStyle = sg; sctx.fillRect(0, 0, 64, 64);
    if (!Human._shadowTex) {
      Human._shadowTex = new THREE.CanvasTexture(shadowCanvas);
      Human._shadowTex.colorSpace = THREE.SRGBColorSpace;
    }
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 1.35),
      new THREE.MeshBasicMaterial({ map: Human._shadowTex, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  constructHairOrHat(a) {
    const hat = a.hat;
    if (hat === 'helmet') {
      this.addMesh(this.headGroup, GEO.sphere, mat(a.hatColor, 0.68, 0.05), 0, 0.13, -0.005, 0.245, 0.19, 0.235);
      this.addMesh(this.headGroup, GEO.cyl, mat(a.hatColor, 0.7), 0, 0.055, 0, 0.245, 0.05, 0.24);
      if (a.visor) {
        this.addMesh(this.headGroup, GEO.box, mat(0x11191c, 0.2, 0.65), 0, 0.075, 0.20, 0.37, 0.10, 0.045);
        this.face.visible = false;
      }
      return;
    }
    if (hat === 'cap') {
      this.addMesh(this.headGroup, GEO.sphere, mat(a.hatColor, 0.85), 0, 0.17, -0.02, 0.22, 0.12, 0.21);
      this.addMesh(this.headGroup, GEO.box, mat(a.hatColor, 0.85), 0, 0.13, 0.19, 0.30, 0.035, 0.17);
      return;
    }
    if (hat === 'beanie') {
      this.addMesh(this.headGroup, GEO.sphere, mat(a.hatColor, 0.96), 0, 0.18, -0.02, 0.225, 0.15, 0.215);
      this.addMesh(this.headGroup, GEO.cyl, mat(a.hatColor, 0.96), 0, 0.09, -0.01, 0.225, 0.05, 0.215);
      return;
    }
    if (hat === 'bucket') {
      this.addMesh(this.headGroup, GEO.cyl, mat(a.hatColor, 0.93), 0, 0.16, -0.01, 0.24, 0.12, 0.23);
      this.addMesh(this.headGroup, GEO.cyl, mat(a.hatColor, 0.93), 0, 0.1, -0.01, 0.31, 0.03, 0.29);
      return;
    }
    // Hair
    const hairMat = mat(a.hair, 0.92);
    this.addMesh(this.headGroup, GEO.sphere, hairMat, 0, 0.15, -0.015, 0.22, 0.15, 0.21);
    if (a.uniform === 'civilian' && Math.random() < 0.28) {
      this.addMesh(this.headGroup, GEO.box, hairMat, 0, -0.03, -0.17, 0.26, 0.34, 0.1);
    }
  }

  createArm(x, y, shirtMat, skinMat, right) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    this.bodyPivot.add(pivot);
    const mesh = this.addMesh(pivot, GEO.box, shirtMat, 0, -0.24, 0, 0.115, 0.48, 0.125);
    const hand = new THREE.Group();
    hand.position.set(0, -0.51, 0.01);
    pivot.add(hand);
    this.addMesh(hand, GEO.sphereLow, skinMat, 0, 0, 0, 0.072, 0.075, 0.06);
    // Shoulder pad / sleeve stripe
    if (this.isResponder) {
      this.addMesh(pivot, GEO.box, mat(this.appearance.vestTrim || 0x3a4445, 0.7), 0, -0.055, 0, 0.13, 0.08, 0.14);
    }
    if (right) {
      this.rightHand = hand;
      this.weaponHolder = new THREE.Group();
      this.weaponHolder.position.set(0.1, -0.01, 0.08);
      hand.add(this.weaponHolder);
    }
    return pivot;
  }

  createLeg(x, y, pantsMat, shoeMat, a) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    this.bodyPivot.add(pivot);
    const legMat = a.shorts && Math.random() < 0.2 ? mat(a.skin, 0.8) : pantsMat;
    this.addMesh(pivot, GEO.box, legMat, 0, -0.35, 0, 0.16, 0.68, 0.18);
    this.addMesh(pivot, GEO.box, shoeMat, 0, -0.73, 0.04, 0.165, 0.085, 0.27);
    return pivot;
  }

  setWeapon(id, refresh = true) {
    if (this.weaponModel) {
      this.weaponHolder.remove(this.weaponModel);
      disposeObject3D(this.weaponModel, false);
      this.weaponModel = null;
      this.muzzle = null;
    }
    this.weaponId = id;
    if (!id) {
      if (refresh) this.syncWeaponVisibility();
      return;
    }
    const model = buildWeaponModel(id);
    model.rotation.x = 0;
    this.weaponModel = model;
    this.muzzle = model.userData.muzzle;
    this.weaponHolder.add(model);
    this.syncWeaponVisibility();
  }

  syncWeaponVisibility() {
    if (!this.weaponHolder) return;
    const visible = this.weaponModel && !this.dead && !this.grabbed && !this.prone && this.state !== 'sleep' && this.state !== 'downed';
    if (this.weaponModel) this.weaponModel.visible = !!visible;
  }

  syncArmorVisual() {
    if (!this.vestGroup) return;
    if (this.isPlayer) {
      this.vestGroup.visible = this.armorPlates > 0;
    } else {
      this.vestGroup.visible = this.isResponder ? this.armorPlates > 0 : false;
    }
  }

  equipArmor(plates) {
    this.armorPlates = Math.max(this.armorPlates, plates);
    this.syncArmorVisual();
  }

  setFacing(yaw) {
    this.targetFacing = yaw;
  }

  setLocomotion(speed, sprinting = false, moving = true) {
    this.moveAmount = clamp(speed / 3.7, 0, 1.6);
    this.moving = moving;
    this.sprinting = sprinting;
    if (moving) {
      this.animPhase += speed * 0.62;
    }
  }

  setAiming(value) {
    this.aiming = value;
  }

  setProne(value) {
    this.prone = !!value;
    if (this.prone) {
      this.state = 'normal';
      this.grabbed = false;
      this.thrownMode = false;
      this.vel.set(0, 0, 0);
    }
    this.syncWeaponVisibility();
  }

  triggerRecoil(power = 1) {
    this.recoil = Math.max(this.recoil, 0.14 * power);
  }

  getHorizontalSpeed() {
    return this.horizontalSpeed || 0;
  }

  playMeleeSwing(duration = 0.34) {
    this.meleeTimer = duration;
    this.meleeDuration = duration;
  }

  setBowDraw(amount) {
    this.bowDraw = clamp(amount, 0, 1);
  }

  setGrabbed(value, options = {}) {
    if (this.dead && value) {
      this.grabbed = true;
      this.vel.set(0, 0, 0);
      this.thrownMode = false;
      this.syncWeaponVisibility();
      return;
    }
    if (value) {
      this.grabbed = true;
      this.state = 'grabbed';
      this.vel.set(0, 0, 0);
      this.thrownMode = false;
      this.aiming = false;
      this.syncWeaponVisibility();
    } else {
      this.grabbed = false;
      this.thrownMode = true;
      const v = options.velocity || new THREE.Vector3();
      this.vel.copy(v);
      this.state = this.dead ? 'dead' : 'downed';
      this.downedTimer = 0.9;
      this.syncWeaponVisibility();
    }
  }

  getHeadPosition(out = new THREE.Vector3()) {
    if (this.prone) {
      out.set(this.root.position.x, this.root.position.y + 0.62 * this.scale, this.root.position.z);
    } else if (this.dead || this.state === 'sleep' || this.state === 'downed') {
      out.set(this.root.position.x, this.root.position.y + 0.35 * this.scale, this.root.position.z);
    } else {
      out.set(this.root.position.x, this.root.position.y + 1.56 * this.scale, this.root.position.z);
    }
    return out;
  }

  getBodyCenter(out = new THREE.Vector3()) {
    if (this.prone) {
      out.set(this.root.position.x, this.root.position.y + 0.33 * this.scale, this.root.position.z);
    } else if (this.dead || this.state === 'sleep' || this.state === 'downed') {
      out.set(this.root.position.x, this.root.position.y + 0.25 * this.scale, this.root.position.z);
    } else {
      out.set(this.root.position.x, this.root.position.y + 1.1 * this.scale, this.root.position.z);
    }
    return out;
  }

  getMuzzlePosition(out = new THREE.Vector3()) {
    if (this.muzzle) {
      this.muzzle.getWorldPosition(out);
      return out;
    }
    out.set(this.root.position.x, this.root.position.y + 1.3 * this.scale, this.root.position.z);
    return out;
  }

  canAct() {
    return !this.dead && !this.grabbed && this.state === 'normal' && !this.thrownMode;
  }

  isLootable() {
    return this.dead && this.isResponder && !this.looted && !this.removed;
  }

  takeDamage(amount, info = {}) {
    if (this.dead || this.removed) return { dead: false, damage: 0, blocked: false };
    if (this.isPlayer && this.game.godMode) return { dead: false, damage: 0, blocked: false };
    if (info.invulnerable) return { dead: false, damage: 0, blocked: false };
    if (this.state === 'sleep') this.wake();
    const hitPart = info.hitPart || 'body';
    let final = amount;
    let blocked = false;
    let armorDamage = 0;
    if (
      !info.ignoreArmor && this.armorPlates > 0 &&
      hitPart !== 'head' && info.source !== 'fall' && info.source !== 'explosion'
    ) {
      // A hard plate stops one complete torso hit. Ten hits empty the vest;
      // headshots, knives and blasts bypass it entirely.
      blocked = true;
      armorDamage = 1;
      final = 0;
      this.armorPlates = Math.max(0, this.armorPlates - 1);
      this.syncArmorVisual();
    } else if (info.ignoreArmor || info.source === 'fall' || info.source === 'explosion') {
      final = amount;
    }
    this.hitFlash = 0.13;
    this.flinch = 0.36;
    this.flinchDir = info.flinchDir || (Math.random() < 0.5 ? -1 : 1);
    this.recoil = Math.max(this.recoil, 0.05);
    this.lastDamagePoint = info.point ? info.point.clone() : this.getBodyCenter();
    if (info.weapon) this.lastDamageWeapon = info.weapon;
    const dir = info.dir || new THREE.Vector3(0, 0, 1);
    if (!blocked) this.hp -= final;
    if (!this.isPlayer) {
      if (!blocked) {
        this.bleedTimer = Math.max(this.bleedTimer, info.bleed === false ? 0 : 5.5);
        this.bleedRate = Math.max(this.bleedRate, hitPart === 'head' ? 4.2 : 2.5);
        if (this.game.effects) this.game.effects.bloodBurst(info.point || this.getBodyCenter(), dir, hitPart === 'head' ? 1.5 : 0.9, { armor: false });
        this.game.audio?.play('flesh', { volume: 0.55, pan: 0 });
      } else if (this.game.effects) {
        this.game.effects.armorSpark(info.point || this.getBodyCenter(), dir);
      }
    } else {
      if (this.game.onPlayerDamaged) this.game.onPlayerDamaged(final, { ...info, blocked, armorDamage });
    }
    if (!blocked && !this.isPlayer && this.woundCount < 7) this.addWound(hitPart);
    this.game.onHumanDamaged?.(this, {
      amount: final, blocked, hitPart, point: info.point, armorLeft: this.armorPlates,
      damageRaw: amount,
    });
    if (this.hp <= 0) {
      this.die({ ...info, dir, hitPart });
    }
    return { dead: this.hp <= 0, damage: final, blocked };
  }

  addWound(hitPart) {
    const bloodMat = mat(0x6d0a08, 0.5);
    this.woundCount++;
    if (hitPart === 'head') {
      const x = rand(-0.09, 0.09), y = 0.11 + rand(-0.03, 0.05), z = 0.205;
      this.addMesh(this.headGroup, GEO.sphereLow, bloodMat, x, y, z, 0.035, 0.025, 0.012, false);
    } else {
      const x = rand(-0.19, 0.19);
      const y = 0.22 + rand(0, 0.24);
      const front = Math.random() < 0.65;
      this.addMesh(this.bodyPivot, GEO.sphereLow, bloodMat, x, y, front ? 0.192 : -0.192,
        rand(0.03, 0.07), rand(0.035, 0.09), 0.012, false);
      if (Math.random() < 0.5) {
        this.addMesh(this.bodyPivot, GEO.sphereLow, bloodMat, -x * 0.7, y - 0.1, front ? 0.194 : -0.194,
          rand(0.018, 0.04), rand(0.02, 0.07), 0.01, false);
      }
    }
  }

  die(info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.state = 'dead';
    this.grabbed = false;
    this.aiming = false;
    this.sleepTimer = 0;
    this.cleanupTimer = this.isResponder ? 140 : 90;
    this.deathTime = 0;
    this.thrownMode = true;
    this.downedTimer = 0;
    this.syncWeaponVisibility();
    if (this.weaponModel) this.weaponModel.visible = false;
    const dir = info.dir || new THREE.Vector3(0, 0, 1);
    const force = info.force || 0;
    this.vel.set(dir.x * (1.1 + force), Math.min(6.5, 1.2 + force * 0.15), dir.z * (1.1 + force));
    if (info.source === 'explosion') {
      this.vel.set(dir.x * (5 + force * 0.7), 6 + force * 0.45, dir.z * (5 + force * 0.7));
      this.fallVelocity = this.vel.y;
    } else if (info.source === 'fall' || this.root.position.y > 0.15) {
      this.fallVelocity = this.vel.y;
    } else {
      this.vel.y = 0;
    }
    this.tiltDir = Math.random() < 0.5 ? -1 : 1;
    this.deathRoll = Math.random() * 0.9 - 0.45;
    if (this.game.effects) {
      this.game.effects.bloodBurst(info.point || this.getBodyCenter(), dir, 2.6, { death: true });
      this.game.effects.bloodPool(this.root.position.x, this.world.groundHeightAt(this.root.position.x, this.root.position.z), this.root.position.z, this.scale);
    }
    this.game.audio?.play(this.type === 'civilian' ? 'scream' : 'down', { volume: 0.7, pan: 0 });
    this.game.onHumanKilled?.(this, info);
    if (this.isPlayer) this.game.onPlayerKilled?.(info);
  }

  applyImpulse(vx, vy, vz) {
    if (this.dead) {
      this.vel.set(vx, vy, vz);
      this.thrownMode = true;
      return;
    }
    this.thrownMode = true;
    this.vel.set(vx, vy, vz);
    this.state = 'downed';
    this.downedTimer = 1.2;
    this.syncWeaponVisibility();
  }

  sedate(seconds = 13) {
    if (this.dead) return false;
    this.sedated = true;
    this.sleepTimer = seconds;
    this.state = 'sleep';
    this.aiming = false;
    this.vel.set(0, 0, 0);
    this.thrownMode = false;
    this.syncWeaponVisibility();
    return true;
  }

  wake() {
    if (this.dead) return;
    this.sedated = false;
    this.sleepTimer = 0;
    if (this.state === 'sleep') this.state = 'normal';
    this.syncWeaponVisibility();
  }

  update(dt) {
    if (this.removed) return;
    this.aimAmount = damp(this.aimAmount, this.aiming && !this.dead ? 1 : 0, 10, dt);
    this.recoil = damp(this.recoil, 0, 18, dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.flinch = Math.max(0, this.flinch - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    if (this.bleedTimer > 0 && !this.dead) {
      this.bleedTimer -= dt;
      this.hp -= this.bleedRate * dt;
      if (Math.random() < dt * 2.5) {
        this.game.effects?.bloodDrip(this.root.position.x, this.root.position.y + 0.5 * this.scale, this.root.position.z);
        this.game.effects?.bloodPool(this.root.position.x, this.root.position.y + 0.001, this.root.position.z, this.scale * 0.35);
      }
      if (this.hp <= 0) {
        this.die({ source: 'bleed', dir: new THREE.Vector3(0, 0, 0.1), hitPart: 'body' });
      }
    }
    if (this.sleepTimer > 0) {
      this.sleepTimer -= dt;
      if (this.sleepTimer <= 0 && this.state === 'sleep') this.wake();
    }
    if (this.state === 'downed' && !this.thrownMode) {
      this.downedTimer -= dt;
      if (this.downedTimer <= 0 && !this.dead) {
        this.state = 'normal';
        this.syncWeaponVisibility();
      }
    }
    if (this.thrownMode) this.updatePhysics(dt);
    if (this.cleanupTimer > 0) {
      this.cleanupTimer -= dt;
      if (this.cleanupTimer <= 0) {
        this.remove();
        return;
      }
    }
    this.updateVisuals(dt);
    this.syncShadow();
  }

  updatePhysics(dt) {
    const ground = this.world.groundHeightAt(this.root.position.x, this.root.position.z);
    if (this.root.position.y > ground + 0.002 || this.vel.y > 0.001) {
      this.vel.y -= 23 * dt;
      const oldX = this.root.position.x, oldZ = this.root.position.z;
      this.root.position.x += this.vel.x * dt;
      this.root.position.z += this.vel.z * dt;
      this.root.position.y += this.vel.y * dt;
      // Horizontal collision with buildings only while below their roofline.
      for (const c of this.world.colliders) {
        if (c.type === 'fountain' && this.root.position.y > c.height) continue;
        if (this.root.position.y > c.height + 0.2) continue;
        const pad = 0.28;
        if (this.root.position.x > c.minX - pad && this.root.position.x < c.maxX + pad &&
            this.root.position.z > c.minZ - pad && this.root.position.z < c.maxZ + pad) {
          if (oldX <= c.minX - pad) this.root.position.x = c.minX - pad;
          else if (oldX >= c.maxX + pad) this.root.position.x = c.maxX + pad;
          else if (oldZ <= c.minZ - pad) this.root.position.z = c.minZ - pad;
          else if (oldZ >= c.maxZ + pad) this.root.position.z = c.maxZ + pad;
          else {
            this.root.position.x = oldX; this.root.position.z = oldZ;
          }
          if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 10 && !this.dead) {
            this.takeDamage(6, { source: 'impact', ignoreArmor: true, bleed: false, hitPart: 'body' });
          }
          this.vel.x *= 0.3; this.vel.z *= 0.3;
          break;
        }
      }
      this.root.position.x = clamp(this.root.position.x, -245, 245);
      this.root.position.z = clamp(this.root.position.z, -245, 245);
      if (this.root.position.y <= ground) {
        const impact = -this.vel.y;
        this.root.position.y = ground;
        this.vel.y = 0;
        this.vel.x *= 0.55;
        this.vel.z *= 0.55;
        this.thrownMode = false;
        if (this.dead) {
          if (this.game.effects) this.game.effects.dustBurst(this.getBodyCenter(), 7);
          this.vel.x = 0; this.vel.z = 0;
          this.cleanupTimer = this.isResponder ? 140 : 90;
        } else {
          if (impact > 7.5) {
            const dmg = Math.min(95, (impact - 6) * 7.2);
            this.state = 'downed';
            this.downedTimer = 1.4;
            this.takeDamage(dmg, { source: 'fall', ignoreArmor: true, bleed: false, hitPart: 'body' });
            if (!this.dead) this.game.audio?.play('fall', { volume: 0.6, pan: 0 });
          } else {
            this.state = 'downed';
            this.downedTimer = 0.9;
          }
          if (this.game.effects) this.game.effects.dustBurst(this.root.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 5);
          this.syncWeaponVisibility();
        }
      }
    } else {
      this.root.position.y = ground;
      this.vel.x = 0; this.vel.z = 0; this.vel.y = 0;
      this.thrownMode = false;
    }
  }

  syncShadow() {
    if (!this.shadow) return;
    const ground = this.world.groundHeightAt(this.root.position.x, this.root.position.z);
    const height = this.root.position.y - ground;
    this.shadow.position.y = (ground - this.root.position.y) / this.scale + 0.012;
    const alpha = clamp(1 - height / 8, 0.15, 1);
    this.shadow.material.opacity = alpha;
    const s = (1 + height * 0.12);
    this.shadow.scale.set(s, s, s);
  }

  updateVisuals(dt) {
    if (this.dead) {
      this.updateDeadVisual(dt);
      return;
    }
    if (this.grabbed) {
      this.updateGrabbedVisual(dt);
      return;
    }
    if (this.prone && this.isPlayer) {
      this.updateProneVisual(dt);
      return;
    }
    if (this.state === 'sleep' || this.state === 'downed') {
      this.updateLyingVisual(dt);
      return;
    }
    this.updateUprightVisual(dt);
  }

  updateUprightVisual(dt) {
    const targetFacing = this.targetFacing;
    this.facing = dampAngle(this.facing, targetFacing, 11, dt);
    this.root.rotation.y = this.facing;
    const speed = this.moveAmount;
    const phase = this.animPhase;
    const aim = this.aimAmount;
    const bobTarget = Math.sin(phase * 2) * 0.022 * speed;
    this.bob.position.y = damp(this.bob.position.y, bobTarget, 14, dt);
    this.bodyPivot.position.y = damp(this.bodyPivot.position.y, 0.84, 12, dt);
    let lean = speed * 0.045 + (this.sprinting ? 0.065 : 0);
    let tilt = Math.sin(phase) * 0.02 * speed;
    if (this.hp < 40 && !this.isPlayer) tilt += 0.08;
    if (this.flinch > 0) {
      tilt += this.flinchDir * this.flinch * 0.65;
      lean -= this.flinch * 0.18;
    }
    this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, lean, 12, dt);
    this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, tilt, 14, dt);
    this.headGroup.rotation.x = damp(this.headGroup.rotation.x, -lean * 0.5, 10, dt);
    this.headGroup.rotation.z = damp(this.headGroup.rotation.z, tilt * 0.35, 10, dt);

    const swing = Math.sin(phase) * (this.sprinting ? 0.92 : 0.62) * Math.min(1, speed);
    let legL = swing;
    let legR = -swing;
    if (speed < 0.08) {
      legL = 0.015;
      legR = -0.015;
    }
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, legL, 16, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, legR, 16, dt);
    this.leftLeg.rotation.z = damp(this.leftLeg.rotation.z, 0.02, 10, dt);
    this.rightLeg.rotation.z = damp(this.rightLeg.rotation.z, -0.02, 10, dt);

    let armLX, armRX, armLZ, armRZ;
    if (this.aimAmount > 0.02) {
      const bow = this.weaponId === 'bow';
      armLX = lerp(-swing * 0.55, bow ? -1.28 : -1.16, aim);
      armRX = lerp(swing * 0.55, -Math.PI / 2 - (this.recoil || 0) * 1.4, aim);
      armLZ = lerp(-0.06, bow ? 0.34 : 0.22, aim);
      armRZ = lerp(0.06, 0.24, aim);
      if (this.bowDraw > 0) {
        armRX += (1 - this.bowDraw) * -0.35 + this.bowDraw * 0.36;
      }
    } else {
      armLX = -swing * 0.72;
      armRX = swing * 0.72;
      armLZ = 0.06;
      armRZ = -0.06;
    }
    if (this.sprinting) {
      armLX = -swing * 1.15;
      armRX = swing * 1.15;
    } else if (this.weaponId && !this.aiming) {
      // Low-ready pose: the weapon should still read from a third-person camera.
      armRX += -0.48;
      armRZ += 0.48;
      armLX += -0.18;
    }
    armRX += this.recoil * 0.6;
    if (this.meleeTimer > 0) {
      const mt = 1 - this.meleeTimer / this.meleeDuration;
      const arc = Math.sin(Math.min(1, mt * 1.25) * Math.PI);
      armRX = lerp(armRX, -0.55 - arc * 0.95, 0.85);
      armRZ = lerp(armRZ, 0.55 - arc * 1.5, 0.9);
      this.bodyPivot.rotation.y = damp(this.bodyPivot.rotation.y, arc * 0.18, 14, dt);
    } else {
      this.bodyPivot.rotation.y = damp(this.bodyPivot.rotation.y, 0, 10, dt);
    }
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, armLX, 15, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, armRX, 15, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, armLZ, 10, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, armRZ, 10, dt);
    if (this.weaponHolder) {
      // Keep the weapon level with the body while the arm moves; the hand still
      // carries it, so both the low-ready pose and the aim pose read clearly
      // from a third-person camera.
      this.weaponHolder.quaternion.copy(this.rightArm.quaternion).invert();
    }
    if (this.headGroup) {
      this.headGroup.rotation.y = damp(this.headGroup.rotation.y, Math.sin(phase * 0.5) * 0.06, 6, dt);
    }
    this.syncWeaponVisibility();
  }

  updateProneVisual(dt) {
    this.facing = dampAngle(this.facing, this.targetFacing, 9, dt);
    this.root.rotation.y = this.facing;
    this.syncWeaponVisibility();
    this.bob.position.y = damp(this.bob.position.y, 0, 9, dt);
    this.bodyPivot.position.y = damp(this.bodyPivot.position.y, 0.31, 9, dt);
    this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, Math.PI / 2 - 0.08, 9, dt);
    this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, 0.035, 9, dt);
    this.bodyPivot.rotation.y = damp(this.bodyPivot.rotation.y, 0, 8, dt);
    const crawl = Math.sin(this.animPhase) * Math.min(0.28, this.moveAmount * 0.2);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, -0.95 + crawl, 9, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, -0.95 - crawl, 9, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, 0.55, 8, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, -0.55, 8, dt);
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, 0.12 - crawl * 0.6, 8, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -0.12 + crawl * 0.6, 8, dt);
    this.leftLeg.rotation.z = damp(this.leftLeg.rotation.z, 0.16, 8, dt);
    this.rightLeg.rotation.z = damp(this.rightLeg.rotation.z, -0.16, 8, dt);
    this.headGroup.rotation.x = damp(this.headGroup.rotation.x, -0.46, 7, dt);
    this.headGroup.rotation.y = damp(this.headGroup.rotation.y, 0, 7, dt);
  }

  updateLyingVisual(dt) {
    this.syncWeaponVisibility();
    this.bob.position.y = damp(this.bob.position.y, 0, 8, dt);
    this.bodyPivot.position.y = damp(this.bodyPivot.position.y, 0.29, 7, dt);
    this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, Math.PI / 2 * 0.96, 7, dt);
    this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, this.state === 'sleep' ? 0.16 : -0.12, 7, dt);
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, 0.15, 6, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -0.08, 6, dt);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, -0.55, 6, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, 0.35, 6, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, 0.5, 6, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, -0.35, 6, dt);
    this.headGroup.rotation.x = damp(this.headGroup.rotation.x, -0.12, 5, dt);
  }

  updateGrabbedVisual(dt) {
    this.syncWeaponVisibility();
    const t = this.game.time;
    const w = Math.sin(t * 9 + this.id);
    this.bodyPivot.position.y = damp(this.bodyPivot.position.y, 0.84, 10, dt);
    this.bob.position.y = 0;
    this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, w * 0.22, 10, dt);
    this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, Math.sin(t * 7 + this.id * 2) * 0.3, 10, dt);
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, 0.5 + w * 0.4, 10, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -0.4 + Math.cos(t * 8) * 0.5, 10, dt);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, -1.4 + w * 0.5, 10, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, -1.1 + Math.cos(t * 9) * 0.6, 10, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, 0.45, 8, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, -0.45, 8, dt);
    this.headGroup.rotation.x = damp(this.headGroup.rotation.x, 0.1, 8, dt);
  }

  updateDeadVisual(dt) {
    this.deathTime += dt;
    this.syncWeaponVisibility();
    const ground = this.world.groundHeightAt(this.root.position.x, this.root.position.z);
    const airborne = this.root.position.y > ground + 0.03;
    this.bob.position.y = damp(this.bob.position.y, 0, 8, dt);
    if (!airborne) {
      this.bodyPivot.position.y = damp(this.bodyPivot.position.y, 0.2, 5, dt);
      this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, Math.PI / 2 * this.tiltDir, 4.5, dt);
      this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, this.deathRoll, 4.5, dt);
    } else {
      this.bodyPivot.rotation.x = damp(this.bodyPivot.rotation.x, (Math.PI / 2 * this.tiltDir) * 0.7, 2.5, dt);
      this.bodyPivot.rotation.z = damp(this.bodyPivot.rotation.z, Math.sin(this.deathTime * 5) * 0.4, 3, dt);
    }
    const spread = Math.min(1, this.deathTime * 2.5);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, -1.4 * spread, 5, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, -0.6 * spread, 5, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, 1.25 * spread, 5, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, -1.1 * spread, 5, dt);
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, 0.3 * spread, 5, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -0.15 * spread, 5, dt);
    this.headGroup.rotation.x = damp(this.headGroup.rotation.x, 0.2, 3, dt);
    if (!airborne && this.deathTime > 2 && !this.poolSpawned) {
      this.poolSpawned = true;
      this.game.effects?.bloodPool(this.root.position.x, this.root.position.y, this.root.position.z, this.scale * 1.2);
    }
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    if (this.shadow) { this.shadow.geometry.dispose(); this.shadow.material.dispose(); }
    if (this.face) this.face.geometry.dispose();
    if (this.weaponModel) disposeObject3D(this.weaponModel, false);
    this.game.scene.remove(this.root);
  }

  remove() { this.dispose(); }
}
