import unittest

from app import create_app, socketio
from app.services import room_service


def join(client, room_id, token=None, name=None, client_id=None):
    payload = {'room_id': room_id, 'token': token, 'name': name}
    if client_id is not None:
        payload['client_id'] = client_id
    client.emit('join', payload)


def events(client, name):
    return [m['args'][0] for m in client.get_received() if m['name'] == name]


def event_names(client):
    return [m['name'] for m in client.get_received()]


def queued(client, name):
    # After a server-side disconnect the test client refuses get_received(), but
    # the packet is still in its internal queue.
    return [p for p in getattr(client, 'queue', []) if p.get('name') == name]


def room(room_id):
    return room_service.get_room(room_id)


class ModerationSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def _room(self, viewer_client_id='viewer-cid'):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        join(host, room_id, host_token, name='Host PC', client_id='host-cid')
        host_sid = events(host, 'joined')[-1]['sid']
        viewer = socketio.test_client(self.app)
        join(viewer, room_id, name='Viewer PC', client_id=viewer_client_id)
        viewer_sid = events(viewer, 'joined')[-1]['sid']
        return room_id, host_token, host, host_sid, viewer, viewer_sid

    def test_host_kick_parks_viewer(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room()

        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})

        self.assertTrue(queued(viewer, 'kicked'))
        self.assertFalse(viewer.is_connected())
        self.assertNotIn(viewer_sid, room(room_id)['participants'])
        self.assertIn('viewer-cid', room(room_id)['pending'])
        self.assertTrue(events(host, 'pending_update'))

        host.disconnect()

    def test_kicked_client_join_is_parked(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')
        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()

        again = socketio.test_client(self.app)
        join(again, room_id, name='Repeat', client_id='repeat-cid')
        received = event_names(again)
        self.assertIn('pending_approval', received)
        self.assertNotIn('joined', received)
        self.assertTrue(again.is_connected())

        updates = events(host, 'pending_update')
        self.assertTrue(updates)
        self.assertEqual(updates[-1]['pending'][0]['name'], 'Repeat')

        host.disconnect()
        again.disconnect()

    def test_host_approve_admits_waiting_client(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')
        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()
        again = socketio.test_client(self.app)
        join(again, room_id, name='Repeat', client_id='repeat-cid')
        again.get_received()
        host.get_received()

        host.emit('approve_viewer', {'room_id': room_id, 'token': host_token, 'client_id': 'repeat-cid'})

        joined = events(again, 'joined')
        self.assertTrue(joined)
        self.assertNotIn('repeat-cid', room(room_id)['pending'])
        self.assertIn(joined[-1]['sid'], room(room_id)['participants'])

        host.disconnect()
        again.disconnect()

    def test_host_ban_after_kick_is_permanent(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')
        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()
        again = socketio.test_client(self.app)
        join(again, room_id, name='Repeat', client_id='repeat-cid')
        again.get_received()
        host.get_received()

        host.emit('ban_client', {'room_id': room_id, 'token': host_token, 'client_id': 'repeat-cid'})

        self.assertTrue(queued(again, 'banned'))
        self.assertFalse(again.is_connected())
        self.assertNotIn('repeat-cid', room(room_id)['pending'])
        self.assertIn('repeat-cid', room(room_id)['banned'])

        # A permanently banned client is refused outright, with no waiting screen.
        third = socketio.test_client(self.app)
        join(third, room_id, name='Repeat', client_id='repeat-cid')
        received = event_names(third)
        self.assertIn('banned', received)
        self.assertNotIn('joined', received)
        self.assertNotIn('pending_approval', received)

        host.disconnect()
        third.disconnect()

    def test_ban_active_viewer(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='vcid')

        host.emit('ban_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})

        self.assertTrue(queued(viewer, 'banned'))
        self.assertFalse(viewer.is_connected())
        self.assertIn('vcid', room(room_id)['banned'])
        self.assertNotIn('vcid', room(room_id)['pending'])

        host.disconnect()

    def test_non_host_cannot_moderate(self):
        room_id, _host_token, host, host_sid, viewer, _viewer_sid = self._room()

        viewer.emit('kick_viewer', {'room_id': room_id, 'token': None, 'target': host_sid})
        self.assertTrue([m for m in viewer.get_received() if m['name'] == 'error'])
        viewer.emit('approve_viewer', {'room_id': room_id, 'client_id': 'x'})
        viewer.emit('ban_client', {'room_id': room_id, 'client_id': 'x'})

        self.assertEqual(room(room_id)['pending'], {})
        self.assertTrue(viewer.is_connected())

        host.disconnect()
        viewer.disconnect()

    def test_pending_included_in_host_joined(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')
        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()
        host.disconnect()

        new_host = socketio.test_client(self.app)
        join(new_host, room_id, host_token, name='Host Again', client_id='host-cid')
        joined = events(new_host, 'joined')[-1]

        self.assertEqual([p['client_id'] for p in joined['pending']], ['repeat-cid'])

        new_host.disconnect()

    def test_approve_clears_request_when_waiting_client_gone(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room(viewer_client_id='repeat-cid')
        host.emit('kick_viewer', {'room_id': room_id, 'token': host_token, 'target': viewer_sid})
        host.get_received()
        again = socketio.test_client(self.app)
        join(again, room_id, name='Repeat', client_id='repeat-cid')
        again.get_received()
        host.get_received()
        again.disconnect()

        self.assertIn('repeat-cid', room(room_id)['pending'])

        host.emit('approve_viewer', {'room_id': room_id, 'token': host_token, 'client_id': 'repeat-cid'})
        self.assertNotIn('repeat-cid', room(room_id)['pending'])

        # The approval sticks: the next join is admitted normally.
        fresh = socketio.test_client(self.app)
        join(fresh, room_id, name='Repeat', client_id='repeat-cid')
        self.assertIn('joined', event_names(fresh))

        host.disconnect()
        fresh.disconnect()

    def test_roster_is_sent_on_join(self):
        room_id, _host_token, host, _host_sid, viewer, _viewer_sid = self._room()

        new = socketio.test_client(self.app)
        join(new, room_id, name='New', client_id='new-cid')
        info = events(new, 'joined')[-1]

        self.assertEqual(len(info['participants']), 3)
        self.assertEqual(sum(1 for p in info['participants'] if p['is_host']), 1)

        host.disconnect()
        viewer.disconnect()
        new.disconnect()


if __name__ == '__main__':
    unittest.main()
