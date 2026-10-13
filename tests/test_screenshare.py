import unittest
from app import create_app, socketio
from app.services import room_service


def join(client, room_id, token=None):
    client.emit('join', {'room_id': room_id, 'token': token})
    for msg in client.get_received():
        if msg['name'] == 'joined':
            return msg['args'][0]
    return None


class ScreenShareSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_host_starts_and_viewer_receives_status(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)

        viewer = socketio.test_client(self.app)
        viewer_info = join(viewer, room_id)

        host.emit('ss_start', {'room_id': room_id, 'token': host_token})
        received = [m for m in viewer.get_received() if m['name'] == 'ss_status']
        self.assertTrue(received)
        self.assertTrue(received[-1]['args'][0]['active'])

        room = room_service.get_room(room_id)
        self.assertEqual(room['mode'], 'screen')
        self.assertTrue(room['screen_share']['active'])

        host.disconnect()
        viewer.disconnect()

    def test_viewer_cannot_start_share(self):
        room_id, host_token = room_service.create_room()
        viewer = socketio.test_client(self.app)
        join(viewer, room_id)
        viewer.emit('ss_start', {'room_id': room_id, 'token': None})
        names = [m['name'] for m in viewer.get_received()]
        self.assertIn('error', names)
        viewer.disconnect()

    def test_signaling_relay(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        host_info = join(host, room_id, host_token)
        viewer = socketio.test_client(self.app)
        viewer_info = join(viewer, room_id)

        host.emit('ss_start', {'room_id': room_id, 'token': host_token})
        viewer.get_received()

        # viewer ready -> host notified
        viewer.emit('ss_viewer_ready', {'room_id': room_id})
        ready = [m for m in host.get_received() if m['name'] == 'ss_viewer_ready']
        self.assertTrue(ready)
        self.assertEqual(ready[-1]['args'][0]['viewer_sid'], viewer_info['sid'])

        # host offer -> viewer
        host.emit('ss_offer', {'target': viewer_info['sid'], 'sdp': {'type': 'offer', 'sdp': 'x'}})
        offers = [m for m in viewer.get_received() if m['name'] == 'ss_offer']
        self.assertTrue(offers)

        # viewer answer -> host
        viewer.emit('ss_answer', {'target': host_info['sid'], 'sdp': {'type': 'answer', 'sdp': 'y'}})
        answers = [m for m in host.get_received() if m['name'] == 'ss_answer']
        self.assertTrue(answers)

        # ice relay both ways
        host.emit('ss_ice', {'target': viewer_info['sid'], 'candidate': {'candidate': 'c'}})
        ices = [m for m in viewer.get_received() if m['name'] == 'ss_ice']
        self.assertTrue(ices)

        host.disconnect()
        viewer.disconnect()

    def test_stop_share(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        viewer = socketio.test_client(self.app)
        join(viewer, room_id)
        host.emit('ss_start', {'room_id': room_id, 'token': host_token})
        host.get_received()
        viewer.get_received()

        host.emit('ss_stop', {'room_id': room_id, 'token': host_token})
        statuses = [m for m in viewer.get_received() if m['name'] == 'ss_status']
        self.assertTrue(statuses)
        self.assertFalse(statuses[-1]['args'][0]['active'])
        room = room_service.get_room(room_id)
        self.assertEqual(room['mode'], 'media')

        host.disconnect()
        viewer.disconnect()


if __name__ == '__main__':
    unittest.main()
