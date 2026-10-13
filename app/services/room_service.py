import uuid
import secrets
import json
import os
from datetime import datetime, timedelta
import threading

_LOCK = threading.Lock()
_DEFAULT_ROOMS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'rooms.json')
# ROOMS_FILE may be set to an empty string to keep rooms in memory only. On
# ephemeral hosts (e.g. Render) disk persistence is pointless and every
# state update would otherwise write a large file.
_ROOMS_FILE = os.environ.get('ROOMS_FILE', _DEFAULT_ROOMS_FILE)
_ROOMS_PERSIST = bool(_ROOMS_FILE)
_ROOMS = {}

ROOM_EXPIRY_HOURS = float(os.environ.get('ROOM_EXPIRY_HOURS', 24))

# Host-authoritative picture settings, broadcast to the room over Socket.IO.
# Every client applies them locally as CSS filters/transforms (captureStream()
# does not capture CSS, so the host's own view is adjusted too, not the stream).
DEFAULT_PICTURE = {
    'brightness': 1.0,
    'contrast': 1.0,
    'saturation': 1.0,
    'hue': 0.0,
    'zoom': 1.0,
    'rotate': 0,
    'flip_h': False,
    'aspect': 'fit',
}


def _load_rooms():
    global _ROOMS
    _ROOMS = {}
    if not _ROOMS_PERSIST or not os.path.exists(_ROOMS_FILE):
        return
    try:
        with open(_ROOMS_FILE, 'r') as f:
            _ROOMS = json.load(f)
    except Exception:
        _ROOMS = {}


def _save_rooms():
    if not _ROOMS_PERSIST:
        return
    with open(_ROOMS_FILE, 'w') as f:
        json.dump(_ROOMS, f)


_load_rooms()


def create_room(password=None):
    with _LOCK:
        room_id = str(uuid.uuid4())[:8]
        while room_id in _ROOMS:
            room_id = str(uuid.uuid4())[:8]
        host_token = secrets.token_urlsafe(32)
        _ROOMS[room_id] = {
            'room_id': room_id,
            'host_token': host_token,
            'password': password,
            'created_at': datetime.utcnow().isoformat(),
            'expires_at': (datetime.utcnow() + timedelta(hours=ROOM_EXPIRY_HOURS)).isoformat(),
            'participants': {},
            # Socket id of the connection currently acting as host. The host token
            # proves authority, but only one connection per room may be the host so
            # duplicated host tabs fall back to viewers.
            'host_sid': None,
            # Playlist is metadata only; the host streams the actual media peer-to-peer.
            'media': None,
            'queue': [],
            'current_index': 0,
            'mode': 'media',
            'screen_share': {'active': False, 'host_sid': None, 'source': None},
            'subtitles': {'cues': [], 'delay': 0},
            'picture': dict(DEFAULT_PICTURE),
            'playback_state': {
                'playing': False,
                'position': 0,
                'media_id': None,
                'updated_at': datetime.utcnow().timestamp(),
                'playback_speed': 1.0,
                'host_permissions': {
                    'allow_viewer_control': False,
                    'allow_viewer_seek': False
                }
            }
        }
        _save_rooms()
        return room_id, host_token


def get_room(room_id):
    with _LOCK:
        room = _ROOMS.get(room_id)
        if room:
            try:
                expires = datetime.fromisoformat(room['expires_at'])
                if datetime.utcnow() > expires:
                    del _ROOMS[room_id]
                    _save_rooms()
                    return None
            except Exception:
                pass
        return room


def update_room(room_id, updates):
    with _LOCK:
        if room_id in _ROOMS:
            _ROOMS[room_id].update(updates)
            _save_rooms()
            return _ROOMS[room_id]
    return None


def is_host(room_id, token):
    room = get_room(room_id)
    if not room:
        return False
    return bool(token) and room.get('host_token') == token


def all_room_ids():
    with _LOCK:
        return list(_ROOMS.keys())
