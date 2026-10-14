/*
 * Room roster ("People" panel) and host moderation.
 *
 * Loaded before room.js so its globals (getClientId, initRosterSocket, loadRoster)
 * exist by the time room.js connects. The client id is generated once per browser
 * and sent on join so the host can ban a kicked viewer across reconnects.
 */
let rosterParticipants = [];
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
            const kick = document.createElement('button');
            kick.type = 'button';
            kick.className = 'btn icon-btn roster-kick';
            kick.title = 'Remove from room';
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

function kickViewer(target, name) {
    if (!socket || !isHost || !target) return;
    if (!window.confirm('Remove ' + name + ' from the room?')) return;
    socket.emit('kick_viewer', { room_id: roomId, token: hostToken, target: target });
}

function initRosterSocket() {
    if (!socket) return;
    socket.on('participants_update', function (data) {
        if (data && Array.isArray(data.participants)) renderRoster(data.participants);
    });
    socket.on('kicked', function (data) {
        const reason = (data && data.reason) || 'You were removed from the room';
        try { sessionStorage.removeItem('host_' + roomId); } catch (e) { /* ignore */ }
        window.alert(reason + '. You will now be returned to the home page.');
        window.location.href = '/';
    });
}
