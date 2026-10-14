/*
 * Room roster ("People" panel) and host moderation.
 *
 * Loaded before room.js so its globals (getClientId, initRosterSocket, loadRoster,
 * canRejoin, rosterOnJoined) exist by the time room.js connects. The client id is
 * generated once per browser and sent on join so the host can track a removed
 * viewer across reconnects.
 */
let rosterParticipants = [];
let pendingRequests = [];
let moderationHold = false;
const CLIENT_ID_KEY = 'wt_client_id';

function getClientId() {
    let id = '';
    try { id = localStorage.getItem(CLIENT_ID_KEY) || ''; } catch (e) { id = ''; }
    if (!id) {
        id = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
}

function rosterName(p) {
    if (p && p.name) return String(p.name);
    return p && p.is_host ? 'Host' : 'Viewer';
}

function roomJoinPayload() {
    return { room_id: roomId, token: hostToken, name: getChatName(), client_id: getClientId() };
}

/* Let room.js know whether an automatic re-join is allowed (blocked after a kick). */
function canRejoin() {
    return !moderationHold;
}

function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }

/* ---------------- People list ---------------- */

function renderRoster(participants) {
    if (Array.isArray(participants)) rosterParticipants = participants;
    const list = document.getElementById('rosterList');
    if (!list) return;
    list.textContent = '';
    rosterParticipants.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'roster-item';

        const name = document.createElement('span');
        name.className = 'roster-name';
        name.textContent = rosterName(p);
        row.appendChild(name);

        if (p.is_host) {
            const badge = document.createElement('span');
            badge.className = 'roster-badge host';
            badge.textContent = 'Host';
            row.appendChild(badge);
        } else if (isHost && p.sid) {
            const ban = document.createElement('button');
            ban.type = 'button';
            ban.className = 'btn icon-btn roster-ban';
            ban.title = 'Ban permanently';
            ban.textContent = '⛔';
            ban.addEventListener('click', function () { banViewer(p.sid, rosterName(p)); });
            row.appendChild(ban);

            const kick = document.createElement('button');
            kick.type = 'button';
            kick.className = 'btn icon-btn roster-kick';
            kick.title = 'Remove (can ask to rejoin)';
            kick.textContent = '✕';
            kick.addEventListener('click', function () { kickViewer(p.sid, rosterName(p)); });
            row.appendChild(kick);
        }

        list.appendChild(row);
    });
    const count = document.getElementById('rosterCount');
    if (count) count.textContent = String(rosterParticipants.length);
}

function loadRoster(participants) {
    rosterParticipants = Array.isArray(participants) ? participants : [];
    renderRoster();
}

/* ---------------- Join requests ---------------- */

function renderPending(pending) {
    if (Array.isArray(pending)) pendingRequests = pending;
    const badge = document.getElementById('rosterRequestsBadge');
    const btn = document.getElementById('rosterRequestsBtn');
    const count = pendingRequests.length;
    if (badge) badge.textContent = String(count);
    if (btn) btn.classList.toggle('hidden', count === 0);

    const list = document.getElementById('pendingList');
    if (!list) return;
    list.textContent = '';
    const empty = document.getElementById('pendingEmpty');
    if (empty) empty.classList.toggle('hidden', count > 0);
    if (!count) return;

    pendingRequests.forEach(function (r) {
        const row = document.createElement('div');
        row.className = 'request-item';

        const name = document.createElement('span');
        name.className = 'request-name';
        name.textContent = r.name || 'Viewer';
        row.appendChild(name);

        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'btn btn-primary request-approve';
        approve.textContent = 'Approve';
        approve.addEventListener('click', function () { approveClient(r.client_id); });
        row.appendChild(approve);

        const ban = document.createElement('button');
        ban.type = 'button';
        ban.className = 'btn request-ban';
        ban.textContent = 'Ban';
        ban.addEventListener('click', function () { banClient(r.client_id, r.name); });
        row.appendChild(ban);

        list.appendChild(row);
    });
}

function loadPending(pending) {
    pendingRequests = Array.isArray(pending) ? pending : [];
    renderPending();
}

/* ---------------- Host actions ---------------- */

function kickViewer(target, name) {
    if (!socket || !isHost || !target) return;
    if (!window.confirm('Remove ' + name + ' from the room? They can ask to rejoin.')) return;
    socket.emit('kick_viewer', { room_id: roomId, token: hostToken, target: target });
}

function banViewer(target, name) {
    if (!socket || !isHost || !target) return;
    if (!window.confirm('Ban ' + name + ' from this room? This is permanent.')) return;
    socket.emit('ban_viewer', { room_id: roomId, token: hostToken, target: target });
}

function approveClient(clientId) {
    if (!socket || !isHost || !clientId) return;
    socket.emit('approve_viewer', { room_id: roomId, token: hostToken, client_id: clientId });
}

function banClient(clientId, name) {
    if (!socket || !isHost || !clientId) return;
    if (!window.confirm('Ban ' + (name || 'this viewer') + ' from this room? This is permanent.')) return;
    socket.emit('ban_client', { room_id: roomId, token: hostToken, client_id: clientId });
}

/* ---------------- Removed / waiting / banned states ---------------- */

function showWaiting() {
    moderationHold = true;
    closeModal('removedModal');
    openModal('waitingModal');
}

function showRemoved() {
    moderationHold = true;
    openModal('removedModal');
}

function showBanned() {
    moderationHold = true;
    closeModal('waitingModal');
    closeModal('removedModal');
    openModal('bannedModal');
}

function rejoinRoom() {
    moderationHold = false;
    closeModal('removedModal');
    if (!socket) return;
    const payload = roomJoinPayload();
    if (socket.connected) {
        socket.emit('join', payload);
    } else {
        socket.once('connect', function () { socket.emit('join', payload); });
        socket.connect();
    }
}

function leaveToHome() {
    moderationHold = true;
    try { sessionStorage.removeItem('host_' + roomId); } catch (e) { /* ignore */ }
    window.location.href = '/';
}

/* Called from room.js when a `joined` payload arrives. */
function rosterOnJoined(data) {
    moderationHold = false;
    closeModal('waitingModal');
    closeModal('removedModal');
    closeModal('bannedModal');
    if (data && Array.isArray(data.pending) && isHost) loadPending(data.pending);
}

function initRosterSocket() {
    if (!socket) return;

    socket.on('participants_update', function (data) {
        if (data && Array.isArray(data.participants)) renderRoster(data.participants);
    });

    socket.on('pending_update', function (data) {
        const before = pendingRequests.length;
        renderPending(data && data.pending);
        if (pendingRequests.length > before && isHost) {
            const latest = pendingRequests[pendingRequests.length - 1];
            if (typeof showToast === 'function') {
                showToast((latest && latest.name ? latest.name : 'Someone') + ' wants to join');
            }
        }
    });

    socket.on('kicked', function () { showRemoved(); });
    socket.on('pending_approval', function () { showWaiting(); });
    socket.on('banned', function () { showBanned(); });

    const requestsBtn = document.getElementById('rosterRequestsBtn');
    if (requestsBtn) requestsBtn.addEventListener('click', function () { openModal('pendingModal'); });

    const closeBtn = document.getElementById('pendingCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeModal('pendingModal'); });

    const rejoinBtn = document.getElementById('removedRejoinBtn');
    if (rejoinBtn) rejoinBtn.addEventListener('click', rejoinRoom);

    ['removedLeaveBtn', 'waitingLeaveBtn', 'bannedHomeBtn'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', leaveToHome);
    });
}
