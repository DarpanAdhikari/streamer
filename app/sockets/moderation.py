"""Host moderation: remove a viewer from the room.

The host can kick any viewer. A kicked viewer is blocked from rejoining for the
lifetime of the room. They are tracked by a browser-local client id rather than
IP address, so other viewers behind the same network are unaffected. See
``README`` for the event reference.
"""
from flask import request
from flask_socketio import emit

from ..services import room_service
from . import registry

socketio = None


def register_moderation_events(sio):
    global socketio
    socketio = sio

    @sio.on('kick_viewer')
    def on_kick_viewer(data):
        room_id = data.get('room_id')
        target = data.get('target')
        # Only the connection that currently holds the host role may kick; a
        # duplicated host-token tab demoted to viewer must not be able to.
        if not room_service.is_host(room_id, data.get('token')) or not registry.is_host_sid(request.sid):
            emit('error', {'message': 'Only the host can remove viewers'})
            return
        room = room_service.get_room(room_id)
        if not room or not target:
            return
        if target == request.sid or registry.get_room_id(target) != room_id:
            return
        info = registry.get_sid_info(target) or {}
        if info.get('is_host'):
            return

        client_id = info.get('client_id')
        if client_id:
            banned = room.get('banned') or {}
            banned[client_id] = True
            room_service.update_room(room_id, {'banned': banned})

        sio.emit('kicked', {'reason': 'The host removed you from the room'}, to=target)
        # Disconnect triggers the room's disconnect handler, which drops the
        # viewer from the roster, the chat, and any audio call. Flask-SocketIO's
        # top-level object does not expose disconnect(); the underlying server does.
        sio.server.disconnect(target)
