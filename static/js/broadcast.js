/*
 * WebRTC broadcast: mirrors the host's screen OR the host's local video player
 * to every viewer, one RTCPeerConnection per viewer. SDP/ICE are relayed by the
 * server over Socket.IO. For larger rooms replace this mesh with an SFU.
 */

let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let broadcastStream = null;
let broadcastSource = null;   // 'screen' | 'video'
let peerConnections = {};     // host side: viewer_sid -> RTCPeerConnection
let viewerPc = null;          // viewer side
let hostSid = null;
let sharingActive = false;
let iceLoaded = false;

async function loadIceConfig() {
    if (iceLoaded) return;
    iceLoaded = true;
    try {
        const res = await fetch('/api/webrtc/config');
        const data = await res.json();
        if (data.iceServers && data.iceServers.length) iceServers = data.iceServers;
    } catch (e) { /* keep default STUN */ }
}

function broadcastTargetEl(source) {
    return source === 'screen'
        ? document.getElementById('screenVideo')
        : document.getElementById('stageVideo');
}

function ssShowContainer(show, source) {
    if (source === 'screen') {
        const view = document.getElementById('screenView');
        if (view) view.classList.toggle('has-stream', !!show);
        if (typeof setMode === 'function') setMode(show ? 'screen' : 'media');
    } else if (source === 'video' && show) {
        if (typeof hideEmptyState === 'function') hideEmptyState();
        if (typeof setMode === 'function') setMode('media');
    }
}

function ssSetStatus(text) {
    const el = document.getElementById('ssStatusText');
    if (el) el.textContent = text;
    const onStage = document.getElementById('screenShareStatus');
    if (onStage) onStage.textContent = text;
}

function ssUpdateButtons(active, source) {
    const startBtn = document.getElementById('startShareBtn');
    const stopBtn = document.getElementById('stopShareBtn');
    const screenStart = document.getElementById('screenStartBtn');
    if (startBtn) startBtn.style.display = active ? 'none' : 'inline-block';
    if (stopBtn) stopBtn.style.display = active ? 'inline-block' : 'none';
    if (screenStart) screenStart.style.display = (isHost && !active) ? 'inline-block' : 'none';
}

/* ---------------------------------- host ---------------------------------- */

async function startBroadcast(source) {
    if (!isHost) return;
    if (sharingActive) stopBroadcast({ silent: true });
    await loadIceConfig();

    let stream = null;
    let hasAudio = false;
    if (source === 'video') {
        stream = window.WTLocal ? window.WTLocal.capture() : null;
        if (!stream) { ssSetStatus('Open a video first'); return; }
        hasAudio = stream.getAudioTracks().length > 0;
    } else {
        source = 'screen';
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
        } catch (e) {
            ssSetStatus('Screen share cancelled or not permitted');
            return;
        }
        const vt = stream.getVideoTracks()[0];
        if (vt) vt.addEventListener('ended', function () { if (sharingActive) stopBroadcast(); });
        const sv = document.getElementById('screenVideo');
        if (sv) sv.srcObject = stream;
        hasAudio = stream.getAudioTracks().length > 0;
    }

    broadcastStream = stream;
    broadcastSource = source;
    sharingActive = true;
    ssSetStatus(source === 'screen'
        ? (hasAudio ? 'Sharing your screen' : 'Sharing your screen (no audio — pick a tab and enable "Share tab audio")')
        : 'Sharing your video');
    ssUpdateButtons(true, source);
    ssShowContainer(true, source);
    if (typeof updateControlAvailability === 'function') updateControlAvailability();
    if (socket) socket.emit('ss_start', { room_id: roomId, token: hostToken, source: source, has_audio: hasAudio });
}

function stopBroadcast(opts) {
    if (socket && !(opts && opts.silent)) socket.emit('ss_stop', { room_id: roomId, token: hostToken });
    teardownBroadcast();
}

function teardownBroadcast() {
    const wasSource = broadcastSource;
    sharingActive = false;
    Object.keys(peerConnections).forEach(function (sid) {
        try { peerConnections[sid].close(); } catch (e) { /* ignore */ }
    });
    peerConnections = {};
    if (viewerPc) {
        try { viewerPc.close(); } catch (e) { /* ignore */ }
        viewerPc = null;
    }
    if (broadcastStream) {
        broadcastStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
        broadcastStream = null;
    }
    const sv = document.getElementById('screenVideo');
    if (sv) sv.srcObject = null;

    // Viewers lose the mirrored video; the host keeps their local player.
    if (!isHost && wasSource === 'video') {
        const stage = document.getElementById('stageVideo');
        if (stage) {
            try { stage.srcObject = null; stage.load(); } catch (e) { /* ignore */ }
        }
        if (typeof showEmptyState === 'function') showEmptyState();
    }

    broadcastSource = null;
    ssShowContainer(false, 'screen');
    ssUpdateButtons(false);
    ssSetStatus('Not sharing');
    if (typeof updateControlAvailability === 'function') updateControlAvailability();
}

