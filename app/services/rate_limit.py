"""Minimal in-memory rate limiter.

Suitable for a single-process dev/small deployment. For multi-worker or
production use, back this with Redis (e.g. flask-limiter) instead.
"""
import threading
import time

_LOCK = threading.Lock()
_BUCKETS = {}


def _prune(bucket, window, now):
    cutoff = now - window
    while bucket and bucket[0][0] < cutoff:
        bucket.pop(0)


def is_allowed(key, limit, window):
    """Return True if `key` has made fewer than `limit` calls in `window` seconds."""
    now = time.time()
    with _LOCK:
        bucket = _BUCKETS.setdefault(key, [])
        _prune(bucket, window, now)
        if len(bucket) >= limit:
            return False
        bucket.append((now, 1))
        return True


def reset():
    with _LOCK:
        _BUCKETS.clear()
