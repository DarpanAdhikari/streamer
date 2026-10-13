import unittest
from app import create_app
from app.services import room_service


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_playback_state_persistence(self):
        room_id, token = room_service.create_room()
        room = room_service.get_room(room_id)
        self.assertIsNotNone(room)
        self.assertIn('playback_state', room)
        self.assertIn('queue', room)
        self.assertEqual(room['playback_state']['playing'], False)
        self.assertEqual(room['playback_state']['position'], 0)


if __name__ == '__main__':
    unittest.main()
