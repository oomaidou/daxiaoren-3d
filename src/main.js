import * as THREE from 'three';
import { World, MAP_SIZE, HALF_MAP } from './world.js';
import { Human } from './human.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { WEAPONS, STARTING_WEAPONS, LOOT_SLOTS } from './weapons.js';
import { CivilianAI, ResponderAI, RESPONDER_PARAMS } from './ai.js';
import {
  clamp, damp, dampAngle, rand, randInt, chance, choose, formatNumber, TAU, raySphere, disposeObject3D,
} from './utils.js';

const STAR_THRESHOLDS = [0, 1, 2, 4, 7, 11];
const RESPONSE_CAP = [0, 4, 6, 8, 10, 13];
const COMBO_WINDOW = 3.6;
const INTERACT_RADIUS = 2.9;
const UNLOCK_LABELS = { policePistol: '警用手枪', smg: '特警冲锋枪', sniper: '军用狙击枪', knife: '战术匕首' };

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function makeAmmo() {
  return {
    bio: {},
    bow: { count: 24 },
    pistol: { mag: 12, reserve: Infinity },
    grenade: { count: 5 },
    tranq: { mag: 6, reserve: 24 },
    policePistol: { mag: 15, reserve: 45 },
    smg: { mag: 30, reserve: 90 },
    sniper: { mag: 5, reserve: 20 },
    knife: {},
  };
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.world = null;
    this.effects = null;
    this.ui = new UI(this);
    this.audio = new AudioEngine(this);
    this.player = null;
    this.humans = [];
    this.civilians = [];
    this.responders = [];
    this.lootDrops = [];
    this.supplyCrates = [];
    this.projectiles = [];
    this.grenades = [];
    this.bioTarget = null;
    this.bioDistance = 7.5;
    this.playerProne = false;
    this.smokeCount = 3;
    this.smokeCooldown = 0;
    this.smokeClouds = [];
    this._proneTipShown = false;
    this._smokeTipShown = false;
    this.bioBeam = null;
    this.bioBeamGlow = null;
    this.hoverHit = null;
    this.hoverTarget = null;
    this.bowDraw = 0;
    this.bowDrawing = false;
    this.aimHeld = false;
    this.mouseDown = false;
    this.fireCooldown = 0;
    this.weaponSwitchCooldown = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.trauma = 0;
    this.time = 0;
    this.gameTime = 0;
    this.menuTime = 0;
    this.startedAt = 0;
    this.lastKillTime = -100;
    this.lastGunshotTime = -100;
    this.lastPlayerHitTime = -100;
    this.lastFrame = performance.now();
    this.keys = Object.create(null);
    this.currentWeapon = 'bio';
    this.previousWeapon = 'pistol';
    this.unlocked = new Set(STARTING_WEAPONS);
    this.ammo = makeAmmo();
    this.reload = { active: false, time: 0, total: 0, id: null };
    this.score = 0;
    this.kills = 0;
    this.civilianKills = 0;
    this.responderKills = 0;
    this.combo = 1;
    this.comboUntil = 0;
    this.heat = 0;
    this.wantedStars = 0;
    this.nextWaveAt = Infinity;
    this.waveNumber = 0;
    this.calmTimer = 0;
    this.started = false;
    this.paused = false;
    this.gameOver = false;
    this.isScoped = false;
    this.pointerLocked = false;
    this.pointerLockWasActive = false;
    this.lockFailed = false;
    this.hasShownFirstLoot = false;
    this.hasShownFirstResponderKill = false;
    this.hasShownComboTip = false;
    this.hasShownArmorTip = false;
    this.menuCameraLook = new THREE.Vector3();
    this.cameraYaw = 2.34;
    this.cameraPitch = -0.04;
    this.lookDir = new THREE.Vector3(0, 0, -1);
    this.cameraForward = new THREE.Vector3();
    this.cameraRight = new THREE.Vector3();
    this.tempVec = new THREE.Vector3();
    this.tempVec2 = new THREE.Vector3();
    this.tempPos = new THREE.Vector3();
    this.playerVelocity = new THREE.Vector3();
    this.playerHeight = 0;
    this.playerVy = 0;
    this.onGround = true;
    this.stepTimer = 0;
    this.hudTimer = 0;
    this.minimapTimer = 0;
    this.civilianTimer = 3;
    this.playerFootTimer = 0;
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.deathTimer = 0;
    this.deathShown = false;
    this.debugGod = false;
    this.godMode = false;
    this.suppressNextPause = false;
    this._bindEvents();
    this._bindUI();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.__XIAOREN3D__ = this;
  }

  async boot() {
    this.ui.setLoading(0.06, '正在规划街区网格 / PLANNING THE BLOCKS');
    await nextFrame();
    this.ui.setLoading(0.16, '正在铺设沥青与斑马线 / PAVING STREETS');
    await new Promise(r => setTimeout(r, 30));
    this.world = new World(this.scene, this.renderer);
    this.ui.setLoading(0.65, '正在摆放房屋、树与路灯 / PLACING HOUSES');
    await nextFrame();
    this.effects = new Effects(this, this.scene);
    this.createBioBeam();
    this.spawnPlayer();
    this.createSupplyCrates();
    this.spawnInitialCivilians();
    this.ui.setLoading(0.93, '正在叫醒居民 / WAKING UP THE NEIGHBOURHOOD');
    await nextFrame();
    this.ui.setLoading(1, '自由街区已就绪 / READY');
    await new Promise(r => setTimeout(r, 260));
    this.ui.showStart();
    this.syncWeaponUI(true);
    this.ui.setVitals(100, 0);
    this.ui.setWanted(0);
    this.ui.setScore(0, 0, '00:00', 1);
    this.renderer.render(this.scene, this.camera);
    this.lastFrame = performance.now();
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  spawnPlayer() {
    const p = this.world.spawnPlayerPoint();
    this.player = new Human(this, {
      type: 'player',
      x: p.x, z: p.z, heading: this.cameraYaw + Math.PI,
    });
    this.player.setWeapon(this.currentWeapon);
    this.player.setAiming(false);
    this.cameraYaw = 2.34;
    this.cameraPitch = -0.035;
  }

  // ------------------------------------------------------------------ events
  _bindEvents() {
    this._onKeyDown = (e) => {
      if (e.code === 'KeyM' && !e.repeat) {
        this.audio.init();
        const muted = this.audio.toggleMute();
        this.ui.setMuted(muted);
        this.ui.toast(muted ? '已静音' : '声音已开启', '按 M 可以随时切换', '', 1100);
        return;
      }
      if (!this.started || this.gameOver) return;
      if (this.paused) {
        if (e.code === 'KeyP' || e.code === 'Escape') {
          e.preventDefault();
          this.resume();
        }
        return;
      }
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.pause();
        return;
      }
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyF') this.throwBioTarget();
      if (e.code === 'KeyQ') this.quickSwitch();
      if (e.code === 'KeyC') this.toggleProne();
      if (e.code === 'KeyG') this.throwSmokeGrenade();
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.selectWeapon(this.ui.hotbarOrder[n - 1]);
      }
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.started || this.paused || this.gameOver) return;
      if (!this.pointerLocked && !this.lockFailed) return;
      const sens = 0.00215 * (this.isScoped ? 0.52 : 1);
      this.cameraYaw -= (e.movementX || 0) * sens;
      this.cameraPitch = clamp(this.cameraPitch - (e.movementY || 0) * sens, -1.18, 1.12);
    };
    this._onMouseDown = (e) => {
      if (!this.started || this.paused || this.gameOver) return;
      if (!this.pointerLocked) {
        this.requestPointerLock();
      }
      if (e.button === 0) {
        e.preventDefault();
        this.mouseDown = true;
        this.onAttackDown();
      } else if (e.button === 2) {
        e.preventDefault();
        this.aimHeld = true;
        if (this.currentWeapon === 'sniper' && !this.reload.active) this.isScoped = true;
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
        if (this.bowDrawing) this.releaseBow();
      } else if (e.button === 2) {
        this.aimHeld = false;
      }
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onWheel = (e) => {
      if (!this.started || this.paused || this.gameOver) return;
      e.preventDefault();
      if (this.bioTarget) {
        this.bioDistance = clamp(this.bioDistance - Math.sign(e.deltaY) * 0.9, 2.5, 23);
        return;
      }
      if (this.weaponSwitchCooldown > 0) return;
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    };
    this._onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      this.pointerLocked = locked;
      if (locked) {
        this.pointerLockWasActive = true;
        this.lockFailed = false;
        document.body.style.cursor = 'none';
      } else {
        if (this.started && !this.paused && !this.gameOver && this.pointerLockWasActive) {
          this.pause();
        }
        if (!this.gameOver) document.body.style.cursor = this.started && !this.paused ? 'none' : 'default';
      }
    };
    this._onPointerLockError = () => {
      this.enableLockFallback();
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
    window.addEventListener('blur', () => {
      this.mouseDown = false;
      this.aimHeld = false;
      if (this.bowDrawing) this.cancelBowDraw();
      if (this.started && !this.paused && !this.gameOver) this.pause();
    });
  }

  _bindUI() {
    this.ui.bind({
      start: () => this.start(),
      resume: () => this.resume(),
      mute: () => {
        this.audio.init();
        const muted = this.audio.toggleMute();
        this.ui.setMuted(muted);
      },
      restart: () => this.restart(),
    });
  }

  requestPointerLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.enableLockFallback());
    } catch (e) {
      this.enableLockFallback();
    }
    setTimeout(() => {
      if (this.started && !this.paused && !this.gameOver && !document.pointerLockElement) {
        this.enableLockFallback();
      }
    }, 900);
  }

  enableLockFallback() {
    if (this.pointerLocked) return;
    this.lockFailed = true;
    if (this.started && !this.paused && !this.gameOver) {
      // Keep the native pointer out of the way: the custom crosshair at screen
      // centre is the aiming point, so a visible OS pointer would be misleading.
      document.body.style.cursor = 'none';
      if (!this._lockErrorToastShown) {
        this._lockErrorToastShown = true;
        this.ui.toast('鼠标已进入瞄准模式', '移动鼠标瞄准中心准星；点击画面可以再次尝试锁定指针。', '', 3400);
      }
    }
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --------------------------------------------------------------- lifecycle
  start() {
    if (this.started && !this.gameOver) return;
    this.started = true;
    this.paused = false;
    this.gameOver = false;
    this.pointerLockWasActive = false;
    this.gameTime = 0;
    this.startedAt = performance.now();
    this.lastKillTime = -100;
    this.lastGunshotTime = -100;
    this.lastPlayerHitTime = -100;
    this.combo = 1;
    this.heat = 0;
    this.wantedStars = 0;
    this.nextWaveAt = Infinity;
    this.calmTimer = 0;
    this.ui.hideStart();
    this.ui.hideDeath();
    this.ui.setScoped(false);
    this.ui.setWanted(0);
    this.playerProne = false;
    this.player.setProne(false);
    this.ui.setProne(false);
    this.smokeCount = 3;
    this.smokeCooldown = 0;
    this.ui.setSmokeCount(this.smokeCount);
    this.audio.init();
    this.audio.play('ui', { volume: 0.7 });
    this.player.armorPlates = 10;
    this.player.syncArmorVisual();
    this.player.hp = 100;
    this.player.dead = false;
    this.player.state = 'normal';
    this.player.root.visible = true;
    this.player.cleanupTimer = -1;
    this.player.root.position.set(this.world.startPos.x, 0, this.world.startPos.z);
    document.body.style.cursor = 'none';
    this.cameraYaw = 2.34;
    this.cameraPitch = -0.035;
    this.player.targetFacing = this.cameraYaw + Math.PI;
    this.selectWeapon('bio', true);
    this.updateCamera(0, true);
    this.requestPointerLock();
    this.lastFrame = performance.now();
    this.ui.syncHotbar(this.unlocked, this.currentWeapon, this.getHotbarCounts());
    this.syncWeaponUI(true);
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
    this.ui.setScore(0, 0, '00:00', 1);
    setTimeout(() => {
      if (!this.started) return;
      this.ui.toast('自由街区已开放', '1–9 切换武器 · C 趴下无敌 · G 烟雾弹 · E 搜刮装备', '', 4200);
    }, 260);
    setTimeout(() => {
      if (!this.started) return;
      this.ui.toast('生物枪已就绪', '看向一个小人，左键牵引。移动鼠标把他拖到任何地方，F 抛飞。', 'success', 4800);
    }, 5200);
  }

  pause() {
    if (!this.started || this.paused || this.gameOver) return;
    this.paused = true;
    this.pointerLockWasActive = false;
    this.mouseDown = false;
    this.aimHeld = false;
    this.isScoped = false;
    this.ui.setScoped(false);
    this.player.root.visible = true;
    this.keys = Object.create(null);
    if (this.bowDrawing) this.cancelBowDraw();
    this.audio.stopBeam();
    this.ui.setScoped(false);
    this.ui.showPause({
      score: this.score, kills: this.kills, stars: this.wantedStars,
    });
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    document.body.style.cursor = 'default';
    this.audio.setPaused?.(true);
  }

  resume() {
    if (!this.paused || this.gameOver) return;
    this.paused = false;
    this.ui.hidePause();
    this.audio.init();
    this.audio.setPaused?.(false);
    this.audio.play('ui', { volume: 0.5 });
    this.requestPointerLock();
    this.lastFrame = performance.now();
  }

  restart() {
    this.ui.clearTransientUI();
    this.ui.hidePause();
    this.ui.hideDeath();
    this.ui.setScoped(false);
    this.audio.stopBeam();
    this.audio.init();
    this.cleanupDynamic();
    this.keys = Object.create(null);
    this.godMode = false;
    this.player.hp = 100;
    this.player.armorPlates = 10;
    this.player.dead = false;
    this.player.state = 'normal';
    this.player.removed = false;
    this.player.cleanupTimer = -1;
    this.player.thrownMode = false;
    this.player.aiming = false;
    this.player.aimAmount = 0;
    this.player.recoil = 0;
    this.player.lastDamageWeapon = null;
    this.player.poolSpawned = false;
    this.player.root.position.set(this.world.startPos.x, 0, this.world.startPos.z);
    this.player.root.visible = true;
    this.player.bob.position.y = 0;
    this.player.bodyPivot.position.y = 0.84;
    this.player.bodyPivot.rotation.set(0, 0, 0);
    this.player.weaponId = null;
    this.player.setWeapon('bio');
    if (!this.player.root.parent) this.scene.add(this.player.root);
    this.player.syncArmorVisual();
    this.currentWeapon = 'bio';
    this.previousWeapon = 'pistol';
    this.unlocked = new Set(STARTING_WEAPONS);
    this.ammo = makeAmmo();
    this.score = 0;
    this.kills = 0;
    this.civilianKills = 0;
    this.responderKills = 0;
    this.combo = 1;
    this.comboUntil = 0;
    this.heat = 0;
    this.wantedStars = 0;
    this.nextWaveAt = Infinity;
    this.waveNumber = 0;
    this.calmTimer = 0;
    this.fireCooldown = 0;
    this.weaponSwitchCooldown = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.trauma = 0;
    this.bowDrawing = false;
    this.bowDraw = 0;
    this.player.setBowDraw(0);
    this.bioTarget = null;
    this.playerProne = false;
    this.player.setProne(false);
    this.ui.setProne(false);
    this.smokeCount = 3;
    this.smokeCooldown = 0;
    this.aimHeld = false;
    this.mouseDown = false;
    this.isScoped = false;
    this.gameTime = 0;
    this.startedAt = performance.now();
    this.lastKillTime = -100;
    this.lastGunshotTime = -100;
    this.lastPlayerHitTime = -100;
    this.gameOver = false;
    this.deathShown = false;
    this.deathTimer = 0;
    this.cameraYaw = 2.34;
    this.cameraPitch = -0.035;
    this.player.horizontalSpeed = 0;
    this.started = true;
    this.paused = false;
    this.pointerLockWasActive = false;
    this.spawnInitialCivilians();
    this.resetSupplyCrates();
    this.ui.hideStart();
    this.ui.hidePause();
    this.setBeamVisible(false);
    this.syncWeaponUI(true);
    this.ui.syncHotbar(this.unlocked, this.currentWeapon, this.getHotbarCounts());
    this.updateCamera(0, true);
    this.requestPointerLock();
    this.ui.setWanted(0);
    this.ui.setScore(0, 0, '00:00', 1);
    this.ui.setVitals(100, 10);
    this.ui.setSmokeCount(this.smokeCount);
    this.ui.setTarget(null);
    this.ui.setPrompt(null);
    this.ui.setGrabbing(false);
    this.lastFrame = performance.now();
    this.ui.toast('街区已经重置', '所有人都忘了刚才发生的事。防弹衣也忘了。', '', 2800);
  }

  cleanupDynamic() {
    for (const h of this.humans) {
      if (h.ai?.onRemove) h.ai.onRemove();
      h.dispose();
    }
    for (const l of this.lootDrops) { this.scene.remove(l.root); disposeObject3D(l.root, true); }
    for (const p of this.projectiles) this.removeProjectileMesh(p.mesh, true);
    for (const g of this.grenades) this.removeProjectileMesh(g.mesh, true);
    for (const c of this.smokeClouds) c.visual.dispose();
    this.smokeClouds = [];
    this.humans = [];
    this.civilians = [];
    this.responders = [];
    this.lootDrops = [];
    this.projectiles = [];
    this.grenades = [];
    this.effects?.clear?.();
    this.bioTarget = null;
  }

  // ------------------------------------------------------------------- loop
  _loop() {
    this._raf = requestAnimationFrame(this._loop.bind(this));
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = Math.min(dt, 0.045);
    if (dt <= 0) return;
    this.time += dt;
    this.frameCount++;
    if (now - this.lastFpsTime > 1000) {
      this.fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    if (!this.started) {
      this.updateMenu(dt);
    } else if (this.gameOver) {
      this.updateAfterDeath(dt);
    } else if (!this.paused) {
      this.updateGame(dt);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.started && !this.paused && !this.gameOver) {
      const w = this.renderer.domElement.clientWidth;
      const h = this.renderer.domElement.clientHeight;
      this.ui.updateFloaters(this.camera, w, h, dt);
    }
    this.uiFps = this.fps;
  }

  updateMenu(dt) {
    this.menuTime += dt;
    this.world.update(dt, this.player.root.position);
    this.updateEnvironmentAnimations(dt);
    for (const ai of this.civilians) ai.update(dt);
    for (const h of this.humans) h.update(dt);
    this.player.update(dt);
    this.effects.update(dt);
    // Low, warm establishing shot from the street east of the park. It keeps
    // the sun in frame and shows both houses and the downtown edge.
    const t = this.menuTime;
    const lookX = -28, lookZ = 22;
    const camX = 8 + Math.sin(t * 0.052) * 1.4;
    const camZ = 40 + Math.cos(t * 0.043) * 1.1;
    const camY = 10 + Math.sin(t * 0.077) * 0.55;
    this.camera.position.set(camX, camY, camZ);
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(lookX + Math.sin(t * 0.031) * 2.2, 1.8, lookZ + Math.cos(t * 0.025) * 1.6);
    this.camera.updateMatrixWorld();
    this.audio.update(dt, 0);
  }

  updateGame(dt) {
    this.gameTime += dt;
    // Constant, requested recovery: 5 HP per second, capped at 100.
    if (this.player && !this.player.dead) {
      this.player.hp = Math.min(100, this.player.hp + 5 * dt);
    }
    if (this.combo > 1 && this.gameTime > this.comboUntil) {
      this.combo = 1;
    }
    if (this.audio) this.audio.update(dt, this.wantedStars);
    this.smokeCooldown = Math.max(0, this.smokeCooldown - dt);
    this.updateSmokeClouds(dt);
    this.updateWaveDirector(dt);
    this.updateHeatDecay(dt);
    this.updatePlayerMovement(dt);
    if (this.gameOver) return;
    this.updateCamera(dt);
    this.updateAimTargets();
    this.updateWeapon(dt);
    if (this.gameOver) return;
    this.updateBioTarget(dt);
    this.updateProjectiles(dt);
    this.updateGrenades(dt);
    this.world.updateFlowField(this.player.root.position.x, this.player.root.position.z);
    this.updateAI(dt);
    if (this.gameOver) return;
    for (const h of this.humans) h.update(dt);
    this.player.update(dt);
    this.updateWorldAndEffects(dt);
    this.updateSupplyCrates(dt);
    this.updateLootDrops(dt);
    this.updateCivilianPopulation(dt);
    this.cleanupDead();
    this.updatePrompts();
    this.updateHUD(dt);
  }

  updateAfterDeath(dt) {
    this.deathTimer += dt;
    this.world.update(dt, this.player.root.position);
    this.world.updateFlowField(this.player.root.position.x, this.player.root.position.z);
    for (const h of this.humans) h.update(dt);
    this.player.update(dt);
    this.effects.update(dt);
    this.updateEnvironmentAnimations(dt);
    this.audio.update(dt, 0);
    if (!this.deathShown && this.deathTimer > 1.35) {
      this.deathShown = true;
      this.ui.showDeath({
        score: this.score, kills: this.kills, time: formatTime(this.gameTime),
      });
      this.saveBest();
    }
    // Slow orbit over the player's body.
    const p = this.player.root.position;
    const angle = 0.7 + this.deathTimer * 0.22;
    this.camera.position.set(p.x + Math.cos(angle) * 4.3, p.y + 2.5, p.z + Math.sin(angle) * 4.3);
    this.camera.lookAt(p.x, p.y + 0.3, p.z);
    this.camera.fov = damp(this.camera.fov, 52, 2, dt);
    this.camera.updateProjectionMatrix();
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
  }

  toggleProne() {
    if (!this.started || this.paused || this.gameOver || !this.player || this.player.dead) return;
    this.playerProne = !this.playerProne;
    this.player.setProne(this.playerProne);
    this.ui.setProne(this.playerProne);
    if (this.playerProne) {
      this.playerVy = 0;
      this.onGround = true;
      this.player.root.position.y = 0;
      if (this.bowDrawing) this.cancelBowDraw();
      if (this.bioTarget) this.releaseBioTarget(false, false);
      this.audio.play('prone', { volume: 0.45 });
      if (!this._proneTipShown) {
        this._proneTipShown = true;
        this.ui.toast('趴下 · 无敌', '伤害完全免疫，生命仍会每秒回复 5 点。趴着也可以移动和开火；按 C 起身。', 'success', 4400);
      }
    } else {
      this.audio.play('stand', { volume: 0.35 });
    }
    this.updateCamera(0, true);
  }

  updatePlayerMovement(dt) {
    if (!this.player || this.player.dead) return;
    const p = this.player.root.position;
    const isAiming = (this.aimHeld || this.bowDrawing || !!this.bioTarget) && !this.isScoped;
    const inputX = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const inputZ = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    const sprint = !!this.keys.ShiftLeft || !!this.keys.ShiftRight;
    const forward = this.tempVec.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = this.tempVec2.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const wish = new THREE.Vector3()
      .addScaledVector(forward, inputZ)
      .addScaledVector(right, inputX);
    const wishLen = wish.length();
    if (wishLen > 0) wish.normalize();
    let speed = 4.4;
    if (sprint && !isAiming && !this.isScoped) speed = 7.15;
    if (isAiming) speed = 2.6;
    if (this.isScoped) speed = 1.35;
    if (this.reload.active) speed *= 0.82;
    if (this.playerProne) speed = 1.25;
    const moving = wishLen > 0.01;
    const actuallyMoving = moving ? speed : 0;
    if (moving) {
      const nx = p.x + wish.x * speed * dt;
      const nz = p.z + wish.z * speed * dt;
      this.tempPos.set(nx, 0, nz);
      this.world.collideCircle(this.tempPos, 0.4);
      p.x = this.tempPos.x;
      p.z = this.tempPos.z;
    }
    this.player.horizontalSpeed = actuallyMoving;
    this.player.setLocomotion(actuallyMoving, sprint && !isAiming, moving);
    const shouldFaceAim = isAiming || this.isScoped || this.fireCooldown > 0.12;
    if (shouldFaceAim) {
      this.player.setFacing(Math.atan2(this.lookDir.x, this.lookDir.z));
    } else if (moving) {
      this.player.setFacing(Math.atan2(wish.x, wish.z));
    }
    this.player.setAiming(isAiming || this.isScoped);
    this.player.setBowDraw(this.bowDrawing ? this.bowDraw : 0);
    // Jump and gravity.
    if (this.keys.Space && this.onGround && !this.playerProne) {
      this.playerVy = 5.9;
      this.onGround = false;
      this.audio.play('jump', { volume: 0.25 });
    }
    if (!this.onGround || p.y > 0.001) {
      this.playerVy -= 16.5 * dt;
      p.y += this.playerVy * dt;
      if (p.y <= 0) {
        p.y = 0;
        if (!this.onGround) {
          this.audio.play('land', { volume: 0.3 });
          this.trauma = Math.min(1, this.trauma + 0.04);
        }
        this.playerVy = 0;
        this.onGround = true;
      }
    } else {
      p.y = 0;
      this.onGround = true;
    }
    // footstep sound
    if (actuallyMoving && this.onGround) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = this.playerProne ? 0.7 : sprint ? 0.29 : 0.46;
        this.audio.play('footstep', { volume: this.playerProne ? 0.05 : 0.12, pan: 0 });
      }
    } else {
      this.stepTimer = 0.2;
    }
    this.player.horizontalSpeed = actuallyMoving;
  }

  updateCamera(dt, immediate = false) {
    if (!this.player) return;
    this.recoilPitch = damp(this.recoilPitch, 0, 13, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 13, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.isScoped = this.currentWeapon === 'sniper' && this.aimHeld && !this.reload.active && this.unlocked.has('sniper');
    this.ui.setScoped(this.isScoped);
    const t = this.time;
    const shake = this.trauma * this.trauma;
    const shakePitch = (Math.sin(t * 53.1) + Math.sin(t * 31.7) * 0.6) * shake * 0.023;
    const shakeYaw = (Math.sin(t * 41.4 + 1.3) + Math.sin(t * 23.8) * 0.5) * shake * 0.02;
    const shakeRoll = Math.sin(t * 37.7 + 2.1) * shake * 0.016;
    const yaw = this.cameraYaw + this.recoilYaw + shakeYaw;
    const pitch = clamp(this.cameraPitch + this.recoilPitch + shakePitch, -1.24, 1.18);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const forward = this.cameraForward.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp).normalize();
    const right = this.cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const p = this.player.root.position;
    const prone = !!this.player.prone;
    const eyeY = prone ? 0.68 : 1.56;
    const head = this.tempVec.set(p.x, p.y + eyeY * this.player.scale, p.z);
    let scopedNow = this.isScoped;
    if (scopedNow) {
      const dist = 0.02;
      this.camera.position.set(head.x + forward.x * dist, head.y + forward.y * dist, head.z + forward.z * dist);
      this.camera.rotation.set(pitch, yaw, shakeRoll);
      this.player.root.visible = false;
      this.camera.fov = damp(this.camera.fov, 27, immediate ? 1000 : 18, dt);
    } else {
      const dist = prone ? (this.aimHeld ? 2.4 : 3.5) : (this.aimHeld ? 2.9 : 4.35);
      const shoulder = prone ? 0.55 : (this.aimHeld ? 0.58 : 0.74);
      const desired = this.tempVec2.copy(head)
        .addScaledVector(forward, -dist)
        .addScaledVector(right, shoulder);
      desired.y += prone ? 0.38 : (this.aimHeld ? 0.08 : 0.16);
      const resolved = this.world.cameraCollision(head, desired, 0.24);
      this.camera.position.copy(resolved);
      if (this.camera.position.y < (prone ? 0.32 : 0.42)) this.camera.position.y = prone ? 0.32 : 0.42;
      this.camera.rotation.set(pitch, yaw, shakeRoll);
      const camDist = this.camera.position.distanceTo(head);
      this.player.root.visible = camDist > 1.15;
      let targetFov = 64;
      if (this.aimHeld || this.bowDrawing) targetFov = 51;
      this.camera.fov = damp(this.camera.fov, targetFov, immediate ? 1000 : 11, dt);
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.lookDir);
    const velocity = this.player.horizontalSpeed || 0;
    this.player.setLocomotion(velocity, !!(this.keys.ShiftLeft || this.keys.ShiftRight) && !this.aimHeld, velocity > 0.2);
  }

  updateAimTargets() {
    if (!this.player || this.player.dead) return;
    const maxRange = this.currentWeapon === 'bio' ? 30 : 150;
    const includeDead = this.currentWeapon === 'bio';
    const hit = this.world.pickHuman(this.camera.position, this.lookDir, maxRange, this.humans, includeDead);
    this.hoverHit = hit;
    this.hoverTarget = hit && !hit.human.dead ? hit.human : null;
    let mode = null;
    if (this.bioTarget) {
      mode = 'bio';
    } else if (hit) {
      if (this.currentWeapon === 'bio') mode = 'bio';
      else mode = hit.human.isResponder ? 'enemy' : 'friendly';
    }
    this.ui.setCrosshair(mode);
    const shown = this.bioTarget || this.hoverTarget;
    this.ui.setTarget(shown && !shown.dead ? shown : null);
    if (this.bioTarget) this.ui.setReticleType(`拖拽中 · ${this.bioDistance.toFixed(1)}m · F 抛飞`);
    else if (hit && this.currentWeapon === 'bio') this.ui.setReticleType(hit.human.dead ? '可牵引尸体' : '左键牵引');
    else this.ui.setReticleType('');
    this.ui.setGrabbing(!!this.bioTarget);
  }

  // ----------------------------------------------------------------- weapons
  get currentDef() { return WEAPONS[this.currentWeapon]; }

  syncWeaponUI(force = false) {
    const def = this.currentDef;
    if (!def) return;
    const canUse = this.unlocked.has(def.id);
    let ammoBig = '<span class="inf">∞</span>';
    let ammoText = '';
    let mode = '';
    const st = this.ammo[def.id];
    if (!canUse) {
      ammoBig = '<span class="inf">锁</span>';
      mode = '尚未获得';
    } else if (def.ammoType === 'mag' && st) {
      const reserve = st.reserve === Infinity ? '∞' : Math.max(0, Math.floor(st.reserve));
      ammoBig = `<span class="mag">${st.mag}</span><span class="reserve">/ ${reserve}</span>`;
      ammoText = `${st.mag}/${reserve}`;
      mode = def.scope ? '精确射手 · 右键开镜' : def.automatic ? '全自动' : '半自动';
    } else if (def.ammoType === 'count' && st) {
      ammoBig = `<span class="mag">${st.count}</span><span class="reserve">${def.id === 'bow' ? '支箭' : '枚'}</span>`;
      ammoText = `${st.count}`;
      mode = def.id === 'grenade' ? '投掷武器' : '按住蓄力 · 松开发射';
    } else if (def.kind === 'melee') {
      ammoBig = '<span class="inf">∞</span>';
      mode = '近战 · 无视防弹衣';
    } else if (def.kind === 'bio') {
      ammoBig = '<span class="inf">∞</span>';
      mode = this.bioTarget ? '牵引中 · F 抛飞' : '牵引模式 · 左键抓取';
    }
    this.ui.updateWeapon(def, ammoText, ammoBig, this.reload.active && this.reload.id === def.id, this.reload.active ? 1 - this.reload.time / this.reload.total : 0, mode, canUse);
    this.ui.syncHotbar(this.unlocked, this.currentWeapon, this.getHotbarCounts());
  }

  getHotbarCounts() {
    const counts = {};
    for (const id of this.ui.hotbarOrder) {
      const def = WEAPONS[id];
      if (!def) continue;
      if (!this.unlocked.has(id)) { counts[id] = null; continue; }
      const st = this.ammo[id];
      if (def.ammoType === 'count') counts[id] = st.count;
      else if (def.ammoType === 'mag') counts[id] = st.mag;
      else counts[id] = null;
    }
    return counts;
  }

  selectWeapon(id, silent = false) {
    if (!id || !WEAPONS[id]) return false;
    if (!this.unlocked.has(id)) {
      if (!silent) {
        this.audio.play('dry', { volume: 0.35 });
        this.ui.toast('武器尚未获得', `从 ${id === 'sniper' ? '军方狙击手' : id === 'smg' ? '特警 / 军方' : '警察'} 身上搜刮`, '', 2200);
      }
      return false;
    }
    if (this.currentWeapon === id) return true;
    if (this.bioTarget) this.releaseBioTarget(false, false);
    if (this.bowDrawing) this.cancelBowDraw();
    if (this.reload.active) this.cancelReload();
    this.previousWeapon = this.currentWeapon;
    this.currentWeapon = id;
    this.bowDrawing = false;
    this.bowDraw = 0;
    this.weaponSwitchCooldown = 0.12;
    this.player.setWeapon(id);
    this.player.setBowDraw(0);
    this.isScoped = false;
    this.ui.setScoped(false);
    if (!silent) this.audio.play('ui', { volume: 0.2 });
    this.syncWeaponUI(true);
    return true;
  }

  cycleWeapon(dir) {
    const order = this.ui.hotbarOrder;
    let idx = order.indexOf(this.currentWeapon);
    for (let i = 1; i <= order.length; i++) {
      const next = order[(idx + dir * i + order.length * 3) % order.length];
      if (this.unlocked.has(next)) {
        this.selectWeapon(next);
        return;
      }
    }
  }

  quickSwitch() {
    if (this.previousWeapon && this.unlocked.has(this.previousWeapon)) this.selectWeapon(this.previousWeapon);
  }

  getShotDirection(spread = 0) {
    const dir = this.lookDir.clone();
    if (spread > 0) {
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const s = spread * (0.55 + Math.random() * 0.45);
      const angle = Math.random() * TAU;
      dir.addScaledVector(right, Math.cos(angle) * s).addScaledVector(up, Math.sin(angle) * s).normalize();
    }
    return dir;
  }

  onAttackDown() {
    if (this.paused || this.gameOver) return;
    const def = this.currentDef;
    if (!def || !this.unlocked.has(def.id)) return;
    if (def.kind === 'bio') {
      this.toggleBioGrab();
      return;
    }
    if (def.kind === 'bow') {
      this.beginBowDraw();
      return;
    }
    this.tryFire();
  }

  tryFire() {
    if (!this.started || this.paused || this.gameOver) return;
    if (this.currentWeapon !== 'bio' && this.currentWeapon !== 'bow') {
      if (this.bioTarget) return;
    }
    if (this.fireCooldown > 0) return;
    const def = this.currentDef;
    if (!def || !this.unlocked.has(def.id)) return;
    const st = this.ammo[def.id];
    if (this.reload.active) return;
    if (def.ammoType === 'mag') {
      if (!st || st.mag <= 0) {
        this.audio.play('dry', { volume: 0.35 });
        this.startReload();
        return;
      }
    }
    if (def.ammoType === 'count' && (!st || st.count <= 0)) {
      this.audio.play('dry', { volume: 0.35 });
      this.ui.toast('弹药耗尽', def.id === 'bow' ? '在补给箱补充箭矢' : '在补给箱补充手榴弹', '', 1800);
      return;
    }
    switch (def.kind) {
      case 'hitscan': this.fireBullet(def); break;
      case 'melee': this.fireMelee(def); break;
      case 'grenade': this.throwGrenade(def); break;
      case 'tranq': this.fireDart(def); break;
      case 'bow': this.beginBowDraw(); break;
      default: break;
    }
  }

  consumeMag(def) {
    const st = this.ammo[def.id];
    st.mag -= 1;
    this.syncWeaponUI();
  }

  fireBullet(def) {
    const spread = def.spread * (this.isScoped ? 0.2 : 1) * (this.player.horizontalSpeed > 0.6 ? 1.4 : 1);
    const dir = this.getShotDirection(spread);
    const origin = this.camera.position.clone();
    const wall = this.world.raycastStatic(origin, dir, def.range + 40);
    const hit = this.world.pickHuman(origin, dir, def.range, this.humans, false);
    let end = wall.point;
    let hitHuman = null;
    let hitPart = 'body';
    if (hit && hit.dist < wall.dist + 0.2) {
      hitHuman = hit.human;
      end = hit.point;
      hitPart = hit.part;
      const damage = hitPart === 'head' ? def.headDamage : def.damage;
      const result = hitHuman.takeDamage(damage, {
        source: 'bullet', hitPart, point: end, dir, weapon: def.id,
        force: def.id === 'sniper' ? 3.5 : 0.6,
      });
      if (result.dead) {
        this.ui.hitmarker('kill');
      } else {
        this.ui.hitmarker(result.blocked ? 'armor' : hitPart === 'head' ? 'head' : 'hit');
      }
      if (result.blocked) this.ui.floatText('装甲抵挡', end, 'armor');
    } else {
      this.effects.impact(wall.point, wall.normal, chance(0.3) ? 'metal' : 'concrete');
    }
    let muzzle = this.getPlayerMuzzle();
    this.effects.tracer(muzzle, end, { color: 0xffd89b, life: 0.075 });
    this.effects.muzzleFlash(muzzle, { scale: def.id === 'sniper' ? 1.05 : 0.6, player: true });
    this.audio.play(def.id === 'sniper' ? 'playerSniper' : def.id === 'smg' ? 'playerSmg' : 'playerPistol', { volume: 0.8 });
    this.player.triggerRecoil(def.recoil > 0.02 ? 1.4 : def.id === 'smg' ? 0.4 : 0.8);
    this.recoilPitch += def.recoil * (this.isScoped ? 1.35 : 1);
    this.recoilYaw += rand(-def.recoil * 0.25, def.recoil * 0.25);
    this.trauma = Math.min(1, this.trauma + (def.id === 'sniper' ? 0.2 : 0.025));
    this.consumeMag(def);
    this.fireCooldown = def.fireInterval;
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
    this.syncWeaponUI();
  }

  fireMelee(def) {
    this.player.playMeleeSwing(0.28);
    this.audio.play('knife', { volume: 0.6 });
    this.fireCooldown = def.fireInterval;
    const p = this.player.root.position;
    let best = null, bestDist = Infinity;
    for (const h of this.humans) {
      if (h.dead) continue;
      const dx = h.root.position.x - p.x, dz = h.root.position.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > def.range + 0.9) continue;
      const ndx = dx / (dist || 1), ndz = dz / (dist || 1);
      const dot = ndx * this.lookDir.x + ndz * this.lookDir.z;
      if (dot < 0.35) continue;
      if (dist < bestDist) { best = h; bestDist = dist; }
    }
    if (best) {
      const part = 'body';
      best.takeDamage(def.damage, {
        source: 'melee', ignoreArmor: true, hitPart: part,
        point: best.getBodyCenter(), dir: new THREE.Vector3(this.lookDir.x, 0, this.lookDir.z),
        weapon: def.id,
      });
      this.ui.hitmarker(best.dead ? 'kill' : 'head');
      this.audio.play('melee', { volume: 0.5 });
      this.lastKillTime = this.time;
    } else {
      this.audio.play('dry', { volume: 0.2 });
    }
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
  }

  fireDart(def) {
    const origin = this.getPlayerMuzzle();
    // Correct for the third-person muzzle offset: the dart starts at the gun,
    // so aim it at the point under the centre reticle instead of flying parallel
    // to the camera ray.
    const wall = this.world.raycastStatic(this.camera.position, this.lookDir, 100);
    const hit = this.world.pickHuman(this.camera.position, this.lookDir, def.range, this.humans, false);
    const aimPoint = hit && hit.dist < wall.dist + 0.15 ? hit.point : wall.point;
    const dir = new THREE.Vector3().subVectors(aimPoint, origin).normalize();
    const geo = new THREE.CylinderGeometry(0.014, 0.022, 0.22, 5);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fe6bd, emissive: 0x3a7f66, emissiveIntensity: 0.5, metalness: 0.2, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      kind: 'dart', mesh, pos: origin.clone(), vel: dir.multiplyScalar(70),
      gravity: 1.6, life: 2.3, damage: 0, radius: 0.1,
    });
    this.consumeMag(def);
    this.fireCooldown = def.fireInterval;
    this.audio.play('tranq', { volume: 0.55 });
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
  }

  beginBowDraw() {
    const def = this.currentDef;
    if (def.id !== 'bow' || this.bowDrawing || this.fireCooldown > 0) return;
    const st = this.ammo.bow;
    if (st.count <= 0) {
      this.audio.play('dry', { volume: 0.35 });
      this.ui.toast('没有箭了', '补给箱可以补充箭矢', '', 1500);
      return;
    }
    this.bowDrawing = true;
    this.bowDraw = 0;
    this.audio.play('bowDraw', { volume: 0.4 });
  }

  releaseBow() {
    if (!this.bowDrawing) return;
    const def = this.currentDef;
    this.bowDrawing = false;
    if (def.id !== 'bow') { this.bowDraw = 0; this.player.setBowDraw(0); return; }
    const power = clamp(this.bowDraw, 0, 1);
    this.bowDraw = 0;
    this.player.setBowDraw(0);
    if (power < 0.13) {
      this.fireCooldown = 0.2;
      return;
    }
    const st = this.ammo.bow;
    if (st.count <= 0) {
      this.audio.play('dry', { volume: 0.3 });
      return;
    }
    st.count -= 1;
    this.fireCooldown = def.fireInterval;
    const origin = this.getPlayerMuzzle();
    const aimWall = this.world.raycastStatic(this.camera.position, this.lookDir, 150);
    let aimPoint = aimWall.point;
    const hit = this.world.pickHuman(this.camera.position, this.lookDir, 120, this.humans, false);
    if (hit && hit.dist < aimWall.dist + 0.3) aimPoint = hit.point;
    const dir = new THREE.Vector3().subVectors(aimPoint, origin).normalize();
    const speed = 58 + power * 50;
    const arrow = this.makeArrowMesh();
    arrow.position.copy(origin);
    this.scene.add(arrow);
    this.projectiles.push({
      kind: 'arrow', mesh: arrow, pos: origin.clone(), vel: dir.multiplyScalar(speed),
      gravity: 3.2, life: 4.5, damage: 34 + power * 78, headMult: 2.1, radius: 0.12,
    });
    this.audio.play('bowShot', { volume: 0.7 });
    this.player.triggerRecoil(0.3);
    this.trauma = Math.min(1, this.trauma + 0.012);
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
    this.syncWeaponUI();
  }

  cancelBowDraw() {
    this.bowDrawing = false;
    this.bowDraw = 0;
    if (this.player) this.player.setBowDraw(0);
  }

  makeArrowMesh() {
    const group = new THREE.Group();
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xcbb27b, roughness: 0.8 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 4), shaftMat);
    shaft.rotation.x = Math.PI / 2;
    group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 4), new THREE.MeshStandardMaterial({ color: 0xaeb8b2, metalness: 0.7, roughness: 0.3 }));
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.55;
    group.add(head);
    const featherMat = new THREE.MeshStandardMaterial({ color: 0xd45a48, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.22), featherMat);
      f.position.set(s * 0.04, 0, -0.36);
      group.add(f);
    }
    return group;
  }

  throwGrenade(def) {
    const st = this.ammo.grenade;
    if (st.count <= 0) return;
    st.count -= 1;
    this.fireCooldown = def.fireInterval;
    const origin = this.player.root.position.clone();
    origin.y += 1.28 * this.player.scale;
    origin.addScaledVector(this.lookDir, 0.75);
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x5b6b4c, roughness: 0.55, metalness: 0.35 }),
    );
    body.scale.y = 1.2;
    mesh.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 6), new THREE.MeshStandardMaterial({ color: 0xb3b6a5, metalness: 0.7, roughness: 0.3 }));
    cap.position.y = 0.15;
    mesh.add(cap);
    const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff4538, toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), blinkMat);
    led.position.set(0, 0.18, 0.05);
    mesh.add(led);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const velocity = new THREE.Vector3(this.lookDir.x, this.lookDir.y + 0.2, this.lookDir.z).normalize().multiplyScalar(17.5);
    velocity.y += 4.8;
    this.grenades.push({
      kind: 'frag', mesh, pos: origin.clone(), vel: velocity, fuse: 2.15, spin: new THREE.Vector3(rand(3, 9), rand(3, 9), rand(3, 9)),
      blink: 0, alive: true,
    });
    this.audio.play('throw', { volume: 0.55 });
    this.audio.play('grenadeBounce', { volume: 0.2 });
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
    this.syncWeaponUI();
  }

  throwSmokeGrenade() {
    if (!this.started || this.paused || this.gameOver || !this.player || this.player.dead) return;
    if (this.smokeCooldown > 0) return;
    if (this.smokeCount <= 0) {
      this.audio.play('dry', { volume: 0.3 });
      this.ui.toast('没有烟雾弹了', '补给箱和武装人员的尸体上可以补充。', '', 1800);
      return;
    }
    this.smokeCount--;
    this.smokeCooldown = 0.75;
    this.ui.setSmokeCount(this.smokeCount);
    const origin = this.player.root.position.clone();
    origin.y += (this.playerProne ? 0.4 : 1.28) * this.player.scale;
    origin.addScaledVector(this.lookDir, 0.65);
    const mesh = new THREE.Group();
    const canister = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.105, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: 0x657c79, metalness: 0.38, roughness: 0.45 }),
    );
    canister.position.y = 0.02;
    mesh.add(canister);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.07, 8),
      new THREE.MeshStandardMaterial({ color: 0xa8b4ac, metalness: 0.65, roughness: 0.3 }),
    );
    cap.position.y = 0.205;
    mesh.add(cap);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.108, 0.108, 0.045, 8),
      new THREE.MeshBasicMaterial({ color: 0x9be8dc, toneMapped: false }),
    );
    band.position.y = 0.07;
    mesh.add(band);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const velocity = new THREE.Vector3(this.lookDir.x, this.lookDir.y + 0.22, this.lookDir.z).normalize().multiplyScalar(16.5);
    velocity.y += 4.4;
    this.grenades.push({
      kind: 'smoke', mesh, pos: origin.clone(), vel: velocity, fuse: 1.35,
      spin: new THREE.Vector3(rand(3, 8), rand(3, 8), rand(3, 8)), blink: 0, alive: true,
    });
    this.audio.play('smokeThrow', { volume: 0.55 });
    this.ui.setSmokeCount(this.smokeCount);
  }

  deploySmoke(position) {
    const p = position.clone();
    p.y = this.world.groundHeightAt(p.x, p.z) + 0.15;
    const visual = this.effects.createSmokeCloud(p, 6.4);
    visual.update(0.01);
    this.smokeClouds.push({ x: p.x, z: p.z, radius: 6.4, age: 0, life: 12, visual });
    this.audio.play('smokePop', { volume: 0.7, pan: this.audio.panFor(p) });
    if (!this._smokeTipShown) {
      this._smokeTipShown = true;
      this.ui.toast('烟幕展开 · 12 秒', '警察、特警和狙击手的视线都会被切断。', 'success', 2600);
    }
    this.effects.dustBurst(p.clone().add(new THREE.Vector3(0, 0.4, 0)), 12);
  }

  updateSmokeClouds(dt) {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      c.age += dt;
      c.visual.update(dt);
      if (c.age >= c.life) {
        c.visual.dispose();
        this.smokeClouds.splice(i, 1);
      }
    }
  }

  isSmokeBlocked(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    for (const c of this.smokeClouds) {
      let t = len2 > 0.0001 ? ((c.x - ax) * dx + (c.z - az) * dz) / len2 : 0;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t, cz = az + dz * t;
      const r = c.radius * 0.88;
      if ((cx - c.x) ** 2 + (cz - c.z) ** 2 < r * r) return true;
    }
    return false;
  }

  startReload() {
    const def = this.currentDef;
    if (!def || def.ammoType !== 'mag' || !this.unlocked.has(def.id) || this.reload.active) return;
    const st = this.ammo[def.id];
    if (!st || st.mag >= def.magazine) return;
    if (st.reserve !== Infinity && st.reserve <= 0) {
      this.ui.toast('没有备弹了', '搜刮敌人或去找补给箱', '', 1600);
      return;
    }
    this.reload = { active: true, time: def.reloadTime, total: def.reloadTime, id: def.id };
    this.bowDrawing = false;
    this.bowDraw = 0;
    this.player.setBowDraw(0);
    this.audio.play('reload', { volume: 0.55 });
    this.syncWeaponUI();
  }

  cancelReload() {
    this.reload.active = false;
    this.reload.time = 0;
    this.reload.total = 0;
    this.reload.id = null;
    this.syncWeaponUI();
  }

  finishReload() {
    const def = WEAPONS[this.reload.id];
    if (!def) { this.reload.active = false; return; }
    const st = this.ammo[def.id];
    if (!st) { this.reload.active = false; return; }
    const need = def.magazine - st.mag;
    const take = st.reserve === Infinity ? need : Math.min(need, Math.max(0, st.reserve));
    st.mag += take;
    if (st.reserve !== Infinity) st.reserve -= take;
    this.reload.active = false;
    this.reload.id = null;
    this.audio.play('shell', { volume: 0.35 });
    this.syncWeaponUI();
  }

  updateWeapon(dt) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.weaponSwitchCooldown = Math.max(0, this.weaponSwitchCooldown - dt);
    if (this.bowDrawing) {
      const def = this.currentDef;
      this.bowDraw = clamp(this.bowDraw + dt / (def.drawTime || 0.75), 0, 1);
      this.player.setBowDraw(this.bowDraw);
      this.player.setAiming(true);
    }
    if (this.reload.active) {
      this.reload.time -= dt;
      this.ui.setReloading(true, 1 - Math.max(0, this.reload.time) / this.reload.total);
      if (this.reload.time <= 0) this.finishReload();
      return;
    }
    const def = this.currentDef;
    if (!def) return;
    const auto = def.automatic || def.kind === 'melee';
    if (auto && this.mouseDown && this.fireCooldown <= 0) {
      this.tryFire();
    }
    if (def.kind !== 'bow' && this.bowDrawing) {
      this.cancelBowDraw();
    }
  }

  removeProjectileMesh(mesh, materials = true) {
    this.scene.remove(mesh);
    disposeObject3D(mesh, materials);
  }

  getPlayerMuzzle() {
    if (this.isScoped || this.playerProne) return this.camera.position.clone().addScaledVector(this.lookDir, 0.5);
    return this.player.getMuzzlePosition(new THREE.Vector3());
  }

  // ---------------------------------------------------------------- bio gun
  createBioBeam() {
    const positions = new Float32Array(18 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      color: 0xa8ffc7, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bioBeam = new THREE.Line(geo, mat);
    this.bioBeam.frustumCulled = false;
    this.bioBeam.visible = false;
    this.scene.add(this.bioBeam);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x97ffba, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bioBeamGlow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), glowMat);
    this.bioBeamGlow.visible = false;
    this.scene.add(this.bioBeamGlow);
  }

  toggleBioGrab() {
    if (this.bioTarget) {
      this.releaseBioTarget(false, false);
      return;
    }
    const hit = this.world.pickHuman(this.camera.position, this.lookDir, 30, this.humans, true);
    if (!hit) {
      this.audio.play('dry', { volume: 0.25 });
      return;
    }
    if (hit.human.isPlayer) return;
    if (this.reload.active) this.cancelReload();
    this.bioTarget = hit.human;
    this.bioTarget.setGrabbed(true);
    this.bioTarget.targetFacing = Math.atan2(this.player.root.position.x - hit.human.root.position.x, this.player.root.position.z - hit.human.root.position.z);
    this.audio.startBeam();
    this.audio.play('tranq', { volume: 0.25 });
    this.setBeamVisible(true);
    this.ui.floatText('牵引', hit.human.getBodyCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.7, 0)), 'bio');
    this.lastGunshotTime = this.time;
    this.syncWeaponUI();
  }

  updateBioTarget(dt) {
    if (!this.bioTarget) {
      this.setBeamVisible(false);
      return;
    }
    const target = this.bioTarget;
    if (target.removed) {
      this.bioTarget = null;
      this.setBeamVisible(false);
      return;
    }
    if (!target.grabbed) {
      // Something else (an explosion or death) already released the body.
      this.bioTarget = null;
      this.setBeamVisible(false);
      this.audio.stopBeam();
      return;
    }
    const origin = this.camera.position;
    const forward = this.lookDir;
    const wall = this.world.raycastStatic(origin, forward, this.bioDistance + 12);
    let desiredDist = this.bioDistance;
    if (wall.dist < desiredDist + 1.0) desiredDist = Math.max(1.6, wall.dist - 0.75);
    const desired = new THREE.Vector3().copy(origin).addScaledVector(forward, desiredDist);
    desired.y = Math.max(desired.y, 0.25);
    const lerp = 1 - Math.exp(-13 * dt);
    target.root.position.lerp(desired, lerp);
    target.thrownMode = false;
    target.targetFacing = Math.atan2(this.player.root.position.x - target.root.position.x, this.player.root.position.z - target.root.position.z);
    target.setAiming(false);
    // Beam with a flickering midpoint.
    const muzzle = this.getPlayerMuzzle();
    const body = target.getBodyCenter(new THREE.Vector3());
    const attr = this.bioBeam.geometry.attributes.position;
    const segments = 18;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const jitter = i === 0 || i === segments - 1 ? 0 : Math.sin(this.time * 31 + i * 2.9) * 0.11;
      attr.setXYZ(i,
        muzzle.x + (body.x - muzzle.x) * t + jitter,
        muzzle.y + (body.y - muzzle.y) * t + Math.cos(this.time * 17 + i) * 0.08,
        muzzle.z + (body.z - muzzle.z) * t - jitter);
    }
    attr.needsUpdate = true;
    this.bioBeamGlow.position.copy(body);
    const pulse = 0.88 + Math.sin(this.time * 9) * 0.12;
    this.bioBeamGlow.scale.setScalar(pulse);
    this.bioBeamGlow.visible = true;
    this.audio.updateBeam(true);
  }

  releaseBioTarget(thrown = false, silent = false) {
    if (!this.bioTarget) return;
    const target = this.bioTarget;
    this.bioTarget = null;
    let velocity = new THREE.Vector3();
    if (thrown) {
      velocity.copy(this.lookDir).multiplyScalar(24);
      velocity.y += 5.8;
      this.audio.play('throw', { volume: 0.55 });
      target.lastDamageWeapon = 'bio';
      this.ui.floatText('抛飞', target.getBodyCenter(new THREE.Vector3()), 'bio');
    }
    target.setGrabbed(false, { velocity });
    target.vel.copy(velocity);
    target.thrownMode = this.dead || true;
    if (!thrown) {
      target.vel.set(this.lookDir.x * 0.8, 0, this.lookDir.z * 0.8);
      target.lastDamageWeapon = 'bio';
    }
    this.setBeamVisible(false);
    this.audio.stopBeam();
    if (!silent) this.syncWeaponUI();
  }

  throwBioTarget() {
    if (!this.bioTarget) return;
    this.releaseBioTarget(true, false);
  }

  setBeamVisible(visible) {
    if (this.bioBeam) this.bioBeam.visible = visible;
    if (this.bioBeamGlow) this.bioBeamGlow.visible = visible;
    if (!visible) this.audio?.updateBeam(false);
  }

  // ---------------------------------------------------------------- projectiles
  updateProjectiles(dt) {
    const prev = new THREE.Vector3();
    const next = new THREE.Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.removeProjectileMesh(p.mesh, true);
        this.projectiles.splice(i, 1);
        continue;
      }
      prev.copy(p.pos);
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const len = prev.distanceTo(p.pos);
      if (len < 0.001) continue;
      const dir = next.copy(p.pos).sub(prev).normalize();
      const wall = this.world.raycastStatic(prev, dir, len + p.radius);
      const shotHit = this.world.pickHuman(prev, dir, len + p.radius + 0.2, this.humans, false);
      if (shotHit && shotHit.dist <= wall.dist + 0.1) {
        const h = shotHit.human;
        const point = shotHit.point;
        if (p.kind === 'arrow') {
          const damage = p.damage * (shotHit.part === 'head' ? p.headMult : 1);
          h.takeDamage(damage, {
            source: 'arrow', hitPart: shotHit.part, point, dir,
            weapon: 'bow', armorPiercing: false, force: 0.8,
          });
          this.ui.hitmarker(h.dead ? 'kill' : shotHit.part === 'head' ? 'head' : 'hit');
          this.audio.play('arrowStick', { volume: 0.6 });
        } else if (p.kind === 'dart') {
          h.sedate(13);
          this.effects.sleepPuff(point);
          this.ui.floatText('昏迷', point, 'status');
          this.ui.hitmarker('head');
          this.audio.play('sedated', { volume: 0.6 });
          if (h.isResponder) {
            this.ui.toast('目标昏迷', '防弹衣挡不住迷药。趁现在搜刮，或者干点别的。', 'success', 2200);
          }
        }
        this.removeProjectileMesh(p.mesh, true);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (wall.dist < len + 0.01) {
        this.effects.impact(wall.point, wall.normal, 'concrete');
        if (p.kind === 'arrow') this.audio.play('arrowStick', { volume: 0.4 });
        this.removeProjectileMesh(p.mesh, true);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.kind === 'arrow') {
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      } else {
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      }
      if (p.pos.y < 0.03) {
        this.effects.dustBurst(p.pos, 3);
        this.removeProjectileMesh(p.mesh, true);
        this.projectiles.splice(i, 1);
      }
    }
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.blink -= dt;
      g.vel.y -= 18 * dt;
      const prev = g.pos.clone();
      g.pos.addScaledVector(g.vel, dt);
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.y += g.spin.y * dt;
      g.mesh.rotation.z += g.spin.z * dt;
      // bounce against ground
      if (g.pos.y < 0.16) {
        g.pos.y = 0.16;
        if (g.vel.y < -1.4) {
          g.vel.y *= -0.43;
          g.vel.x *= 0.74; g.vel.z *= 0.74;
          this.audio.play('grenadeBounce', { volume: clamp(0.35 - g.pos.distanceTo(this.player.root.position) / 80, 0.03, 0.3) });
        } else {
          g.vel.y = 0; g.vel.x *= 0.82; g.vel.z *= 0.82;
        }
      }
      // rough building collision
      const dir = g.pos.clone().sub(prev);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        const wall = this.world.raycastStatic(prev, dir, len + 0.15);
        if (wall.dist < len && wall.point.y > 0.2) {
          g.pos.copy(prev).addScaledVector(dir, Math.max(0, wall.dist - 0.16));
          g.vel.x *= -0.28; g.vel.z *= -0.28; g.vel.y *= 0.5;
          this.audio.play('grenadeBounce', { volume: 0.25 });
        }
      }
      if (g.fuse <= 0) {
        if (g.kind === 'smoke') this.deploySmoke(g.pos);
        else this.detonateGrenade(g);
        this.removeProjectileMesh(g.mesh, true);
        this.grenades.splice(i, 1);
      }
    }
  }

  detonateGrenade(g) {
    const radius = 8.2;
    const origin = g.pos.clone();
    this.effects.explosion(origin, radius);
    this.audio.play('explosion', { volume: 0.9 });
    const distToPlayer = this.player.root.position.distanceTo(origin);
    this.trauma = Math.min(1, this.trauma + clamp(1.1 - distToPlayer / 30, 0.05, 0.9));
    for (const h of this.humans) {
      if (h.dead || h.removed) continue;
      const point = h.getBodyCenter(new THREE.Vector3());
      const distance = point.distanceTo(origin);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      const damage = 35 + 150 * Math.pow(falloff, 1.35);
      const dir = point.clone().sub(origin).normalize();
      h.takeDamage(damage, {
        source: 'explosion', ignoreArmor: true, hitPart: 'body', point,
        dir, weapon: 'grenade', force: 2 + falloff * 4,
      });
      if (!h.dead) {
        h.applyImpulse(dir.x * (5 + falloff * 8), 3 + falloff * 6, dir.z * (5 + falloff * 8));
      }
    }
    const playerPoint = this.player.root.position.clone();
    playerPoint.y += 1;
    const pd = playerPoint.distanceTo(origin);
    if (pd < radius && !this.player.dead) {
      const falloff = 1 - pd / radius;
      this.damagePlayer(65 + 105 * Math.pow(falloff, 1.4), {
        source: 'explosion', ignoreArmor: true, hitPart: 'body', point: this.player.getBodyCenter(),
        dir: playerPoint.clone().sub(origin).normalize(),
      });
      if (!this.player.dead) {
        this.ui.toast('爆炸波及', '别在脚边玩手榴弹。', 'danger', 1800);
      }
    }
    this.lastGunshotTime = this.time;
    this.disturbCivilians();
  }

  // ------------------------------------------------------------------- combat
  damagePlayer(amount, info = {}) {
    if (!this.player || this.player.dead || this.gameOver) return;
    if (this.godMode || this.playerProne) return;
    const result = this.player.takeDamage(amount, { ...info, force: info.force || 0 });
    this.lastPlayerHitTime = this.time;
    const blocked = !!result.blocked;
    this.trauma = Math.min(1, this.trauma + (blocked ? 0.06 : clamp(amount / 80, 0.12, 0.55)));
    this.audio.play(blocked ? 'armor' : 'playerHurt', { volume: blocked ? 0.4 : 0.7 });
    this.ui.damageFlash(blocked ? 0.2 : clamp(amount / 40, 0.25, 1));
    if (!blocked && this.player.hp <= 35 && !this.player.dead) {
      this.ui.toast('生命值告急', '去补给箱回口血。M 可以暂时静音。', 'danger', 1800);
    }
    if (this.player.dead) {
      this.onPlayerKilled(info);
    }
  }

  onPlayerDamaged(amount, info) {
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
    if (info?.blocked) this.ui.damageFlash(0.25);
  }

  onPlayerKilled() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.pointerLockWasActive = false;
    this.deathTimer = 0;
    this.deathShown = false;
    this.aimHeld = false;
    this.mouseDown = false;
    this.bowDrawing = false;
    if (this.playerProne) { this.playerProne = false; this.player?.setProne(false); this.ui.setProne(false); }
    if (this.bioTarget) { this.bioTarget.setGrabbed(false, { velocity: new THREE.Vector3() }); this.bioTarget = null; }
    this.setBeamVisible(false);
    this.audio.stopBeam();
    this.ui.setScoped(false);
    this.ui.setGrabbing(false);
    this.ui.setTarget(null);
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.style.cursor = 'default';
    this.player.root.visible = true;
    this.saveBest();
    setTimeout(() => {
      if (this.gameOver && !this.deathShown) {
        this.deathShown = true;
        this.ui.showDeath({ score: this.score, kills: this.kills, time: formatTime(this.gameTime) });
      }
    }, 1300);
  }

  onHumanDamaged(human, info) {
    if (!human || human.isPlayer) return;
    const point = human.lastDamagePoint ? human.lastDamagePoint.clone() : human.getBodyCenter();
    point.y += 0.15;
    if (info.blocked) {
      this.ui.hitmarker('armor');
      this.ui.floatText(info.armorLeft === 0 ? '护甲碎裂' : '挡下', point, 'armor');
      if (!this.hasShownArmorTip) {
        this.hasShownArmorTip = true;
        this.ui.toast('防弹衣挡住了子弹', '十层护甲会全部用完。瞄准头部，或用刀、爆炸和迷药绕过它。', 'danger', 4200);
      }
    } else {
      const dmg = Math.max(1, Math.round(info.amount));
      this.ui.floatText(`${dmg}`, point, info.hitPart === 'head' ? 'head' : '');
      this.audio.play(info.hitPart === 'head' ? 'headshot' : 'hitmarker', { volume: info.hitPart === 'head' ? 0.45 : 0.25 });
      if (info.hitPart === 'head') this.ui.hitmarker('head');
      else this.ui.hitmarker('hit');
    }
  }

  onHumanKilled(human, info) {
    if (human.isPlayer) {
      this.onPlayerKilled(info);
      return;
    }
    if (human._counted) return;
    human._counted = true;
    const now = this.time;
    this.kills++;
    if (human.type === 'civilian') this.civilianKills++;
    else this.responderKills++;
    if (now <= this.comboUntil) this.combo = Math.min(8, this.combo + 1);
    else this.combo = 1;
    this.comboUntil = now + COMBO_WINDOW;
    const headshot = info.hitPart === 'head';
    const base = human.isResponder ? (RESPONDER_PARAMS[human.type]?.score || 400) : 100;
    const points = Math.round((base + (headshot ? 120 : 0)) * this.combo);
    this.score += points;
    this.lastKillTime = now;
    const wid = human.lastDamageWeapon || info.weapon || 'unknown';
    const wname = WEAPONS[wid]?.name || '环境伤害';
    this.ui.addKillFeed({ name: human.type === 'civilian' ? '居民' : RESPONDER_PARAMS[human.type]?.label || '敌人', weapon: wname, headshot, points });
    this.ui.floatText(`+${points}`, new THREE.Vector3(human.root.position.x, human.root.position.y + 1.85, human.root.position.z), 'kill');
    this.ui.setScore(this.score, this.kills, formatTime(this.gameTime), this.combo);
    this.audio.play('down', { volume: 0.25 });
    if (headshot) this.audio.play('headshot', { volume: 0.5 });
    if (human.isResponder) {
      this.createLootDrop(human);
      if (!this.hasShownFirstResponderKill) {
        this.hasShownFirstResponderKill = true;
        this.ui.toast('对方倒下了', '走近发光的装备，按 E 搜刮防弹衣和武器。', 'success', 4000);
      }
    }
    this.bumpWanted(human);
    if (this.wantedStars > 0 && (!isFinite(this.nextWaveAt) || this.nextWaveAt > this.gameTime + 5)) {
      this.nextWaveAt = this.gameTime + Math.min(4, 2 + this.wantedStars * 0.3);
    }
    this.ui.setScore(this.score, this.kills, formatTime(this.gameTime), this.combo);
  }

  bumpWanted(human) {
    const before = this.wantedStars;
    this.heat += human.isResponder ? 0.55 : 1.05;
    this.wantedStars = this.starsForHeat(this.heat);
    if (this.wantedStars !== before) {
      this.ui.setWanted(this.wantedStars);
      this.audio.play('wave', { volume: 0.35 });
      if (before === 0 && this.wantedStars > 0) {
        this.ui.toast('警报拉响', '你放倒了一个小人。警察正在赶来的路上。', 'danger', 3800);
      } else if (this.wantedStars > before) {
        const msgs = [
          '', '通缉升级：警察正在赶来。', '通缉升级：特警已经出动。', '通缉升级：军方介入。',
          '红色通缉：他们不会停手。', '最高通缉：整条街都在找你。',
        ];
        this.ui.toast('通缉等级提升', msgs[this.wantedStars] || '', 'danger', 3200);
      }
      if (this.wantedStars > 0 && !isFinite(this.nextWaveAt)) {
        this.nextWaveAt = this.gameTime + 3.2;
      }
    }
    this.ui.setWanted(this.wantedStars);
  }

  starsForHeat(heat) {
    let s = 0;
    for (let i = 1; i < STAR_THRESHOLDS.length; i++) if (heat >= STAR_THRESHOLDS[i]) s = i;
    return s;
  }

  updateWaveDirector(dt) {
    if (this.wantedStars <= 0) return;
    const activeCount = this.responders.filter(a => !a.human.dead && !a.human.removed).length;
    if (!isFinite(this.nextWaveAt)) {
      this.nextWaveAt = this.gameTime + 3.2;
    }
    // If the player has been quiet for a long time and nobody is nearby, the city
    // slowly calms down; no fresh waves keep arriving forever.
    const noKillFor = this.gameTime - this.lastKillTime;
    const nearThreat = this.responders.some(a => !a.human.dead && a.human.root.position.distanceTo(this.player.root.position) < 95);
    if (noKillFor > 30 && !nearThreat) return;
    if (this.gameTime < this.nextWaveAt) return;
    if (activeCount >= RESPONSE_CAP[this.wantedStars]) {
      this.nextWaveAt = this.gameTime + 4;
      return;
    }
    this.spawnWave();
    this.nextWaveAt = this.gameTime + 18 + rand(0, 7);
  }

  spawnWave() {
    const stars = this.wantedStars;
    if (stars <= 0) return;
    const activeCount = this.responders.filter(a => !a.human.dead && !a.human.removed).length;
    const cap = RESPONSE_CAP[stars];
    let slots = Math.min(cap - activeCount, 2 + Math.floor((stars - 1) / 1.7));
    if (slots <= 0) return;
    slots = Math.min(slots, 4);
    const types = [];
    for (let i = 0; i < slots; i++) {
      let type = 'police';
      if (stars === 1) type = 'police';
      else if (stars === 2) type = i === 0 && chance(0.65) ? 'swat' : 'police';
      else if (stars === 3) {
        if (i === 0) type = 'swat';
        else if (i === slots - 1) type = chance(0.55) ? 'militarySniper' : 'militarySMG';
        else type = chance(0.5) ? 'swat' : 'police';
      } else {
        type = choose(['police', 'swat', 'swat', 'militarySniper', 'militarySMG']);
        if (i === slots - 1 && !types.some(t => t.startsWith('military'))) {
          type = chance(0.5) ? 'militarySniper' : 'militarySMG';
        }
      }
      types.push(type);
    }
    // Choose a spawn point far enough from the player and out of direct sight if possible.
    let spawn = null;
    for (let i = 0; i < 40; i++) {
      const cand = this.world.getRoadSpawn(30, 58, this.player.root.position.x, this.player.root.position.z);
      if (!cand) continue;
      const visible = this.world.hasLineOfSight(cand.x, cand.z, this.player.root.position.x, this.player.root.position.z);
      if (!visible || i > 28) { spawn = cand; break; }
    }
    if (!spawn) spawn = this.world.getRoadSpawn(30, 65, this.player.root.position.x, this.player.root.position.z);
    const labels = new Set();
    types.forEach((type, i) => {
      let x = spawn.x + rand(-2.3, 2.3);
      let z = spawn.z + rand(-2.3, 2.3);
      const point = new THREE.Vector3(x, 0, z);
      this.world.collideCircle(point, 0.5);
      x = point.x; z = point.z;
      this.spawnResponder(type, x, z);
      labels.add(RESPONDER_PARAMS[type].label);
    });
    this.waveNumber++;
    this.audio.play('siren', { volume: 0.4 });
    this.audio.play('wave', { volume: 0.3 });
    const title = stars >= 3 ? `军方增援抵达 · 第 ${this.waveNumber} 波` : stars === 2 ? `特警增援抵达 · 第 ${this.waveNumber} 波` : `警察抵达 · 第 ${this.waveNumber} 波`;
    this.ui.toast(title, [...labels].join(' / ') + ' 从街区边缘进入。', 'danger', 3200);
    this.ui.setWanted(this.wantedStars);
  }

  updateHeatDecay(dt) {
    if (this.wantedStars <= 0) return;
    const noKillFor = this.gameTime - this.lastKillTime;
    if (noKillFor < 28) { this.calmTimer = 0; return; }
    const nearThreat = this.responders.some(a => !a.human.dead && a.human.root.position.distanceTo(this.player.root.position) < 90);
    if (nearThreat) { this.calmTimer = 0; return; }
    this.calmTimer += dt;
    if (this.calmTimer > 3) {
      this.heat = Math.max(0, this.heat - dt * 0.8);
      const s = this.starsForHeat(this.heat);
      if (s !== this.wantedStars) {
        this.wantedStars = s;
        this.ui.setWanted(s);
        if (s === 0) this.ui.toast('街区暂时平静', '通缉解除。至少在你下一次开枪之前。', 'success', 3200);
        else this.ui.toast('通缉降温', '他们正在失去你的踪迹。', '', 2200);
      }
    }
  }

  createLootDrop(human) {
    const params = RESPONDER_PARAMS[human.type];
    if (!params) return;
    const p = human.root.position;
    const root = new THREE.Group();
    root.position.set(p.x, 0.03, p.z);
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x323b3c, roughness: 0.6, metalness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xddb265, roughness: 0.35, metalness: 0.45, emissive: 0x3d2b0f, emissiveIntensity: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.48), bagMat);
    base.position.y = 0.18;
    base.castShadow = true;
    root.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.38), trimMat);
    top.position.y = 0.4;
    top.rotation.z = 0.08;
    root.add(top);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.58, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc864, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd98d, toneMapped: false }),
    );
    diamond.position.y = 0.9;
    root.add(diamond);
    this.scene.add(root);
    const armor = human.armorPlates || 0;
    const weapons = (params.lootWeapons || []).filter(Boolean);
    this.lootDrops.push({
      root, human, ring, diamond, weapons, armor, baseY: 0.9,
      time: this.time, taken: false,
    });
    human.looted = false;
    human.hasLoot = true;
  }

  updateLootDrops(dt) {
    for (let i = this.lootDrops.length - 1; i >= 0; i--) {
      const l = this.lootDrops[i];
      if (l.taken) {
        this.scene.remove(l.root);
        disposeObject3D(l.root, true);
        this.lootDrops.splice(i, 1);
        continue;
      }
      const t = this.time - l.time;
      l.diamond.position.y = 0.85 + Math.sin(t * 2.3) * 0.12;
      l.diamond.rotation.y += dt * 1.8;
      l.ring.rotation.z += dt * 0.35;
      const pulse = 0.55 + Math.sin(t * 2.8) * 0.18;
      l.ring.material.opacity = pulse;
      if (this.time - l.time > 180) {
        this.scene.remove(l.root);
        disposeObject3D(l.root, true);
        this.lootDrops.splice(i, 1);
      }
    }
  }

  getNearestLoot(maxDist = INTERACT_RADIUS) {
    let best = null, bd = maxDist;
    const p = this.player.root.position;
    for (const l of this.lootDrops) {
      if (l.taken) continue;
      const d = Math.hypot(l.root.position.x - p.x, l.root.position.z - p.z);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  getNearestSupply(maxDist = INTERACT_RADIUS) {
    let best = null, bd = maxDist;
    const p = this.player.root.position;
    for (const s of this.supplyCrates) {
      const d = Math.hypot(s.root.position.x - p.x, s.root.position.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  interact() {
    if (!this.player || this.player.dead) return;
    const loot = this.getNearestLoot();
    if (loot) { this.collectLoot(loot); return; }
    const supply = this.getNearestSupply();
    if (supply) {
      if (supply.cooldown > 0) {
        this.ui.toast('补给箱冷却中', `还要等 ${Math.ceil(supply.cooldown)} 秒。`, '', 1400);
        return;
      }
      this.useSupply(supply);
      return;
    }
    this.ui.toast('附近没有可交互物品', '走近尸体或发光的补给箱，按 E。', '', 1400);
  }

  collectLoot(loot) {
    if (!loot || loot.taken) return;
    loot.taken = true;
    loot.human.looted = true;
    const newlyUnlocked = [];
    for (const id of loot.weapons) {
      const def = WEAPONS[id];
      if (!def) continue;
      if (!this.unlocked.has(id)) {
        this.unlocked.add(id);
        if (this.ammo[id]) {
          if (def.ammoType === 'mag') {
            this.ammo[id].mag = def.magazine;
            this.ammo[id].reserve = Math.max(this.ammo[id].reserve || 0, def.reserve === Infinity ? 45 : Math.min(def.reserveMax || 60, Math.max(30, def.magazine * 2)));
          }
        }
        newlyUnlocked.push(def.name);
        this.ui.flashSlot(id);
      } else {
        this.addAmmo(id, def.ammoType === 'mag' ? Math.max(15, def.magazine) : 0);
      }
    }
    // Ammo + medkit from the same body.
    this.ammo.bow.count = Math.min(WEAPONS.bow.maxAmmo, this.ammo.bow.count + 6);
    this.ammo.grenade.count = Math.min(WEAPONS.grenade.maxAmmo, this.ammo.grenade.count + 1);
    this.ammo.tranq.reserve = Math.min(WEAPONS.tranq.reserveMax, this.ammo.tranq.reserve + 6);
    this.smokeCount = Math.min(5, this.smokeCount + 1);
    this.ui.setSmokeCount(this.smokeCount);
    this.player.hp = Math.min(100, this.player.hp + 18);
    const armorPlates = loot.armor;
    let armorText = '';
    if (armorPlates > 0) {
      if (this.player.armorPlates < armorPlates) {
        this.player.equipArmor(armorPlates);
        armorText = ` · 防弹衣 ${armorPlates} 层`;
      } else {
        armorText = ` · 防弹衣 ${armorPlates} 层（未替换）`;
      }
    }
    this.audio.play('pickup', { volume: 0.7 });
    if (armorText) this.audio.play('armorEquip', { volume: 0.5 });
    const title = newlyUnlocked.length ? `获得：${newlyUnlocked.join(' · ')}` : '搜刮完成';
    const sub = `回血 18 · 箭矢 +6 · 手雷 +1 · 烟雾 +1 · 迷药 +6${armorText}`;
    this.ui.toast(title, sub, 'success', 3400);
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
    this.syncWeaponUI();
    if (!this.hasShownFirstLoot && armorPlates > 0) {
      this.hasShownFirstLoot = true;
      setTimeout(() => {
        if (!this.started || this.gameOver) return;
        this.ui.toast('防弹衣已装备', '它只能替你挡下 10 发躯干子弹。爆头依然致命。', '', 3600);
      }, 900);
    }
  }

  addAmmo(id, amount) {
    const def = WEAPONS[id];
    const st = this.ammo[id];
    if (!def || !st || !amount) return;
    if (def.ammoType === 'mag') {
      if (st.reserve !== Infinity) {
        st.reserve = Math.min(def.reserveMax || 999, st.reserve + amount);
      }
    } else if (def.ammoType === 'count') {
      st.count = Math.min(def.maxAmmo || 99, st.count + amount);
    }
  }

  // ----------------------------------------------------------------- supplies
  createSupplyCrates() {
    const positions = this.world.getSupplySpots();
    this.supplyCrates = positions.map((p, idx) => this.makeSupplyCrate(p, idx));
  }

  resetSupplyCrates() {
    for (const s of this.supplyCrates) {
      s.cooldown = 0;
      s.base.scale.set(1, 1, 1);
      s.beacon.visible = true;
      s.ring.material.opacity = 0.5;
    }
  }

  makeSupplyCrate(p, idx) {
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x44554b, roughness: 0.65, metalness: 0.25 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x8fdad7, roughness: 0.25, metalness: 0.4, emissive: 0x1f5a56, emissiveIntensity: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.72, 0.94), boxMat);
    base.position.y = 0.36;
    base.castShadow = true;
    base.receiveShadow = true;
    root.add(base);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.0), trimMat);
    band.position.y = 0.38;
    root.add(band);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.8), new THREE.MeshStandardMaterial({ color: 0x667b6b, roughness: 0.55, metalness: 0.3 }));
    lid.position.y = 0.8;
    root.add(lid);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xa8fff1, toneMapped: false });
    for (const [w, h, x, y] of [[0.42, 0.09, 0, 0.211], [0.09, 0.42, 0, 0.211]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), crossMat);
      m.position.set(x, y + 0.2, 0.48);
      root.add(m);
    }
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 2.4, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fdad7, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beacon.position.y = 1.5;
    root.add(beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.82, 28),
      new THREE.MeshBasicMaterial({ color: 0x8fdad7, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
    this.scene.add(root);
    return { root, ring, beacon, base, cooldown: 0, idx };
  }

  updateSupplyCrates(dt) {
    for (const s of this.supplyCrates) {
      if (s.cooldown > 0) {
        s.cooldown = Math.max(0, s.cooldown - dt);
        s.beacon.visible = false;
        s.ring.material.opacity = 0.08;
        if (s.cooldown === 0) {
          s.beacon.visible = true;
          s.ring.material.opacity = 0.45;
        }
      } else {
        s.beacon.visible = true;
        s.ring.rotation.z += dt * 0.5;
        const pulse = 0.3 + Math.sin(this.time * 2.2 + s.idx) * 0.12;
        s.ring.material.opacity = pulse;
        s.beacon.material.opacity = 0.04 + (pulse - 0.18) * 0.04;
      }
    }
  }

  useSupply(supply) {
    supply.cooldown = 32;
    this.player.hp = Math.min(100, this.player.hp + 34);
    this.smokeCount = Math.min(5, this.smokeCount + 2);
    this.ui.setSmokeCount(this.smokeCount);
    this.ammo.bow.count = Math.min(WEAPONS.bow.maxAmmo, this.ammo.bow.count + 10);
    this.ammo.grenade.count = Math.min(WEAPONS.grenade.maxAmmo, this.ammo.grenade.count + 2);
    this.ammo.tranq.mag = WEAPONS.tranq.magazine;
    this.ammo.tranq.reserve = Math.min(WEAPONS.tranq.reserveMax, this.ammo.tranq.reserve + 12);
    for (const id of this.unlocked) {
      const def = WEAPONS[id];
      if (def.ammoType === 'mag') {
        const st = this.ammo[id];
        st.mag = Math.max(st.mag, def.magazine);
        if (st.reserve !== Infinity) st.reserve = Math.min(def.reserveMax || 999, Math.max(st.reserve, def.magazine * 3));
      }
    }
    supply.beacon.visible = false;
    supply.ring.material.opacity = 0.08;
    this.audio.play('heal', { volume: 0.7 });
    this.audio.play('pickup', { volume: 0.55 });
    this.effects.sleepPuff(this.player.root.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.ui.toast('补给完成', '生命 +34 · 弹药已补齐 · 烟雾弹 +2', 'success', 2400);
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
    this.syncWeaponUI();
  }

  // ------------------------------------------------------------------- people
  spawnCivilians(count, minD = 9, maxD = 52, initial = false) {
    const playerPos = this.player.root.position;
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    for (let i = 0; i < count; i++) {
      let point = null;
      for (let attempt = 0; attempt < 45; attempt++) {
        const p = this.world.getRandomSidewalkPoint(minD, maxD, playerPos.x, playerPos.z);
        if (!p) continue;
        const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
        if (d < minD || d > maxD) continue;
        let tooClose = false;
        for (const h of this.humans) {
          if (!h.dead && Math.hypot(h.root.position.x - p.x, h.root.position.z - p.z) < 2) { tooClose = true; break; }
        }
        if (tooClose) continue;
        if (initial && attempt < 24) {
          const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
          const dot = (dx * forward.x + dz * forward.z) / (Math.hypot(dx, dz) || 1);
          if (dot < -0.15) continue;
        }
        point = p;
        break;
      }
      if (!point) point = this.world.getRandomSidewalkPoint(minD, maxD, playerPos.x, playerPos.z);
      if (!point) return;
      const human = new Human(this, {
        type: 'civilian',
        x: point.x, z: point.z,
        heading: rand(0, TAU),
        scale: rand(0.78, 0.94),
      });
      const ai = new CivilianAI(this, human);
      ai.spawnTime = this.time;
      this.humans.push(human);
      this.civilians.push(ai);
    }
  }

  spawnInitialCivilians() {
    this.spawnCivilians(14, 8, 46, true);
    this.spawnCivilians(3, 30, 76, false);
  }

  updateCivilianPopulation(dt) {
    if (!this.started || this.gameOver) return;
    this.civilianTimer -= dt;
    if (this.civilianTimer > 0) return;
    this.civilianTimer = rand(3.5, 5.5);
    const aliveNear = this.civilians.filter(a => !a.human.dead && !a.human.removed &&
      a.human.root.position.distanceTo(this.player.root.position) < 95).length;
    if (aliveNear < 13 && this.civilians.length < 24) {
      this.spawnCivilians(Math.min(2, 13 - aliveNear), 32, 78, false);
    }
    // Remove far-away walkers so the active crowd stays where the player is.
    for (let i = this.civilians.length - 1; i >= 0; i--) {
      const ai = this.civilians[i];
      const h = ai.human;
      if (h.dead || h.grabbed) continue;
      if (h.root.position.distanceTo(this.player.root.position) > 185 && this.time - (ai.spawnTime || 0) > 18) {
        h.dispose();
        this.civilians.splice(i, 1);
      }
    }
  }

  spawnResponder(type, x, z) {
    const param = RESPONDER_PARAMS[type];
    if (!param) return null;
    const human = new Human(this, {
      type,
      x, z,
      heading: Math.atan2(this.player.root.position.x - x, this.player.root.position.z - z),
      weaponId: param.weaponId,
      armorPlates: 10,
      scale: type === 'militarySniper' ? 0.98 : rand(0.98, 1.04),
    });
    const ai = new ResponderAI(this, human, type);
    this.humans.push(human);
    this.responders.push(ai);
    return ai;
  }

  updateAI(dt) {
    for (const ai of this.civilians) ai.update(dt);
    for (const ai of this.responders) ai.update(dt);
  }

  updateCivilianPanic(sourcePos) {
    // AI reacts to global gunfire; this call exists to make the intent explicit.
  }

  disturbCivilians() {
    this.lastGunshotTime = this.time;
  }

  cleanupDead() {
    for (let i = this.humans.length - 1; i >= 0; i--) {
      const h = this.humans[i];
      if (h.removed) {
        h.ai?.onRemove?.();
        this.humans.splice(i, 1);
      }
    }
    this.civilians = this.civilians.filter(ai => !ai.human.removed);
    this.responders = this.responders.filter(ai => !ai.human.removed);
    const dead = this.humans.filter(h => h.dead && !h.removed);
    if (dead.length > 26) {
      dead.sort((a, b) => (b.cleanupTimer || 0) - (a.cleanupTimer || 0));
      for (let i = 26; i < dead.length; i++) dead[i].dispose();
    }
    if (this.bioTarget && this.bioTarget.removed) {
      this.bioTarget = null;
      this.setBeamVisible(false);
    }
  }

  updateEnvironmentAnimations(dt) {
    for (const s of this.supplyCrates) {
      if (!s) continue;
      if (s.cooldown > 0) continue;
      s.ring.rotation.z += dt * 0.5;
      s.ring.material.opacity = 0.3 + Math.sin(this.time * 2.2 + s.idx) * 0.12;
    }
  }

  updateWorldAndEffects(dt) {
    this.world.update(dt, this.player.root.position);
    this.effects.update(dt);
    this.updateEnvironmentAnimations(dt);
    for (const l of this.lootDrops) {
      if (!l.taken) {
        l.diamond.rotation.y += dt * 1.6;
        l.ring.rotation.z += dt * 0.3;
      }
    }
  }

  updatePrompts() {
    if (!this.player || this.player.dead) { this.ui.setPrompt(null); return; }
    if (this.bioTarget) { this.ui.setPrompt(null); return; }
    const loot = this.getNearestLoot();
    if (loot) {
      const names = loot.weapons.map(id => UNLOCK_LABELS[id] || WEAPONS[id]?.name).filter(Boolean).join(' · ');
      const armor = loot.armor > 0 ? `防弹衣 ${loot.armor} 层 · ` : '';
      this.ui.setPrompt('搜刮装备', `${armor}${names || '急救包'}`);
      return;
    }
    const supply = this.getNearestSupply();
    if (supply) {
      if (supply.cooldown > 0) this.ui.setPrompt(null);
      else this.ui.setPrompt('打开补给箱', '回复 34 生命 · 补充弹药与烟雾弹');
      return;
    }
    this.ui.setPrompt(null);
  }

  updateHUD(dt) {
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
    this.ui.setScore(this.score, this.kills, formatTime(this.gameTime), this.combo);
    this.ui.setWanted(this.wantedStars);
    this.syncWeaponUI();
    this.ui.setReloading(this.reload.active, this.reload.active ? 1 - Math.max(0, this.reload.time) / this.reload.total : 0);
    this.minimapTimer -= 0.1;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.12;
      this.ui.drawMinimap(this.player, this.cameraYaw, this.humans, this.lootDrops.filter(l => !l.taken), this.supplyCrates.map(s => ({ x: s.root.position.x, z: s.root.position.z })), this.wantedStars);
    }
  }

  saveBest() {
    try {
      const key = 'daxiaoren3d.best';
      const current = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      if (this.score > current) localStorage.setItem(key, String(this.score));
    } catch (e) { /* private mode */ }
  }

  // -------------------------------------------------------------- debug hooks
  debugStart() {
    this.start();
  }

  debugGiveAll() {
    for (const id of LOOT_SLOTS) {
      this.unlocked.add(id);
      this.ui.flashSlot(id);
    }
    this.player.equipArmor(10);
    this.ammo.smg.reserve = 200;
    this.ammo.sniper.reserve = 40;
    this.ammo.policePistol.reserve = 90;
    this.smokeCount = 5;
    this.ui.setSmokeCount(this.smokeCount);
    this.syncWeaponUI(true);
    this.ui.setVitals(this.player.hp, this.player.armorPlates);
  }

  debugSpawnWave(count = 3) {
    for (let i = 0; i < count; i++) {
      const type = choose(['police', 'police', 'swat', 'militarySniper', 'militarySMG']);
      const p = this.world.getRoadSpawn(12, 25, this.player.root.position.x, this.player.root.position.z);
      this.spawnResponder(type, p.x, p.z);
    }
  }

  debugKillAll() {
    for (const h of this.humans) {
      if (!h.dead) h.takeDamage(999, { source: 'debug', ignoreArmor: true, hitPart: 'body', point: h.getBodyCenter() });
    }
  }
}

let game = null;
try {
  game = new Game();
  game.boot().catch((err) => {
    console.error(err);
    const sub = document.getElementById('loading-sub');
    if (sub) sub.textContent = `启动失败：${err.message}`;
    const loading = document.getElementById('loading-screen');
    if (loading) loading.classList.remove('hidden');
  });
} catch (err) {
  console.error(err);
  const loading = document.getElementById('loading-screen');
  if (loading) loading.classList.add('hidden');
  const noWebgl = document.getElementById('no-webgl');
  if (noWebgl) noWebgl.classList.remove('hidden');
}
