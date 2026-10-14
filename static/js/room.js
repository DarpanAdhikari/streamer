let socket;
let isHost = false;
let roomId;
let hostToken = null;
let currentMedia = null;
let syncInterval = null;
let queue = [];
let currentIndex = 0;
let currentMode = 'media';
let reconnectAttempts = 0;
let hostFiles = [];
let waitingStreamTimer = null;
let hostClaimRetried = false;
let permissions = {
    allow_viewer_control: false,
    allow_viewer_seek: false
};
const MAX_RECONNECT_ATTEMPTS = 10;

document.addEventListener('DOMContentLoaded', function () {
    roomId = document.getElementById('roomId').textContent.trim();
    hostToken = sessionStorage.getItem(`host_${roomId}`);

    applyRole(!!hostToken);

    setupModeTabs();
    setupSidebarToggle();
    setupCopyLink();
    setupPermissionToggles();
    setupPlaylistButtons();
    setupOpenVideo();
    setupTrackControls();
    syncRequestDrivenUi();
    showEmptyState();

    initializeSocket();
    startPeriodicSync();
    setMode('media');
});

function show(id, display) { const el = document.getElementById(id); if (el) el.style.display = display; }

function applyRole(host) {
    isHost = !!host;
    const roleBadge = document.getElementById('roleBadge');
    if (roleBadge) {
        roleBadge.textContent = isHost ? 'Host' : 'Viewer';
        roleBadge.classList.toggle('host', isHost);
        roleBadge.classList.toggle('viewer', !isHost);
    }
    show('openVideoBtn', isHost ? 'inline-block' : 'none');
    show('emptyAddMediaBtn', isHost ? 'inline-block' : 'none');
    show('stopVideoBtn', 'none');
    show('hostControlsPanel', isHost ? 'block' : 'none');
    show('permissionsPanel', isHost ? 'block' : 'none');
    show('ssHostControls', isHost ? 'flex' : 'none');
    show('screenStartBtn', isHost ? 'inline-block' : 'none');
    if (typeof updateControlAvailability === 'function') updateControlAvailability();
}

function setupModeTabs() {
    document.querySelectorAll('.mode-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { setMode(tab.dataset.mode); });
    });
}

function setupSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle || !sidebar) return;

    function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }
    function closeSheet() {
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
    }

    toggle.addEventListener('click', function () {
        if (isMobile()) {
            const open = sidebar.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('open', open);
        } else {
            sidebar.classList.toggle('collapsed');
        }
    });
    if (backdrop) backdrop.addEventListener('click', closeSheet);
    window.addEventListener('resize', function () {
        if (!isMobile()) closeSheet();
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    requestAnimationFrame(function () { toast.classList.add('show'); });
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.classList.add('hidden'); }, 220);
    }, 1900);
}

function setupCopyLink() {
    const btn = document.getElementById('copyLinkBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
        const url = window.location.href;
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(url);
                ok = true;
            }
        } catch (e) { ok = false; }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (e) { ok = false; }
        }
        showToast(ok ? 'Link copied' : 'Copy this link: ' + url);
    });
}

function setupPermissionToggles() {
    setupPermissionToggle('permControl', 'allow_viewer_control');
    setupPermissionToggle('permSeek', 'allow_viewer_seek');
}

function setupPlaylistButtons() {
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () {
        if (isHost && socket) socket.emit('media_next', { room_id: roomId, token: hostToken });
    });
    if (prevBtn) prevBtn.addEventListener('click', function () {
        if (isHost && socket) socket.emit('media_prev', { room_id: roomId, token: hostToken });
    });
}

function syncRequestDrivenUi() { /* preference toggles update via applyPermissions() */ }

function setMode(mode) {
    currentMode = mode === 'screen' ? 'screen' : 'media';
    const watch = document.getElementById('watchView');
    const screen = document.getElementById('screenView');
    if (watch) watch.classList.toggle('active', currentMode === 'media');
    if (screen) screen.classList.toggle('active', currentMode === 'screen');
    const tabWatch = document.getElementById('tabWatch');
    const tabScreen = document.getElementById('tabScreen');
    if (tabWatch) tabWatch.classList.toggle('active', currentMode === 'media');
    if (tabScreen) tabScreen.classList.toggle('active', currentMode === 'screen');
}

/* ---------------- Local video (host) ---------------- */

