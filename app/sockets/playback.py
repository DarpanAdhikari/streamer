from flask_socketio import emit
from ..services import room_service
from datetime import datetime
import uuid

socketio = None

DEFAULT_PERMISSIONS = {
    'allow_viewer_control': False,
    'allow_viewer_seek': False
}


def _now():
    return datetime.utcnow().timestamp()


def _authorize(room_id, token, action):
    """Return the room dict if the request is permitted, else None.

    action is one of: 'host', 'control', 'seek'.
    Hosts are always allowed. Viewers are allowed based on room permissions.
    """
    room = room_service.get_room(room_id)
    if not room:
        return None
    if room_service.is_host(room_id, token):
        return room
    perms = room.get('playback_state', {}).get('host_permissions', DEFAULT_PERMISSIONS)
    if action == 'control' and perms.get('allow_viewer_control'):
        return room
    if action == 'seek' and perms.get('allow_viewer_seek'):
        return room
    return None


def _persist_state(room_id, room):
    room['playback_state']['updated_at'] = _now()
    room_service.update_room(room_id, {'playback_state': room['playback_state']})


def _current_media(room):
    queue = room.get('queue', [])
    idx = room.get('current_index', 0)
    if 0 <= idx < len(queue):
        return queue[idx]
    return room.get('media')


def _load_media(room_id, room, index):
    queue = room.get('queue', [])
    if not (0 <= index < len(queue)):
        return False
    room['current_index'] = index
    media = queue[index]
    room['media'] = media
    room['playback_state']['media_id'] = media.get('media_id')
    room['playback_state']['position'] = 0
    room['playback_state']['playing'] = False
    _persist_state(room_id, room)
    room_service.update_room(room_id, {
        'media': room['media'],
        'current_index': index,
        'playback_state': room['playback_state']
    })
    emit('media_change', {
        'media': media,
        'current_index': index,
        'queue': queue,
        'playback_state': room['playback_state']
    }, to=room_id)
    return True


def _queue_update(room_id, room):
    room_service.update_room(room_id, {'queue': room.get('queue', []), 'current_index': room.get('current_index', 0)})
    emit('queue_update', {'queue': room.get('queue', []), 'current_index': room.get('current_index', 0)}, to=room_id)


