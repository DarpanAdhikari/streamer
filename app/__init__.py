import mimetypes
import os

from flask import Flask
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

# Browsers require correct MIME types for ES modules and WebAssembly.
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')

socketio = SocketIO(cors_allowed_origins="*")


def _asset_version(app):
    """Newest mtime among the app's own JS/CSS, used to cache-bust static URLs."""
    latest = 0
    for sub in ('js', 'css'):
        folder = os.path.join(app.static_folder, sub)
        try:
            for name in os.listdir(folder):
                if name.endswith(('.js', '.mjs', '.css')):
                    latest = max(latest, os.path.getmtime(os.path.join(folder, name)))
        except OSError:
            pass
    return str(int(latest))


def create_app(config_class=None):
    app = Flask(__name__, template_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates'),
                static_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static'))
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')
    app.config['DEBUG'] = os.environ.get('FLASK_DEBUG', 'True').lower() == 'true'
    # Never let a browser cache templates or static assets during development.
    app.config['TEMPLATES_AUTO_RELOAD'] = app.config['DEBUG']
    # Static URLs are versioned with ?v=ASSET_VERSION, so production can cache
    # them aggressively; development must always revalidate.
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0 if app.config['DEBUG'] else 31536000
    app.config['ASSET_VERSION'] = _asset_version(app)

    # Trust the reverse proxy (Render/Railway/etc.) one hop deep so that
    # request.url / remote_addr reflect the real scheme, host, and client IP
    # (needed for correct https share links and for rate limiting).
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @app.context_processor
    def _inject_asset_version():
        return {'ASSET_VERSION': app.config['ASSET_VERSION']}

    from .routes.rooms import rooms_bp
    app.register_blueprint(rooms_bp)

    from .sockets.rooms import register_rooms_events
    from .sockets.playback import register_playback_events
    from .sockets.screen_share import register_screen_share_events
    register_rooms_events(socketio)
    register_playback_events(socketio)
    register_screen_share_events(socketio)

    socketio.init_app(app, async_mode=os.environ.get('SOCKETIO_ASYNC_MODE', 'eventlet'),
                      cors_allowed_origins="*")

    return app
