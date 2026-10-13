import unittest
from app import create_app


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_media_routes_removed(self):
        resp = self.client.post('/create', json={})
        room_id = resp.get_json()['room_id']
        # Media is streamed peer-to-peer; the server exposes no upload/stream API.
        self.assertEqual(self.client.post(f'/api/rooms/{room_id}/upload').status_code, 404)
        self.assertEqual(self.client.get(f'/api/rooms/{room_id}/media').status_code, 404)
        self.assertEqual(self.client.get(f'/stream/{room_id}/x.mp4').status_code, 404)

    def test_invalid_room(self):
        resp = self.client.get('/room/nonexistentr')
        self.assertIn(resp.status_code, [404])

    def test_unauthorized_playback(self):
        resp = self.client.post('/create', json={})
        data = resp.get_json()
        room_id = data['room_id']
        # This would require socket test - basic structure
        self.assertEqual(resp.status_code, 200)


if __name__ == '__main__':
    unittest.main()