function setupOpenVideo() {
    const input = document.getElementById('videoFileInput');
    const openBtn = document.getElementById('openVideoBtn');
    const emptyBtn = document.getElementById('emptyAddMediaBtn');
    [openBtn, emptyBtn].forEach(function (btn) {
        if (btn) btn.addEventListener('click', function () { if (input) input.click(); });
    });
    if (input) input.addEventListener('change', function () {
        const files = Array.from(input.files || []);
        input.value = '';
        if (!files.length) return;
        const video = files.find(function (f) { return !/\.(srt|vtt)$/i.test(f.name); }) || files[0];
        openLocalVideo(video, files);
    });
}

function setupTrackControls() {
    const audio = document.getElementById('audioTrack');
    if (audio) audio.addEventListener('change', function () {
        changeAudioTrack(parseInt(audio.value, 10) || 0);
    });
}

async function openLocalVideo(file, allFiles) {
    if (!isHost || !window.WTLocal) return;
    hideEmptyState();
    setMediaTitle(file.name);
    setTierChip(null);
    showOverlay('Opening ' + file.name + '…', true);

    try {
        const res = await window.WTLocal.open(file, {
            onPhase: updateEnginePhase,
            onProgress: updateEngineProgress,
        });
        if (!res) return;
        hideOverlay();
        setTierChip(res.tier);
        hostFiles.push(file);
        const v = document.getElementById('stageVideo');
        if (v) v.play().catch(function () {});
        startBroadcast('video');
        setMediaStatus('ready', 'Live');
        updateControlAvailability();
        if (window.WTLocal && window.WTLocal.listEmbeddedSubtitles) {
            const at = (window.WTLocal.audioTracks && window.WTLocal.audioTracks()) || [];
            window.WTLocal.listEmbeddedSubtitles().then(function (subs) {
                console.debug('[tracks] tier=' + res.tier, 'audio=' + at.length, at,
                    'embeddedSubs=' + (subs ? subs.length : 0), subs);
            }).catch(function () {});
        }
        if (allFiles && typeof findMatchingSubtitle === 'function') {
            const sub = findMatchingSubtitle(allFiles, file);
            if (sub && typeof loadExternalSubtitle === 'function') loadExternalSubtitle(sub);
        }
        if (socket) socket.emit('media_add', {
            room_id: roomId, token: hostToken,
            media: { filename: file.name, size: file.size, duration: (v && v.duration) || 0 }
        });
    } catch (e) {
        setTierChip(null);
        setMediaStatus('error', 'Failed');
        showOverlay('Could not play this file: ' + (e && e.message ? e.message : 'unsupported format'));
    }
}

function updateEnginePhase(phase) {
    const labels = {
        'tier-1': 'Loading…',
        'tier-2': 'Remuxing in your browser (lossless)…',
        'tier-3': 'Converting in your browser…'
    };
    if (labels[phase]) showOverlay(labels[phase], true);
}

function updateEngineProgress(p) {
    if (!p) return;
    const pct = (typeof p.progress === 'number') ? Math.round(p.progress * 100) : null;
    showOverlay(pct != null ? 'Converting… ' + pct + '%' : 'Converting…', true);
}

function setTierChip(tier) {
    const chip = document.getElementById('mediaTier');
    if (!chip) return;
    if (!tier) { chip.classList.add('hidden'); return; }
    const names = { 1: 'Direct', 2: 'Remux', 3: 'Convert' };
    chip.textContent = 'Tier ' + tier + ' · ' + (names[tier] || '');
    chip.classList.remove('hidden');
}

function setMediaTitle(name) {
    const el = document.getElementById('mediaTitle');
    if (el) el.textContent = name || 'No media selected';
}

/* ---------------- Socket ---------------- */

