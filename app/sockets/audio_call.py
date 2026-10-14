"""Room-wide peer-to-peer audio call signaling.

Participants connect to each other directly (a full mesh), so the server never
handles audio. It only tracks who is in the call and relays SDP offers/answers
and ICE candidates between them.

A call can outlive the host: if the host hangs up or disconnects, whoever is
left keeps talking over their direct connections. The call only ends when the
last participant leaves, the host explicitly ends it for everyone, or the room
expires. See ``README`` for the event reference.
"""
import time

from flask import request
from flask_socketio import emit

from ..services import room_service
from . import registry

socketio = None


def _now_ms():
    return int(time.time() * 1000)


def _empty_call():
    return {'active': False, 'started_by': None, 'started_at': None, 'participants': {}}


def _call(room):
    return room.setdefault('audio_call', _empty_call())


def _name_for(room_id, sid, name=None):
    name = (name or registry.get_name(sid) or '').strip()
    if name:
        return name[:32]
    return 'Host' if registry.is_host_sid(sid) else 'Viewer'


def _participant_list(call):
    return [
        {
            'sid': sid,
            'name': p.get('name'),
            'muted': bool(p.get('muted')),
            'joined_at': p.get('joined_at'),
        }
        for sid, p in call['participants'].items()
    ]


def _broadcast_state(room_id, room):
    if not socketio:
        return
    socketio.emit('ac_state', state_payload(room), to=room_id)


def state_payload(room):
    """Public, JSON-friendly call state (participants as a list)."""
    call = _call(room)
    return {
        'active': call['active'],
        'started_by': call.get('started_by'),
        'started_at': call.get('started_at'),
        'participants': _participant_list(call),
    }


def _in_room(room_id):
    return bool(room_id) and registry.get_room_id(request.sid) == room_id


def register_audio_call_events(sio):
    global socketio
    socketio = sio

    @sio.on('ac_start')
    def on_ac_start(data):
        room_id = data.get('room_id')
        if not room_service.is_host(room_id, data.get('token')):
            emit('error', {'message': 'Only the host can start a call'})
            return
        room = room_service.get_room(room_id)
        if not room or not _in_room(room_id):
            return
        call = _call(room)
        if not call['active']:
            call.update({'active': True, 'started_by': request.sid, 'started_at': _now_ms(), 'participants': {}})
        call['participants'][request.sid] = {
            'name': _name_for(room_id, request.sid, data.get('name')),
            'muted': False,
            'joined_at': _now_ms(),
        }
        room_service.update_room(room_id, {'audio_call': call})
        sio.emit('ac_invite', {
            'started_by': request.sid,
            'name': _name_for(room_id, request.sid, data.get('name')),
        }, to=room_id)
        _broadcast_state(room_id, room)

    @sio.on('ac_accept')
    def on_ac_accept(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room or not _in_room(room_id):
            return
        call = _call(room)
        if not call['active']:
            return
        call['participants'][request.sid] = {
            'name': _name_for(room_id, request.sid, data.get('name')),
            'muted': False,
            'joined_at': _now_ms(),
        }
        room_service.update_room(room_id, {'audio_call': call})
        _broadcast_state(room_id, room)

    @sio.on('ac_decline')
    def on_ac_decline(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room:
            return
        host_sid = _call(room).get('started_by')
        if host_sid:
            sio.emit('ac_declined', {
                'sid': request.sid,
                'name': _name_for(room_id, request.sid),
            }, to=host_sid)

    @sio.on('ac_leave')
    def on_ac_leave(data):
        _leave(data.get('room_id'), request.sid)

    @sio.on('ac_end')
    def on_ac_end(data):
        room_id = data.get('room_id')
        if not room_service.is_host(room_id, data.get('token')):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        call = _call(room)
        call.update(_empty_call())
        room_service.update_room(room_id, {'audio_call': call})
        sio.emit('ac_ended', {'reason': 'host_ended'}, to=room_id)
        _broadcast_state(room_id, room)

    @sio.on('ac_mute')
    def on_ac_mute(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room:
            return
        call = _call(room)
        participant = call['participants'].get(request.sid)
        if not participant:
            return
        participant['muted'] = bool(data.get('muted'))
        room_service.update_room(room_id, {'audio_call': call})
        _broadcast_state(room_id, room)

    @sio.on('ac_offer')
    def on_ac_offer(data):
        _relay('ac_offer', data)

    @sio.on('ac_answer')
    def on_ac_answer(data):
        _relay('ac_answer', data)

    @sio.on('ac_ice')
    def on_ac_ice(data):
        _relay('ac_ice', data)


def _relay(event, data):
    target = data.get('target')
    room_id = registry.get_room_id(request.sid)
    if not target or not room_id or registry.get_room_id(target) != room_id:
        return
    room = room_service.get_room(room_id)
    if not room:
        return
    participants = _call(room)['participants']
    # Only peers that are both currently in the call may exchange signaling.
    if request.sid not in participants or target not in participants:
        return
    payload = {'from': request.sid}
    if event == 'ac_ice':
        payload['candidate'] = data.get('candidate')
    else:
        payload['sdp'] = data.get('sdp')
    socketio.emit(event, payload, to=target)


def _leave(room_id, sid):
    room = room_service.get_room(room_id)
    if not room:
        return
    call = _call(room)
    if sid not in call['participants']:
        return
    del call['participants'][sid]
    if not call['participants']:
        call.update(_empty_call())
    room_service.update_room(room_id, {'audio_call': call})
    if socketio:
        socketio.emit('ac_state', state_payload(room), to=room_id)
        if not call['active']:
            socketio.emit('ac_ended', {'reason': 'empty'}, to=room_id)


def handle_disconnect(room_id, sid):
    """Remove a disconnected user from the call without ending it for others."""
    _leave(room_id, sid)
