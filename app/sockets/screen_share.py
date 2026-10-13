"""WebRTC screen-sharing signaling.

The server relays SDP offers/answers and ICE candidates between the host and
each viewer, and tracks the authoritative share status per room. It never
handles media itself. For large rooms an SFU (e.g. LiveKit) should replace the
mesh relay; see README.
"""
from flask_socketio import emit
from flask import request
from ..services import room_service
from . import registry

socketio = None


def register_screen_share_events(sio):
    global socketio
    socketio = sio

    @sio.on('ss_start')
    def on_ss_start(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        # source is 'screen' (getDisplayMedia) or 'video' (host's local media element).
        source = data.get('source') if data.get('source') in ('screen', 'video') else 'screen'
        has_audio = bool(data.get('has_audio'))
        room['mode'] = 'screen' if source == 'screen' else 'media'
        room['screen_share'] = {'active': True, 'host_sid': request.sid, 'source': source, 'has_audio': has_audio}
        room_service.update_room(room_id, {'mode': room['mode'], 'screen_share': room['screen_share']})
        emit('ss_status', {'active': True, 'host_sid': request.sid, 'source': source, 'has_audio': has_audio}, to=room_id)

    @sio.on('ss_stop')
    def on_ss_stop(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        _end_share(room_id, reason='host_stopped')

    @sio.on('ss_viewer_ready')
    def on_ss_viewer_ready(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room:
            return
        host_sid = room.get('screen_share', {}).get('host_sid')
        if not host_sid:
            return
        sio.emit('ss_viewer_ready', {'viewer_sid': request.sid}, to=host_sid)

    @sio.on('ss_offer')
    def on_ss_offer(data):
        if not registry.is_host_sid(request.sid):
            emit('error', {'message': 'Unauthorized'})
            return
        target = data.get('target')
        if not _same_room(target):
            return
        sio.emit('ss_offer', {'sdp': data.get('sdp'), 'from': request.sid}, to=target)

    @sio.on('ss_answer')
    def on_ss_answer(data):
        target = data.get('target')
        if not _same_room(target):
            return
        if not registry.is_host_sid(target):
            return
        sio.emit('ss_answer', {'sdp': data.get('sdp'), 'from': request.sid}, to=target)

    @sio.on('ss_ice')
    def on_ss_ice(data):
        target = data.get('target')
        if not _same_room(target):
            return
        sio.emit('ss_ice', {'candidate': data.get('candidate'), 'from': request.sid}, to=target)


def _same_room(target_sid):
    if not target_sid:
        return False
    return registry.get_room_id(target_sid) == registry.get_room_id(request.sid)


def _end_share(room_id, reason='host_stopped'):
    room = room_service.get_room(room_id)
    if not room:
        return
    room['screen_share'] = {'active': False, 'host_sid': None, 'source': None}
    room['mode'] = 'media'
    room_service.update_room(room_id, {'screen_share': room['screen_share'], 'mode': room['mode']})
    socketio.emit('ss_status', {'active': False, 'reason': reason}, to=room_id)
