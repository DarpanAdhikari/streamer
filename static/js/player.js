/*
 * Watch-stage player: a plain <video> element driven by the host's local
 * engine (media-local.js) or a viewer's incoming MediaStream (broadcast.js).
 * Replaces the previous Video.js-based player.
 */

let player = null;

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
}

function isRemoteStream() {
    return !!(player && player.srcObject);
}

function canControl() {
    return isHost || (permissions && permissions.allow_viewer_control);
}

function canSeek() {
    if (isHost) return true;
    return !!(permissions && permissions.allow_viewer_seek) && !isRemoteStream();
}

function initPlayer() {
    player = document.getElementById('stageVideo');
    if (!player) return;
    setupKeyboardShortcuts();
    setupHostControls();
    setupViewerControls();
    initControlBar();
    setupCenterPlay();
    setupAutoHide();
    setupFullscreen();
    setupSettingsMenu();
    bindHostEvents();
    setupGestures();
    setupTheater();
    setupScreenshot();
    setupStats();
    setupAutoPip();
    setupMediaSession();

    if (typeof window.WTPicture !== 'undefined' && window.WTPicture) window.WTPicture.init();

    const ctw = document.getElementById('clickToWatch');
    if (ctw) ctw.addEventListener('click', function () {
        ctw.classList.add('hidden');
        if (player) player.play().catch(function () {});
    });

    updateCenterPlay();
    if (typeof updateControlAvailability === 'function') updateControlAvailability();
}
document.addEventListener('DOMContentLoaded', initPlayer);

function bindHostEvents() {
    if (!player) return;
    ['play', 'pause', 'seeked', 'ratechange'].forEach(function (ev) {
        player.addEventListener(ev, emitHostState);
    });
}

function emitHostState() {
    if (!isHost || !socket || !player) return;
    socket.emit('state_update', {
        room_id: roomId, token: hostToken,
        state: {
            playing: !player.paused,
            position: player.currentTime || 0,
            playback_speed: player.playbackRate || 1,
            updated_at: Date.now() / 1000
        }
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
        if (!player) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        // Any keypress is intent to interact: bring the controls back so they
        // are visible in fullscreen too, not only when the mouse moves.
        showChrome();
        switch (e.code) {
            case 'Space': case 'KeyK': e.preventDefault(); togglePlayback(); break;
            case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
            case 'KeyT': e.preventDefault(); toggleTheater(); break;
            case 'KeyM': e.preventDefault(); player.muted = !player.muted; break;
            case 'KeyP': togglePip(); break;
            case 'KeyC': if (typeof toggleSubtitles === 'function') toggleSubtitles(); break;
            case 'KeyS': e.preventDefault(); takeScreenshot(); break;
            case 'KeyY': e.preventDefault(); toggleStats(); break;
            case 'KeyV': e.preventDefault(); cycleAspect(); break;
            case 'ArrowLeft': e.preventDefault(); nudge(-5); break;
            case 'ArrowRight': e.preventDefault(); nudge(5); break;
            case 'KeyJ': e.preventDefault(); nudge(-10); break;
            case 'KeyL': e.preventDefault(); nudge(10); break;
            case 'ArrowUp': e.preventDefault(); adjustVolume(0.1); break;
            case 'ArrowDown': e.preventDefault(); adjustVolume(-0.1); break;
            case 'KeyN': if (isHost && socket) socket.emit('media_next', { room_id: roomId, token: hostToken }); break;
            case 'Comma': e.preventDefault(); frameStep(-1); break;
            case 'Period': e.preventDefault(); frameStep(1); break;
            case 'Escape': if (document.body.classList.contains('theater')) toggleTheater(false); break;
        }
    });
}

function adjustVolume(delta) {
    if (!player) return;
    player.volume = Math.max(0, Math.min(1, (player.volume || 0) + delta));
    player.muted = false;
}

function frameStep(dir) {
    if (!player || !canControl()) return;
    const fps = 30;
    player.pause();
    requestSeek((player.currentTime || 0) + dir / fps);
}