function hostAddViewer(viewerSid) {
    if (!broadcastStream || peerConnections[viewerSid]) return;

    const pc = new RTCPeerConnection({ iceServers: iceServers });
    peerConnections[viewerSid] = pc;

    broadcastStream.getTracks().forEach(function (track) {
        pc.addTrack(track, broadcastStream);
    });

    pc.onicecandidate = function (event) {
        if (event.candidate) socket.emit('ss_ice', { target: viewerSid, candidate: event.candidate });
    };
    pc.onconnectionstatechange = function () {
        if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) !== -1) {
            try { pc.close(); } catch (e) { /* ignore */ }
            delete peerConnections[viewerSid];
        }
    };

    pc.createOffer()
        .then(function (offer) { return pc.setLocalDescription(offer); })
        .then(function () { socket.emit('ss_offer', { target: viewerSid, sdp: pc.localDescription }); })
        .catch(function () { ssSetStatus('Failed to negotiate with a viewer'); });
}

/* --------------------------------- viewer --------------------------------- */

function createViewerConnection() {
    if (viewerPc) return;
    viewerPc = new RTCPeerConnection({ iceServers: iceServers });

    viewerPc.ontrack = function (event) {
        const el = broadcastTargetEl(broadcastSource);
        if (el) {
            el.srcObject = event.streams[0];
            el.muted = false;
            el.play().catch(function () {
                if (broadcastSource === 'screen') {
                    const sctw = document.getElementById('screenClickToWatch');
                    if (sctw) sctw.classList.remove('hidden');
                } else {
                    const ctw = document.getElementById('clickToWatch');
                    if (ctw) ctw.classList.remove('hidden');
                }
            });
        }
        ssShowContainer(true, broadcastSource);
    };
    viewerPc.onicecandidate = function (event) {
        if (event.candidate && hostSid) socket.emit('ss_ice', { target: hostSid, candidate: event.candidate });
    };
    viewerPc.onconnectionstatechange = function () {
        if (['failed', 'disconnected'].indexOf(viewerPc.connectionState) !== -1) {
            ssSetStatus('Connection lost, attempting to reconnect…');
        }
    };

    socket.emit('ss_viewer_ready', { room_id: roomId });
}

/* ------------------------------- signaling -------------------------------- */

function onSsStatus(data) {
    if (data.active) {
        sharingActive = true;
        hostSid = data.host_sid || hostSid;
        broadcastSource = data.source || 'screen';
        if (isHost) {
            ssSetStatus(broadcastSource === 'screen' ? 'Sharing your screen' : 'Sharing your video');
            ssUpdateButtons(true, broadcastSource);
            ssShowContainer(true, broadcastSource);
        } else {
            ssSetStatus(broadcastSource === 'screen'
                ? (data.has_audio === false ? 'Host is sharing their screen (no audio)' : 'Host is sharing their screen')
                : 'Host is sharing a video');
            ssShowContainer(true, broadcastSource);
            createViewerConnection();
        }
    } else {
        const reason = data.reason || 'stopped';
        teardownBroadcast();
        if (!isHost) ssSetStatus(reason === 'host_left' ? 'Host left the room' : 'Stream ended');
    }
}

function onViewerReady(data) {
    if (isHost) hostAddViewer(data.viewer_sid);
}

function onOffer(data) {
    if (isHost || !viewerPc) return;
    viewerPc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function () { return viewerPc.createAnswer(); })
        .then(function (answer) { return viewerPc.setLocalDescription(answer); })
        .then(function () { socket.emit('ss_answer', { target: hostSid, sdp: viewerPc.localDescription }); })
        .catch(function () {});
}

function onAnswer(data) {
    if (!isHost) return;
    const pc = peerConnections[data.from];
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function () {});
}

function onIce(data) {
    const candidate = new RTCIceCandidate(data.candidate);
    if (isHost) {
        const pc = peerConnections[data.from];
        if (pc) pc.addIceCandidate(candidate).catch(function () {});
    } else if (viewerPc) {
        viewerPc.addIceCandidate(candidate).catch(function () {});
    }
}

document.addEventListener('DOMContentLoaded', function () {
    loadIceConfig();

    const startBtn = document.getElementById('startShareBtn');
    const stopBtn = document.getElementById('stopShareBtn');
    const screenStartBtn = document.getElementById('screenStartBtn');
    const stopVideoBtn = document.getElementById('stopVideoBtn');
    if (startBtn) startBtn.addEventListener('click', function () { startBroadcast('screen'); });
    if (stopBtn) stopBtn.addEventListener('click', function () { stopBroadcast(); });
    if (screenStartBtn) screenStartBtn.addEventListener('click', function () { startBroadcast('screen'); });
    if (stopVideoBtn) stopVideoBtn.addEventListener('click', function () { stopBroadcast(); });

    const screenCtw = document.getElementById('screenClickToWatch');
    if (screenCtw) screenCtw.addEventListener('click', function () {
        screenCtw.classList.add('hidden');
        const sv = document.getElementById('screenVideo');
        if (sv) { sv.muted = false; sv.play().catch(function () {}); }
    });

    if (typeof socket === 'undefined' || !socket) return;

    socket.on('joined', function (data) {
        if (!isHost && data.screen_share && data.screen_share.active) {
            sharingActive = true;
            hostSid = data.screen_share.host_sid || null;
            broadcastSource = data.screen_share.source || 'screen';
            ssSetStatus('Host is sharing');
            ssShowContainer(true, broadcastSource);
            createViewerConnection();
        }
    });
    socket.on('ss_status', onSsStatus);
    socket.on('ss_viewer_ready', onViewerReady);
    socket.on('ss_offer', onOffer);
    socket.on('ss_answer', onAnswer);
    socket.on('ss_ice', onIce);
    socket.on('host_left', function () {
        if (!isHost) { teardownBroadcast(); ssSetStatus('Host left the room'); }
    });
});
