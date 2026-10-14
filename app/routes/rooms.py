import os
from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from ..services import room_service, rate_limit

rooms_bp = Blueprint('rooms', __name__)

CREATE_RATE_LIMIT = 20       # rooms
CREATE_RATE_WINDOW = 60      # seconds


@rooms_bp.route('/api/webrtc/config')
def webrtc_config():
    ice_servers = []
    stun = os.environ.get('STUN_URL', 'stun:stun.l.google.com:19302')
    if stun:
        ice_servers.append({'urls': stun})
    turn_url = os.environ.get('TURN_URL')
    if turn_url:
        turn = {'urls': turn_url}
        if os.environ.get('TURN_USERNAME'):
            turn['username'] = os.environ['TURN_USERNAME']
        if os.environ.get('TURN_CREDENTIAL'):
            turn['credential'] = os.environ['TURN_CREDENTIAL']
        ice_servers.append(turn)
    return jsonify({'iceServers': ice_servers})


@rooms_bp.route('/')
def index():
    return render_template('index.html')


@rooms_bp.route('/healthz')
def healthz():
    """Cheap liveness endpoint; also handy as an uptime-ping target to keep a
    free host from sleeping (see README)."""
    return jsonify({'status': 'ok'})


@rooms_bp.route('/create', methods=['POST'])
def create():
    client_ip = request.remote_addr or 'unknown'
    if not rate_limit.is_allowed('create:' + client_ip, CREATE_RATE_LIMIT, CREATE_RATE_WINDOW):
        return jsonify({'error': 'Too many rooms created, try again later'}), 429
    data = request.get_json(silent=True) or {}
    password = data.get('password') if data.get('password') else None
    room_id, host_token = room_service.create_room(password=password)
    return jsonify({'room_id': room_id, 'host_token': host_token, 'link': url_for('rooms.room', room_id=room_id, _external=True)})


@rooms_bp.route('/room/<room_id>', methods=['GET', 'POST'])
def room(room_id):
    room = room_service.get_room(room_id)
    if not room:
        return render_template('expired.html', room_id=room_id), 404
    password = request.form.get('password') if request.method == 'POST' else None
    if room.get('password') and password != room.get('password'):
        return render_template('index.html', error='Invalid password'), 403
    return render_template('room.html', room_id=room_id)