function cycleAspect() {
    if (typeof window.WTPicture === 'undefined' || !window.WTPicture) return;
    const list = ['fit', 'fill', '16:9', '4:3', '1:1'];
    const cur = window.WTPicture.state.aspect;
    const next = list[(list.indexOf(cur) + 1) % list.length];
    window.WTPicture.adjust('aspect', next);
}

function togglePlayback() {
    if (!player) return;
    if (player.paused) player.play().catch(function () {});
    else player.pause();
}

function nudge(delta) {
    if (!player) return;
    requestSeek((player.currentTime || 0) + delta);
}

function requestSeek(position) {
    if (!player) return;
    const duration = isFinite(player.duration) ? player.duration : 0;
    position = Math.max(0, Math.min(position, duration || position));
    if (isHost) {
        try { player.currentTime = position; } catch (e) { /* ignore */ }
    } else if (permissions && permissions.allow_viewer_seek && socket) {
        socket.emit('seek', { room_id: roomId, token: hostToken, position: position });
    }
}

function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/* #watchView is the fullscreen element — not .player-shell — because the
   control bar and title are siblings of .player-shell inside #watchView.
   Fullscreening the shell alone hides both. */
function toggleFullscreen() {
    if (isFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exit) return;
        try {
            const r = exit.call(document);
            if (r && r.catch) r.catch(function () {});
        } catch (e) { /* ignore */ }
        return;
    }
    // Prefer whichever view is on screen — fullscreening a hidden .view would
    // show nothing — and fall back to the shell if the markup ever changes.
    const view = document.querySelector('.view.active')
        || document.getElementById('watchView')
        || document.querySelector('.player-shell');
    if (!view) return;
    if (view.requestFullscreen) { view.requestFullscreen().catch(function () {}); return; }
    if (view.webkitRequestFullscreen) { view.webkitRequestFullscreen(); return; }
    // iOS Safari has no element fullscreen for arbitrary markup — the <video>
    // goes fullscreen with the platform's own controls instead of ours.
    if (player && player.webkitEnterFullscreen) player.webkitEnterFullscreen();
}

function togglePip() {
    if (!player || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
    } else {
        player.requestPictureInPicture().catch(function () {});
    }
}

function setupHostControls() {
    const h = {
        play: document.getElementById('playBtn'),
        pause: document.getElementById('pauseBtn'),
        seek: document.getElementById('seekBtn'),
        seekInput: document.getElementById('seekInput'),
        sync: document.getElementById('syncBtn'),
    };
    if (h.play) h.play.addEventListener('click', function () { if (isHost && socket) socket.emit('play', { room_id: roomId, token: hostToken }); });
    if (h.pause) h.pause.addEventListener('click', function () { if (isHost && socket) socket.emit('pause', { room_id: roomId, token: hostToken }); });
    if (h.seek) h.seek.addEventListener('click', function () {
        if (isHost && socket && h.seekInput.value) socket.emit('seek', { room_id: roomId, token: hostToken, position: parseFloat(h.seekInput.value) });
    });
    if (h.sync) h.sync.addEventListener('click', function () { if (socket) socket.emit('sync_request', { room_id: roomId }); });
}

function setupViewerControls() {
    const v = {
        play: document.getElementById('viewerPlayBtn'),
        pause: document.getElementById('viewerPauseBtn'),
        seek: document.getElementById('viewerSeekBtn'),
        seekInput: document.getElementById('viewerSeekInput'),
    };
    if (v.play) v.play.addEventListener('click', function () { if (socket) socket.emit('play', { room_id: roomId, token: hostToken }); });
    if (v.pause) v.pause.addEventListener('click', function () { if (socket) socket.emit('pause', { room_id: roomId, token: hostToken }); });
    if (v.seek) v.seek.addEventListener('click', function () {
        if (socket && v.seekInput.value) socket.emit('seek', { room_id: roomId, token: hostToken, position: parseFloat(v.seekInput.value) });
    });
}

