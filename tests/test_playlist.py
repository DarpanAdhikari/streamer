import unittest
from app import create_app, socketio
from app.services import room_service


class PlaylistSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def _seed_queue(self, room_id):
        room = room_service.get_room(room_id)
        queue = [
            {'media_id': 'a', 'filename': 'a.mp4'},
            {'media_id': 'b', 'filename': 'b.mp4'},
            {'media_id': 'c', 'filename': 'c.mp4'},
        ]
        room['queue'] = queue
        room['current_index'] = 0
        room['media'] = queue[0]
        room_service.update_room(room_id, {'queue': queue, 'current_index': 0, 'media': queue[0]})

    def test_host_next_prev(self):
        room_id, host_token = room_service.create_room()
        self._seed_queue(room_id)
        host = socketio.test_client(self.app)
        host.emit('join', {'room_id': room_id, 'token': host_token})
        host.get_received()

        host.emit('media_next', {'room_id': room_id, 'token': host_token})
        received = host.get_received()
        changes = [r for r in received if r['name'] == 'media_change']
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]['args'][0]['current_index'], 1)

        host.emit('media_prev', {'room_id': room_id, 'token': host_token})
        received = host.get_received()
        changes = [r for r in received if r['name'] == 'media_change']
        self.assertEqual(changes[-1]['args'][0]['current_index'], 0)
        host.disconnect()

    def test_viewer_cannot_change_media(self):
        room_id, host_token = room_service.create_room()
        self._seed_queue(room_id)
        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()
        viewer.emit('media_next', {'room_id': room_id, 'token': None})
        received = viewer.get_received()
        names = [r['name'] for r in received]
        self.assertIn('error', names)
        viewer.disconnect()

    def test_remove_current_media_advances(self):
        room_id, host_token = room_service.create_room()
        self._seed_queue(room_id)
        host = socketio.test_client(self.app)
        host.emit('join', {'room_id': room_id, 'token': host_token})
        host.get_received()
        host.emit('media_remove', {'room_id': room_id, 'token': host_token, 'index': 0})
        received = host.get_received()
        changes = [r for r in received if r['name'] == 'media_change']
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]['args'][0]['current_index'], 0)
        self.assertEqual(changes[0]['args'][0]['media']['media_id'], 'b')
        host.disconnect()


if __name__ == '__main__':
    unittest.main()
