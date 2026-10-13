document.addEventListener('DOMContentLoaded', function() {
    const createRoomBtn = document.getElementById('createRoomBtn');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const roomIdInput = document.getElementById('roomIdInput');
    const roomInfo = document.getElementById('roomInfo');

    createRoomBtn.addEventListener('click', async function() {
        try {
            const response = await fetch('/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await response.json();
            roomInfo.style.display = 'block';
            roomInfo.innerHTML = `
                <strong>Room created!</strong><br>
                Room ID: <code>${data.room_id}</code><br>
                Link: <a href="/room/${data.room_id}" style="color: #86efac;">Open Room</a><br>
                <small>Host token stored in session</small>
            `;
            // Store host token
            sessionStorage.setItem(`host_${data.room_id}`, data.host_token);
            window.location.href = `/room/${data.room_id}`;
        } catch (e) {
            roomInfo.style.display = 'block';
            roomInfo.innerHTML = '<span style="color: #fca5a5;">Error creating room</span>';
        }
    });

    joinRoomBtn.addEventListener('click', function() {
        const roomId = roomIdInput.value.trim();
        if (roomId) {
            window.location.href = `/room/${roomId}`;
        }
    });

    roomIdInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            joinRoomBtn.click();
        }
    });
});
