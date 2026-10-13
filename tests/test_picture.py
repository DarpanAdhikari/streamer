import unittest
from app import create_app, socketio
from app.services import room_service


class PictureSyncTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def test_room_starts_with_default_picture(self):
        room_id, _ = room_service.create_room()
        room = room_service.get_room(room_id)
        self.assertEqual(room['picture'], room_service.DEFAULT_PICTURE)

    def test_joined_payload_includes_picture(self):
        room_id, _ = room_service.create_room()
        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        received = viewer.get_received()
        joined = [r for r in received if r['name'] == 'joined'][0]
        self.assertIn('picture', joined['args'][0])
        viewer.disconnect()

    def test_host_picture_update_is_broadcast_and_persisted(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        host.emit('join', {'room_id': room_id, 'token': host_token})
        host.get_received()

        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()

        host.emit('picture_update', {
            'room_id': room_id, 'token': host_token,
            'picture': {'brightness': 1.4, 'zoom': 1.5, 'rotate': 90, 'aspect': '16:9'}
        })
        host.get_received()
        received = viewer.get_received()
        updates = [r for r in received if r['name'] == 'picture_update']
        self.assertEqual(len(updates), 1)
        picture = updates[0]['args'][0]['picture']
        self.assertEqual(picture['brightness'], 1.4)
        self.assertEqual(picture['rotate'], 90)
        self.assertEqual(picture['aspect'], '16:9')
        # Unspecified keys keep their defaults.
        self.assertEqual(picture['contrast'], 1.0)

        self.assertEqual(room_service.get_room(room_id)['picture']['zoom'], 1.5)
        viewer.disconnect()
        host.disconnect()

    def test_viewer_cannot_publish_picture(self):
        room_id, _ = room_service.create_room()
        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()
        viewer.emit('picture_update', {
            'room_id': room_id, 'token': None,
            'picture': {'brightness': 2.0}
        })
        received = viewer.get_received()
        names = [r['name'] for r in received]
        self.assertIn('error', names)
        self.assertNotIn('picture_update', names)
        viewer.disconnect()


if __name__ == '__main__':
    unittest.main()
