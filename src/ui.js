import { WEAPONS, STARTING_WEAPONS, LOOT_SLOTS } from './weapons.js';
import { clamp, formatNumber, TYPE_LABEL } from './utils.js';

const SLOT_ICONS = {
  bio: '生', bow: '弓', pistol: '枪', grenade: '雷', tranq: '麻',
  policePistol: '警', smg: '冲', sniper: '狙', knife: '匕',
};

const WANTED_LABELS = [
  '街区平静 · 无人注意',
  '警报响起 · 警察正在靠近',
  '事态升级 · 特警已经出动',
  '全城封锁 · 军方介入',
  '红色通缉 · 火力全开',
  '最高级别 · 不惜代价',
];

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {};
    const ids = [
      'hud', 'score-value', 'kill-value', 'time-value', 'combo-value', 'wanted-card',
      'wanted-stars', 'wanted-meta', 'crosshair', 'reticle-type', 'hitmarker', 'target-info',
      'target-name', 'target-hp', 'target-armor', 'float-layer', 'interact-prompt', 'p-name',
      'p-sub', 'grab-hint', 'scope', 'hp-value', 'hp-bar', 'armor-pips', 'armor-count',
      'weapon-name', 'weapon-desc', 'ammo-block', 'reload-row', 'reload-fill', 'weapon-mode',
      'hotbar', 'killfeed', 'toasts', 'start-screen', 'start-btn', 'pause-screen', 'resume-btn',
      'mute-btn', 'pause-restart-btn', 'pause-score', 'pause-kills', 'pause-wanted',
      'death-screen', 'death-score', 'death-kills', 'death-time', 'death-restart-btn',
      'death-line', 'death-best', 'loading-screen', 'loading-fill', 'loading-sub', 'minimap',
      'low-health', 'damage-flash', 'no-webgl', 'stance-status', 'smoke-count', 'smoke-chip',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.el.stars = Array.from(this.el['wanted-stars'].children);
    this.el.armorPips = Array.from(this.el['armor-pips'].children);
    this.minimapCtx = this.el.minimap.getContext('2d');
    this.slotEls = new Map();
    this.hotbarOrder = [...STARTING_WEAPONS, ...LOOT_SLOTS];
    this.buildHotbar();
    this.floaters = [];
    this.toastQueue = [];
    this.toastActive = false;
    this.lastDamageFlash = 0;
    this.hitmarkerTimer = 0;
    this._lastVitals = { hp: -1, armor: -1 };
    this._lastScore = { score: -1, kills: -1, time: '', combo: -1 };
    this._lastWanted = -1;
    this._lastWeapon = '';
    this._lastAmmo = '';
    this._lastPrompt = '';
    this._targetKey = '';
    this.slotState = { unlocked: new Set(STARTING_WEAPONS), current: 'bio' };
    this.hideAllOverlays();
  }

  bind(handlers) {
    this.handlers = handlers;
    this.el['start-btn'].addEventListener('click', (e) => { e.stopPropagation(); handlers.start?.(); });
    this.el['resume-btn'].addEventListener('click', (e) => { e.stopPropagation(); handlers.resume?.(); });
    this.el['mute-btn'].addEventListener('click', (e) => { e.stopPropagation(); handlers.mute?.(); });
    this.el['pause-restart-btn'].addEventListener('click', (e) => { e.stopPropagation(); handlers.restart?.(); });
    this.el['death-restart-btn'].addEventListener('click', (e) => { e.stopPropagation(); handlers.restart?.(); });
    this.el['start-screen'].addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
    });
  }

  buildHotbar() {
    const hotbar = this.el.hotbar;
    hotbar.innerHTML = '';
    this.hotbarOrder.forEach((id, i) => {
      const def = WEAPONS[id];
      const slot = document.createElement('div');
      slot.className = 'slot locked';
      slot.dataset.weapon = id;
      slot.innerHTML = `
        <span class="s-key">${i + 1}</span>
        <span class="s-icon">${SLOT_ICONS[id] || '·'}</span>
        <span class="s-name">${def.short}</span>
        <span class="s-count" data-count></span>
      `;
      hotbar.appendChild(slot);
      this.slotEls.set(id, slot);
    });
  }

  hideAllOverlays() {
    this.el['loading-screen'].classList.add('hidden');
    this.el['start-screen'].classList.add('hidden');
    this.el['pause-screen'].classList.add('hidden');
    this.el['death-screen'].classList.add('hidden');
    this.el.hud.classList.add('hud-hidden');
  }

  setLoading(progress, sub) {
    this.el['loading-screen'].classList.remove('hidden');
    this.el.hud.classList.add('hud-hidden');
    this.el['loading-fill'].style.width = `${Math.round(progress * 100)}%`;
    if (sub) this.el['loading-sub'].textContent = sub;
  }

  showNoWebGL() {
    this.el['loading-screen'].classList.add('hidden');
    this.el['no-webgl'].classList.remove('hidden');
  }

  showStart() {
    this.el['loading-screen'].classList.add('hidden');
    this.el['start-screen'].classList.remove('hidden');
    this.el['pause-screen'].classList.add('hidden');
    this.el['death-screen'].classList.add('hidden');
    this.el.hud.classList.add('hud-hidden');
    document.body.style.cursor = 'default';
  }

  hideStart() {
    this.el['start-screen'].classList.add('hidden');
    this.el.hud.classList.remove('hud-hidden');
    this.el.crosshair.classList.remove('hidden');
    this.el['target-info'].classList.add('hidden');
    this.el['interact-prompt'].classList.add('hidden');
    this.el['grab-hint'].classList.add('hidden');
    document.body.style.cursor = 'none';
  }

  showPause(stats) {
    this.el['pause-screen'].classList.remove('hidden');
    document.body.style.cursor = 'default';
    if (stats) {
      this.el['pause-score'].textContent = formatNumber(stats.score);
      this.el['pause-kills'].textContent = stats.kills;
      this.el['pause-wanted'].textContent = `${stats.stars} ★`;
    }
  }

  hidePause() {
    this.el['pause-screen'].classList.add('hidden');
    document.body.style.cursor = 'none';
  }

  showDeath(stats) {
    this.el['death-screen'].classList.remove('hidden');
    this.el['pause-screen'].classList.add('hidden');
    this.el['death-score'].textContent = formatNumber(stats.score);
    this.el['death-kills'].textContent = stats.kills;
    this.el['death-time'].textContent = stats.time;
    let best = 0;
    try { best = parseInt(localStorage.getItem('daxiaoren3d.best') || '0', 10) || 0; } catch (e) { /* private mode */ }
    this.el['death-best'].textContent = formatNumber(Math.max(best, stats.score));
    const lines = [
      '街区安静下来了，但只安静了一会儿。',
      '你留下了一地弹壳，和一条很长很长的通缉记录。',
      '防弹衣只能挡十发。下次记得先捡别人的。',
      '今天的压力，似乎转移到了你自己身上。',
    ];
    this.el['death-line'].textContent = lines[(Math.random() * lines.length) | 0];
    this.el.scope.classList.add('hidden');
    this.el.crosshair.classList.add('hidden');
    this.el['stance-status'].classList.add('hidden');
    this.el['target-info'].classList.add('hidden');
    this.el['interact-prompt'].classList.add('hidden');
    this.el['grab-hint'].classList.add('hidden');
    document.body.style.cursor = 'default';
  }

  hideDeath() {
    this.el['death-screen'].classList.add('hidden');
    this.el.crosshair.classList.remove('scoped');
    this.el.crosshair.classList.remove('hidden');
  }

  clearTransientUI() {
    this.el['killfeed'].innerHTML = '';
    this.el.toasts.innerHTML = '';
    this.toastQueue.length = 0;
    this.toastActive = false;
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
    this.el['target-info'].classList.add('hidden');
    this.el['interact-prompt'].classList.add('hidden');
    this.el['grab-hint'].classList.add('hidden');
    this.el['damage-flash'].classList.remove('show');
    this.el['stance-status'].classList.add('hidden');
    this.el.crosshair.classList.remove('hidden', 'scoped');
    this.el.scope.classList.add('hidden');
    this._lastVitals = { hp: -1, armor: -1 };
    this._lastScore = { score: -1, kills: -1, time: '', combo: -1 };
    this._lastWanted = -1;
    this._lastWeapon = '';
    this._lastAmmo = '';
    this._lastPrompt = '';
    this._targetKey = '';
  }

  setMuted(muted) {
    this.el['mute-btn'].textContent = muted ? '恢复声音 / UNMUTE' : '静音 / MUTE';
  }

  setVitals(hp, armor, maxArmor = 10) {
    const h = Math.max(0, Math.ceil(hp));
    const a = Math.max(0, armor || 0);
    if (h !== this._lastVitals.hp || a !== this._lastVitals.armor) {
      this.el['hp-value'].innerHTML = `${h}<span>/100</span>`;
      this.el['hp-bar'].style.width = `${Math.max(0, Math.min(100, h))}%`;
      const low = h <= 32;
      this.el['hp-value'].classList.toggle('low', low);
      this.el['hp-bar'].classList.toggle('low', low);
      this.el['low-health'].classList.toggle('show', low && !this.game.player?.dead && h > 0);
      this.el.armorPips.forEach((pip, i) => pip.classList.toggle('on', i < a));
      this.el['armor-count'].textContent = `${a} 层`;
      this._lastVitals = { hp: h, armor: a };
    }
  }

  setProne(prone) {
    this.el['stance-status'].classList.toggle('hidden', !prone);
  }

  setSmokeCount(count) {
    const n = Math.max(0, Math.floor(count || 0));
    this.el['smoke-count'].textContent = n;
    this.el['smoke-chip'].classList.toggle('empty', n <= 0);
  }

  setScore(score, kills, timeStr, combo) {
    if (score !== this._lastScore.score) this.el['score-value'].textContent = formatNumber(score);
    if (kills !== this._lastScore.kills) this.el['kill-value'].textContent = kills;
    if (timeStr !== this._lastScore.time) this.el['time-value'].textContent = timeStr;
    if (combo !== this._lastScore.combo) {
      this.el['combo-value'].textContent = `连击 ×${combo}`;
      this.el['combo-value'].classList.toggle('cool', combo <= 1);
    }
    this._lastScore = { score, kills, time: timeStr, combo };
  }

  setWanted(stars, extraLabel) {
    const s = Math.max(0, Math.min(5, stars));
    if (s !== this._lastWanted) {
      this.el.stars.forEach((star, i) => star.classList.toggle('lit', i < s));
      this.el['wanted-card'].classList.toggle('alert', s >= 1);
      this.el['wanted-meta'].textContent = WANTED_LABELS[s] || WANTED_LABELS[0];
      this.el['wanted-meta'].classList.toggle('hot', s >= 3);
      this._lastWanted = s;
    }
    if (extraLabel) this.el['wanted-meta'].textContent = extraLabel;
  }

  syncHotbar(unlocked, currentId, counts = {}) {
    this.slotState.unlocked = unlocked;
    this.slotState.current = currentId;
    for (const id of this.hotbarOrder) {
      const el = this.slotEls.get(id);
      if (!el) continue;
      const isUnlocked = unlocked.has(id);
      el.classList.toggle('locked', !isUnlocked);
      el.classList.toggle('unlocked', isUnlocked);
      el.classList.toggle('active', id === currentId);
      const countEl = el.querySelector('[data-count]');
      if (countEl) {
        const c = counts[id];
        countEl.textContent = isUnlocked && c !== undefined && c !== null && c !== Infinity ? c : '';
      }
      el.classList.toggle('empty', isUnlocked && counts[id] === 0 && id !== 'bio' && id !== 'knife');
    }
  }

  flashSlot(id) {
    const el = this.slotEls.get(id);
    if (!el) return;
    el.classList.remove('new');
    void el.offsetWidth;
    el.classList.add('new');
    setTimeout(() => el.classList.remove('new'), 1200);
  }

  updateWeapon(def, ammoText, ammoBig, reloading, reloadProgress, modeText, canUse = true) {
    if (!def) return;
    this.el['weapon-name'].textContent = def.name;
    this.el['weapon-desc'].textContent = canUse ? def.description : '尚未获得 · 从对应敌人身上搜刮';
    this.el['weapon-mode'].textContent = modeText || '';
    const key = `${def.id}-${ammoText}-${reloading}-${canUse}`;
    if (key !== this._lastAmmo) {
      this.el['ammo-block'].innerHTML = ammoBig;
      this._lastAmmo = key;
    }
    this.el['reload-row'].classList.toggle('show', !!reloading);
    this.el['reload-fill'].style.width = `${Math.round((reloadProgress || 0) * 100)}%`;
  }

  setReloading(active, progress) {
    this.el['reload-row'].classList.toggle('show', !!active);
    this.el['reload-fill'].style.width = `${Math.round((progress || 0) * 100)}%`;
  }

  setTarget(human) {
    if (!human || human.removed) {
      if (this._targetKey === 'none') return;
      this._targetKey = 'none';
      this.el['target-info'].classList.add('hidden');
      return;
    }
    const isCiv = human.type === 'civilian';
    const key = `${human.id}:${Math.ceil(human.hp)}:${human.armorPlates}:${human.type}`;
    if (key === this._targetKey) return;
    this._targetKey = key;
    this.el['target-info'].classList.remove('hidden');
    this.el['target-info'].classList.toggle('civilian', isCiv);
    this.el['target-info'].classList.toggle('responder', !isCiv);
    const label = TYPE_LABEL[human.type] || '小人';
    this.el['target-name'].innerHTML = isCiv
      ? `<span class="enemy-dot" style="color:var(--mint)">●</span>${label}`
      : `<span class="enemy-dot">●</span>${label}`;
    this.el['target-hp'].style.width = `${Math.max(0, Math.min(100, human.hp))}%`;
    if (isCiv) {
      this.el['target-armor'].textContent = '无护甲';
      this.el['target-armor'].style.color = 'var(--ink-faint)';
    } else {
      this.el['target-armor'].textContent = human.armorPlates > 0 ? `防弹衣 ${human.armorPlates}/10` : '护甲已碎';
      this.el['target-armor'].style.color = human.armorPlates > 0 ? 'var(--cyan)' : 'var(--coral)';
    }
  }

  setCrosshair(mode) {
    const ch = this.el.crosshair;
    ch.classList.remove('enemy', 'friendly', 'bio');
    if (mode) ch.classList.add(mode);
  }

  pulseCrosshair() {
    this.el.crosshair.classList.add('kick');
    clearTimeout(this._crosshairTimer);
    this._crosshairTimer = setTimeout(() => this.el.crosshair.classList.remove('kick'), 100);
  }

  setScoped(on) {
    this.el.scope.classList.toggle('hidden', !on);
    this.el.crosshair.classList.toggle('scoped', on);
  }

  setPrompt(name, sub) {
    if (!name) {
      this.el['interact-prompt'].classList.add('hidden');
      return;
    }
    const text = `${name}|${sub || ''}`;
    if (text === this._lastPrompt) return;
    this._lastPrompt = text;
    this.el['interact-prompt'].classList.remove('hidden');
    this.el['p-name'].textContent = name;
    this.el['p-sub'].textContent = sub || '';
  }

  setGrabbing(grabbing) {
    this.el['grab-hint'].classList.toggle('hidden', !grabbing);
  }

  hitmarker(type = 'hit') {
    const el = this.el.hitmarker;
    el.className = 'hitmarker';
    if (type === 'head') el.classList.add('head');
    if (type === 'kill') el.classList.add('kill');
    if (type === 'armor') el.classList.add('armor');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = setTimeout(() => el.classList.remove('show'), 130);
  }

  damageFlash(intensity = 1) {
    const now = performance.now();
    if (now - this.lastDamageFlash < 45) return;
    this.lastDamageFlash = now;
    const el = this.el['damage-flash'];
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this._damageTimer);
    this._damageTimer = setTimeout(() => el.classList.remove('show'), 260);
  }

  addKillFeed({ name, weapon, headshot = false, points = 0 }) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `<span class="tag${headshot ? ' head' : ''}">${headshot ? '爆头' : '击倒'}</span>
      <span class="weapon">${weapon || '未知武器'}</span>
      <span>${name}</span><span class="pts">+${points}</span>`;
    this.el.killfeed.prepend(row);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastElementChild.remove();
    setTimeout(() => row.remove(), 4500);
  }

  toast(title, sub = '', type = '', duration = 2800) {
    this.toastQueue.push({ title, sub, type, duration });
    if (!this.toastActive) this._showNextToast();
  }

  _showNextToast() {
    const next = this.toastQueue.shift();
    if (!next) { this.toastActive = false; return; }
    this.toastActive = true;
    const toast = document.createElement('div');
    toast.className = `toast ${next.type}`;
    toast.innerHTML = `<div class="t-main">${next.title}</div>${next.sub ? `<div class="t-sub">${next.sub}</div>` : ''}`;
    this.el.toasts.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => {
        toast.remove();
        this._showNextToast();
      }, 300);
    }, next.duration);
  }

  floatText(text, worldPos, type = '') {
    if (this.floaters.length > 32) {
      const old = this.floaters.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `float-dmg ${type}`;
    el.textContent = text;
    this.el['float-layer'].appendChild(el);
    this.floaters.push({ el, pos: worldPos.clone(), life: 1.25, maxLife: 1.25, drift: (Math.random() - 0.5) * 22 });
  }

  updateFloaters(camera, width, height, dt = 1 / 60) {
    if (!this.floaters.length) return;
    const v = new (camera.position.constructor)();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      v.copy(f.pos);
      v.y += t * 0.6;
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.4 || Math.abs(v.y) > 1.4) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * width + f.drift * t;
      const y = (-v.y * 0.5 + 0.5) * height - t * 28;
      f.el.style.transform = `translate(-50%,-50%) translate3d(${x}px,${y}px,0) scale(${1 + (1 - t) * 0.1})`;
      f.el.style.opacity = String(Math.min(1, f.life / 0.4));
    }
  }

  drawMinimap(player, cameraYaw, humans, loot, supplySpots, wantedStars) {
    const ctx = this.minimapCtx;
    const canvas = this.el.minimap;
    const S = canvas.width;
    const world = this.game.world;
    const viewRadius = 74;
    const sourceCenterX = ((player.root.position.x + world.half) / world.size) * world.minimapCanvas.width;
    const sourceCenterZ = ((player.root.position.z + world.half) / world.size) * world.minimapCanvas.width;
    const srcSize = (viewRadius * 2 / world.size) * world.minimapCanvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#111a1b';
    ctx.fillRect(0, 0, S, S);
    const srcX = sourceCenterX - srcSize / 2;
    const srcY = sourceCenterZ - srcSize / 2;
    try {
      ctx.drawImage(world.minimapCanvas, srcX, srcY, srcSize, srcSize, 0, 0, S, S);
    } catch (e) {
      // ignore crop edge cases
    }
    // Darken edges to blend into the circular frame.
    const edge = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.52);
    edge.addColorStop(0, 'rgba(7,12,13,0)');
    edge.addColorStop(1, 'rgba(7,12,13,.8)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, S, S);

    const scale = S / (viewRadius * 2);
    const mapPoint = (x, z) => ({ x: S / 2 + (x - player.root.position.x) * scale, y: S / 2 + (z - player.root.position.z) * scale });

    // subtle grid rings
    ctx.strokeStyle = 'rgba(245,240,228,.08)';
    ctx.lineWidth = 1;
    for (const r of [0.28, 0.46]) {
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2); ctx.stroke();
    }

    // smoke clouds
    for (const c of this.game.smokeClouds || []) {
      const q = mapPoint(c.x, c.z);
      ctx.fillStyle = `rgba(220,228,220,${0.14 * clamp(1 - c.age / c.life, 0.2, 1)})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, c.radius * scale, 0, Math.PI * 2); ctx.fill();
    }

    // supplies
    for (const p of supplySpots || []) {
      const q = mapPoint(p.x, p.z);
      if (Math.hypot(q.x - S / 2, q.y - S / 2) > S * 0.48) continue;
      ctx.fillStyle = 'rgba(143,218,215,.9)';
      ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
      ctx.fillStyle = 'rgba(143,218,215,.25)';
      ctx.fillRect(q.x - 6, q.y - 6, 12, 12);
    }

    // loot
    for (const item of loot || []) {
      const q = mapPoint(item.root.position.x, item.root.position.z);
      if (Math.hypot(q.x - S / 2, q.y - S / 2) > S * 0.48) continue;
      ctx.fillStyle = '#ffc864';
      ctx.save();
      ctx.translate(q.x, q.y); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    }

    // people
    for (const h of humans || []) {
      if (h.removed || h.dead) continue;
      const q = mapPoint(h.root.position.x, h.root.position.z);
      if (Math.hypot(q.x - S / 2, q.y - S / 2) > S * 0.48) continue;
      if (h.isResponder) {
        ctx.fillStyle = h.type === 'militarySniper' ? '#ff644f' : h.type === 'police' ? '#ffb66e' : '#ff8468';
        ctx.beginPath(); ctx.arc(q.x, q.y, h.type === 'militarySniper' ? 4.2 : 3.3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,190,.4)'; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(235,227,203,.58)';
        ctx.beginPath(); ctx.arc(q.x, q.y, h.ai?.state?.panic > 0 ? 2.7 : 2.0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // player arrow
    const cx = S / 2, cy = S / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-cameraYaw);
    ctx.shadowColor = 'rgba(182,242,156,.8)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#d5ffc3';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // wanted rim
    if (wantedStars > 0) {
      ctx.strokeStyle = `rgba(255,101,84,${0.18 + wantedStars * 0.06})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.47, 0, Math.PI * 2); ctx.stroke();
    }
    // crosshair lines
    ctx.strokeStyle = 'rgba(245,240,228,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(S / 2 - 4, S - 20); ctx.lineTo(S / 2 + 4, S - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(S - 20, S / 2 - 4); ctx.lineTo(S - 20, S / 2 + 4); ctx.stroke();
  }

  setScopeLabel(text) {
    const el = this.el.scope.querySelector('.scope-label');
    if (el) el.textContent = text;
  }

  setReticleType(text) {
    this.el['reticle-type'].textContent = text || '';
  }
}