function initControlBar() {
    const playPause = document.getElementById('ctrlPlayPause');
    const prev = document.getElementById('ctrlPrev');
    const next = document.getElementById('ctrlNext');
    const mute = document.getElementById('ctrlMute');
    const volume = document.getElementById('ctrlVolume');
    const seekRange = document.getElementById('seekRange');
    const speed = document.getElementById('ctrlSpeed');
    const pip = document.getElementById('ctrlPip');
    const fs = document.getElementById('ctrlFullscreen');
    const seekPlayed = document.getElementById('seekPlayed');
    const seekBuffered = document.getElementById('seekBuffered');
    const currentEl = document.getElementById('ctrlCurrent');
    const durationEl = document.getElementById('ctrlDuration');

    function setPlayIcon() { if (playPause) playPause.textContent = player && !player.paused ? '⏸' : '▶'; }

    function updateSeek() {
        if (!player) return;
        const duration = isFinite(player.duration) ? player.duration : 0;
        const current = player.currentTime || 0;
        const pct = duration ? (current / duration) * 100 : 0;
        if (seekRange && document.activeElement !== seekRange) seekRange.value = Math.round(pct * 10);
        if (seekPlayed) seekPlayed.style.width = pct + '%';
        if (currentEl) currentEl.textContent = formatTime(current);
        if (durationEl) durationEl.textContent = duration ? formatTime(duration) : (isRemoteStream() ? 'LIVE' : '0:00');
    }

    function updateBuffered() {
        if (!seekBuffered || !player) return;
        const duration = isFinite(player.duration) ? player.duration : 0;
        try {
            if (player.buffered.length && duration) {
                seekBuffered.style.width = ((player.buffered.end(player.buffered.length - 1) / duration) * 100) + '%';
            }
        } catch (e) { /* ignore */ }
    }

    if (playPause) playPause.addEventListener('click', togglePlayback);
    if (prev) prev.addEventListener('click', function () { if (isHost && socket) socket.emit('media_prev', { room_id: roomId, token: hostToken }); });
    if (next) next.addEventListener('click', function () { if (isHost && socket) socket.emit('media_next', { room_id: roomId, token: hostToken }); });
    if (mute) mute.addEventListener('click', function () { if (player) player.muted = !player.muted; });
    if (volume) volume.addEventListener('input', function () { if (player) { player.volume = parseFloat(volume.value); player.muted = false; } });
    if (pip) pip.addEventListener('click', togglePip);
    if (fs) fs.addEventListener('click', toggleFullscreen);
    if (speed) speed.addEventListener('change', function () {
        if (player) player.playbackRate = parseFloat(speed.value);
        emitHostState();
    });
    if (seekRange) {
        seekRange.addEventListener('input', function () {
            const duration = isFinite(player.duration) ? player.duration : 0;
            const pct = parseFloat(seekRange.value) / 10;
            if (seekPlayed) seekPlayed.style.width = pct + '%';
            if (currentEl) currentEl.textContent = formatTime((pct / 100) * duration);
        });
        seekRange.addEventListener('change', function () {
            const duration = isFinite(player.duration) ? player.duration : 0;
            requestSeek((parseFloat(seekRange.value) / 1000) * duration);
        });
    }

    if (player) {
        player.addEventListener('timeupdate', updateSeek);
        player.addEventListener('progress', updateBuffered);
        player.addEventListener('durationchange', updateSeek);
        player.addEventListener('loadedmetadata', function () { updateSeek(); updateBuffered(); hideOverlay(); updateCenterPlay(); });
        player.addEventListener('play', setPlayIcon);
        player.addEventListener('pause', setPlayIcon);
        player.addEventListener('play', updateCenterPlay);
        player.addEventListener('pause', updateCenterPlay);
        player.addEventListener('emptied', updateCenterPlay);
        player.addEventListener('volumechange', function () {
            const v = player.muted ? 0 : player.volume;
            if (volume) volume.value = v;
            const sv = document.getElementById('settingsVolume');
            if (sv) sv.value = v;
            if (mute) mute.textContent = (player.muted || player.volume === 0) ? '🔇' : '🔊';
        });
        player.addEventListener('waiting', function () { showOverlay('', true); });
        player.addEventListener('playing', hideOverlay);
        player.addEventListener('canplay', hideOverlay);
        player.addEventListener('error', function () {
            if (!isRemoteStream()) showOverlay('This file could not be played. The format may be unsupported.');
        });
    }

    setPlayIcon();
    updateSeek();
}

