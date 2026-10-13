let lastSyncTime = 0;
const SYNC_INTERVAL = 5000; // 5 seconds

/*
 * Viewers watch a live WebRTC mirror of the host's player, so playback is
 * inherently in sync and cannot be seeked. This remains for robustness while
 * the stream is still connecting and for rooms without an active broadcast.
 */
function syncPlayerState(state) {
    if (typeof player === 'undefined' || !player || !state) return;
    if (player.srcObject) return;                       // live mirror — never seek
    if (!player.currentSrc) return;                     // nothing loaded yet

    const target = state.position || 0;
    if (Math.abs((player.currentTime || 0) - target) > 1.5) {
        try { player.currentTime = target; } catch (e) { /* ignore */ }
    }
    if (state.playing && player.paused) player.play().catch(function () {});
    else if (!state.playing && !player.paused) player.pause();
    if (typeof state.playback_speed === 'number') player.playbackRate = state.playback_speed || 1;
}

function startPeriodicSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(function () {
        const now = Date.now();
        if (now - lastSyncTime > SYNC_INTERVAL) {
            lastSyncTime = now;
            if (socket) socket.emit('sync_request', { room_id: roomId });
        }
    }, SYNC_INTERVAL);
}