def register_playback_events(sio):
    global socketio
    socketio = sio

    @sio.on('play')
    def on_play(data):
        room_id = data.get('room_id')
        token = data.get('token')
        room = _authorize(room_id, token, 'control')
        if not room:
            emit('error', {'message': 'Unauthorized'})
            return
        room['playback_state']['playing'] = True
        _persist_state(room_id, room)
        emit('playback_update', {'state': room['playback_state']}, to=room_id)

    @sio.on('pause')
    def on_pause(data):
        room_id = data.get('room_id')
        token = data.get('token')
        room = _authorize(room_id, token, 'control')
        if not room:
            emit('error', {'message': 'Unauthorized'})
            return
        room['playback_state']['playing'] = False
        _persist_state(room_id, room)
        emit('playback_update', {'state': room['playback_state']}, to=room_id)

    @sio.on('seek')
    def on_seek(data):
        room_id = data.get('room_id')
        token = data.get('token')
        position = data.get('position', 0)
        room = _authorize(room_id, token, 'seek')
        if not room:
            emit('error', {'message': 'Unauthorized'})
            return
        try:
            room['playback_state']['position'] = max(0.0, float(position))
        except (TypeError, ValueError):
            return
        _persist_state(room_id, room)
        emit('playback_update', {'state': room['playback_state']}, to=room_id)

    @sio.on('sync_request')
    def on_sync_request(data):
        room_id = data.get('room_id')
        room = room_service.get_room(room_id)
        if not room:
            return
        emit('playback_update', {'state': room['playback_state']})

    @sio.on('state_update')
    def on_state_update(data):
        room_id = data.get('room_id')
        token = data.get('token')
        state = data.get('state', {})
        if not room_service.is_host(room_id, token):
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        allowed_keys = {'playing', 'position', 'playback_speed', 'media_id'}
        for key in allowed_keys:
            if key in state:
                room['playback_state'][key] = state[key]
        _persist_state(room_id, room)
        emit('playback_update', {'state': room['playback_state']}, to=room_id)

    @sio.on('picture_update')
    def on_picture_update(data):
        """Host-published picture adjustments (brightness/zoom/rotate/…).

        Only the host may publish; every client (host included) applies the
        values locally as CSS. Viewers may override locally, but the next host
        update re-syncs everyone.
        """
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        picture = room.setdefault('picture', dict(room_service.DEFAULT_PICTURE))
        incoming = data.get('picture') or {}
        for key in room_service.DEFAULT_PICTURE:
            if key in incoming:
                picture[key] = incoming[key]
        room_service.update_room(room_id, {'picture': picture})
        emit('picture_update', {'picture': picture}, to=room_id)

    @sio.on('set_permissions')
    def on_set_permissions(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        perms = room['playback_state'].setdefault('host_permissions', dict(DEFAULT_PERMISSIONS))
        for key in DEFAULT_PERMISSIONS:
            if key in data.get('permissions', {}):
                perms[key] = bool(data['permissions'][key])
        room_service.update_room(room_id, {'playback_state': room['playback_state']})
        emit('permissions_update', {'host_permissions': perms}, to=room_id)

    @sio.on('subtitle_set')
    def on_subtitle_set(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        cues = data.get('cues') or []
        try:
            delay = float(data.get('delay', 0))
        except (TypeError, ValueError):
            delay = 0
        room['subtitles'] = {'cues': cues, 'delay': delay}
        room_service.update_room(room_id, {'subtitles': room['subtitles']})
        emit('subtitle_set', {'cues': cues, 'delay': delay}, to=room_id)

    @sio.on('subtitle_off')
    def on_subtitle_off(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        room['subtitles'] = {'cues': [], 'delay': 0}
        room_service.update_room(room_id, {'subtitles': room['subtitles']})
        emit('subtitle_set', {'cues': [], 'delay': 0}, to=room_id)

    @sio.on('media_add')
    def on_media_add(data):
        """Host opened a local file: store metadata only (no bytes are uploaded).

        The host streams the actual media peer-to-peer via broadcast.js; the
        server only relays this metadata so viewers see the title/playlist.
        """
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        media = data.get('media') or {}
        if not media.get('filename'):
            return
        item = {
            'media_id': str(uuid.uuid4())[:8],
            'filename': media['filename'],
            'duration': media.get('duration') or 0,
            'size': media.get('size') or 0,
        }
        queue = room.setdefault('queue', [])
        queue.append(item)
        _queue_update(room_id, room)
        _load_media(room_id, room, len(queue) - 1)

    @sio.on('media_next')
    def on_media_next(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        _load_media(room_id, room, room.get('current_index', 0) + 1)

    @sio.on('media_prev')
    def on_media_prev(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        _load_media(room_id, room, room.get('current_index', 0) - 1)

    @sio.on('media_select')
    def on_media_select(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        try:
            index = int(data.get('index', -1))
        except (TypeError, ValueError):
            return
        _load_media(room_id, room, index)

    @sio.on('media_remove')
    def on_media_remove(data):
        room_id = data.get('room_id')
        token = data.get('token')
        if not room_service.is_host(room_id, token):
            emit('error', {'message': 'Unauthorized'})
            return
        room = room_service.get_room(room_id)
        if not room:
            return
        try:
            index = int(data.get('index', -1))
        except (TypeError, ValueError):
            return
        queue = room.get('queue', [])
        if not (0 <= index < len(queue)):
            return
        removed_current = (index == room.get('current_index', 0))
        queue.pop(index)
        room['queue'] = queue
        if removed_current and queue:
            new_index = min(index, len(queue) - 1)
            _queue_update(room_id, room)
            _load_media(room_id, room, new_index)
            return
        if not queue:
            room['current_index'] = 0
            room['media'] = None
            room['playback_state']['media_id'] = None
            room['playback_state']['position'] = 0
            room['playback_state']['playing'] = False
            room_service.update_room(room_id, {
                'media': None,
                'playback_state': room['playback_state']
            })
            emit('media_change', {'media': None, 'current_index': 0, 'queue': [], 'playback_state': room['playback_state']}, to=room_id)
            _queue_update(room_id, room)
            return
        if index < room.get('current_index', 0):
            room['current_index'] = max(0, room.get('current_index', 0) - 1)
        _queue_update(room_id, room)