/* ------------------------------- overlays --------------------------------- */

function showOverlay(text, spinner) {
    const overlay = document.getElementById('playerOverlay');
    const textEl = document.getElementById('playerOverlayText');
    const spinnerEl = overlay ? overlay.querySelector('.spinner') : null;
    hideEmptyState();
    if (textEl) textEl.textContent = text || '';
    if (spinnerEl) spinnerEl.style.display = spinner === true ? 'block' : 'none';
    if (overlay) overlay.classList.remove('hidden');
}

function hideOverlay() {
    const overlay = document.getElementById('playerOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function showEmptyState() {
    const empty = document.getElementById('emptyState');
    if (empty) empty.classList.remove('hidden');
    hideOverlay();
}

function hideEmptyState() {
    const empty = document.getElementById('emptyState');
    if (empty) empty.classList.add('hidden');
}

/* --------------------------- center play button --------------------------- */

function hasPlayableMedia() {
    if (!player) return false;
    return isRemoteStream() || !!player.currentSrc || !!player.src;
}

function updateCenterPlay() {
    const btn = document.getElementById('centerPlay');
    if (!btn) return;
    btn.classList.toggle('hidden', !hasPlayableMedia() || !player.paused);
}

function setupCenterPlay() {
    const btn = document.getElementById('centerPlay');
    if (!btn || !player) return;
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePlayback();
    });
    updateCenterPlay();
}

/* ------------------------------ auto-hide UI ------------------------------ */

let chromeTimer = null;

function watchViewEl() { return document.getElementById('watchView'); }

function mightBeInteracting() {
    if (!player || player.paused) return true;
    const menu = document.getElementById('settingsMenu');
    if (menu && !menu.classList.contains('hidden')) return true;
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'));
}

/* Reveals the controls and (re)arms the 3s hide timer. Safe to call from
   anywhere — keyboard shortcuts, the fullscreenchange handler, playback events. */
function showChrome() {
    const view = watchViewEl();
    if (!view) return;
    view.classList.remove('ui-hidden');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(hideChrome, 3000);
}

function hideChrome() {
    if (mightBeInteracting()) return;
    const view = watchViewEl();
    if (!view) return;
    view.classList.add('ui-hidden');
}

function setupAutoHide() {
    const view = watchViewEl();
    if (!view || !player) return;

    view.addEventListener('mousemove', showChrome, { passive: true });
    view.addEventListener('pointerdown', showChrome, { passive: true });
    view.addEventListener('touchstart', showChrome, { passive: true });
    view.addEventListener('keydown', showChrome);
    player.addEventListener('play', showChrome);
    player.addEventListener('pause', function () {
        clearTimeout(chromeTimer);
        view.classList.remove('ui-hidden');
    });
    player.addEventListener('click', function () {
        if (view.classList.contains('ui-hidden')) showChrome();
    });
}

/* Entering or leaving fullscreen re-shows the controls (they can never be
   stuck hidden behind the fullscreen element), re-arms the auto-hide timer,
   marks the fullscreen button, and re-lays out the picture transforms. */
