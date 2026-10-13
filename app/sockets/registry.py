"""In-memory registry mapping Socket.IO session ids to room membership.

Used by WebRTC signaling to validate that a requested signal target is a
member of the same room as the sender.
"""
import threading

_LOCK = threading.Lock()
_SID_INFO = {}


def set_sid(sid, room_id, is_host=False):
    with _LOCK:
        _SID_INFO[sid] = {'room_id': room_id, 'is_host': is_host}


def remove_sid(sid):
    with _LOCK:
        return _SID_INFO.pop(sid, None)


def get_sid_info(sid):
    with _LOCK:
        return _SID_INFO.get(sid)


def get_room_id(sid):
    info = get_sid_info(sid)
    return info['room_id'] if info else None


def is_host_sid(sid):
    info = get_sid_info(sid)
    return bool(info and info['is_host'])


def sids_in_room(room_id):
    with _LOCK:
        return [sid for sid, info in _SID_INFO.items() if info['room_id'] == room_id]
