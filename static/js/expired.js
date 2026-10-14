/* Create a fresh room from the expired-room page. */
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('createRoomBtn');
    const info = document.getElementById('roomInfo');
    if (!btn) return;

    btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
            const response = await fetch('/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await response.json();
            if (!response.ok || !data.room_id) throw new Error('create failed');
            sessionStorage.setItem('host_' + data.room_id, data.host_token);
            window.location.href = '/room/' + data.room_id;
        } catch (e) {
            if (info) {
                info.style.display = 'block';
                info.textContent = 'Could not create a room. Please try again.';
            }
            btn.disabled = false;
        }
    });
});
