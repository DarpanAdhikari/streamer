import unittest
from app import create_app, socketio
from app.services import room_service


def join(client, room_id, token=None):
    client.emit('join', {'room_id': room_id, 'token': token})
    for msg in client.get_received():
        if msg['name'] == 'joined':
            return msg['args'][0]
    return None


class RoomTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_create_and_get_room(self):
        response = self.client.post('/create', json={})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        room_id = data['room_id']
        token = data['host_token']
        self.assertTrue(len(room_id) > 0)
        self.assertTrue(len(token) > 0)

        # Join room
        response = self.client.get(f'/room/{room_id}')
        self.assertEqual(response.status_code, 200)

    def test_missing_room_shows_friendly_page(self):
        response = self.client.get('/room/doesnotexist')
        self.assertEqual(response.status_code, 404)
        body = response.get_data(as_text=True)
        self.assertIn('has ended or expired', body)
        self.assertIn('createRoomBtn', body)

    def test_healthz(self):
        response = self.client.get('/healthz')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'status': 'ok'})


class HostRoleSocketTests(unittest.TestCase):
    """Only one connection per room may act as host (duplicate host tabs fall back)."""

    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_duplicate_host_token_is_demoted_to_viewer(self):
        room_id, host_token = room_service.create_room()

        host = socketio.test_client(self.app)
        first = join(host, room_id, host_token)
        self.assertTrue(first['is_host'])

        duplicate = socketio.test_client(self.app)
        second = join(duplicate, room_id, host_token)
        self.assertFalse(second['is_host'])

        # After the real host leaves, a host-token connection can host again.
        host.disconnect()
        rejoined = join(duplicate, room_id, host_token)
        self.assertTrue(rejoined['is_host'])

        duplicate.disconnect()


if __name__ == '__main__':
    unittest.main()

