import unittest
from app import create_app


class BasicTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_index_page(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)

    def test_create_room(self):
        response = self.client.post('/create', json={})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('room_id', data)
        self.assertIn('host_token', data)


if __name__ == '__main__':
    unittest.main()
