import os

# Patch the standard library for the selected async mode *before* importing the
# application so that blocking calls (sockets, file I/O) cooperate with the event
# loop instead of stalling it.
_ASYNC_MODE = os.environ.get('SOCKETIO_ASYNC_MODE', 'eventlet')
if _ASYNC_MODE == 'eventlet':
    import eventlet

    eventlet.monkey_patch()
elif _ASYNC_MODE == 'gevent':
    from gevent import monkey

    monkey.patch_all()

from app import create_app, socketio  # noqa: E402

app = create_app()


def _acquire_single_instance_lock(port):
    """Refuse to start if another server instance already owns this port.

    eventlet enables SO_REUSEPORT by default, so a second `python app.py`
    would silently co-bind the port. The kernel would then load-balance
    requests across both processes, but Socket.IO sessions and in-memory
    room/participant state are per-process, so viewers would miss media
    updates and participant counts would reset. Fail loudly instead.
    """
    import fcntl
    lock_name = '.server.%d.lock' % port
    lock_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), lock_name)
    handle = open(lock_path, 'w')
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('ERROR: another watch-party server is already running on this port.\n'
              'Stop the existing server first — in-memory room state cannot be shared\n'
              'across processes, so running two servers breaks streaming for viewers.')
        import sys
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    # The Werkzeug reloader re-executes this file: the parent never serves,
    # only the child (WERKZEUG_RUN_MAIN=true) holds the port.
    _SERVING = os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.config['DEBUG']
    _lock = _acquire_single_instance_lock(port) if _SERVING else None
    socketio.run(app, host='0.0.0.0', port=port, debug=app.config['DEBUG'])
