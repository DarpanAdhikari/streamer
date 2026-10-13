import unittest
from app import create_app, socketio
from app.services import room_service


class PermissionSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_viewer_cannot_control_by_default(self):
        room_id, host_token = room_service.create_room()
        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()

        viewer.emit('play', {'room_id': room_id, 'token': None})
        received = viewer.get_received()
        errors = [r for r in received if r['name'] == 'error']
        self.assertTrue(len(errors) >= 1)
        viewer.disconnect()

    def test_host_can_grant_viewer_control(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        host.emit('join', {'room_id': room_id, 'token': host_token})
        host.get_received()

        host.emit('set_permissions', {
            'room_id': room_id, 'token': host_token,
            'permissions': {'allow_viewer_control': True, 'allow_viewer_seek': True}
        })
        host.get_received()

        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()
        viewer.emit('play', {'room_id': room_id, 'token': None})
        received = viewer.get_received()
        names = [r['name'] for r in received]
        self.assertIn('playback_update', names)
        viewer.disconnect()
        host.disconnect()

    def test_unauthorized_permission_change(self):
        room_id, host_token = room_service.create_room()
        viewer = socketio.test_client(self.app)
        viewer.emit('join', {'room_id': room_id, 'token': None})
        viewer.get_received()
        viewer.emit('set_permissions', {
            'room_id': room_id, 'token': None,
            'permissions': {'allow_viewer_control': True}
        })
        received = viewer.get_received()
        names = [r['name'] for r in received]
        self.assertIn('error', names)
        viewer.disconnect()


if __name__ == '__main__':
    unittest.main()