function initializeSocket() {
    socket = io({
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    socket.emit('join', { room_id: roomId, token: hostToken, name: getChatName() });
    if (typeof initChatSocket === 'function') initChatSocket();
    if (typeof initAudioCallSocket === 'function') initAudioCallSocket();

    socket.on('connect', function () { reconnectAttempts = 0; hostClaimRetried = false; });
    socket.on('reconnect', function () {
        socket.emit('join', { room_id: roomId, token: hostToken, name: getChatName() });
        socket.emit('sync_request', { room_id: roomId });
    });

    socket.on('joined', function (data) {
        if (typeof data.is_host === 'boolean') applyRole(data.is_host);
        if (typeof refreshChatHostUi === 'function') refreshChatHostUi();
        if (typeof loadChatHistory === 'function') loadChatHistory(data.chat);
        if (typeof loadAudioCallState === 'function') loadAudioCallState(data.audio_call);
        // A host token holder demoted to viewer is usually a stale socket during a
        // refresh; retry once so the refreshed host reclaims the role.
        if (!data.is_host && hostToken && !hostClaimRetried) {
            hostClaimRetried = true;
            setTimeout(function () {
                if (socket) socket.emit('join', { room_id: roomId, token: hostToken });
            }, 1500);
        }
        document.getElementById('participantCount').textContent = (data.participant_count || 1) + ' watching';
        queue = data.queue || [];
        currentIndex = data.current_index || 0;
        if (data.playback_state && data.playback_state.host_permissions) {
            applyPermissions(data.playback_state.host_permissions);
        }
        updatePlaylistUI();
        setMode(data.mode || 'media');
        if (data.subtitles) applyRemoteSubtitles(data.subtitles);
        if (data.picture && window.WTPicture) window.WTPicture.applyRemote(data.picture);
        handleMediaPayload(data.media, data.playback_state);
    });

    socket.on('playback_update', function (data) {
        if (!isHost) syncPlayerState(data.state);
        if (!isHost && typeof updateRemoteClock === 'function') updateRemoteClock(data.state);
        lastSyncTime = Date.now();
    });

    socket.on('permissions_update', function (data) { applyPermissions(data.host_permissions); });

    socket.on('queue_update', function (data) {
        queue = data.queue || [];
        currentIndex = data.current_index || 0;
        updatePlaylistUI();
    });

    socket.on('media_change', function (data) {
        queue = data.queue || [];
        currentIndex = data.current_index || 0;
        updatePlaylistUI();
        handleMediaPayload(data.media, data.playback_state);
    });

    socket.on('subtitle_set', function (data) { applyRemoteSubtitles(data); });

    socket.on('picture_update', function (data) {
        if (data && data.picture && window.WTPicture) window.WTPicture.applyRemote(data.picture);
    });

    socket.on('participants_update', function (data) {
        document.getElementById('participantCount').textContent = data.count + ' watching';
    });

    socket.on('error', function (data) { console.error(data.message); });
}

function setupPermissionToggle(elementId, permissionKey) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.addEventListener('change', function () {
        if (!isHost || !socket) return;
        const payload = { room_id: roomId, token: hostToken, permissions: {} };
        payload.permissions[permissionKey] = el.checked;
        socket.emit('set_permissions', payload);
    });
}

function applyPermissions(perms) {
    permissions = Object.assign(permissions, perms || {});
    const ctrl = document.getElementById('permControl');
    const seek = document.getElementById('permSeek');
    if (ctrl) ctrl.checked = !!permissions.allow_viewer_control;
    if (seek) seek.checked = !!permissions.allow_viewer_seek;
    updateControlAvailability();
}

function setHidden(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !!hidden);
}

function updateControlAvailability() {
    const canCtrl = isHost || permissions.allow_viewer_control;

    setHidden('ctrlPrev', !isHost);
    setHidden('ctrlNext', !isHost);
    setHidden('seekRow', !isHost);
    setHidden('ctrlPlayPause', !canCtrl);
    setHidden('speedSettingRow', !isHost);
    setHidden('nextBtn', !isHost);
    setHidden('prevBtn', !isHost);

    // A/V track pickers are host-only (viewers receive the mirrored stream).
    refreshTrackControls();

    const viewerPanel = document.getElementById('viewerControlsPanel');
    if (viewerPanel) viewerPanel.style.display = 'none';
    const viewerControls = document.getElementById('viewerControls');
    if (viewerControls) viewerControls.style.display = 'none';
    document.querySelectorAll('.viewer-seek-control').forEach(function (el) { el.style.display = 'none'; });

    if (typeof updateCcButton === 'function') updateCcButton();
}

/* ---------------- A/V track selection (host) ---------------- */

function hasSelectableAudio() {
    return !!(window.WTLocal && window.WTLocal.audioTracks && window.WTLocal.audioTracks().length > 1);
}

function audioTrackLabel(track, i) {
    const name = track.name || track.language || ('Track ' + (i + 1));
    return track.codec ? name + ' · ' + track.codec : name;
}

function refreshTrackControls() {
    refreshAudioTracks();
    setHidden('audioSettingRow', !isHost || !hasSelectableAudio());
    setHidden('subtitleSettingRow', !isHost);
    setHidden('subLoadRow', !isHost);
    if (typeof refreshSubtitleSources === 'function') refreshSubtitleSources();
}

function refreshAudioTracks() {
    const select = document.getElementById('audioTrack');
    if (!select) return;
    const tracks = (window.WTLocal && window.WTLocal.audioTracks) ? window.WTLocal.audioTracks() : [];
    select.innerHTML = '';
    if (!tracks.length) {
        const opt = document.createElement('option');
        opt.value = '0';
        opt.textContent = 'Default';
        select.appendChild(opt);
        return;
    }
    tracks.forEach(function (track, i) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = audioTrackLabel(track, i);
        if (i === (window.WTLocal.audioIndex || 0)) opt.selected = true;
        select.appendChild(opt);
    });
}

