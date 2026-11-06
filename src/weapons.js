import * as THREE from 'three';

export const WEAPONS = {
  bio: {
    id: 'bio', slot: 1, name: '生物枪', short: '生物', kind: 'bio', ammoType: 'none',
    description: '抓取并拖拽任何小人，按 F 抛飞',
  },
  bow: {
    id: 'bow', slot: 2, name: '猎弓', short: '猎弓', kind: 'bow', ammoType: 'count',
    ammo: 24, maxAmmo: 40, fireInterval: 0.5, drawTime: 0.72, damage: 90, headDamage: 180,
    range: 140, description: '按住左键蓄力，松开发射',
  },
  pistol: {
    id: 'pistol', slot: 3, name: '手枪', short: '手枪', kind: 'hitscan', ammoType: 'mag',
    magazine: 12, reserve: Infinity, reserveMax: Infinity, reloadTime: 1.12,
    fireInterval: 0.21, damage: 28, headDamage: 100, spread: 0.007, range: 90, recoil: 0.012,
    automatic: false, armorPiercing: 0, description: '可靠的半自动手枪 · 爆头必杀',
  },
  grenade: {
    id: 'grenade', slot: 4, name: '手榴弹', short: '手雷', kind: 'grenade', ammoType: 'count',
    ammo: 5, maxAmmo: 9, fireInterval: 0.7, description: '抛物线投掷，2 秒后爆炸',
  },
  tranq: {
    id: 'tranq', slot: 5, name: '迷药枪', short: '迷药', kind: 'tranq', ammoType: 'mag',
    magazine: 6, reserve: 24, reserveMax: 36, reloadTime: 1.35,
    fireInterval: 0.55, damage: 0, range: 60, description: '麻醉飞镖，让目标睡一会儿',
  },
  policePistol: {
    id: 'policePistol', slot: 6, name: '警用手枪', short: '警枪', kind: 'hitscan', ammoType: 'mag',
    magazine: 15, reserve: 45, reserveMax: 90, reloadTime: 1.0,
    fireInterval: 0.19, damage: 31, headDamage: 105, spread: 0.006, range: 100, recoil: 0.011,
    automatic: false, lootOnly: true, description: '从警察身上缴获 · 爆头必杀',
  },
  smg: {
    id: 'smg', slot: 7, name: '特警冲锋枪', short: '冲锋枪', kind: 'hitscan', ammoType: 'mag',
    magazine: 30, reserve: 120, reserveMax: 180, reloadTime: 1.5,
    fireInterval: 0.085, damage: 17, headDamage: 78, spread: 0.018, range: 85, recoil: 0.008,
    automatic: true, lootOnly: true, description: '全自动，按住左键倾泻火力',
  },
  sniper: {
    id: 'sniper', slot: 8, name: '军用狙击枪', short: '狙击', kind: 'hitscan', ammoType: 'mag',
    magazine: 5, reserve: 20, reserveMax: 35, reloadTime: 2.25,
    fireInterval: 0.95, damage: 160, headDamage: 260, spread: 0.0005, range: 260, recoil: 0.026,
    automatic: false, scope: true, lootOnly: true, description: '右键开镜 · 一枪撕开装甲',
  },
  knife: {
    id: 'knife', slot: 9, name: '战术匕首', short: '匕首', kind: 'melee', ammoType: 'none',
    fireInterval: 0.36, damage: 62, range: 2.7, lootOnly: true, description: '近身挥砍，无视防弹衣',
  },
};

export const STARTING_WEAPONS = ['bio', 'bow', 'pistol', 'grenade', 'tranq'];
export const LOOT_SLOTS = ['policePistol', 'smg', 'sniper', 'knife'];

