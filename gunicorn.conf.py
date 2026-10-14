import os

# Render runs `gunicorn app:app` by default and ignores render.yaml / a Procfile
# when the service has an explicit start command. Gunicorn auto-loads this file
# from the working directory, so production settings live here.
#
# NOTE: deliberately no monkey patch here. The gevent worker patches the stdlib
# in `init_process()` (after fork, before importing the app), which avoids
# patching gunicorn's master sockets.
os.environ.setdefault('SOCKETIO_ASYNC_MODE', 'gevent')
os.environ.setdefault('FLASK_DEBUG', 'False')
os.environ.setdefault('ROOMS_FILE', '')
os.environ.setdefault('ROOM_EXPIRY_HOURS', '24')

worker_class = 'geventwebsocket.gunicorn.workers.GeventWebSocketWorker'
workers = 1
timeout = 120