async function changeAudioTrack(index) {
    if (!isHost || !window.WTLocal || !window.WTLocal.file) return;
    const v = document.getElementById('stageVideo');
    const resumeAt = (v && isFinite(v.currentTime)) ? v.currentTime : 0;
    const wasPlaying = !!(v && !v.paused);

    if (typeof stopBroadcast === 'function') stopBroadcast();
    hideOverlay();
    showOverlay('Switching audio track…', true);
    try {
        await window.WTLocal.open(window.WTLocal.file, {
            onPhase: updateEnginePhase,
            onProgress: updateEngineProgress,
        }, { audioIndex: index, resumeAt: resumeAt, forceRemux: true });
        hideOverlay();
        if (v && isFinite(resumeAt)) { try { v.currentTime = resumeAt; } catch (e) { /* ignore */ } }
        if (typeof startBroadcast === 'function') startBroadcast('video');
        if (wasPlaying && v) v.play().catch(function () {});
        refreshAudioTracks();
    } catch (e) {
        showOverlay('Could not switch audio track: ' + (e && e.message ? e.message : 'error'), false);
    }
}

/* ---------------- Media metadata ---------------- */

function titleFor(media) {
    return media && media.filename ? media.filename : 'Media';
}

function setMediaStatus(status, text) {
    const chip = document.getElementById('mediaStatus');
    if (!chip) return;
    if (!status) { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden', 'ready', 'error');
    if (status === 'ready') chip.classList.add('ready');
    if (status === 'error') chip.classList.add('error');
    chip.textContent = text || status;
}

function handleMediaPayload(media, playbackState) {
    if (!media || !media.filename) {
        currentMedia = null;
        setMediaStatus(null);
        setTierChip(null);
        if (waitingStreamTimer) { clearTimeout(waitingStreamTimer); waitingStreamTimer = null; }
        if (!isHost) { setMediaTitle(''); showEmptyState(); }
        return;
    }
    currentMedia = media;
    setMediaTitle(media.filename);
    if (typeof updateMediaSession === 'function') updateMediaSession(media.filename);
    hideEmptyState();

    if (!isHost) {
        setMediaStatus('ready', 'Live');
        const hasStream = typeof player !== 'undefined' && player && player.srcObject;
        if (hasStream) {
            if (waitingStreamTimer) { clearTimeout(waitingStreamTimer); waitingStreamTimer = null; }
        } else {
            showOverlay('Waiting for the host to start streaming…', true);
            if (waitingStreamTimer) clearTimeout(waitingStreamTimer);
            waitingStreamTimer = setTimeout(function () {
                if (isHost) return;
                if (!(typeof player !== 'undefined' && player && player.srcObject)) {
                    showOverlay('Still waiting for the media stream… ask the host to (re)start.', false);
                }
            }, 8000);
        }
    }
    if (playbackState) syncPlayerState(playbackState);
}

function updatePlaylistUI() {
    const noPlaylist = document.getElementById('noPlaylist');
    const playlistItems = document.getElementById('playlistItems');
    if (!playlistItems) return;

    playlistItems.innerHTML = '';
    if (!queue.length) {
        if (noPlaylist) noPlaylist.style.display = 'block';
        return;
    }
    if (noPlaylist) noPlaylist.style.display = 'none';

    queue.forEach(function (item, idx) {
        const div = document.createElement('div');
        div.className = 'playlist-item' + (idx === currentIndex ? ' current' : '');

        const name = document.createElement('span');
        name.className = 'pl-name';
        name.textContent = item.filename || ('Media ' + (idx + 1));
        if (isHost) {
            name.classList.add('clickable');
            name.addEventListener('click', function () {
                if (hostFiles[idx]) openLocalVideo(hostFiles[idx]);
                else if (socket) socket.emit('media_select', { room_id: roomId, token: hostToken, index: idx });
            });
        }
        div.appendChild(name);

        if (isHost) {
            const rm = document.createElement('button');
            rm.className = 'pl-remove';
            rm.textContent = '×';
            rm.title = 'Remove';
            rm.addEventListener('click', function (e) {
                e.stopPropagation();
                if (hostFiles[idx]) hostFiles.splice(idx, 1);
                if (socket) socket.emit('media_remove', { room_id: roomId, token: hostToken, index: idx });
            });
            div.appendChild(rm);
        }
        playlistItems.appendChild(div);
    });
}
