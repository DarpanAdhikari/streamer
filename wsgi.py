"""WSGI entrypoint for production servers (gunicorn on Render).

Gunicorn's ``app:app`` is ambiguous here: the repo root contains *both* the
``app/`` package and ``app.py``, and the package shadows the module, so the
lookup for a top-level ``app`` fails. This module is the unambiguous target:

    gunicorn ... wsgi:app

It also performs the async-mode monkey patch (mirroring ``app.py``) *before*
importing the application, which gevent/eventlet require.
"""

import os

_ASYNC_MODE = os.environ.get('SOCKETIO_ASYNC_MODE', 'eventlet')
if _ASYNC_MODE == 'eventlet':
    import eventlet

    eventlet.monkey_patch()
elif _ASYNC_MODE == 'gevent':
    from gevent import monkey

    monkey.patch_all()

from app import create_app, socketio  # noqa: E402

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
