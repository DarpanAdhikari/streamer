import unittest
from app import create_app
from app.services import room_service


class ReconnectTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_room_state_survives_for_late_joiners(self):
        room_id, _ = room_service.create_room()
        room = room_service.get_room(room_id)
        for key in ('playback_state', 'queue', 'screen_share', 'subtitles', 'mode'):
            self.assertIn(key, room)

    def test_update_room_persists(self):
        room_id, _ = room_service.create_room()
        room_service.update_room(room_id, {'mode': 'screen'})
        self.assertEqual(room_service.get_room(room_id)['mode'], 'screen')


if __name__ == '__main__':
    unittest.main()
