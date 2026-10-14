import unittest

from app import create_app, socketio
from app.services import room_service


def join(client, room_id, token=None, name=None, client_id=None):
    payload = {'room_id': room_id, 'token': token, 'name': name}
    if client_id is not None:
        payload['client_id'] = client_id
    client.emit('join', payload)
    for msg in client.get_received():
        if msg['name'] == 'joined':
            return msg['args'][0]
    return None


def events(client, name):
    return [m['args'][0] for m in client.get_received() if m['name'] == name]


def queued(client, name):
    # After a server-side disconnect the test client refuses get_received(), but
    # the packet is still in its internal queue.
    return [p for p in getattr(client, 'queue', []) if p.get('name') == name]


def participants_of(room_id):
    return room_service.get_room(room_id)['participants']


class ModerationSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def _room(self, viewer_client_id='viewer-cid'):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        host_sid = join(host, room_id, host_token, name='Host PC', client_id='host-cid')['sid']
        viewer = socketio.test_client(self.app)
        viewer_sid = join(viewer, room_id, name='Viewer PC', client_id=viewer_client_id)['sid']
        host.get_received()
        viewer.get_received()
        return room_id, host_token, host, host_sid, viewer, viewer_sid

    def test_host_kicks_viewer(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room()

        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})

        self.assertTrue(queued(viewer, 'kicked'))
        self.assertFalse(viewer.is_connected())
        self.assertNotIn(viewer_sid, participants_of(room_id))

        host.disconnect()
        if viewer.is_connected():
            viewer.disconnect()

    def test_non_host_cannot_kick(self):
        room_id, _host_token, host, host_sid, viewer, viewer_sid = self._room()

        viewer.emit('kick_viewer', {'room_id': room_id, 'token': None, 'target': host_sid})
        self.assertTrue([m for m in viewer.get_received() if m['name'] == 'error'])

        # A duplicated host-token connection demoted to viewer is not the host.
        dup = socketio.test_client(self.app)
        info = join(dup, room_id, _host_token, name='Dup', client_id='dup-cid')
        self.assertFalse(info['is_host'])
        dup.get_received()
        dup.emit('kick_viewer', {'room_id': room_id, 'token': _host_token, 'target': viewer_sid})
        self.assertTrue([m for m in dup.get_received() if m['name'] == 'error'])
        self.assertIn(viewer_sid, participants_of(room_id))

        host.disconnect()
        dup.disconnect()
        viewer.disconnect()

    def test_cannot_kick_the_host(self):
        room_id, host_token, host, host_sid, viewer, _viewer_sid = self._room()

        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': host_sid})

        self.assertIn(host_sid, participants_of(room_id))
        self.assertFalse(events(host, 'kicked'))

        host.disconnect()
        viewer.disconnect()

    def test_kicked_client_id_cannot_rejoin(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')

        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()

        rejoiner = socketio.test_client(self.app)
        rejoiner.emit('join', {'room_id': room_id, 'name': 'Rejoiner', 'client_id': 'repeat-cid'})
        received = rejoiner.get_received()
        self.assertFalse(any(m['name'] == 'joined' for m in received))
        self.assertTrue(any(m['name'] == 'kicked' for m in received))
        self.assertEqual(len(participants_of(room_id)), 1)

        host.disconnect()
        rejoiner.disconnect()
        if viewer.is_connected():
            viewer.disconnect()

    def test_kick_removes_viewer_from_audio_call(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room()

        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()
        self.assertIn(viewer_sid, room_service.get_room(room_id)['audio_call']['participants'])

        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})

        call = room_service.get_room(room_id)['audio_call']
        self.assertNotIn(viewer_sid, call['participants'])
        self.assertIn(host_sid, call['participants'])

        host.disconnect()
        if viewer.is_connected():
            viewer.disconnect()

    def test_roster_is_sent_on_join(self):
        room_id, _host_token, host, host_sid, viewer, viewer_sid = self._room()
        new = socketio.test_client(self.app)
        info = join(new, room_id, name='New', client_id='new-cid')

        self.assertEqual(len(info['participants']), 3)
        names = {p['name'] for p in info['participants']}
        self.assertIn('Host PC', names)
        self.assertEqual(sum(1 for p in info['participants'] if p['is_host']), 1)

        host.disconnect()
        viewer.disconnect()
        new.disconnect()


if __name__ == '__main__':
    unittest.main()
