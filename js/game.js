/* 《墙影狂奔》—— 原创横版跑酷。所有图形均由 canvas 绘制，无外部资源。 */
(function () {
  'use strict';

  // ---------------- 常量 ----------------
  var W = 960, H = 540, GROUND = 450;
  var PX = 360, PW = 34, PH = 80, PH_SLIDE = 40;
  var PPM = 40;                       // 每米像素
  var GRAV = 2400, JUMP_V = -800, JUMP2_V = -700;
  var BASE_SPEED = 340, MAX_SPEED = 820, ACCEL = 6;
  var WALL_INTERVAL = 10, APPROACH = 3.0;
  var GAP_START = 10, GAP_MAX = 12, CHASER_PX_PER_M = 22;
  var HIT_PENALTY = 3, FALL_PENALTY = 4, WALL_PENALTY = 7;
  var LS_BEST = 'qyky_best';

  var KEY_GLYPH = { up: '↑', down: '↓', left: '←', right: '→', smash: '空格/X' };
  var WALL_TYPES = {
    vault:   { name: '翻越',     hint: '快速连按两次 ↑',        keys: ['up', 'up'], window: 1.3, h: 150, w: 40, color: '#6fd3ff', bonus: 50 },
    wallrun: { name: '蹬墙',     hint: '按住 ↑ 不放，蹬上墙头', keys: ['up'], hold: 0.5, window: 1.45, h: 330, w: 44, color: '#9dff7a', bonus: 60 },
    slide:   { name: '滑铲穿洞', hint: '按 ↓ 从洞口滑过去',     keys: ['down'], window: 1.1, h: 330, w: 44, color: '#ffd25a', bonus: 50 },
    smash:   { name: '破墙',     hint: '按 空格 或 X 撞碎它',   keys: ['smash'], window: 1.1, h: 330, w: 44, color: '#ff7b5c', bonus: 50 },
    combo:   { name: '连招',     hint: '按顺序输入方向键',      keys: null, window: 1.9, h: 330, w: 50, color: '#e58cff', bonus: 80 }
  };
  var WALL_ORDER = ['vault', 'wallrun', 'slide', 'smash', 'combo'];

  // ---------------- DOM ----------------
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game'), ctx = canvas.getContext('2d');
  var stage = $('stage');
  var ui = {
    hud: $('hud'), dist: $('hud-dist'), score: $('hud-score'), best: $('hud-best'), speed: $('hud-speed'), walls: $('hud-walls'),
    next: $('hud-next'), nextBar: $('hud-next-bar'), gap: $('hud-gap'), gapBar: $('hud-gap-bar'), chaserBox: $('hud-chaser-box'),
    start: $('screen-start'), over: $('screen-over'), pause: $('screen-pause'), touch: $('touch'),
    btnMusic: $('btn-music'), btnSfx: $('btn-sfx'), btnPause: $('btn-pause')
  };
  var Snd = window.GameAudio;

  // ---------------- 工具 ----------------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function loadBest() { try { return parseInt(localStorage.getItem(LS_BEST), 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(LS_BEST, String(v)); } catch (e) { /* ignore */ } }

  // ---------------- 状态 ----------------
  var S = { state: 'menu', best: loadBest(), events: [] };
  var held = { up: false, down: false, left: false, right: false, smash: false };

  function newRun() {
    S.state = 'playing';
    S.t = 0; S.speed = BASE_SPEED; S.speedMul = 1; S.eff = BASE_SPEED;
    S.dist = 0; S.wallsPassed = 0; S.bonus = 0; S.score = 0;
    S.gap = GAP_START; S.lastHit = -10; S.chaserX = PX - GAP_START * CHASER_PX_PER_M - 20;
    S.wallTimer = WALL_INTERVAL; S.cycleSpawned = false; S.lastWallType = null; S.wallCount = 0;
    S.walls = []; S.obstacles = []; S.particles = []; S.texts = [];
    S.spawnCursor = W + 420; S.scroll = 0; S.shake = 0; S.flash = 0;
    S.deathT = 0; S.events = []; S.newRecord = false;
    S.player = { y: GROUND, vy: 0, onGround: true, jumps: 0, sliding: false, slideT: 0, stun: 0, anim: null, phase: 0, rot: 0 };
  }

  // ---------------- 墙壁 ----------------
  function makeCombo(len) {
    var dirs = ['left', 'right', 'up', 'down'], seq = [];
    while (seq.length < len) {
      var d = pick(dirs);
      if (seq.length && seq[seq.length - 1] === d) continue;
      seq.push(d);
    }
    return seq;
  }
  function spawnWall(type) {
    if (!type && window.__game && window.__game.nextWallType) { type = window.__game.nextWallType; window.__game.nextWallType = null; }
    if (!type) {
      do { type = pick(WALL_ORDER); } while (type === S.lastWallType);
    }
    S.lastWallType = type;
    var def = WALL_TYPES[type];
    var ratio = (S.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
    var keys = def.keys ? def.keys.slice() : makeCombo(ratio > 0.55 ? 4 : 3);
    var win = def.window + (type === 'combo' ? (keys.length - 3) * 0.35 : 0);
    var lead = Math.max(S.wallTimer, 0.5);
    var w = {
      type: type, def: def, keys: keys, window: win, prog: 0, lastKeyT: -10, holdStart: null, holdProg: 0,
      x: PX + PW + S.speed * lead, w: def.w, h: def.h, status: 'pending', windowOpened: false,
      broken: false, openT: 0, id: ++S.wallCount, spawnT: S.t, beeps: 0
    };
    S.walls.push(w);
    S.events.push({ e: 'wallSpawn', t: S.t, type: type, keys: keys.slice(), id: w.id });
    return w;
  }
  function wallTtc(w) { return (w.x - (PX + PW)) / Math.max(S.speed, 1); }
  function windowWall() {
    for (var i = 0; i < S.walls.length; i++) {
      var w = S.walls[i];
      if (w.status === 'pending' && w.windowOpened) return w;
    }
    return null;
  }
  function lockedWall() { // 已判定但尚未接触的墙：期间锁定普通操作
    for (var i = 0; i < S.walls.length; i++) {
      var w = S.walls[i];
      if ((w.status === 'ok' || w.status === 'fail') && wallTtc(w) < 1.2) return w;
    }
    return null;
  }
  function upcomingWall() {
    for (var i = 0; i < S.walls.length; i++) {
      var w = S.walls[i];
      if (w.status === 'pending' || w.status === 'ok' || w.status === 'fail') return w;
    }
    return null;
  }
  function succeedWall(w) {
    w.status = 'ok'; w.prog = w.keys.length; w.holdProg = 1;
    S.wallsPassed++; S.bonus += w.def.bonus;
    S.gap = Math.min(GAP_MAX, S.gap + 1);
    Snd.sfx('success');
    addText(W / 2 - 110, 262, w.def.name + '成功！+' + w.def.bonus, w.def.color, 30);
    S.events.push({ e: 'wallOk', t: S.t, id: w.id, type: w.type });
  }
  function failWall(w, why) {
    if (w.status !== 'pending') return;
    w.status = 'fail';
    Snd.sfx('wrong');
    addText(W / 2 - 70, 262, why || '按错了！', '#ff5470', 30);
    S.events.push({ e: 'wallFail', t: S.t, id: w.id, type: w.type, why: why || 'wrong' });
  }
  function wallInput(w, a) {
    if (w.type === 'wallrun') {
      if (a === 'up') { w.holdStart = S.t; Snd.sfx('key'); } else failWall(w, '按错了！');
      return;
    }
    var need = w.keys[w.prog];
    if (a === need) {
      if (w.type === 'vault' && w.prog === 1 && S.t - w.lastKeyT > 0.45) { // 太慢，重新算第一下
        w.lastKeyT = S.t; Snd.sfx('key'); return;
      }
      w.prog++; w.lastKeyT = S.t; Snd.sfx('key');
      if (w.prog >= w.keys.length) succeedWall(w);
    } else {
      failWall(w, '按错了！');
    }
  }
  function startWallAnim(w) {
    var p = S.player, eff = Math.max(S.eff, 60);
    w.status = 'passing';
    p.sliding = false; p.stun = 0;
    p.anim = { type: w.type, t: 0, dur: Math.max(0.38, (eff * 0.18 + w.w + PW + 16) / eff), startY: p.y, wall: w };
    if (w.type === 'smash') { w.broken = true; debris(w, 26); Snd.sfx('smash'); S.shake = 10; }
    else if (w.type === 'slide') Snd.sfx('slide');
    else Snd.sfx('jump2');
  }
  function crashWall(w) {
    var p = S.player;
    var why = w.status === 'pending' ? 'miss' : 'wrong';
    w.status = 'crashed'; w.broken = true;
    debris(w, 34);
    p.anim = null; p.sliding = false; p.stun = 0.9; p.vy = -320; p.y = Math.min(p.y, GROUND - 1); p.onGround = false;
    S.gap -= WALL_PENALTY; S.lastHit = S.t; S.speedMul = 0.2; S.shake = 20; S.flash = 0.5;
    Snd.sfx('crash');
    addText(PX - 40, GROUND - 150, '撞墙！追兵 -' + WALL_PENALTY + ' 米', '#ff5470', 30);
    S.events.push({ e: 'wallCrash', t: S.t, id: w.id, type: w.type, why: why, gap: S.gap });
    if (S.gap <= 0) caught();
  }

  // ---------------- 障碍 ----------------
  function wallZones() {
    var zones = [], i, w;
    for (i = 0; i < S.walls.length; i++) {
      w = S.walls[i];
      zones.push([w.x - S.speed * 2.5, w.x + w.w + S.speed * 0.9]);
    }
    var tProj = S.cycleSpawned ? S.wallTimer + WALL_INTERVAL : S.wallTimer;
    var px = PX + PW + S.speed * tProj;
    zones.push([px - S.speed * 2.6, px + 60 + S.speed * 1.0]);
    return zones;
  }
  function spawnObstacle(x) {
    var ratio = (S.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
    var r = Math.random(), o;
    if (r < 0.4 || S.t < 3) o = { type: 'hurdle', w: 26, h: rand(38, 50) };
    else if (r < 0.7) o = { type: 'bar', w: rand(60, 110), bottom: GROUND - 58 };
    else o = { type: 'gap', w: rand(90, 130 + 50 * ratio) };
    var zones = wallZones();
    for (var i = 0; i < zones.length; i++) {
      if (x + o.w > zones[i][0] && x < zones[i][1]) { S.spawnCursor = zones[i][1] + 10; return; }
    }
    o.x = x; o.hit = false;
    S.obstacles.push(o);
    S.spawnCursor = x + o.w + S.speed * rand(0.8, 1.6) * (1 - 0.15 * ratio);
  }
  function overGap() {
    var cx = PX + PW / 2;
    for (var i = 0; i < S.obstacles.length; i++) {
      var o = S.obstacles[i];
      if (o.type === 'gap' && cx > o.x + 4 && cx < o.x + o.w - 4) return o;
    }
    return null;
  }
  function hitObstacle(o, amount, label) {
    o.hit = true;
    S.gap -= amount; S.lastHit = S.t;
    S.speedMul = Math.min(S.speedMul, 0.55); S.shake = 9;
    S.player.stun = 0.4; S.player.sliding = false;
    Snd.sfx(o.type === 'gap' ? 'fall' : 'hit');
    addText(PX - 30, GROUND - 130, label + ' 追兵 -' + amount + ' 米', '#ff8a5c', 24);
    S.events.push({ e: 'hit', t: S.t, type: o.type, gap: S.gap });
    if (S.gap <= 0) caught();
  }

  // ---------------- 特效 ----------------
  function addText(x, y, s, color, size) { S.texts.push({ x: x, y: y, s: s, color: color, size: size || 24, life: 1.4 }); }
  function particle(x, y, vx, vy, life, color, size, grav) {
    S.particles.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, color: color, size: size, grav: grav || 0 });
  }
  function debris(w, n) {
    for (var i = 0; i < n; i++) {
      particle(w.x + rand(0, w.w), GROUND - rand(0, w.h), rand(80, 420), rand(-520, -80), rand(0.6, 1.2),
        pick(['#8a5a44', '#a7745a', '#5d3b2e', '#c9a27e']), rand(5, 13), 1400);
    }
  }

  // ---------------- 结束 ----------------
  function caught() {
    if (S.state !== 'playing') return;
    S.gap = 0;
    S.state = 'dying'; S.deathT = 0;
    S.player.anim = null;
    Snd.sfx('caught'); Snd.stopMusic();
    S.events.push({ e: 'caught', t: S.t });
  }
  function gameOver() {
    S.state = 'over';
    S.score = Math.floor(S.dist) + S.bonus;
    if (S.score > S.best) { S.best = S.score; S.newRecord = true; saveBest(S.best); Snd.sfx('record'); }
    $('over-score').textContent = S.score;
    $('over-dist').textContent = Math.floor(S.dist) + ' 米';
    $('over-walls').textContent = S.wallsPassed + ' 面';
    $('over-best').textContent = S.best;
    $('over-record').classList.toggle('hidden', !S.newRecord);
    ui.over.classList.remove('hidden');
    ui.btnPause.classList.add('hidden');
    S.events.push({ e: 'over', t: S.t, score: S.score });
  }

  // ---------------- 输入 ----------------
  function doAction(a) {
    if (S.state !== 'playing') return;
    var p = S.player, w = windowWall();
    if (a === 'tap') a = (w && w.type === 'smash') ? 'smash' : 'up';
    if (w) { wallInput(w, a); return; }
    if (lockedWall() || p.anim || p.stun > 0.15) return;
    if (a === 'up') {
      if (p.onGround || p.sliding) {
        p.sliding = false; p.vy = JUMP_V; p.onGround = false; p.jumps = 1; Snd.sfx('jump');
      } else if (p.jumps < 2) {
        p.vy = JUMP2_V; p.jumps = 2; Snd.sfx('jump2');
        for (var i = 0; i < 6; i++) particle(PX + PW / 2, p.y, rand(-120, 120), rand(40, 140), 0.35, '#ffffff', 4);
      }
    } else if (a === 'down') {
      if (p.onGround) { if (!p.sliding) { p.sliding = true; p.slideT = 0; Snd.sfx('slide'); } }
      else { p.vy = Math.max(p.vy, 950); p.wantSlide = true; }
    }
  }
  function press(a) {
    if (held[a] && a !== 'tap') return;
    if (a !== 'tap') held[a] = true;
    doAction(a);
  }
  function release(a) {
    held[a] = false;
    if (a === 'up' && S.state === 'playing') {
      for (var i = 0; i < S.walls.length; i++) {
        var w = S.walls[i];
        if (w.type === 'wallrun' && w.status === 'pending' && w.holdStart !== null) { w.holdStart = null; w.holdProg = 0; }
      }
    }
  }

  var KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', Space: 'tap', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', KeyX: 'smash', KeyJ: 'smash'
  };
  var spaceAs = null;
  window.addEventListener('keydown', function (e) {
    var code = e.code;
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (S.state === 'menu' || S.state === 'over') { e.preventDefault(); startGame(); }
      else if (S.state === 'paused') { e.preventDefault(); resumeGame(); }
      return;
    }
    if (code === 'KeyP' || code === 'Escape') { if (S.state === 'playing') pauseGame(); else if (S.state === 'paused') resumeGame(); return; }
    if (code === 'KeyM') { toggleMusic(); return; }
    if (code === 'KeyN') { toggleSfx(); return; }
    var a = KEYMAP[code];
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return;
    if (a === 'tap') { // 空格：破墙窗口内=破墙，否则=跳跃
      var w = windowWall();
      spaceAs = (w && w.type === 'smash') ? 'smash' : 'up';
      press(spaceAs);
      return;
    }
    press(a);
  });
  window.addEventListener('keyup', function (e) {
    var a = KEYMAP[e.code];
    if (!a) return;
    if (a === 'tap') { if (spaceAs) release(spaceAs); spaceAs = null; return; }
    release(a);
  });
  window.addEventListener('blur', function () { for (var k in held) held[k] = false; });

  // 触屏：滑动 / 轻点
  var touchState = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    showTouchUI(e.pointerType !== 'mouse');
    touchState = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), done: null };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!touchState || touchState.id !== e.pointerId || touchState.done) return;
    var dx = e.clientX - touchState.x, dy = e.clientY - touchState.y, th = Math.max(24, stage.clientWidth * 0.03);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    var a = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right');
    touchState.done = a; press(a);
  });
  function endTouch(e) {
    if (!touchState || touchState.id !== e.pointerId) return;
    if (touchState.done) release(touchState.done);
    else if (performance.now() - touchState.t < 350) { doAction('tap'); }
    touchState = null;
  }
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  Array.prototype.forEach.call(document.querySelectorAll('.tbtn'), function (b) {
    var act = b.getAttribute('data-act');
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } press(act); });
    var up = function (e) { e.preventDefault(); b.classList.remove('on'); release(act); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  var touchUI = false;
  function showTouchUI(on) {
    if (on && !touchUI) { touchUI = true; }
    ui.touch.classList.toggle('hidden', !(touchUI && (S.state === 'playing' || S.state === 'paused')));
  }
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) touchUI = true;
  window.addEventListener('touchstart', function () { if (!touchUI) { touchUI = true; showTouchUI(true); } }, { passive: true });

  // ---------------- 界面控制 ----------------
  function startGame() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Snd.resume();
    newRun();
    ui.start.classList.add('hidden'); ui.over.classList.add('hidden'); ui.pause.classList.add('hidden');
    ui.hud.classList.remove('hidden'); ui.btnPause.classList.remove('hidden');
    showTouchUI(false);
    Snd.sfx('start'); Snd.setIntensity(0); Snd.startMusic();
    for (var k in held) held[k] = false;
  }
  function pauseGame() {
    if (S.state !== 'playing') return;
    S.state = 'paused'; ui.pause.classList.remove('hidden'); Snd.suspend();
  }
  function resumeGame() {
    if (S.state !== 'paused') return;
    S.state = 'playing'; ui.pause.classList.add('hidden'); Snd.resume(); lastTs = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function goHome() {
    S.state = 'menu'; Snd.stopMusic();
    ui.over.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.hud.classList.add('hidden');
    ui.btnPause.classList.add('hidden'); ui.start.classList.remove('hidden'); showTouchUI(false);
    $('start-best').textContent = S.best;
  }
  function refreshSoundButtons() {
    ui.btnMusic.textContent = '音乐：' + (Snd.musicOn ? '开' : '关'); ui.btnMusic.classList.toggle('off', !Snd.musicOn);
    ui.btnSfx.textContent = '音效：' + (Snd.sfxOn ? '开' : '关'); ui.btnSfx.classList.toggle('off', !Snd.sfxOn);
  }
  function toggleMusic() { Snd.resume(); Snd.setMusic(!Snd.musicOn); refreshSoundButtons(); }
  function toggleSfx() { Snd.resume(); Snd.setSfx(!Snd.sfxOn); refreshSoundButtons(); }
  $('btn-start').addEventListener('click', startGame);
  $('btn-retry').addEventListener('click', startGame);
  $('btn-home').addEventListener('click', goHome);
  $('btn-quit').addEventListener('click', goHome);
  $('btn-resume').addEventListener('click', resumeGame);
  ui.btnPause.addEventListener('click', function () { if (S.state === 'playing') pauseGame(); else resumeGame(); });
  ui.btnMusic.addEventListener('click', function (e) { toggleMusic(); e.currentTarget.blur(); });
  ui.btnSfx.addEventListener('click', function (e) { toggleSfx(); e.currentTarget.blur(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });
  refreshSoundButtons();
  $('start-best').textContent = S.best;

  // ---------------- 布局 ----------------
  var dpr = 1;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var portrait = vh > vw * 1.1;
    document.body.classList.toggle('portrait', portrait);
    var availH = portrait ? vh * 0.5 : vh;
    var w = Math.min(vw, availH * 16 / 9), h = w * 9 / 16;
    w = Math.floor(w); h = Math.floor(h);
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    stage.style.setProperty('--u', (w / 100) + 'px');
    document.body.style.setProperty('--stage-h', h + 'px');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
  layout();

  // ---------------- 更新 ----------------
  function update(dt) {
    var p = S.player, i, o, w;
    // 粒子 & 文本
    for (i = S.particles.length - 1; i >= 0; i--) {
      var q = S.particles[i];
      q.life -= dt; q.vy += q.grav * dt; q.x += (q.vx - S.eff * 0.6) * dt; q.y += q.vy * dt;
      if (q.life <= 0) S.particles.splice(i, 1);
    }
    for (i = S.texts.length - 1; i >= 0; i--) { S.texts[i].life -= dt; S.texts[i].y -= 40 * dt; if (S.texts[i].life <= 0) S.texts.splice(i, 1); }
    S.shake = Math.max(0, S.shake - 40 * dt); S.flash = Math.max(0, S.flash - dt);

    if (S.state === 'dying') {
      S.deathT += dt;
      S.speedMul = Math.max(0, S.speedMul - dt * 2); S.eff = S.speed * S.speedMul;
      S.chaserX += (PX - 30 - S.chaserX) * Math.min(1, dt * 6);
      p.phase += dt * 4;
      if (S.deathT > 1.4) gameOver();
      return;
    }

    S.t += dt;
    S.speed = Math.min(MAX_SPEED, BASE_SPEED + ACCEL * S.t);
    S.speedMul += (1 - S.speedMul) * Math.min(1, dt * 1.3);
    var eff = S.eff = S.speed * S.speedMul;
    S.dist += eff * dt / PPM;
    S.scroll += eff * dt;
    S.score = Math.floor(S.dist) + S.bonus;
    Snd.setIntensity((S.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED));

    // 墙壁计时：每 10 秒一面墙（提前 3 秒出现提示）
    S.wallTimer -= dt;
    if (!S.cycleSpawned && S.wallTimer <= APPROACH) { spawnWall(); S.cycleSpawned = true; }
    if (S.wallTimer <= 0) { S.wallTimer += WALL_INTERVAL; S.cycleSpawned = false; }

    // 滚动
    for (i = 0; i < S.obstacles.length; i++) S.obstacles[i].x -= eff * dt;
    for (i = 0; i < S.walls.length; i++) S.walls[i].x -= eff * dt;
    S.spawnCursor -= eff * dt;
    S.obstacles = S.obstacles.filter(function (o) { return o.x + o.w > -120; });
    S.walls = S.walls.filter(function (w) { return w.x + w.w > -200 || w.status === 'pending' || w.status === 'ok' || w.status === 'fail'; });
    var guard = 0;
    while (S.spawnCursor < W + 60 && guard++ < 5) spawnObstacle(S.spawnCursor);

    // 墙壁判定
    for (i = 0; i < S.walls.length; i++) {
      w = S.walls[i];
      var ttc = wallTtc(w);
      if (w.status === 'pending') {
        if (!w.windowOpened && ttc <= w.window) {
          w.windowOpened = true; Snd.sfx('go');
          if (w.type === 'wallrun' && held.up) w.holdStart = S.t;
        }
        if (!w.windowOpened && ttc <= w.window + 1.5) { // 倒数提示音
          var b = Math.floor((w.window + 1.5 - ttc) / 0.5);
          if (b > w.beeps && b <= 3) { w.beeps = b; Snd.sfx('beep'); }
        }
        if (w.type === 'wallrun' && w.windowOpened && w.holdStart !== null) {
          w.holdProg = (S.t - w.holdStart) / w.def.hold;
          if (w.holdProg >= 1) succeedWall(w);
        }
      }
      if (w.status === 'ok' && w.x - (PX + PW) <= eff * 0.18) startWallAnim(w);
      if ((w.status === 'pending' || w.status === 'fail') && w.x <= PX + PW) crashWall(w);
      if (S.state !== 'playing') return;
      if (w.type === 'combo' && w.status === 'passing') w.openT = Math.min(1, w.openT + dt * 5);
    }

    // 玩家
    var runRate = eff / 340;
    p.phase += dt * 11 * Math.max(0.4, runRate);
    if (p.anim) {
      var an = p.anim; an.t += dt;
      var k = clamp(an.t / an.dur, 0, 1), base = an.startY + (GROUND - an.startY) * Math.min(1, k * 3);
      var off = 0;
      if (an.type === 'vault') off = -Math.sin(Math.PI * k) * (an.wall.h + 45);
      else if (an.type === 'wallrun') off = -Math.sin(Math.PI * k) * (an.wall.h + 40);
      else if (an.type === 'combo') off = -Math.sin(Math.PI * k) * 70;
      p.y = base + off; p.vy = 0;
      p.rot = an.type === 'combo' ? -Math.PI * 2 * k : (an.type === 'wallrun' ? (k < 0.5 ? -1.3 * Math.min(1, k * 4) : -1.3 - (Math.PI * 2 - 1.3) * (k - 0.5) * 2) : 0);
      if (k >= 1) { p.anim = null; p.y = GROUND; p.rot = 0; p.onGround = true; p.jumps = 0; Snd.sfx('land'); }
    } else {
      p.rot = 0;
      if (p.stun > 0) p.stun -= dt;
      if (p.sliding) { p.slideT += dt; if (p.slideT > 0.55 && !held.down) p.sliding = false; }
      p.vy += GRAV * dt; p.y += p.vy * dt;
      var g = overGap();
      if (p.y >= GROUND) {
        if (g && !g.hit) {
          hitObstacle(g, FALL_PENALTY, '失足！');
          if (S.state !== 'playing') return;
          p.y = GROUND; p.vy = -880; p.onGround = false; p.jumps = 1;
        } else {
          if (!p.onGround) {
            Snd.sfx('land');
            for (i = 0; i < 5; i++) particle(PX + PW / 2, GROUND, rand(-60, 60), rand(-120, -20), 0.35, 'rgba(230,210,255,.8)', 4, 300);
            if (p.wantSlide || held.down) { p.sliding = true; p.slideT = 0; Snd.sfx('slide'); }
          }
          p.wantSlide = false;
          p.y = GROUND; p.vy = 0; p.onGround = true; p.jumps = 0;
        }
      } else p.onGround = false;

      // 碰撞
      var top = p.y - (p.sliding ? PH_SLIDE : PH), l = PX + 8, r = PX + PW - 8;
      for (i = 0; i < S.obstacles.length; i++) {
        o = S.obstacles[i];
        if (o.hit || o.type === 'gap') continue;
        if (r < o.x || l > o.x + o.w) continue;
        if (o.type === 'hurdle' && p.y > GROUND - o.h + 4) { hitObstacle(o, HIT_PENALTY, '绊倒！'); }
        else if (o.type === 'bar' && top < o.bottom) { hitObstacle(o, HIT_PENALTY, '撞头！'); }
        if (S.state !== 'playing') return;
      }
      if (p.onGround && !p.sliding && Math.random() < dt * 10 * runRate) particle(PX + 6, GROUND, rand(-30, 10), rand(-60, -10), 0.4, 'rgba(200,180,240,.5)', 3);
    }

    // 追兵：干净奔跑时逐渐拉开
    if (S.t - S.lastHit > 2) S.gap = Math.min(GAP_MAX, S.gap + 0.4 * dt);
    var cx = PX - S.gap * CHASER_PX_PER_M - 20;
    S.chaserX += (cx - S.chaserX) * Math.min(1, dt * 3);
    if (Math.random() < dt * 30) particle(S.chaserX + rand(-20, 10), GROUND - rand(10, 110), rand(-80, -20), rand(-40, 10), rand(0.5, 1), 'rgba(40,10,60,.55)', rand(8, 16));
  }

  // ---------------- 渲染 ----------------
  var LAYERS = (function () {
    function gen(n, wmin, wmax, hmin, hmax) {
      var arr = [], x = 0;
      for (var i = 0; i < n; i++) { var w = rand(wmin, wmax); arr.push({ x: x, w: w, h: rand(hmin, hmax), win: Math.random() }); x += w + rand(0, 14); }
      return { list: arr, len: x };
    }
    return { far: gen(30, 40, 90, 70, 190), mid: gen(24, 60, 120, 110, 260), lamps: 0 };
  })();

  function drawLayer(layer, factor, color, winColor) {
    var off = (S.scroll * factor) % layer.len;
    for (var rep = 0; rep < 2; rep++) {
      for (var i = 0; i < layer.list.length; i++) {
        var b = layer.list[i], x = b.x - off + rep * layer.len;
        if (x > W || x + b.w < 0) continue;
        ctx.fillStyle = color; ctx.fillRect(x, GROUND - b.h, b.w, b.h);
        if (winColor) {
          ctx.fillStyle = winColor;
          for (var wy = GROUND - b.h + 12; wy < GROUND - 20; wy += 22)
            for (var wx = x + 8; wx < x + b.w - 10; wx += 16)
              if (((wx * 7 + wy * 3 + b.win * 100) | 0) % 5 < 2) ctx.fillRect(wx, wy, 7, 10);
        }
      }
    }
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#1b1033'); g.addColorStop(0.55, '#5a2a6e'); g.addColorStop(1, '#ff8a5c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
    // 月亮
    ctx.fillStyle = 'rgba(255,240,210,.9)'; ctx.beginPath(); ctx.arc(170, 110, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,.15)'; ctx.beginPath(); ctx.arc(170, 110, 60, 0, Math.PI * 2); ctx.fill();
    drawLayer(LAYERS.far, 0.1, '#3a1d52', null);
    drawLayer(LAYERS.mid, 0.3, '#24123a', 'rgba(255,214,120,.55)');
    // 地面
    ctx.fillStyle = '#2b1838'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#e0592a'; ctx.fillRect(0, GROUND, W, 4);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
    var off = S.scroll % 60;
    ctx.beginPath();
    for (var x = -off; x < W; x += 60) { ctx.moveTo(x, GROUND + 4); ctx.lineTo(x - 30, H); }
    ctx.stroke();
  }

  function drawObstacles() {
    for (var i = 0; i < S.obstacles.length; i++) {
      var o = S.obstacles[i];
      if (o.x > W + 20 || o.x + o.w < -20) continue;
      if (o.type === 'gap') {
        var g = ctx.createLinearGradient(0, GROUND, 0, H);
        g.addColorStop(0, '#07030d'); g.addColorStop(1, '#000');
        ctx.fillStyle = g; ctx.fillRect(o.x, GROUND, o.w, H - GROUND);
        ctx.fillStyle = '#ff5a3c'; ctx.fillRect(o.x - 4, GROUND, 4, 10); ctx.fillRect(o.x + o.w, GROUND, 4, 10);
      } else if (o.type === 'hurdle') {
        ctx.save(); ctx.translate(o.x, GROUND);
        if (o.hit) { ctx.translate(o.w, 0); ctx.rotate(1.2); ctx.translate(-o.w, 0); }
        ctx.fillStyle = '#ddd'; ctx.fillRect(2, -o.h, 4, o.h); ctx.fillRect(o.w - 6, -o.h, 4, o.h);
        for (var s = 0; s < 3; s++) { ctx.fillStyle = s % 2 ? '#fff' : '#ff6a2a'; ctx.fillRect(-4 + s * ((o.w + 8) / 3), -o.h, (o.w + 8) / 3 + 0.5, 14); }
        ctx.restore();
      } else if (o.type === 'bar') {
        ctx.strokeStyle = '#555'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(o.x + 8, 0); ctx.lineTo(o.x + 8, o.bottom - 20); ctx.moveTo(o.x + o.w - 8, 0); ctx.lineTo(o.x + o.w - 8, o.bottom - 20); ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.bottom - 24, o.w, 24); ctx.clip();
        ctx.fillStyle = '#222'; ctx.fillRect(o.x, o.bottom - 24, o.w, 24);
        ctx.fillStyle = o.hit ? '#a08a2a' : '#ffd23c';
        for (var sx = o.x - 24; sx < o.x + o.w; sx += 24) { ctx.beginPath(); ctx.moveTo(sx, o.bottom); ctx.lineTo(sx + 12, o.bottom); ctx.lineTo(sx + 24, o.bottom - 24); ctx.lineTo(sx + 12, o.bottom - 24); ctx.fill(); }
        ctx.restore();
      }
    }
  }

  function drawBricks(x, y, w, h, c1, c2) {
    ctx.fillStyle = c1; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.beginPath();
    for (var r = 0, yy = y + h; yy > y; yy -= 16, r++) {
      ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
      for (var xx = x + (r % 2 ? 11 : 0); xx < x + w; xx += 22) { ctx.moveTo(xx, yy); ctx.lineTo(xx, Math.max(y, yy - 16)); }
    }
    ctx.stroke();
  }

  function drawWalls() {
    for (var i = 0; i < S.walls.length; i++) {
      var w = S.walls[i];
      if (w.broken || w.x > W + 20 || w.x + w.w < -20) continue;
      var top = GROUND - w.h, c = w.def.color;
      if (w.type === 'vault') {
        drawBricks(w.x, top, w.w, w.h, '#7a4b3a', '#4a2a22');
        ctx.fillStyle = '#b8b0c8'; ctx.fillRect(w.x - 4, top - 8, w.w + 8, 10);
      } else if (w.type === 'wallrun') {
        drawBricks(w.x, top, w.w, w.h, '#5b4a6e', '#3a2c4a');
        ctx.fillStyle = 'rgba(157,255,122,.7)';
        for (var f = 0; f < 5; f++) ctx.fillRect(w.x + 4, GROUND - 60 - f * 55, 10, 6);
      } else if (w.type === 'slide') {
        drawBricks(w.x, top, w.w, w.h, '#6e5a3a', '#463822');
        ctx.fillStyle = '#05020a'; ctx.fillRect(w.x - 1, GROUND - 52, w.w + 2, 52);
        ctx.fillStyle = c; ctx.fillRect(w.x - 3, GROUND - 56, w.w + 6, 4);
      } else if (w.type === 'smash') {
        ctx.fillStyle = '#8c6a4c'; ctx.fillRect(w.x, top, w.w, w.h);
        ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 2;
        for (var pl = top; pl < GROUND; pl += 30) { ctx.beginPath(); ctx.moveTo(w.x, pl); ctx.lineTo(w.x + w.w, pl); ctx.stroke(); }
        ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(w.x + 8, GROUND - 200); ctx.lineTo(w.x + 22, GROUND - 160); ctx.lineTo(w.x + 12, GROUND - 120); ctx.lineTo(w.x + 30, GROUND - 80); ctx.lineTo(w.x + 18, GROUND - 40);
        ctx.stroke();
      } else if (w.type === 'combo') {
        var shift = w.openT * w.h;
        ctx.save(); ctx.beginPath(); ctx.rect(w.x - 10, 0, w.w + 20, GROUND); ctx.clip();
        ctx.fillStyle = '#4a4e5e'; ctx.fillRect(w.x, top - shift, w.w, w.h);
        ctx.strokeStyle = '#2c2f3a'; ctx.lineWidth = 3;
        for (var gy = top - shift; gy < GROUND - shift; gy += 26) { ctx.beginPath(); ctx.moveTo(w.x, gy); ctx.lineTo(w.x + w.w, gy); ctx.stroke(); }
        ctx.fillStyle = c; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
        for (var kk = 0; kk < w.keys.length; kk++) ctx.fillText(KEY_GLYPH[w.keys[kk]], w.x + w.w / 2, GROUND - 210 + kk * 34 - shift);
        ctx.restore();
        ctx.fillStyle = '#2c2f3a'; ctx.fillRect(w.x - 8, top - 10, w.w + 16, 10);
      }
      // 墙上方的小标记
      if (w.status === 'pending' || w.status === 'ok' || w.status === 'fail') {
        ctx.fillStyle = w.status === 'fail' ? '#ff5470' : w.status === 'ok' ? '#5be38a' : c;
        ctx.font = 'bold 20px ' + FONT; ctx.textAlign = 'center';
        ctx.fillText(w.def.name, w.x + w.w / 2, top - 18);
      }
    }
  }

  // 角色绘制（关节角度：0 = 竖直向下，正值 = 向前）
  function limb(x, y, a1, l1, a2, l2, width, color) {
    var kx = x + Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
    var fx = kx + Math.sin(a2) * l2, fy = ky + Math.cos(a2) * l2;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    return [fx, fy];
  }
  function pose(name, ph) {
    var s = Math.sin(ph), c = Math.cos(ph), P;
    switch (name) {
      case 'jump': P = { hip: -40, lean: 0.25, l1: [1.3, -0.2], l2: [0.3, -0.9], a1: [2.6, 2.2], a2: [-0.6, 0.6] }; break;
      case 'slide': P = { hip: -18, lean: -1.05, l1: [1.45, 1.55], l2: [1.0, 2.2], a1: [-1.6, -0.9], a2: [0.7, 1.4] }; break;
      case 'stun': P = { hip: -38, lean: -0.5 + s * 0.1, l1: [0.6, 0.1], l2: [-0.3, -0.9], a1: [2.8 + s * 0.4, 2.4], a2: [-2.4 - s * 0.4, -2.0] }; break;
      case 'smash': P = { hip: -40, lean: 0.75, l1: [0.9 * s, 0.9 * s - 0.7], l2: [-0.9 * s, -0.9 * s - 0.7], a1: [1.6, 1.6], a2: [0.6, 1.3] }; break;
      case 'vault': P = { hip: -40, lean: 0.9, l1: [1.6, 0.4], l2: [1.2, 0.0], a1: [0.2, 0.0], a2: [2.6, 2.6] }; break;
      case 'caught': P = { hip: -38, lean: -0.3, l1: [0.3, 0.0], l2: [-0.3, -0.6], a1: [2.9, 2.7], a2: [2.5, 2.9] }; break;
      default:
        P = { hip: -40, lean: 0.3, l1: [0.85 * s, 0.85 * s - 0.25 - 1.0 * Math.max(0, -c)], l2: [-0.85 * s, -0.85 * s - 0.25 - 1.0 * Math.max(0, c)],
          a1: [-0.9 * s, -0.9 * s + 1.3], a2: [0.9 * s, 0.9 * s + 1.3] };
    }
    return P;
  }
  function drawFigure(x, y, P, col, scale, rot, scarfPhase) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (rot) { ctx.translate(0, -40); ctx.rotate(rot); ctx.translate(0, 40); }
    var hx = 0, hy = P.hip;
    var sx = hx + Math.sin(P.lean) * 26, sy = hy - Math.cos(P.lean) * 26;
    var headX = sx + Math.sin(P.lean) * 13, headY = sy - Math.cos(P.lean) * 13;
    // 后侧肢体
    limb(hx, hy, P.l2[0], 21, P.l2[1], 21, 7, col.back);
    limb(sx, sy, P.a2[0], 15, P.a2[1], 14, 6, col.backArm);
    // 围巾（玩家特征）
    if (col.scarf) {
      ctx.strokeStyle = col.scarf; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(sx, sy + 2);
      ctx.quadraticCurveTo(sx - 18, sy - 4 + Math.sin(scarfPhase) * 6, sx - 34, sy + 2 + Math.sin(scarfPhase + 1.5) * 8);
      ctx.stroke();
    }
    // 躯干
    ctx.strokeStyle = col.body; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(sx, sy); ctx.stroke();
    // 头
    ctx.fillStyle = col.head; ctx.beginPath(); ctx.arc(headX, headY, 10, 0, Math.PI * 2); ctx.fill();
    if (col.band) { ctx.strokeStyle = col.band; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(headX, headY, 10, Math.PI * 1.05 - P.lean, Math.PI * 1.75 - P.lean); ctx.stroke(); }
    if (col.eyes) {
      ctx.save(); ctx.shadowColor = col.eyes; ctx.shadowBlur = 12; ctx.fillStyle = col.eyes;
      ctx.beginPath(); ctx.arc(headX + 5, headY - 1, 2.6, 0, Math.PI * 2); ctx.arc(headX + 0.5, headY - 1, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else {
      ctx.fillStyle = '#1b1033'; ctx.beginPath(); ctx.arc(headX + 5, headY - 1, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    // 前侧肢体
    var foot = limb(hx, hy, P.l1[0], 21, P.l1[1], 21, 8, col.leg);
    if (col.shoe) { ctx.fillStyle = col.shoe; ctx.beginPath(); ctx.arc(foot[0] + 2, foot[1], 4.5, 0, Math.PI * 2); ctx.fill(); }
    limb(sx, sy, P.a1[0], 15, P.a1[1], 14, 6.5, col.arm);
    ctx.restore();
  }
  var FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC","Noto Serif CJK SC",sans-serif';
  var PLAYER_COL = { back: '#1f2c5a', backArm: '#128f86', body: '#19c3b5', head: '#ffd9b8', band: '#ff4d4d', leg: '#2e3f7a', arm: '#1fd8c8', shoe: '#ffffff', scarf: '#ff9a3c' };
  var CHASER_COL = { back: '#140a22', backArm: '#140a22', body: '#22123a', head: '#2a1646', leg: '#1d0f30', arm: '#2a1646', eyes: '#ff2a3c' };

  function drawPlayer() {
    var p = S.player, name = 'run';
    if (S.state === 'dying') name = 'caught';
    else if (p.anim) name = { vault: 'vault', wallrun: 'run', slide: 'slide', smash: 'smash', combo: 'jump' }[p.anim.type];
    else if (p.stun > 0) name = 'stun';
    else if (p.sliding) name = 'slide';
    else if (!p.onGround) name = 'jump';
    else if (windowWall() && windowWall().type === 'smash') name = 'smash';
    var P = pose(name, p.phase);
    var rot = p.rot;
    drawFigure(PX + PW / 2, p.y, P, PLAYER_COL, 1, rot, p.phase * 1.3);
  }
  function drawChaser() {
    var x = S.chaserX + 10, y = GROUND, ph = S.player.phase * 0.95;
    // 暗红光晕，让黑影在夜色中可见
    var gl = ctx.createRadialGradient(x, y - 70, 10, x, y - 70, 110);
    gl.addColorStop(0, 'rgba(255,40,90,' + (0.28 + 0.08 * Math.sin(S.t * 6)) + ')'); gl.addColorStop(1, 'rgba(255,40,90,0)');
    ctx.fillStyle = gl; ctx.fillRect(x - 120, y - 190, 240, 200);
    // 斗篷
    ctx.fillStyle = 'rgba(30,12,50,.85)';
    ctx.beginPath(); ctx.moveTo(x + 4, y - 88); ctx.quadraticCurveTo(x - 40, y - 60 + Math.sin(ph) * 6, x - 50 + Math.sin(ph * 1.3) * 8, y - 10); ctx.lineTo(x - 6, y - 40); ctx.closePath(); ctx.fill();
    var P = pose(S.state === 'dying' ? 'smash' : 'run', ph);
    P.lean = S.state === 'dying' ? 0.6 : 0.45;
    if (S.state === 'dying') { P.a1 = [1.7, 1.7]; P.a2 = [1.5, 1.6]; }
    drawFigure(x, y, P, CHASER_COL, 1.35, 0, 0);
    // 兜帽
    var hx = x + Math.sin(P.lean) * 39 * 1.35, hy = y + (-40 - Math.cos(P.lean) * 39) * 1.35;
    ctx.fillStyle = '#1a0c2e'; ctx.beginPath(); ctx.moveTo(hx - 18, hy + 10); ctx.quadraticCurveTo(hx - 6, hy - 26, hx + 14, hy - 8); ctx.lineTo(hx + 2, hy + 4); ctx.closePath(); ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function keyCap(x, y, label, state, wide) {
    var w = wide ? 92 : 50, h = 50;
    roundRect(x - w / 2, y, w, h, 10);
    ctx.fillStyle = state === 'done' ? '#5be38a' : state === 'bad' ? '#ff5470' : state === 'next' ? '#fff3c4' : '#ffffff';
    ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = state === 'next' ? '#ffb03b' : 'rgba(0,0,0,.3)'; ctx.stroke();
    ctx.fillStyle = '#2a1650'; ctx.font = 'bold ' + (wide ? 22 : 30) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + h / 2 + 1); ctx.textBaseline = 'alphabetic';
    return w;
  }
  function drawWallPrompt() {
    var w = upcomingWall();
    if (!w) return;
    var ttc = wallTtc(w);
    var bx = 170, by = 54, bw = 560, bh = 168, cx = bx + bw / 2;
    var col = w.status === 'ok' ? '#5be38a' : w.status === 'fail' ? '#ff5470' : w.def.color;
    roundRect(bx, by, bw, bh, 16);
    ctx.fillStyle = 'rgba(12,6,28,.82)'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.font = 'bold 34px ' + FONT;
    ctx.fillText('前方墙壁：' + w.def.name, cx, by + 42);
    ctx.fillStyle = '#e8e0ff'; ctx.font = '18px ' + FONT;
    ctx.fillText(w.def.hint, cx, by + 68);
    // 按键
    var n = w.keys.length, wide = w.type === 'smash', gapX = wide ? 0 : 62, startX = cx - (n - 1) * gapX / 2;
    for (var i = 0; i < n; i++) {
      var st = w.status === 'ok' || i < w.prog ? 'done' : (w.status === 'fail' ? 'bad' : (i === w.prog && w.windowOpened ? 'next' : ''));
      keyCap(startX + i * gapX, by + 78, KEY_GLYPH[w.keys[i]], st, wide);
    }
    if (w.type === 'wallrun') { // 按住进度
      var hp = w.status === 'ok' ? 1 : clamp(w.holdProg, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(cx + 40, by + 96, 120, 14);
      ctx.fillStyle = '#9dff7a'; ctx.fillRect(cx + 40, by + 96, 120 * hp, 14);
      ctx.fillStyle = '#e8e0ff'; ctx.font = '15px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('按住', cx + 166, by + 108); ctx.textAlign = 'center';
    }
    // 时机条
    var tx = bx + 30, ty = by + 140, tw = bw - 150, th = 14;
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(tx, ty, tw, th);
    var zw = tw * Math.min(1, w.window / APPROACH);
    ctx.fillStyle = w.windowOpened && w.status === 'pending' ? 'rgba(91,227,138,.9)' : 'rgba(91,227,138,.4)';
    ctx.fillRect(tx + tw - zw, ty, zw, th);
    var mk = tx + tw * clamp(1 - ttc / APPROACH, 0, 1);
    ctx.fillStyle = '#fff'; ctx.fillRect(mk - 3, ty - 6, 6, th + 12);
    ctx.fillStyle = '#cfc4ef'; ctx.font = '13px ' + FONT; ctx.textAlign = 'left';
    ctx.fillText('时机窗口', tx + tw - zw, ty - 4);
    // 状态
    var label, lc;
    if (w.status === 'ok') { label = '✔ 成功'; lc = '#5be38a'; }
    else if (w.status === 'fail') { label = '✘ 失误'; lc = '#ff5470'; }
    else if (w.windowOpened) { label = '现在！'; lc = (Math.floor(S.t * 8) % 2) ? '#ffffff' : '#ffd25a'; }
    else { label = '准备 ' + Math.max(0, ttc).toFixed(1) + 's'; lc = '#cfc4ef'; }
    ctx.fillStyle = lc; ctx.font = 'bold 22px ' + FONT; ctx.textAlign = 'center';
    ctx.fillText(label, bx + bw - 62, ty + 13);
  }

  function render() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (!S.player) { newRun(); S.state = 'menu'; }
    ctx.save();
    if (S.shake > 0) ctx.translate(rand(-S.shake, S.shake) * 0.5, rand(-S.shake, S.shake) * 0.5);
    drawBackground();
    drawObstacles();
    drawWalls();
    var i;
    for (i = 0; i < S.particles.length; i++) {
      var q = S.particles[i]; ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    if (S.state !== 'menu') drawChaser();
    drawPlayer();
    ctx.restore();

    if (S.state === 'playing' || S.state === 'paused' || S.state === 'dying') {
      drawWallPrompt();
      for (i = 0; i < S.texts.length; i++) {
        var t = S.texts[i]; ctx.globalAlpha = clamp(t.life, 0, 1); ctx.fillStyle = t.color; ctx.font = 'bold ' + t.size + 'px ' + FONT; ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4; ctx.strokeText(t.s, t.x, t.y); ctx.fillText(t.s, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      // 危险红晕
      if (S.gap < 4 || S.flash > 0) {
        var a = S.flash > 0 ? S.flash : (0.25 + 0.15 * Math.sin(S.t * 10)) * (1 - S.gap / 4);
        var rg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
        rg.addColorStop(0, 'rgba(255,0,40,0)'); rg.addColorStop(1, 'rgba(255,0,40,' + clamp(a, 0, 0.7) + ')');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    }
    updateHUD();
  }

  var hudCache = {};
  function setText(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
  function updateHUD() {
    if (S.state === 'menu') return;
    setText(ui.dist, 'd', String(Math.floor(S.dist)));
    setText(ui.score, 's', String(S.score));
    setText(ui.best, 'b', String(Math.max(S.best, S.score)));
    setText(ui.speed, 'v', (S.eff / PPM).toFixed(1) + ' 米/秒');
    setText(ui.walls, 'w', S.wallsPassed + ' 面');
    var uw = upcomingWall(), next = uw ? Math.max(0, wallTtc(uw)) : Math.max(0, S.wallTimer);
    setText(ui.next, 'n', next.toFixed(1) + ' 秒');
    ui.nextBar.style.width = (100 * (1 - clamp(next / WALL_INTERVAL, 0, 1))) + '%';
    setText(ui.gap, 'g', Math.max(0, S.gap).toFixed(1) + ' 米');
    var gp = clamp(S.gap / GAP_MAX, 0, 1);
    ui.gapBar.style.width = (100 * gp) + '%';
    var gc = S.gap < 4 ? '#ff3b5c' : S.gap < 7 ? '#ffb03b' : '#5be38a';
    if (hudCache.gc !== gc) { hudCache.gc = gc; ui.gapBar.style.background = gc; }
    ui.chaserBox.classList.toggle('alert', S.gap < 4);
  }

  // ---------------- 主循环 ----------------
  var lastTs = 0;
  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (S.state === 'playing' || S.state === 'dying') update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 供自动化测试读取状态
  window.__game = {
    get S() { return S; },
    config: { W: W, H: H, GROUND: GROUND, PX: PX, PW: PW, WALL_INTERVAL: WALL_INTERVAL, APPROACH: APPROACH, WALL_PENALTY: WALL_PENALTY },
    wallTtc: wallTtc, upcomingWall: upcomingWall
  };
})();
