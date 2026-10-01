/* 《墙影狂奔》音频模块：全部声音均由 WebAudio 实时合成，无任何外部音频文件。
 * 背景音乐为原创程序化循环（贝斯 + 鼓 + 旋律），旋律由本项目自行编写。 */
(function () {
  'use strict';

  var LS_MUSIC = 'qyky_music_on';
  var LS_SFX = 'qyky_sfx_on';

  function readPref(key) {
    try { var v = localStorage.getItem(key); return v === null ? true : v === '1'; } catch (e) { return true; }
  }
  function writePref(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ---------------- 原创乐谱（A 小调，Am - F - G - E 四小节循环，16 分音符步进） ----------------
  var _ = null;
  var CHORD_ROOTS = [45, 41, 43, 40]; // A2 F2 G2 E2
  // 贝斯：相对根音的半音偏移（null = 休止）
  var BASS = [0, _, 0, 12, 0, _, 0, 12, 0, _, 0, 12, 7, _, 12, 0];
  var BASS_LAST = [0, _, 0, 12, 0, _, 0, 12, 0, 7, 12, 7, 11, _, 12, 11];
  // 旋律 A 段
  var MEL_A = [
    [69, _, 72, _, 76, _, 74, 72, _, _, 71, _, 72, _, 69, _],
    [65, _, 69, _, 72, _, 74, _, 72, _, 69, _, 67, _, 65, _],
    [67, _, 71, _, 74, _, 76, 74, _, _, 71, _, 67, _, 74, _],
    [76, _, 68, _, 71, _, 76, _, 77, 76, _, 74, _, 72, 71, _]
  ];
  // 旋律 B 段（更高、更紧张）
  var MEL_B = [
    [81, _, _, 79, 76, _, _, 72, 74, _, 76, _, _, _, _, _],
    [77, _, _, 76, 72, _, _, 69, 72, _, 74, _, _, _, _, _],
    [79, _, _, 77, 74, _, _, 71, 74, _, 79, _, 77, _, 74, _],
    [76, _, 80, _, 83, _, 80, _, 76, _, 74, _, 72, _, 71, _]
  ];
  // 和弦琶音音型（高强度时出现）
  var ARP_CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]];

  var A = {
    ctx: null, master: null, musicBus: null, sfxBus: null, noiseBuf: null,
    musicOn: readPref(LS_MUSIC), sfxOn: readPref(LS_SFX),
    playing: false, timer: null, step: 0, nextTime: 0, intensity: 0,
    stepsPlayed: 0,

    init: function () {
      if (this.ctx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (e) { this.ctx = null; return false; }
      var c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.85;
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
      this.musicBus.connect(this.master); this.sfxBus.connect(this.master);
      var len = c.sampleRate; // 1 秒白噪声
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      var d = this.noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    },
    resume: function () {
      if (!this.init()) return;
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
    },
    setMusic: function (on) {
      this.musicOn = on; writePref(LS_MUSIC, on);
      if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    },
    setSfx: function (on) {
      this.sfxOn = on; writePref(LS_SFX, on);
      if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.03);
    },

    // ---------------- 基础合成器 ----------------
    tone: function (bus, freq, t, dur, type, vol, freqTo, attack) {
      var c = this.ctx; if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (freqTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
      var a = attack || 0.005;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise: function (bus, t, dur, vol, ftype, freq, q) {
      var c = this.ctx; if (!c) return;
      var s = c.createBufferSource(); s.buffer = this.noiseBuf;
      var f = c.createBiquadFilter(); f.type = ftype || 'bandpass'; f.frequency.value = freq || 1000; f.Q.value = q || 0.8;
      var g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },

    // ---------------- 音效 ----------------
    sfx: function (name) {
      if (!this.ctx || !this.sfxOn) return;
      var c = this.ctx, t = c.currentTime + 0.005, b = this.sfxBus, self = this;
      switch (name) {
        case 'jump': this.tone(b, 330, t, 0.16, 'square', 0.16, 720); break;
        case 'jump2': this.tone(b, 480, t, 0.16, 'square', 0.14, 980); break;
        case 'slide': this.noise(b, t, 0.28, 0.35, 'bandpass', 900, 0.6); break;
        case 'land': this.noise(b, t, 0.06, 0.15, 'lowpass', 400); break;
        case 'hit':
          this.tone(b, 160, t, 0.25, 'sawtooth', 0.35, 60);
          this.noise(b, t, 0.18, 0.4, 'lowpass', 700); break;
        case 'fall': this.tone(b, 500, t, 0.4, 'triangle', 0.3, 90); break;
        case 'key': this.tone(b, 880, t, 0.07, 'square', 0.12); break;
        case 'wrong':
          this.tone(b, 140, t, 0.22, 'square', 0.22);
          this.tone(b, 148, t, 0.22, 'square', 0.18); break;
        case 'go': this.tone(b, 660, t, 0.09, 'triangle', 0.25); this.tone(b, 990, t + 0.09, 0.12, 'triangle', 0.25); break;
        case 'beep': this.tone(b, 520, t, 0.08, 'triangle', 0.18); break;
        case 'success':
          [523, 659, 784, 1047].forEach(function (f, i) { self.tone(b, f, t + i * 0.06, 0.14, 'square', 0.13); });
          break;
        case 'smash':
          this.noise(b, t, 0.45, 0.7, 'lowpass', 1800);
          this.tone(b, 120, t, 0.3, 'sawtooth', 0.3, 40); break;
        case 'crash':
          this.noise(b, t, 0.6, 0.8, 'lowpass', 900);
          this.tone(b, 90, t, 0.5, 'sawtooth', 0.45, 30); break;
        case 'caught':
          [392, 330, 262, 196].forEach(function (f, i) { self.tone(b, f, t + i * 0.16, 0.22, 'sawtooth', 0.2, f * 0.97); });
          break;
        case 'start': [440, 554, 659].forEach(function (f, i) { self.tone(b, f, t + i * 0.07, 0.12, 'square', 0.14); }); break;
        case 'record': [659, 784, 988, 1319].forEach(function (f, i) { self.tone(b, f, t + 0.5 + i * 0.09, 0.18, 'triangle', 0.2); }); break;
      }
    },

    // ---------------- 背景音乐（前瞻调度器） ----------------
    bpm: function () { return 128 + 22 * this.intensity; },
    setIntensity: function (x) { this.intensity = Math.max(0, Math.min(1, x)); },
    startMusic: function () {
      if (!this.init()) return;
      this.stopMusic();
      this.playing = true; this.step = 0; this.nextTime = this.ctx.currentTime + 0.08;
      var self = this;
      this.timer = setInterval(function () { self.pump(); }, 25);
      this.pump();
    },
    stopMusic: function () {
      this.playing = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },
    pump: function () {
      if (!this.playing || !this.ctx) return;
      if (this.ctx.state !== 'running') { this.nextTime = this.ctx.currentTime + 0.05; return; }
      var ahead = this.ctx.currentTime + 0.12;
      if (this.nextTime < this.ctx.currentTime - 0.3) this.nextTime = this.ctx.currentTime + 0.02; // 掉帧后重新对齐
      while (this.nextTime < ahead) {
        this.playStep(this.step, this.nextTime);
        this.nextTime += 60 / this.bpm() / 4;
        this.step = (this.step + 1) % 128; // 8 小节 = A 段 + B 段
        this.stepsPlayed++;
      }
    },
    playStep: function (step, t) {
      var b = this.musicBus, s = step % 16, bar = Math.floor(step / 16) % 4, half = Math.floor(step / 64);
      var sp = 60 / this.bpm() / 4, hi = this.intensity;
      // 鼓
      if (s % 4 === 0 || (bar === 3 && s === 14)) {
        var c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g); g.connect(b); o.start(t); o.stop(t + 0.3);
      }
      if (s === 4 || s === 12) {
        this.noise(b, t, 0.16, 0.42, 'bandpass', 1900, 0.7);
        this.tone(b, 210, t, 0.08, 'triangle', 0.25, 150);
      }
      if (bar === 3 && s >= 13) this.noise(b, t, 0.08, 0.25, 'bandpass', 2200, 0.7); // 过门
      if (s % 2 === 0 || hi > 0.45) this.noise(b, t, s % 4 === 2 ? 0.09 : 0.035, s % 4 === 2 ? 0.16 : 0.09, 'highpass', 7500);
      // 贝斯
      var pat = bar === 3 ? BASS_LAST : BASS, off = pat[s];
      if (off !== null) {
        var c2 = this.ctx, o2 = c2.createOscillator(), f2 = c2.createBiquadFilter(), g2 = c2.createGain();
        o2.type = 'sawtooth'; o2.frequency.value = mtof(CHORD_ROOTS[bar] + off);
        f2.type = 'lowpass'; f2.frequency.setValueAtTime(900 + 600 * hi, t); f2.frequency.exponentialRampToValueAtTime(220, t + sp * 0.9); f2.Q.value = 5;
        g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(0.32, t + 0.006); g2.gain.exponentialRampToValueAtTime(0.0001, t + sp * 0.95);
        o2.connect(f2); f2.connect(g2); g2.connect(b); o2.start(t); o2.stop(t + sp + 0.03);
      }
      // 旋律
      var mel = (half === 0 ? MEL_A : MEL_B)[bar][s];
      if (mel !== null) {
        this.tone(b, mtof(mel), t, sp * 1.7, 'square', 0.075, null, 0.01);
        this.tone(b, mtof(mel) * 1.005, t, sp * 1.7, 'sawtooth', 0.03, null, 0.01);
      }
      // 高强度时加入琶音
      if (hi > 0.3 && s % 2 === 1) {
        var ch = ARP_CHORDS[bar];
        this.tone(b, mtof(ch[(s >> 1) % 3] + 12), t, sp * 0.8, 'triangle', 0.05 * hi);
      }
    },
    suspend: function () { if (this.ctx && this.ctx.state === 'running') { try { this.ctx.suspend(); } catch (e) { /* ignore */ } } }
  };

  window.GameAudio = A;
})();