function setupFullscreen() {
    function onChange() {
        const fs = isFullscreen();
        const btn = document.getElementById('ctrlFullscreen');
        if (btn) {
            btn.classList.toggle('active', fs);
            btn.setAttribute('aria-pressed', fs ? 'true' : 'false');
        }
        showChrome();
        if (window.WTPicture && window.WTPicture.layout) {
            setTimeout(function () { try { window.WTPicture.layout(); } catch (e) { /* ignore */ } }, 60);
        }
    }
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
}

/* ----------------------------- settings menu ------------------------------ */

function setupSettingsMenu() {
    const gear = document.getElementById('ctrlSettings');
    const menu = document.getElementById('settingsMenu');
    if (!gear || !menu) return;

    function close() { menu.classList.add('hidden'); gear.setAttribute('aria-expanded', 'false'); }
    function open() { menu.classList.remove('hidden'); gear.setAttribute('aria-expanded', 'true'); }

    gear.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) open(); else close();
    });
    document.addEventListener('click', function (e) {
        if (menu.classList.contains('hidden')) return;
        if (menu.contains(e.target) || gear.contains(e.target)) return;
        close();
    });
    document.addEventListener('keydown', function (e) { if (e.code === 'Escape') close(); });

    const vol = document.getElementById('settingsVolume');
    if (vol) vol.addEventListener('input', function () {
        if (player) { player.volume = parseFloat(vol.value); player.muted = false; }
    });

    const cc = document.getElementById('settingsCc');
    if (cc) cc.addEventListener('change', function () {
        if (typeof toggleSubtitles === 'function') toggleSubtitles(cc.checked);
    });
}

/* -------------------------------- CC button ------------------------------- */

function updateCcButton() {
    const btn = document.getElementById('ctrlCc');
    const row = document.getElementById('settingsCcRow');
    const toggle = document.getElementById('settingsCc');
    const available = typeof hasActiveSubtitles === 'function' && hasActiveSubtitles();
    const enabled = typeof subtitlesEnabled === 'undefined' ? true : subtitlesEnabled;
    if (btn) {
        btn.classList.toggle('hidden', !available);
        btn.classList.toggle('active', available && enabled);
    }
    if (row) row.classList.toggle('hidden', !available);
    if (toggle) toggle.checked = available && enabled;
}

/* ------------------------------- gestures --------------------------------- */

let singleTapTimer = null;
let lastTapTime = 0;

function setupGestures() {
    const view = document.getElementById('watchView');
    if (!view || !player) return;

    view.addEventListener('wheel', function (e) {
        if (e.target.closest('.control-bar') || e.target.closest('.settings-menu')) return;
        e.preventDefault();
        adjustVolume(e.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });

    const pointers = new Map();
    let gesture = null;

    function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

    view.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.control-bar') || e.target.closest('.settings-menu') ||
            e.target.closest('#fsCallPopover') ||
            e.target.closest('button, a, input, select, textarea')) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            gesture = {
                startX: e.clientX, startY: e.clientY,
                startTime: Date.now(),
                startVol: player.volume || 0,
                startBright: (window.WTPicture ? window.WTPicture.state.brightness : 1),
                startZoom: (window.WTPicture ? window.WTPicture.state.zoom : 1),
                moved: false, longpress: false, pinchDist: null,
            };
            gesture.longpressTimer = setTimeout(function () {
                if (!gesture || gesture.moved || !isHost) return;
                gesture.longpress = true;
                player.playbackRate = 2;
            }, 550);
        } else if (pointers.size === 2 && gesture) {
            const pts = Array.from(pointers.values());
            gesture.pinchDist = dist(pts[0], pts[1]);
        }
        try { view.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    view.addEventListener('pointermove', function (e) {
        if (!pointers.has(e.pointerId) || !gesture) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2 && gesture.pinchDist) {
            const pts = Array.from(pointers.values());
            const factor = dist(pts[0], pts[1]) / gesture.pinchDist;
            if (window.WTPicture) window.WTPicture.adjust('zoom', Math.max(1, Math.min(4, gesture.startZoom * factor)));
            return;
        }

        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        if (Math.hypot(dx, dy) > 12) {
            gesture.moved = true;
            clearTimeout(gesture.longpressTimer);
        }
        const rect = view.getBoundingClientRect();
        const relX = gesture.startX - rect.left;
        if (gesture.moved && Math.abs(dy) > Math.abs(dx)) {
            if (relX < rect.width * 0.25) {
                if (window.WTPicture) window.WTPicture.adjust('brightness', gesture.startBright - dy / rect.height);
            } else if (relX > rect.width * 0.75) {
                player.volume = Math.max(0, Math.min(1, gesture.startVol - dy / rect.height));
                player.muted = false;
            }
        }
    });

    function endPointer(e) {
        pointers.delete(e.pointerId);
        if (!gesture) return;
        if (gesture.longpress) { player.playbackRate = 1; gesture.longpress = false; }
        if (pointers.size === 0) {
            clearTimeout(gesture.longpressTimer);
            if (!gesture.moved && (Date.now() - gesture.startTime) < 300) handleTap(e.clientX);
            gesture = null;
        } else {
            gesture.pinchDist = null;
        }
    }
    view.addEventListener('pointerup', endPointer);
    view.addEventListener('pointercancel', endPointer);

    function handleTap(x) {
        const rect = view.getBoundingClientRect();
        const relX = x - rect.left;
        const now = Date.now();
        if (now - lastTapTime < 300) {
            if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
            lastTapTime = 0;
            if (relX < rect.width * 0.35) nudge(-10);
            else if (relX > rect.width * 0.65) nudge(10);
            else toggleFullscreen();
            return;
        }
        lastTapTime = now;
        singleTapTimer = setTimeout(function () {
            singleTapTimer = null;
            if (view.classList.contains('ui-hidden')) { return; }
            togglePlayback();
        }, 250);
    }
}

