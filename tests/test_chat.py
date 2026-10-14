import unittest

from app import create_app, socketio
from app.services import room_service, rate_limit
from app.sockets import chat


def join(client, room_id, token=None, name=None):
    client.emit('join', {'room_id': room_id, 'token': token, 'name': name})
    for msg in client.get_received():
        if msg['name'] == 'joined':
            return msg['args'][0]
    return None


def chat_messages(client):
    return [m['args'][0] for m in client.get_received()
            if m['name'] == 'chat_message' and m['args'][0].get('type') == 'message']


class ChatSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()
        rate_limit.reset()

    def tearDown(self):
        self.app_context.pop()

    def test_message_broadcasts_and_persists(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token, name='Host PC')
        viewer = socketio.test_client(self.app)
        join(viewer, room_id, name='Viewer PC')

        host.get_received()
        viewer.get_received()

        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'name': 'Host PC', 'text': 'hello'})

        received = chat_messages(viewer)
        self.assertTrue(received)
        self.assertEqual(received[-1]['text'], 'hello')
        self.assertEqual(received[-1]['name'], 'Host PC')
        self.assertEqual(received[-1]['role'], 'host')

        room = room_service.get_room(room_id)
        self.assertEqual(room['chat'][-1]['text'], 'hello')

        host.disconnect()
        viewer.disconnect()

    def test_history_delivered_on_join(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': 'earlier message'})
        host.get_received()

        viewer = socketio.test_client(self.app)
        info = join(viewer, room_id)
        texts = [m['text'] for m in info['chat']]
        self.assertIn('earlier message', texts)

        host.disconnect()
        viewer.disconnect()

    def test_empty_message_ignored(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        host.get_received()

        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': '   '})
        self.assertEqual(chat_messages(host), [])
        self.assertEqual(room_service.get_room(room_id)['chat'], [])

        host.disconnect()

    def test_message_length_is_capped(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        host.get_received()

        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': 'x' * (chat.CHAT_MAX_LEN + 50)})
        room = room_service.get_room(room_id)
        self.assertEqual(len(room['chat'][-1]['text']), chat.CHAT_MAX_LEN)

        host.disconnect()

    def test_rate_limit_blocks_spam(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        host.get_received()

        for i in range(chat.CHAT_RATE_LIMIT):
            host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': 'msg %d' % i})
        self.assertEqual(len(chat_messages(host)), chat.CHAT_RATE_LIMIT)

        host.get_received()
        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': 'one too many'})
        errors = [m for m in host.get_received() if m['name'] == 'error']
        self.assertTrue(errors)
        self.assertEqual(len(room_service.get_room(room_id)['chat']), chat.CHAT_RATE_LIMIT)

        host.disconnect()

    def test_non_member_cannot_chat(self):
        room_id, _ = room_service.create_room()
        outsider = socketio.test_client(self.app)
        outsider.emit('chat_send', {'room_id': room_id, 'text': 'sneaky'})
        errors = [m for m in outsider.get_received() if m['name'] == 'error']
        self.assertTrue(errors)
        self.assertEqual(room_service.get_room(room_id)['chat'], [])
        outsider.disconnect()

    def test_clear_is_host_only(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token)
        viewer = socketio.test_client(self.app)
        join(viewer, room_id)
        host.get_received()
        viewer.get_received()

        host.emit('chat_send', {'room_id': room_id, 'token': host_token, 'text': 'hello'})
        viewer.get_received()

        viewer.emit('chat_clear', {'room_id': room_id, 'token': None})
        self.assertTrue([m for m in viewer.get_received() if m['name'] == 'error'])
        self.assertEqual(len(room_service.get_room(room_id)['chat']), 1)

        host.emit('chat_clear', {'room_id': room_id, 'token': host_token})
        self.assertEqual(room_service.get_room(room_id)['chat'], [])
        self.assertTrue([m for m in viewer.get_received() if m['name'] == 'chat_clear'])

        host.disconnect()
        viewer.disconnect()


if __name__ == '__main__':
    unittest.main()
