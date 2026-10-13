/*
 * Picture adjustments (brightness/contrast/saturation/hue, zoom, rotate, flip,
 * aspect). Applied as CSS filters/transforms on the staged <video>, so they are
 * NOT captured by captureStream(): the host publishes the values over Socket.IO
 * and every client (host included) applies them to its own view. Viewers may
 * override locally; the next host update re-syncs everyone.
 */

window.WTPicture = (function () {
    const DEFAULTS = {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        hue: 0,
        zoom: 1.0,
        rotate: 0,
        flip_h: false,
        aspect: 'fit',
    };

    const state = Object.assign({}, DEFAULTS);
    let localOverride = false;
    let emitTimer = null;
    let ro = null;

    function video() { return document.getElementById('stageVideo'); }
    function shell() { const v = video(); return v ? v.parentElement : null; }

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    function applyAspect(v) {
        switch (state.aspect) {
            case 'fill':
                v.style.objectFit = 'cover';
                v.style.aspectRatio = 'auto';
                v.style.width = '100%';
                v.style.height = '100%';
                v.style.flex = '';
                v.style.margin = '0';
                break;
            case '16:9':
            case '4:3':
            case '1:1': {
                const ar = state.aspect === '16:9' ? '16 / 9' : state.aspect === '4:3' ? '4 / 3' : '1 / 1';
                v.style.objectFit = 'contain';
                v.style.aspectRatio = ar;
                v.style.width = 'auto';
                v.style.height = 'auto';
                v.style.maxWidth = '100%';
                v.style.maxHeight = '100%';
                v.style.flex = '0 0 auto';
                v.style.margin = 'auto';
                break;
            }
            default:
                v.style.objectFit = 'contain';
                v.style.aspectRatio = 'auto';
                v.style.width = '100%';
                v.style.height = '100%';
                v.style.maxWidth = '100%';
                v.style.maxHeight = '100%';
                v.style.flex = '';
                v.style.margin = '0';
        }
    }

    function layout() {
        const v = video();
        if (!v) return;
        applyAspect(v);

        const s = shell();
        let fit = 1;
        if (state.rotate % 180 !== 0 && s && s.clientWidth && s.clientHeight) {
            fit = Math.min(s.clientWidth / s.clientHeight, s.clientHeight / s.clientWidth);
        }
        const scale = state.zoom * fit;
        const sx = (state.flip_h ? -1 : 1) * scale;
        v.style.transformOrigin = 'center center';
        v.style.transform = 'rotate(' + state.rotate + 'deg) scale(' + sx + ', ' + scale + ')';
    }

    function apply() {
        const v = video();
        if (!v) return;
        v.style.filter =
            'brightness(' + state.brightness + ') contrast(' + state.contrast + ') ' +
            'saturate(' + state.saturation + ') hue-rotate(' + state.hue + 'deg)';
        layout();
    }

    function emit() {
        if (typeof isHost === 'undefined' || !isHost) return;
        if (typeof socket === 'undefined' || !socket) return;
        if (emitTimer) return;
        emitTimer = setTimeout(function () {
            emitTimer = null;
            socket.emit('picture_update', {
                room_id: roomId, token: hostToken,
                picture: Object.assign({}, state),
            });
        }, 90);
    }

    function syncUi() {
        const set = function (id, val) { const el = document.getElementById(id); if (el) el.value = val; };
        const txt = function (id, val) { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('picBrightness', Math.round(state.brightness * 100));
        set('picContrast', Math.round(state.contrast * 100));
        set('picSaturation', Math.round(state.saturation * 100));
        set('picHue', Math.round(state.hue));
        set('picZoom', Math.round(state.zoom * 100));
        txt('picBrightnessVal', Math.round(state.brightness * 100) + '%');
        txt('picContrastVal', Math.round(state.contrast * 100) + '%');
        txt('picSaturationVal', Math.round(state.saturation * 100) + '%');
        txt('picHueVal', Math.round(state.hue) + '°');
        txt('picZoomVal', Math.round(state.zoom * 100) + '%');
        const aspect = document.getElementById('picAspect');
        if (aspect) aspect.value = state.aspect;
    }

    function setValue(key, value, opts) {
        opts = opts || {};
        state[key] = value;
        if (!isHostGlobal()) localOverride = true;
        apply();
        syncUi();
        if (opts.quiet !== true) emit();
    }

    function isHostGlobal() { return typeof isHost !== 'undefined' && isHost; }

    function adjust(key, value, opts) {
        switch (key) {
            case 'brightness': setValue('brightness', clamp(Number(value), 0.1, 3), opts); break;
            case 'contrast': setValue('contrast', clamp(Number(value), 0.1, 3), opts); break;
            case 'saturation': setValue('saturation', clamp(Number(value), 0, 3), opts); break;
            case 'hue': setValue('hue', clamp(Number(value), -180, 180), opts); break;
            case 'zoom': setValue('zoom', clamp(Number(value), 1, 4), opts); break;
            case 'rotate': setValue('rotate', ((Math.round(Number(value)) % 360) + 360) % 360, opts); break;
            case 'flip_h': setValue('flip_h', !!value, opts); break;
            case 'aspect': setValue('aspect', value, opts); break;
        }
    }

    function reset() {
        Object.assign(state, DEFAULTS);
        apply();
        syncUi();
        emit();
        if (typeof showToast === 'function') showToast('Picture reset');
    }

    // Called when the host's published values arrive; clears any local override.
    function applyRemote(picture) {
        if (picture) {
            for (const key in DEFAULTS) {
                if (Object.prototype.hasOwnProperty.call(picture, key)) state[key] = picture[key];
            }
        }
        localOverride = false;
        apply();
        syncUi();
    }

    function wire() {
        const on = function (id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
        on('picBrightness', 'input', function () { adjust('brightness', this.value / 100); });
        on('picContrast', 'input', function () { adjust('contrast', this.value / 100); });
        on('picSaturation', 'input', function () { adjust('saturation', this.value / 100); });
        on('picHue', 'input', function () { adjust('hue', this.value); });
        on('picZoom', 'input', function () { adjust('zoom', this.value / 100); });
        on('picAspect', 'change', function () { adjust('aspect', this.value); });
        on('picRotateLeft', 'click', function () { adjust('rotate', state.rotate - 90); });
        on('picRotateRight', 'click', function () { adjust('rotate', state.rotate + 90); });
        on('picFlipH', 'click', function () { adjust('flip_h', !state.flip_h); });
        on('picReset', 'click', reset);
    }

    function init() {
        if (ro) return;
        wire();
        apply();
        syncUi();
        const s = shell();
        if (s && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(function () { layout(); });
            ro.observe(s);
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        DEFAULTS: DEFAULTS,
        state: state,
        init: init,
        apply: apply,
        layout: layout,
        adjust: adjust,
        reset: reset,
        applyRemote: applyRemote,
        isOverridden: function () { return localOverride; },
    };
})();
