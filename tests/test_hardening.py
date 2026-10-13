import unittest
from datetime import datetime, timedelta

from app import create_app
from app.services import room_service, rate_limit


class HardeningTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def _create_room(self):
        data = self.client.post('/create', json={}).get_json()
        return data['room_id'], data['host_token']

    def test_create_rate_limit(self):
        for _ in range(20):
            resp = self.client.post('/create', json={})
            self.assertEqual(resp.status_code, 200)
        resp = self.client.post('/create', json={})
        self.assertEqual(resp.status_code, 429)

    def test_create_returns_link(self):
        data = self.client.post('/create', json={}).get_json()
        self.assertTrue(data['link'].endswith('/room/' + data['room_id']))
        self.assertTrue(data['host_token'])

    def test_host_token_authorization(self):
        room_id, token = self._create_room()
        self.assertTrue(room_service.is_host(room_id, token))
        self.assertFalse(room_service.is_host(room_id, 'wrong-token'))
        self.assertFalse(room_service.is_host('missing-room', token))

    def test_expired_room_is_removed(self):
        room_id, _ = self._create_room()
        room_service._ROOMS[room_id]['expires_at'] = (datetime.utcnow() - timedelta(hours=1)).isoformat()
        self.assertIsNone(room_service.get_room(room_id))
        self.assertNotIn(room_id, room_service._ROOMS)

    def test_unknown_room_returns_404(self):
        resp = self.client.get('/room/does-not-exist')
        self.assertEqual(resp.status_code, 404)

    def test_webrtc_config_has_stun(self):
        resp = self.client.get('/api/webrtc/config')
        self.assertEqual(resp.status_code, 200)
        servers = resp.get_json()['iceServers']
        self.assertTrue(any('stun:' in s['urls'] for s in servers))

    def test_new_room_defaults(self):
        room_id, _ = self._create_room()
        room = room_service.get_room(room_id)
        self.assertEqual(room['mode'], 'media')
        self.assertEqual(room['queue'], [])
        self.assertIsNone(room['media'])
        self.assertFalse(room['screen_share']['active'])
        self.assertIsNone(room['screen_share']['source'])
        self.assertEqual(room['subtitles'], {'cues': [], 'delay': 0})


if __name__ == '__main__':
    unittest.main()
