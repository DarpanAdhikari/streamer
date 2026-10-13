import os


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key')
    ROOM_EXPIRY_HOURS = float(os.environ.get('ROOM_EXPIRY_HOURS', 24))
    SOCKETIO_ASYNC_MODE = os.environ.get('SOCKETIO_ASYNC_MODE', 'eventlet')