/* ------------------------------ theater mode ------------------------------ */

function setupTheater() {
    const btn = document.getElementById('ctrlTheater');
    if (btn) btn.addEventListener('click', function () { toggleTheater(); });
}

function toggleTheater(force) {
    const on = (typeof force === 'boolean') ? force : !document.body.classList.contains('theater');
    document.body.classList.toggle('theater', on);
    const btn = document.getElementById('ctrlTheater');
    if (btn) btn.classList.toggle('active', on);
    setTimeout(function () { if (window.WTPicture) window.WTPicture.layout(); }, 60);
}

/* ------------------------------- screenshot ------------------------------- */

function setupScreenshot() {
    const btn = document.getElementById('ctrlSnap');
    if (btn) btn.addEventListener('click', takeScreenshot);
}

function takeScreenshot() {
    if (!player || !hasPlayableMedia()) return;
    const w = player.videoWidth || player.clientWidth;
    const h = player.videoHeight || player.clientHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const f = (window.WTPicture ? window.WTPicture.state : null);
    try {
        if (f) {
            ctx.filter = 'brightness(' + f.brightness + ') contrast(' + f.contrast + ') ' +
                'saturate(' + f.saturation + ') hue-rotate(' + f.hue + 'deg)';
            ctx.translate(w / 2, h / 2);
            ctx.rotate(f.rotate * Math.PI / 180);
            ctx.scale((f.flip_h ? -1 : 1) * f.zoom, f.zoom);
            ctx.drawImage(player, -w / 2, -h / 2, w, h);
        } else {
            ctx.drawImage(player, 0, 0, w, h);
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Screenshot failed');
        return;
    }
    canvas.toBlob(function (blob) {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'watch-together-frame-' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (typeof showToast === 'function') showToast('Screenshot saved');
    });
}

/* ------------------------------ stats overlay ----------------------------- */

let statsTimer = null;

function setupStats() {
    const toggle = document.getElementById('statsToggle');
    if (toggle) toggle.addEventListener('change', function () { toggleStats(toggle.checked); });
}

function toggleStats(force) {
    const el = document.getElementById('statsOverlay');
    if (!el) return;
    const on = (typeof force === 'boolean') ? force : el.classList.contains('hidden');
    el.classList.toggle('hidden', !on);
    const toggle = document.getElementById('statsToggle');
    if (toggle) toggle.checked = on;
    if (on) {
        if (statsTimer) clearInterval(statsTimer);
        updateStats();
        statsTimer = setInterval(updateStats, 500);
    } else if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
    }
}

