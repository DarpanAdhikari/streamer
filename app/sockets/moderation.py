"""Host moderation: kick (reversible) and ban (permanent) viewers.

Removal is tracked by a browser-local client id rather than IP address, so other
viewers behind the same network are unaffected.

A kicked viewer is *parked*: reopening the room link shows a waiting screen, and
the host can either approve them back in or ban them permanently. A ban is
permanent for the lifetime of the room. See ``README`` for the event reference.
"""
import time

from flask import request
from flask_socketio import emit

from ..services import room_service
from . import registry

socketio = None

# Parked (pending-approval) sockets: sid -> room_id. These sockets never join the
# Socket.IO room, so on disconnect we resolve their room through this map.
WAITING = {}


def _now():
    return time.time()


def pending_list(room):
    """Public list of clients awaiting host approval: names only, no sids."""
    return [
        {'client_id': cid, 'name': entry.get('name') or 'Viewer'}
        for cid, entry in (room.get('pending') or {}).items()
    ]


def _notify_host(room, room_id):
    if not socketio:
        return
    host_sid = room.get('host_sid')
    if host_sid:
        socketio.emit('pending_update', {'pending': pending_list(room)}, to=host_sid)


def park(sid, room_id, client_id, name):
    """Hold a kicked client's socket until the host approves or bans them."""
    room = room_service.get_room(room_id)
    if not room:
        return
    pending = room.setdefault('pending', {})
    entry = pending.get(client_id) or {}
    clean = (name or '').strip()
    if clean:
        entry['name'] = clean[:32]
    entry.setdefault('name', 'Viewer')
    entry['sid'] = sid
    entry['at'] = _now()
    pending[client_id] = entry
    room_service.update_room(room_id, {'pending': pending})
    WAITING[sid] = room_id
    _notify_host(room, room_id)


def handle_disconnect(sid):
    """Clear a parked socket's waiting slot on disconnect (the request stays)."""
    room_id = WAITING.pop(sid, None)
    if not room_id:
        return
    room = room_service.get_room(room_id)
    if not room:
        return
    pending = room.get('pending', {})
    changed = False
    for entry in pending.values():
        if entry.get('sid') == sid:
            entry['sid'] = None
            changed = True
    if changed:
        room_service.update_room(room_id, {'pending': pending})


def register_moderation_events(sio):
    global socketio
    socketio = sio

    @sio.on('kick_viewer')
    def on_kick_viewer(data):
        room = _room_if_host(data)
        target = data.get('target')
        info = _kickable_target(room, target)
        if info is None:
            return
        client_id = info.get('client_id')
        if client_id:
            pending = room.setdefault('pending', {})
            pending[client_id] = {
                'name': (info.get('name') or 'Viewer')[:32],
                'sid': None,
                'at': _now(),
            }
            room_service.update_room(room['room_id'], {'pending': pending})
        sio.emit('kicked', {'reason': 'The host removed you from the room'}, to=target)
        _notify_host(room, room['room_id'])
        # Disconnecting runs the room's disconnect handler, which drops the viewer
        # from the roster, chat, and any audio call. Flask-SocketIO's top-level
        # object does not expose disconnect(); the underlying server does.
        sio.server.disconnect(target)

    @sio.on('ban_viewer')
    def on_ban_viewer(data):
        room = _room_if_host(data)
        target = data.get('target')
        info = _kickable_target(room, target)
        if info is None:
            return
        _ban(room, info.get('client_id'), info.get('name'))
        sio.emit('banned', {'reason': 'You have been banned from this room'}, to=target)
        _notify_host(room, room['room_id'])
        sio.server.disconnect(target)

    @sio.on('ban_client')
    def on_ban_client(data):
        room = _room_if_host(data)
        client_id = data.get('client_id')
        if not room or not client_id:
            return
        entry = (room.get('pending') or {}).get(client_id) or {}
        waiting_sid = entry.get('sid')
        _ban(room, client_id, entry.get('name'))
        if waiting_sid:
            WAITING.pop(waiting_sid, None)
            sio.emit('banned', {'reason': 'You have been banned from this room'}, to=waiting_sid)
            sio.server.disconnect(waiting_sid)
        _notify_host(room, room['room_id'])

    @sio.on('approve_viewer')
    def on_approve_viewer(data):
        room = _room_if_host(data)
        client_id = data.get('client_id')
        if not room or not client_id:
            return
        pending = room.get('pending', {})
        entry = pending.pop(client_id, None)
        room_service.update_room(room['room_id'], {'pending': pending})
        _notify_host(room, room['room_id'])
        if not entry:
            return
        waiting_sid = entry.get('sid')
        if waiting_sid and WAITING.pop(waiting_sid, None):
            from .rooms import _admit
            _admit(waiting_sid, room['room_id'], entry.get('name'), client_id, is_host=False)


def _room_if_host(data):
    """Validate host authority, returning the room or None (emits an error)."""
    room_id = data.get('room_id')
    if not room_service.is_host(room_id, data.get('token')) or not registry.is_host_sid(request.sid):
        emit('error', {'message': 'Only the host can moderate viewers'})
        return None
    return room_service.get_room(room_id)


def _kickable_target(room, target):
    """Validate acting on an active viewer; returns its registry info or None."""
    if not room or not target or target == request.sid:
        return None
    if registry.get_room_id(target) != room.get('room_id'):
        return None
    info = registry.get_sid_info(target) or {}
    if info.get('is_host'):
        return None
    return info


def _ban(room, client_id, name):
    if not client_id:
        return
    banned = room.setdefault('banned', {})
    banned[client_id] = {
        'name': (name or banned.get(client_id, {}).get('name') or 'Viewer')[:32],
        'at': _now(),
    }
    pending = room.get('pending', {})
    if client_id in pending:
        del pending[client_id]
    room_service.update_room(room['room_id'], {'banned': banned, 'pending': pending})
