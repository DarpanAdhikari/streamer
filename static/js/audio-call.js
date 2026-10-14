/*
 * Room-wide peer-to-peer audio call (client side).
 *
 * Loaded before room.js so its helpers are available globally by the time the
 * socket connects. Each participant opens one RTCPeerConnection to every other
 * participant (a full mesh); the server only relays SDP/ICE. A call survives
 * the host leaving: remaining peers stay connected until the last one hangs up.
 */
let acLocalStream = null;
let acPeers = {};        // sid -> { pc, pending, remoteSet, initiated }
let acAudioEls = {};     // sid -> hidden <audio>
let acState = { active: false, started_by: null, started_at: null, participants: [] };
let acInCall = false;
let acWasInCall = false;
let acMuted = false;
let acTimer = null;
let acRejoinPrompted = false;

/* --------------------------------- state ---------------------------------- */

function acMe() {
    return (typeof socket !== 'undefined' && socket) ? socket.id : null;
}

function acNormalize(state) {
    if (!state) return { active: false, started_by: null, started_at: null, participants: [] };
    let parts = state.participants;
    if (!Array.isArray(parts)) {
        const dict = parts || {};
        parts = Object.keys(dict).map(function (sid) {
            const p = dict[sid] || {};
            return { sid: sid, name: p.name, muted: p.muted, joined_at: p.joined_at };
        });
    }
    return {
        active: !!state.active,
        started_by: state.started_by || null,
        started_at: state.started_at || null,
        participants: parts || []
    };
}

function acIsParticipant() {
    const me = acMe();
    return !!me && acState.participants.some(function (p) { return p.sid === me; });
}

/* ----------------------------------- UI ----------------------------------- */

function acShowInvite(text, title) {
    const modal = document.getElementById('callInviteModal');
    if (!modal) return;
    const titleEl = document.getElementById('callInviteTitle');
    const textEl = document.getElementById('callInviteText');
    if (titleEl && title) titleEl.textContent = title;
    if (textEl) textEl.textContent = text || '';
    modal.classList.add('open');
}

function acHideInvite() {
    const modal = document.getElementById('callInviteModal');
    if (modal) modal.classList.remove('open');
}

function acUpdateTimer() {
    const el = document.getElementById('callTimer');
    const btnLabel = document.getElementById('callBtnLabel');
    if (!acState.active || !acState.started_at) {
        if (el) el.textContent = '';
        if (btnLabel && acInCall) btnLabel.textContent = 'In call';
        return;
    }
    const secs = Math.max(0, Math.floor((Date.now() - acState.started_at) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const text = mm + ':' + ss;
    if (el) el.textContent = text;
    if (btnLabel && acInCall) btnLabel.textContent = 'In call · ' + text;
}

function acStartTimer() {
    acStopTimer();
    acUpdateTimer();
    acTimer = setInterval(acUpdateTimer, 1000);
}

function acStopTimer() {
    if (acTimer) { clearInterval(acTimer); acTimer = null; }
    const el = document.getElementById('callTimer');
    if (el) el.textContent = '';
}

function acRenderParticipants() {
    const box = document.getElementById('callParticipants');
    if (!box) return;
    const me = acMe();
    box.textContent = '';
    acState.participants.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'call-participant' + (p.sid === me ? ' me' : '');

        const mic = document.createElement('span');
        mic.className = 'call-mic' + (p.muted ? ' muted' : '');
        mic.textContent = p.muted ? '🔇' : '🎙';

        const name = document.createElement('span');
        name.className = 'call-name';
        name.textContent = (p.name || 'Guest') + (p.sid === me ? ' (you)' : '');

        row.appendChild(mic);
        row.appendChild(name);
        box.appendChild(row);
    });
}

function acUpdateUI() {
    const btn = document.getElementById('callBtn');
    const label = document.getElementById('callBtnLabel');
    if (btn) {
        const visible = acInCall || acState.active || isHost;
        btn.style.display = visible ? 'inline-flex' : 'none';
        if (label) {
            if (acInCall) label.textContent = 'In call';
            else if (acState.active) label.textContent = 'Join call';
            else label.textContent = 'Start call';
        }
        btn.classList.toggle('in-call', acInCall);
    }

    const panel = document.getElementById('callPanel');
    if (panel) panel.style.display = acInCall ? 'block' : 'none';

    const muteBtn = document.getElementById('callMuteBtn');
    if (muteBtn) muteBtn.textContent = acMuted ? 'Unmute' : 'Mute';

    const endBtn = document.getElementById('callEndBtn');
    if (endBtn) endBtn.style.display = (isHost && acInCall) ? 'inline-block' : 'none';

    acRenderParticipants();

    if (acInCall && acState.active) acStartTimer();
    else { acStopTimer(); acUpdateTimer(); }
}