function updateStats() {
    const el = document.getElementById('statsOverlay');
    if (!el || !player) return;
    const lines = [];
    lines.push('res     ' + (player.videoWidth || 0) + 'x' + (player.videoHeight || 0));
    let engine = isRemoteStream() ? 'mirror' : 'local';
    if (!isRemoteStream() && window.WTLocal && window.WTLocal.tier) engine = 'tier ' + window.WTLocal.tier;
    lines.push('engine  ' + engine);
    if (!isRemoteStream() && window.WTLocal) {
        const tracks = (window.WTLocal.audioTracks && window.WTLocal.audioTracks()) || [];
        if (tracks.length) {
            const idx = window.WTLocal.audioIndex || 0;
            const t = tracks[idx] || tracks[0];
            const label = (typeof audioTrackLabel === 'function')
                ? audioTrackLabel(t, idx)
                : ('track ' + (idx + 1));
            lines.push('audio   ' + label + '  ' + (idx + 1) + '/' + tracks.length);
        }
        const subs = (window.WTLocal.embeddedSubtitleCount && window.WTLocal.embeddedSubtitleCount()) || 0;
        if (subs) lines.push('subs    ' + subs + ' embedded');
        const probe = window.WTLocal.probeInfo && window.WTLocal.probeInfo();
        if (probe && probe.videoCodec) {
            const vc = (typeof shortCodec === 'function') ? shortCodec(probe.videoCodec) : probe.videoCodec;
            lines.push('video   ' + vc + (probe.width ? ' · ' + probe.width + 'x' + probe.height : ''));
        }
    }
    if (player.getVideoPlaybackQuality) {
        const q = player.getVideoPlaybackQuality();
        lines.push('dropped ' + (q.droppedVideoFrames || 0));
        lines.push('total   ' + (q.totalVideoFrames || 0));
    }
    if (player.webkitDecodedFrameCount != null) lines.push('decoded ' + player.webkitDecodedFrameCount);
    lines.push('rate    ' + (player.playbackRate || 1) + 'x');
    lines.push('volume  ' + Math.round((player.muted ? 0 : player.volume) * 100) + '%');
    let buffered = 0;
    try {
        if (player.buffered.length) buffered = player.buffered.end(player.buffered.length - 1);
    } catch (e) { /* ignore */ }
    lines.push('buffer  ' + buffered.toFixed(1) + 's');
    lines.push('time    ' + formatTime(player.currentTime || 0) + ' / ' + (isFinite(player.duration) ? formatTime(player.duration) : 'live'));
    el.textContent = lines.join('\n');
}

/* --------------------------- auto picture-in-picture ---------------------- */

function setupAutoPip() {
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) return;
        if (!player || player.paused) return;
        if (!document.pictureInPictureEnabled || document.pictureInPictureElement) return;
        if (!hasPlayableMedia()) return;
        player.requestPictureInPicture().catch(function () { /* ignore */ });
    });
}

/* ------------------------------ media session ----------------------------- */

function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.setActionHandler('play', function () { if (player.paused) togglePlayback(); });
        navigator.mediaSession.setActionHandler('pause', function () { if (!player.paused) togglePlayback(); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { nudge(-10); });
        navigator.mediaSession.setActionHandler('seekforward', function () { nudge(10); });
    } catch (e) { /* unsupported actions */ }
    updateMediaSession();
}

function updateMediaSession(title) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || (currentMedia && currentMedia.filename) || 'Watch Together',
            artist: 'Watch Together',
            album: roomId ? ('Room ' + roomId) : '',
        });
    } catch (e) { /* ignore */ }
}
