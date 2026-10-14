"""In-room text chat.

Messages are held in the in-memory room dict (capped by ``CHAT_HISTORY``), so
history is session-scoped and cleared on restart or room expiry. The server
only relays text and never persists it to disk. Join/leave notices are emitted
as transient ``system`` messages and are not stored in history.
"""
import os
import time
import uuid

from flask import request
from flask_socketio import emit

from ..services import room_service, rate_limit
from . import registry

socketio = None

CHAT_MAX_LEN = int(os.environ.get('CHAT_MAX_LEN', 500))
CHAT_HISTORY = int(os.environ.get('CHAT_HISTORY', 200))
CHAT_RATE_LIMIT = int(os.environ.get('CHAT_RATE_LIMIT', 5))
CHAT_RATE_WINDOW = float(os.environ.get('CHAT_RATE_WINDOW', 5))
CHAT_NAME_MAX_LEN = 32


def _now_ms():
    return int(time.time() * 1000)


def _clean_name(name, fallback):
    name = (name or '').strip()
    return name[:CHAT_NAME_MAX_LEN] if name else fallback


def _role_for(room_id, token):
    return 'host' if room_service.is_host(room_id, token) else 'viewer'


def _append(room_id, room, message):
    chat = room.setdefault('chat', [])
    chat.append(message)
    if len(chat) > CHAT_HISTORY:
        del chat[:-CHAT_HISTORY]
    room_service.update_room(room_id, {'chat': chat})


def notify_system(room_id, text, name=None):
    """Broadcast a transient join/leave notice (not stored in history)."""
    if not socketio:
        return
    label = _clean_name(name, 'Someone')
    socketio.emit('chat_message', {
        'id': uuid.uuid4().hex[:12],
        'type': 'system',
        'text': text.format(name=label),
        'ts': _now_ms(),
    }, to=room_id)


def register_chat_events(sio):
    global socketio
    socketio = sio

    @sio.on('chat_send')
    def on_chat_send(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room:
            return
        if registry.get_room_id(request.sid) != room_id:
            emit('error', {'message': 'Join the room before chatting'})
            return

        text = (data.get('text') or '').strip()
        if not text:
            return
        if len(text) > CHAT_MAX_LEN:
            text = text[:CHAT_MAX_LEN]

        if not rate_limit.is_allowed('chat:' + request.sid, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW):
            emit('error', {'message': 'You are sending messages too quickly'})
            return

        role = _role_for(room_id, data.get('token'))
        message = {
            'id': uuid.uuid4().hex[:12],
            'type': 'message',
            'sid': request.sid,
            'name': _clean_name(data.get('name'), 'Host' if role == 'host' else 'Viewer'),
            'role': role,
            'text': text,
            'ts': _now_ms(),
        }
        _append(room_id, room, message)
        emit('chat_message', message, to=room_id)

    @sio.on('chat_clear')
    def on_chat_clear(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        room['chat'] = []
        room_service.update_room(room_id, {'chat': []})
        emit('chat_clear', {}, to=room_id)