/* --------------------------------- media ---------------------------------- */

async function acEnsureStream() {
    if (acLocalStream) return acLocalStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone is not supported in this browser');
    }
    acLocalStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    acLocalStream.getAudioTracks().forEach(function (t) { t.enabled = !acMuted; });
    return acLocalStream;
}

function acAttachRemote(sid, stream) {
    let el = acAudioEls[sid];
    if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.setAttribute('playsinline', '');
        el.className = 'ac-audio';
        el.dataset.sid = sid;
        document.body.appendChild(el);
        acAudioEls[sid] = el;
    }
    el.srcObject = stream;
    el.play().catch(function () {});
}

function acCreatePeer(sid) {
    if (acPeers[sid]) return acPeers[sid];
    const config = { iceServers: (typeof iceServers !== 'undefined' ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]) };
    const pc = new RTCPeerConnection(config);
    const entry = { pc: pc, pending: [], remoteSet: false, initiated: false };
    acPeers[sid] = entry;

    if (acLocalStream) {
        acLocalStream.getTracks().forEach(function (t) { pc.addTrack(t, acLocalStream); });
    }
    pc.onicecandidate = function (e) {
        if (e.candidate && socket) socket.emit('ac_ice', { target: sid, candidate: e.candidate });
    };
    pc.ontrack = function (e) { acAttachRemote(sid, e.streams[0]); };
    return entry;
}

function acRemovePeer(sid) {
    const entry = acPeers[sid];
    if (entry) {
        try { entry.pc.close(); } catch (e) { /* ignore */ }
        delete acPeers[sid];
    }
    const el = acAudioEls[sid];
    if (el) {
        el.srcObject = null;
        if (el.parentNode) el.parentNode.removeChild(el);
        delete acAudioEls[sid];
    }
}

function acTeardownPeers() {
    Object.keys(acPeers).forEach(acRemovePeer);
}

async function acReconcile() {
    if (!acInCall || !acState.active || typeof socket === 'undefined' || !socket) {
        acTeardownPeers();
        acUpdateUI();
        return;
    }
    const me = acMe();
    const others = acState.participants
        .map(function (p) { return p.sid; })
        .filter(function (sid) { return sid && sid !== me; });

    Object.keys(acPeers).forEach(function (sid) {
        if (others.indexOf(sid) === -1) acRemovePeer(sid);
    });

    try { await acEnsureStream(); } catch (e) { return; }
    if (typeof loadIceConfig === 'function') { try { await loadIceConfig(); } catch (e) { /* ignore */ } }

    for (let i = 0; i < others.length; i++) {
        const sid = others[i];
        const entry = acCreatePeer(sid);
        // Exactly one side offers: the peer with the greater session id.
        if (!entry.initiated && me && me > sid && entry.pc.signalingState === 'stable') {
            entry.initiated = true;
            try {
                const offer = await entry.pc.createOffer();
                await entry.pc.setLocalDescription(offer);
                socket.emit('ac_offer', { target: sid, sdp: entry.pc.localDescription });
            } catch (e) {
                entry.initiated = false;
            }
        }
    }
    acUpdateUI();
}

/* ------------------------------- signalling ------------------------------- */

function onAcState(data) {
    acState = acNormalize(data);
    const mine = acIsParticipant();

    if (!acState.active) {
        acStopLocal();
        acInCall = false;
        acWasInCall = false;
        acRejoinPrompted = false;
        acHideInvite();
    }

    acReconcile();
    acUpdateUI();

    if (acState.active && acWasInCall && !acInCall && !mine && !acRejoinPrompted) {
        acRejoinPrompted = true;
        acShowInvite('The call is still going. Rejoin?', 'Rejoin audio call');
    }
}

function onAcInvite(data) {
    if (acInCall) return;
    if (!acState.active) acState.active = true;
    acRejoinPrompted = false;
    acShowInvite((data && data.name ? data.name : 'Someone') + ' started an audio call.', 'Incoming audio call');
}

function onAcEnded() {
    acStopLocal();
    acInCall = false;
    acWasInCall = false;
    acRejoinPrompted = false;
    acHideInvite();
    acState = { active: false, started_by: null, started_at: null, participants: [] };
    acUpdateUI();
}

function onAcDeclined(data) {
    if (isHost) showToast((data && data.name ? data.name : 'Someone') + ' declined the call');
}

function onAcOffer(data) {
    if (!acInCall || !socket) return;
    acEnsureStream().then(function () {
        const entry = acCreatePeer(data.from);
        return entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
            entry.remoteSet = true;
            entry.pending.forEach(function (c) { entry.pc.addIceCandidate(c).catch(function () {}); });
            entry.pending = [];
            return entry.pc.createAnswer();
        }).then(function (answer) {
            return entry.pc.setLocalDescription(answer);
        }).then(function () {
            socket.emit('ac_answer', { target: data.from, sdp: entry.pc.localDescription });
        });
    }).catch(function () {});
}

