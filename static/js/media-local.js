/*
 * Local media engine for the host.
 *
 * Wraps the vendored tiered engine (static/js/engine.js):
 *   Tier 1 native <video> · Tier 2 lossless remux→MSE · Tier 3 ffmpeg.wasm
 *
 * The host's <video id="stageVideo"> is the single source of truth: it plays
 * the local file, and broadcast.js mirrors it to viewers via captureStream().
 */
import {
  RemuxEngine, planTiers, ffmpegConvert, playableSmokeTest, EngineError,
  listEmbeddedSubtitles, extractEmbeddedSubtitle,
} from './engine.js';

const WTLocal = {
  video: null,
  engine: null,
  file: null,
  tier: null,
  info: null,
  audioIndex: 0,
  phase: '',
  stream: null,
  objectUrl: null,
  gen: 0,
  _hooks: {},

  init(videoEl) {
    this.video = videoEl;
    this.engine = new RemuxEngine(videoEl, {
      onPhase: (phase) => {
        this.phase = phase;
        if (this._hooks.onPhase) this._hooks.onPhase(phase);
      },
      onProgress: (p) => { if (this._hooks.onProgress) this._hooks.onProgress(p); },
      onError: () => {},
    });
    window.dispatchEvent(new Event('wtlocal:ready'));
  },

  async open(file, hooks = {}, opts = {}) {
    if (!this.engine || !this.video) throw new EngineError('engine', 'Local player is not ready');
    this._hooks = hooks;
    this.destroy(true);
    const myGen = ++this.gen;
    this.file = file;
    this.audioIndex = opts.audioIndex ?? 0;
    const resumeAt = opts.resumeAt || 0;

    const tiers = planTiers(file.name);
    let lastErr = null;

    for (const tier of tiers) {
      if (myGen !== this.gen) return null;
      try {
        if (hooks.onPhase) hooks.onPhase('tier-' + tier);
        if (tier === 1 && !opts.forceRemux) {
          this.objectUrl = URL.createObjectURL(file);
          await this._nativePlay(this.objectUrl);
          this.tier = 1;
        } else if (tier === 2) {
          this._resetElement();
          await this.engine.load(file, { audioIndex: this.audioIndex, audioDisabled: false, resumeAt });
          this.tier = 2;
          this.info = { duration: this.engine.duration, audioTracks: this.engine.audioTracks || [] };
        } else {
          const res = await ffmpegConvert(file, {
            verify: playableSmokeTest,
            onProgress: (p) => { if (myGen === this.gen && hooks.onProgress) hooks.onProgress(p); },
          });
          if (myGen !== this.gen) return null;
          this.objectUrl = URL.createObjectURL(res.blob);
          await this._nativePlay(this.objectUrl);
          this.tier = 3;
          this.info = { mode: res.mode };
        }
        if (myGen !== this.gen) return null;
        const result = { tier: this.tier, info: this.info, file };
        if (hooks.onReady) hooks.onReady(result);
        return result;
      } catch (e) {
        if (myGen !== this.gen) return null;
        lastErr = e;
        if (this.objectUrl) {
          try { URL.revokeObjectURL(this.objectUrl); } catch (err) { /* ignore */ }
          this.objectUrl = null;
        }
        this._resetElement();
      }
    }

    if (myGen === this.gen && hooks.onError) hooks.onError(lastErr);
    throw lastErr || new EngineError('codec', 'This file could not be played');
  },

  _nativePlay(src) {
    const v = this.video;
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', ok);
        v.removeEventListener('error', bad);
        clearTimeout(timer);
      };
      const ok = () => { if (!done) { done = true; cleanup(); resolve(); } };
      const bad = () => {
        if (!done) {
          done = true;
          cleanup();
          reject(new EngineError('codec', 'This browser cannot decode the file natively'));
        }
      };
      const timer = setTimeout(bad, 45000);
      v.addEventListener('loadedmetadata', ok);
      v.addEventListener('error', bad);
      v.removeAttribute('crossorigin');
      v.src = src;
      v.load();
    });
  },

  _resetElement() {
    const v = this.video;
    if (!v) return;
    try { v.pause(); } catch (e) { /* ignore */ }
    try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
  },

  // Live MediaStream mirrored to viewers over WebRTC (see broadcast.js).
  capture() {
    if (!this.video) return null;
    if (!this.stream) {
      try { this.stream = this.video.captureStream(); }
      catch (e) { return null; }
    }
    return this.stream;
  },

  hasMedia() {
    return !!(this.video && (this.video.currentSrc || this.video.src || this.video.srcObject));
  },

  isReady() { return this.tier != null; },

  audioTracks() {
    if (this.tier !== 2 || !this.engine) return [];
    return this.engine.audioTracks || [];
  },

  async listEmbeddedSubtitles() {
    if (!this.file) return [];
    try { return await listEmbeddedSubtitles(this.file); } catch (e) { return []; }
  },

  async extractSubtitle(index) {
    if (!this.file) return '';
    return extractEmbeddedSubtitle(this.file, index);
  },

  destroy(keepFile) {
    this.gen++;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ignore */ } });
      this.stream = null;
    }
    if (this.engine) { try { this.engine.destroy(); } catch (e) { /* ignore */ } }
    this._resetElement();
    if (this.objectUrl) {
      try { URL.revokeObjectURL(this.objectUrl); } catch (e) { /* ignore */ }
      this.objectUrl = null;
    }
    this.tier = null;
    this.info = null;
    this.phase = '';
    if (!keepFile) this.file = null;
  },
};

window.WTLocal = WTLocal;

document.addEventListener('DOMContentLoaded', function () {
  const el = document.getElementById('stageVideo');
  if (el) WTLocal.init(el);
});