const matCache = new Map();
function material(color, metalness = 0.05, roughness = 0.72, emissive = 0, emissiveIntensity = 0) {
  const key = `${color}-${metalness}-${roughness}-${emissive}-${emissiveIntensity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, metalness, roughness, emissive, emissiveIntensity,
    }));
  }
  return matCache.get(key);
}

function addBox(parent, w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function addCylinder(parent, rt, rb, h, seg, x, y, z, mat, rx = Math.PI / 2, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function buildWeaponModel(id) {
  const group = new THREE.Group();
  const dark = material(0x262b2d, 0.7, 0.34);
  const black = material(0x131719, 0.4, 0.38);
  const steel = material(0x7b8484, 0.85, 0.28);
  const wood = material(0x774e35, 0.05, 0.8);
  const accent = material(0x44535a, 0.4, 0.4);
  const gripMat = material(0x202527, 0.25, 0.6);
  let muzzleZ = 0.2;

  switch (id) {
    case 'bio': {
      const body = material(0x4e6751, 0.45, 0.45);
      addBox(group, 0.1, 0.13, 0.34, 0, 0.03, 0.03, body);
      addBox(group, 0.065, 0.08, 0.22, 0, 0.0, -0.22, dark);
      addBox(group, 0.08, 0.15, 0.06, 0, -0.09, 0.02, gripMat, 0.22);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.2, 10), material(0x79ffb0, 0.2, 0.18, 0x4dff9f, 1.8));
      glass.rotation.x = Math.PI / 2;
      glass.position.set(0, 0.115, 0.06);
      group.add(glass);
      for (let n = 0; n < 3; n++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.009, 4, 10), material(0x93b498, 0.5, 0.3));
        ring.position.set(0, 0.03, 0.16 + n * 0.045);
        group.add(ring);
      }
      addCylinder(group, 0.025, 0.033, 0.25, 8, 0, 0.02, 0.28, steel);
      addBox(group, 0.04, 0.04, 0.12, 0, 0.02, 0.41, material(0xa4ffc9, 0.2, 0.2, 0x63ff9f, 2.5));
      muzzleZ = 0.5;
      break;
    }
    case 'bow': {
      const bowMat = material(0x6b4a2e, 0.1, 0.55);
      const grip = addBox(group, 0.055, 0.25, 0.06, 0, 0, 0.02, wood);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 5, 28, Math.PI * 1.18), bowMat);
      arc.rotation.z = -Math.PI * 0.59;
      arc.position.set(0, 0, 0.1);
      group.add(arc);
      const tipMat = material(0xd6c39b, 0.3, 0.4);
      addBox(group, 0.02, 0.04, 0.04, -0.355, 0, 0.12, tipMat);
      addBox(group, 0.02, 0.04, 0.04, 0.355, 0, 0.12, tipMat);
      const stringGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.34, 0, 0.11), new THREE.Vector3(0, 0, -0.17), new THREE.Vector3(0.34, 0, 0.11),
      ]);
      const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xe4d8bc }));
      group.add(string);
      addCylinder(group, 0.012, 0.012, 0.4, 5, 0, 0, 0.17, wood);
      muzzleZ = 0.25;
      break;
    }
    case 'pistol':
    case 'policePistol': {
      const slideMat = id === 'policePistol' ? material(0x35424c, 0.75, 0.3) : dark;
      addBox(group, 0.055, 0.075, 0.23, 0, 0.045, 0.05, slideMat);
      addBox(group, 0.052, 0.16, 0.075, 0, -0.075, -0.035, gripMat, 0.19);
      addCylinder(group, 0.014, 0.014, 0.09, 8, 0, 0.045, 0.17, black);
      addBox(group, 0.03, 0.025, 0.05, 0, 0.087, -0.055, black);
      if (id === 'policePistol') addBox(group, 0.058, 0.016, 0.12, 0, 0.002, 0.04, material(0x9ec86b, 0.1, 0.5));
      muzzleZ = 0.23;
      break;
    }
    case 'smg': {
      addBox(group, 0.085, 0.11, 0.35, 0, 0.04, 0.02, dark);
      addBox(group, 0.075, 0.065, 0.22, 0, 0.045, -0.26, black);
      addBox(group, 0.05, 0.16, 0.07, 0, -0.09, -0.03, gripMat, 0.15);
      addBox(group, 0.06, 0.19, 0.08, 0, -0.11, 0.1, gripMat, 0.04);
      addCylinder(group, 0.017, 0.017, 0.18, 8, 0, 0.045, 0.28, steel);
      addBox(group, 0.035, 0.035, 0.18, 0, 0.11, -0.02, accent);
      addBox(group, 0.02, 0.04, 0.1, 0, 0.15, 0.09, dark);
      muzzleZ = 0.39;
      break;
    }
    case 'sniper': {
      addBox(group, 0.07, 0.09, 0.55, 0, 0.02, 0.08, dark);
      addBox(group, 0.075, 0.13, 0.26, 0, -0.01, -0.3, material(0x4d523b, 0.2, 0.7));
      addBox(group, 0.055, 0.15, 0.065, 0, -0.09, -0.15, gripMat, 0.2);
      addCylinder(group, 0.017, 0.017, 0.7, 8, 0, 0.03, 0.58, steel);
      const scope = addCylinder(group, 0.042, 0.042, 0.26, 10, 0, 0.13, 0.03, black);
      addCylinder(group, 0.052, 0.052, 0.05, 10, 0, 0.13, 0.17, accent);
      addCylinder(group, 0.052, 0.052, 0.05, 10, 0, 0.13, -0.11, accent);
      addBox(group, 0.08, 0.025, 0.16, 0, -0.02, 0.38, accent);
      addBox(group, 0.035, 0.06, 0.22, 0, -0.025, 0.52, dark);
      muzzleZ = 0.84;
      break;
    }
    case 'tranq': {
      addBox(group, 0.065, 0.09, 0.22, 0, 0.04, 0.03, material(0x4a5e5a, 0.4, 0.4));
      addBox(group, 0.05, 0.16, 0.075, 0, -0.075, -0.03, gripMat, 0.18);
      addCylinder(group, 0.022, 0.022, 0.2, 8, 0, 0.045, 0.21, steel);
      const can = addCylinder(group, 0.042, 0.042, 0.14, 10, 0, 0.13, -0.01, material(0x78db7d, 0.2, 0.2, 0x50d46d, 1.2));
      addBox(group, 0.02, 0.07, 0.12, 0, -0.03, 0.16, material(0xc6e8d0, 0.1, 0.4));
      muzzleZ = 0.34;
      break;
    }
    case 'knife': {
      addBox(group, 0.045, 0.055, 0.16, 0, 0, -0.04, gripMat);
      addBox(group, 0.1, 0.035, 0.03, 0, 0, 0.045, steel);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 4), material(0xcdd7d3, 0.9, 0.18));
      blade.rotation.x = Math.PI / 2;
      blade.scale.set(0.6, 1, 1.2);
      blade.position.set(0, 0.005, 0.22);
      group.add(blade);
      muzzleZ = 0.2;
      break;
    }
    case 'grenade': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), material(0x526448, 0.25, 0.65));
      body.scale.y = 1.3;
      group.add(body);
      addCylinder(group, 0.03, 0.035, 0.045, 8, 0, 0.1, 0, steel, 0, 0, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 4, 10), steel);
      ring.position.set(0.03, 0.13, 0);
      ring.rotation.y = 0.7;
      group.add(ring);
      muzzleZ = 0.1;
      break;
    }
    default:
      addBox(group, 0.06, 0.08, 0.2, 0, 0, 0, dark);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'bow' ? 0 : 0.045, muzzleZ);
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  return group;
}