function onAcAnswer(data) {
    const entry = acPeers[data.from];
    if (!entry) return;
    entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
        entry.remoteSet = true;
        entry.pending.forEach(function (c) { entry.pc.addIceCandidate(c).catch(function () {}); });
        entry.pending = [];
    }).catch(function () {});
}

function onAcIce(data) {
    const entry = acPeers[data.from];
    if (!entry) return;
    const candidate = new RTCIceCandidate(data.candidate);
    if (entry.remoteSet) entry.pc.addIceCandidate(candidate).catch(function () {});
    else entry.pending.push(candidate);
}

/* --------------------------------- actions -------------------------------- */

function acStopLocal() {
    acTeardownPeers();
    if (acLocalStream) {
        acLocalStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
        acLocalStream = null;
    }
    acMuted = false;
    acStopTimer();
}

async function acStartCall() {
    if (!isHost || acInCall) return;
    try { await acEnsureStream(); }
    catch (e) { showToast('Microphone permission is required to start a call'); return; }
    acInCall = true;
    acWasInCall = true;
    acRejoinPrompted = false;
    socket.emit('ac_start', { room_id: roomId, token: hostToken, name: getChatName() });
}

async function acAcceptInvite() {
    if (acInCall) return;
    if (!acState.active) { acHideInvite(); return; }
    try { await acEnsureStream(); }
    catch (e) { showToast('Microphone permission is required to join the call'); return; }
    acInCall = true;
    acWasInCall = true;
    acRejoinPrompted = false;
    acHideInvite();
    socket.emit('ac_accept', { room_id: roomId, name: getChatName() });
}

function acDeclineInvite() {
    acHideInvite();
    if (socket) socket.emit('ac_decline', { room_id: roomId });
}

function acLeave() {
    acInCall = false;
    acWasInCall = false;
    acRejoinPrompted = false;
    if (socket) socket.emit('ac_leave', { room_id: roomId });
    acStopLocal();
    acUpdateUI();
}

function acEndForAll() {
    if (!isHost) return;
    if (!window.confirm('End the audio call for everyone?')) return;
    acInCall = false;
    acWasInCall = false;
    acRejoinPrompted = false;
    socket.emit('ac_end', { room_id: roomId, token: hostToken });
    acStopLocal();
    acUpdateUI();
}

function acToggleMute() {
    acMuted = !acMuted;
    if (acLocalStream) {
        acLocalStream.getAudioTracks().forEach(function (t) { t.enabled = !acMuted; });
    }
    if (socket && acInCall) socket.emit('ac_mute', { room_id: roomId, muted: acMuted });
    acUpdateUI();
}

function acOnCallButton() {
    if (acInCall) return;
    if (acState.active) { acAcceptInvite(); return; }
    if (isHost) acStartCall();
}

/* ------------------------------- lifecycle -------------------------------- */

function loadAudioCallState(state) {
    acState = acNormalize(state);
    if (!acState.active) {
        acUpdateUI();
        return;
    }
    const mine = acIsParticipant();
    if (mine) {
        acInCall = true;
        acWasInCall = true;
        acReconcile();
    } else if (acWasInCall && !acRejoinPrompted) {
        acRejoinPrompted = true;
        acShowInvite('The call is still going. Rejoin?', 'Rejoin audio call');
    }
    acUpdateUI();
}

function initAudioCallSocket() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.on('ac_state', onAcState);
    socket.on('ac_invite', onAcInvite);
    socket.on('ac_ended', onAcEnded);
    socket.on('ac_declined', onAcDeclined);
    socket.on('ac_offer', onAcOffer);
    socket.on('ac_answer', onAcAnswer);
    socket.on('ac_ice', onAcIce);
    socket.on('disconnect', function () {
        if (acInCall) { acStopLocal(); acInCall = false; }
    });
}

function initAudioCall() {
    const btn = document.getElementById('callBtn');
    if (btn) btn.addEventListener('click', acOnCallButton);
    const accept = document.getElementById('callAcceptBtn');
    if (accept) accept.addEventListener('click', acAcceptInvite);
    const decline = document.getElementById('callDeclineBtn');
    if (decline) decline.addEventListener('click', acDeclineInvite);
    const mute = document.getElementById('callMuteBtn');
    if (mute) mute.addEventListener('click', acToggleMute);
    const leave = document.getElementById('callLeaveBtn');
    if (leave) leave.addEventListener('click', acLeave);
    const end = document.getElementById('callEndBtn');
    if (end) end.addEventListener('click', acEndForAll);
    acUpdateUI();
}

document.addEventListener('DOMContentLoaded', initAudioCall);
