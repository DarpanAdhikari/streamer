from flask_socketio import emit, join_room, leave_room
from flask import request
from ..services import room_service
from . import registry, chat

socketio = None


def register_rooms_events(sio):
    global socketio
    socketio = sio

    @sio.on('join')
    def on_join(data):
        room_id = data.get('room_id')
        token = data.get('token')
        name = data.get('name')
        room = room_service.get_room(room_id)
        if not room:
            emit('error', {'message': 'Room not found'})
            return
        wants_host = room_service.is_host(room_id, token)
        participants = room.setdefault('participants', {})
        host_sid = room.get('host_sid')
        host_present = bool(host_sid) and host_sid in participants
        is_host = wants_host and (not host_present or host_sid == request.sid)
        if is_host:
            room['host_sid'] = request.sid

        join_room(room_id)
        registry.set_sid(request.sid, room_id, is_host, name)

        participants[request.sid] = {'is_host': is_host}
        room_service.update_room(room_id, {'participants': participants, 'host_sid': room.get('host_sid')})

        emit('joined', {
            'room_id': room_id,
            'sid': request.sid,
            'is_host': is_host,
            'playback_state': room.get('playback_state'),
            'media': room.get('media'),
            'queue': room.get('queue', []),
            'current_index': room.get('current_index', 0),
            'mode': room.get('mode', 'media'),
            'screen_share': room.get('screen_share', {'active': False}),
            'subtitles': room.get('subtitles', {'cues': [], 'delay': 0}),
            'picture': room.get('picture', room_service.DEFAULT_PICTURE),
            'chat': room.get('chat', []),
            'participant_count': len(participants)
        })
        sio.emit('participants_update', {'count': len(participants)}, to=room_id)
        chat.notify_system(room_id, '{name} joined', name)

    @sio.on('leave')
    def on_leave(data):
        room_id = data.get('room_id')
        _cleanup_participant(request.sid, room_id)
        leave_room(room_id)

    @sio.on('disconnect')
    def on_disconnect():
        sid = request.sid
        info = registry.remove_sid(sid)
        if not info:
            return
        room_id = info['room_id']
        _cleanup_participant(sid, room_id, info.get('name'))
        room = room_service.get_room(room_id)
        if not room:
            return

        if room.get('host_sid') == sid:
            room['host_sid'] = None
            room_service.update_room(room_id, {'host_sid': None})

        # If the host leaves while screen sharing, stop the session for everyone.
        share = room.get('screen_share', {})
        if share.get('active') and share.get('host_sid') == sid:
            room['screen_share'] = {'active': False, 'host_sid': None, 'source': None}
            room['mode'] = 'media'
            room_service.update_room(room_id, {
                'screen_share': room['screen_share'], 'mode': room['mode']
            })
            sio.emit('ss_status', {'active': False, 'reason': 'host_left'}, to=room_id)

        if info.get('is_host'):
            sio.emit('host_left', {}, to=room_id)


def _cleanup_participant(sid, room_id, name=None):
    room = room_service.get_room(room_id)
    if not room:
        return
    participants = room.get('participants', {})
    if sid in participants:
        if name is None:
            name = registry.get_name(sid)
        del participants[sid]
        room_service.update_room(room_id, {'participants': participants})
        if socketio:
            socketio.emit('participants_update', {'count': len(participants)}, to=room_id)
        chat.notify_system(room_id, '{name} left', name)
