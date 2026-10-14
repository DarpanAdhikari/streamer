import unittest

from app import create_app, socketio
from app.services import room_service


def join(client, room_id, token=None, name=None):
    client.emit('join', {'room_id': room_id, 'token': token, 'name': name})
    for msg in client.get_received():
        if msg['name'] == 'joined':
            return msg['args'][0]
    return None


def events(client, name):
    return [m['args'][0] for m in client.get_received() if m['name'] == name]


def call_of(room_id):
    return room_service.get_room(room_id)['audio_call']


class AudioCallSocketTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def _room_with_participants(self):
        room_id, host_token = room_service.create_room()
        host = socketio.test_client(self.app)
        host_sid = join(host, room_id, host_token, name='Host PC')['sid']
        viewer = socketio.test_client(self.app)
        viewer_sid = join(viewer, room_id, name='Viewer PC')['sid']
        host.get_received()
        viewer.get_received()
        return room_id, host_token, host, host_sid, viewer, viewer_sid

    def test_host_starts_call_and_others_are_invited(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()

        host.emit('ac_start', {'room_id': room_id, 'token': host_token, 'name': 'Host PC'})

        invites = events(viewer, 'ac_invite')
        self.assertTrue(invites)
        self.assertEqual(invites[-1]['started_by'], host_sid)

        call = call_of(room_id)
        self.assertTrue(call['active'])
        self.assertEqual(call['started_by'], host_sid)
        self.assertIn(host_sid, call['participants'])

        host.disconnect()
        viewer.disconnect()

    def test_only_host_can_start(self):
        room_id, _host_token, host, _host_sid, viewer, _viewer_sid = self._room_with_participants()

        viewer.emit('ac_start', {'room_id': room_id, 'token': None})

        self.assertTrue([m for m in viewer.get_received() if m['name'] == 'error'])
        self.assertFalse(call_of(room_id)['active'])

        host.disconnect()
        viewer.disconnect()

    def test_accept_adds_participant(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        host.get_received()
        viewer.get_received()

        viewer.emit('ac_accept', {'room_id': room_id, 'name': 'Viewer PC'})

        call = call_of(room_id)
        self.assertIn(viewer_sid, call['participants'])
        self.assertTrue(events(viewer, 'ac_state'))

        host.disconnect()
        viewer.disconnect()

    def test_decline_notifies_host(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        host.get_received()
        viewer.get_received()

        viewer.emit('ac_decline', {'room_id': room_id})

        declined = events(host, 'ac_declined')
        self.assertTrue(declined)
        self.assertEqual(declined[-1]['sid'], viewer_sid)
        self.assertNotIn(viewer_sid, call_of(room_id)['participants'])

        host.disconnect()
        viewer.disconnect()

    def test_leave_ends_call_when_last_participant_leaves(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()

        viewer.emit('ac_leave', {'room_id': room_id})
        self.assertNotIn(viewer_sid, call_of(room_id)['participants'])
        self.assertTrue(call_of(room_id)['active'])

        host.emit('ac_leave', {'room_id': room_id})
        self.assertFalse(call_of(room_id)['active'])
        self.assertTrue(events(viewer, 'ac_ended'))

        host.disconnect()
        viewer.disconnect()

    def test_host_disconnect_keeps_call_for_others(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()

        host.disconnect()

        call = call_of(room_id)
        self.assertTrue(call['active'])
        self.assertNotIn(host_sid, call['participants'])
        self.assertIn(viewer_sid, call['participants'])

        viewer.emit('ac_leave', {'room_id': room_id})
        self.assertFalse(call_of(room_id)['active'])
        viewer.disconnect()

    def test_participant_disconnect_is_removed(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()

        viewer.disconnect()

        call = call_of(room_id)
        self.assertTrue(call['active'])
        self.assertNotIn(viewer_sid, call['participants'])
        self.assertIn(host_sid, call['participants'])

        host.disconnect()

    def test_mute_broadcasts_state(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()

        viewer.emit('ac_mute', {'room_id': room_id, 'muted': True})

        states = events(host, 'ac_state')
        self.assertTrue(states)
        muted = [p for p in states[-1]['participants'] if p['sid'] == viewer_sid]
        self.assertTrue(muted and muted[0]['muted'])

        host.disconnect()
        viewer.disconnect()

    def test_relay_reaches_participants_only(self):
        room_id, host_token, host, host_sid, viewer, viewer_sid = self._room_with_participants()
        third = socketio.test_client(self.app)
        third_sid = join(third, room_id, name='Third')['sid']

        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()
        third.get_received()

        host.emit('ac_offer', {'target': viewer_sid, 'sdp': {'type': 'offer', 'sdp': 'x'}})
        offers = events(viewer, 'ac_offer')
        self.assertTrue(offers)
        self.assertEqual(offers[-1]['from'], host_sid)
        self.assertEqual(offers[-1]['sdp']['sdp'], 'x')

        # A room member who never joined the call gets nothing.
        host.emit('ac_offer', {'target': third_sid, 'sdp': {'type': 'offer', 'sdp': 'y'}})
        self.assertFalse(events(third, 'ac_offer'))

        host.disconnect()
        viewer.disconnect()
        third.disconnect()

    def test_relay_blocked_across_rooms(self):
        room_id, host_token, host, _host_sid, viewer, _viewer_sid = self._room_with_participants()
        other_room_id, _ = room_service.create_room()
        outsider = socketio.test_client(self.app)
        outsider_sid = join(outsider, other_room_id, name='Outsider')['sid']

        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        host.get_received()
        outsider.get_received()

        host.emit('ac_offer', {'target': outsider_sid, 'sdp': {'type': 'offer', 'sdp': 'z'}})
        self.assertFalse(events(outsider, 'ac_offer'))

        host.disconnect()
        viewer.disconnect()
        outsider.disconnect()

    def test_late_joiner_sees_active_call(self):
        room_id, host_token, host, host_sid, viewer, _viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        host.get_received()

        newcomer = socketio.test_client(self.app)
        info = join(newcomer, room_id, name='Newcomer')

        self.assertTrue(info['audio_call']['active'])
        self.assertEqual(info['audio_call']['participants'][0]['sid'], host_sid)

        host.disconnect()
        viewer.disconnect()
        newcomer.disconnect()

    def test_host_can_end_for_all(self):
        room_id, host_token, host, _host_sid, viewer, viewer_sid = self._room_with_participants()
        host.emit('ac_start', {'room_id': room_id, 'token': host_token})
        viewer.emit('ac_accept', {'room_id': room_id})
        host.get_received()
        viewer.get_received()

        host.emit('ac_end', {'room_id': room_id, 'token': host_token})

        ended = events(viewer, 'ac_ended')
        self.assertTrue(ended)
        self.assertFalse(call_of(room_id)['active'])
        self.assertEqual(call_of(room_id)['participants'], {})

        host.disconnect()
        viewer.disconnect()


if __name__ == '__main__':
    unittest.main()
