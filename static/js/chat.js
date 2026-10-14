/*
 * In-room text chat (client side).
 *
 * Loaded before room.js so its top-level helpers (getChatName, initChatSocket,
 * renderChatHistory) are available globally by the time room.js connects.
 * Message bodies are rendered with textContent only, so they are XSS-safe.
 */
let chatName = '';
let chatAtBottom = true;
let chatUnread = 0;
let chatHistoryLoaded = false;
const CHAT_DOM_LIMIT = 200;

function chatRoomId() {
    const el = document.getElementById('roomId');
    return el ? el.textContent.trim() : '';
}

function deriveDefaultName() {
    let browser = '';
    let os = '';
    const uaData = navigator.userAgentData;
    if (uaData) {
        if (uaData.brands) {
            const b = uaData.brands.find(function (x) { return !/Not.?A.?Brand/i.test(x.brand); });
            if (b) browser = b.brand;
        }
        if (uaData.platform) os = uaData.platform;
    }
    const ua = navigator.userAgent || '';
    if (!browser) {
        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/OPR\//.test(ua)) browser = 'Opera';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Safari\//.test(ua)) browser = 'Safari';
    }
    if (!os) {
        if (/Windows/.test(ua)) os = 'Windows';
        else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
        else if (/Android/.test(ua)) os = 'Android';
        else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
        else if (/Linux/.test(ua)) os = 'Linux';
    }
    return [browser, os].filter(Boolean).join(' · ') || 'Guest';
}

function getChatName() {
    return chatName;
}

function formatChatTime(ts) {
    try {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

function scrollChatToBottom() {
    const list = document.getElementById('chatMessages');
    if (list) list.scrollTop = list.scrollHeight;
    chatAtBottom = true;
}

function bumpChatUnread() {
    chatUnread++;
    const badge = document.getElementById('chatUnread');
    if (badge) {
        badge.textContent = String(chatUnread);
        badge.classList.remove('hidden');
    }
}

function clearChatUnread() {
    chatUnread = 0;
    const badge = document.getElementById('chatUnread');
    if (badge) badge.classList.add('hidden');
}

function trimChatDom(list) {
    while (list.childElementCount > CHAT_DOM_LIMIT) list.removeChild(list.firstChild);
}

function appendChatMessage(msg) {
    const list = document.getElementById('chatMessages');
    if (!list || !msg) return;

    const item = document.createElement('div');
    item.className = 'chat-item' + (msg.type === 'system' ? ' system' : '');
    if (msg.type === 'system') {
        const span = document.createElement('span');
        span.className = 'chat-system-text';
        span.textContent = msg.text || '';
        item.appendChild(span);
    } else {
        const meta = document.createElement('div');
        meta.className = 'chat-meta';

        const nameEl = document.createElement('span');
        nameEl.className = 'chat-name' + (msg.role === 'host' ? ' host' : '');
        nameEl.textContent = msg.name || (msg.role === 'host' ? 'Host' : 'Viewer');

        const timeEl = document.createElement('span');
        timeEl.className = 'chat-time';
        timeEl.textContent = formatChatTime(msg.ts);

        meta.appendChild(nameEl);
        meta.appendChild(timeEl);
        item.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'chat-text';
        body.textContent = msg.text || '';
        item.appendChild(body);

        if (socket && msg.sid === socket.id) item.classList.add('mine');
    }

    list.appendChild(item);
    if (chatAtBottom) scrollChatToBottom();
    else bumpChatUnread();
    trimChatDom(list);
}

function renderChatHistory(history) {
    const list = document.getElementById('chatMessages');
    if (!list) return;
    list.textContent = '';
    chatAtBottom = true;
    (history || []).forEach(appendChatMessage);
    scrollChatToBottom();
    clearChatUnread();
}

function loadChatHistory(history) {
    if (chatHistoryLoaded) return;
    chatHistoryLoaded = true;
    renderChatHistory(history);
}

function updateChatCounter() {
    const input = document.getElementById('chatInput');
    const counter = document.getElementById('chatCounter');
    if (!input || !counter) return;
    const max = parseInt(input.getAttribute('maxlength'), 10) || 500;
    counter.textContent = input.value.length + '/' + max;
}

function sendChat() {
    const input = document.getElementById('chatInput');
    if (!input || !socket) return;
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat_send', { room_id: roomId, token: hostToken, name: getChatName(), text: text });
    input.value = '';
    updateChatCounter();
    input.focus();
}

function refreshChatHostUi() {
    const clearBtn = document.getElementById('chatClearBtn');
    if (clearBtn) clearBtn.style.display = isHost ? 'inline-block' : 'none';
}

function initChatSocket() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.on('chat_message', appendChatMessage);
    socket.on('chat_clear', function () { renderChatHistory([]); });
}

function initChat() {
    const stored = sessionStorage.getItem('chat_name_' + chatRoomId());
    chatName = stored || deriveDefaultName();

    const nameInput = document.getElementById('chatName');
    if (nameInput) {
        nameInput.value = chatName;
        nameInput.addEventListener('input', function () {
            chatName = nameInput.value.trim().slice(0, 32);
            sessionStorage.setItem('chat_name_' + chatRoomId(), chatName);
        });
    }

    const form = document.getElementById('chatForm');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); sendChat(); });

    const input = document.getElementById('chatInput');
    if (input) input.addEventListener('input', updateChatCounter);

    const list = document.getElementById('chatMessages');
    if (list) {
        list.addEventListener('scroll', function () {
            const nearBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 40;
            if (nearBottom) { chatAtBottom = true; clearChatUnread(); }
            else chatAtBottom = false;
        });
    }

    const clearBtn = document.getElementById('chatClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (!isHost || !socket) return;
            if (window.confirm('Clear the chat for everyone?')) {
                socket.emit('chat_clear', { room_id: roomId, token: hostToken });
            }
        });
    }

    updateChatCounter();
    refreshChatHostUi();
}

document.addEventListener('DOMContentLoaded', initChat);
