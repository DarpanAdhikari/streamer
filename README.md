# Watch Together — Local-First Watch Party

A browser-based watch-together app: the host plays **any local video file** in their
browser, and viewers watch a live peer-to-peer mirror with synchronized playback.
There is no server-side upload, storage, or transcoding.

## Architecture Summary

- **Frontend**: vanilla JavaScript, HTML5 `<video>`, CSS3, Socket.IO client.
- **Backend**: Flask + Flask-SocketIO for signaling/state only.
- **Media delivery**: the host's browser decodes the file with a tiered client-side
  engine and mirrors it to each viewer over WebRTC (`captureStream()` → mesh of
  `RTCPeerConnection`s). The server only relays SDP/ICE and metadata.
- **Playlist**: metadata only (`filename`, `duration`, `size`); it is synced to
  viewers but the bytes never leave the host.
- **Subtitles**: parsed into cues in the host's browser and broadcast over Socket.IO;
  rendered as a DOM overlay (subtitles would not be captured by `captureStream()`).
- **Rooms**: UUID-based ids, host tokens, participant tracking, expiry.

## Quick Start

```bash
pip install -r requirements.txt
python app.py            # http://localhost:5000
```

> WebRTC requires a secure context. `localhost` is exempt; production must use HTTPS.

## Playback engine (tiered, client-side)

The host's file is decoded in-browser (`static/js/engine.js`, wrapped by
`static/js/media-local.js`):

1. **Tier 1 — Native**: `<video>` plays the file directly if the browser supports the codec.
2. **Tier 2 — Lossless remux**: `mediabunny` demuxes (`.mkv`, `.ts`, `.mka`, …) and
   muxes fMP4 fed to `hls.js`/MSE. AC3/EAC3/DTS audio is transcoded to AAC by a
   vendored audio-only ffmpeg core.
3. **Tier 3 — ffmpeg.wasm**: full remux/transcode (`.avi`, `.wmv`, exotic codecs).
   The `@ffmpeg/core` runtime is loaded from a public CDN on demand.

Bare module specifiers (`mediabunny`, `hls.js/light`) are resolved by an import map
in `templates/room.html`; vendored assets live under `static/js/vendor/`.

## WebRTC / TURN configuration

ICE servers are served from `/api/webrtc/config` (env-driven):

```bash
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=turn:your-turn-host:3478
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

TURN is required for viewers behind symmetric NAT / strict firewalls.

## Room & playback flow

- Host creates a room; the host token is kept in `sessionStorage` (`host_<roomId>`).
- Host clicks **Open video**, picks a local file; the engine loads (Tier 1→2→3) and
  the host immediately starts broadcasting the mirrored stream (`ss_start` with
  `source: 'video'`).
- Viewers receive SDP/ICE via `ss_offer`/`ss_answer`/`ss_ice`, attach the incoming
  `MediaStream`, and see the video. Late joiners auto-attach.
- Screen sharing is a separate **Screen** tab (`getDisplayMedia`, `source: 'screen'`).
- Host play/pause/seek/rate are broadcast (`state_update` → `playback_update`);
  the mirror is inherently in sync.

### Socket.IO events

- Signaling: `ss_start`, `ss_stop`, `ss_status`, `ss_viewer_ready`, `ss_offer`,
  `ss_answer`, `ss_ice`, `host_left`.
- Playlist/metadata: `media_add`, `media_select`, `media_next`, `media_prev`,
  `media_remove`, `media_change`, `queue_update`.
- Playback: `play`, `pause`, `seek`, `state_update`, `playback_update`, `sync_request`.
- Permissions: `set_permissions`, `permissions_update`.
- Subtitles: `subtitle_set`, `subtitle_off` (cues + delay).
- Picture: `picture_update` (host-published brightness/contrast/saturation/hue/zoom/rotate/flip/aspect; applied locally as CSS by every client).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | `dev-secret-key` | Flask secret |
| `FLASK_DEBUG` | `True` | Debug mode |
| `PORT` | `5000` | Dev server port |
| `ROOM_EXPIRY_HOURS` | `24` | Room lifetime |
| `ROOMS_FILE` | `rooms.json` | Room-store path; set to `""` for in-memory only |
| `STUN_URL` / `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | — | ICE servers |
| `SOCKETIO_ASYNC_MODE` | `eventlet` | `eventlet`, `gevent`, or `threading` |

## Tests

```bash
python -m pytest tests/ -q
```

Covers room lifecycle/auth, playlist signaling, permissions, sync, screen sharing,
hardening (rate limit, expiry), and reconnect state.

## Deployment

- Copy `.env.example` to `.env` and set `SECRET_KEY` and TURN settings.
- **HTTPS is required** in production (WebRTC + `getDisplayMedia`).
- Recommended: gunicorn with a single gevent worker so the in-process room store
  stays consistent, and `SOCKETIO_ASYNC_MODE=gevent`:

  ```bash
  gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker \
           -w 1 -b 0.0.0.0:5000 wsgi:app
  ```

- Reverse proxies must forward WebSocket upgrades.
- Multiple workers need a shared room store and a Socket.IO message queue
  (e.g. Redis); until then run one worker (or consistent hashing/sticky sessions
  for signaling).

### Deploy on Render (free tier)

`render.yaml` provisions a single free web service (Singapore) that builds with
`pip install -r requirements.txt` and runs one GEventWebSocketWorker. Steps:

1. Push this repo to GitHub (branch `main`).
2. Render Dashboard → **New → Blueprint** → select the repo. Render reads
   `render.yaml`.
3. Set the `sync: false` secrets when prompted: `TURN_URL`, `TURN_USERNAME`,
   `TURN_CREDENTIAL` (leave blank for STUN-only), optionally `STUN_URL`.
4. Deploy. Render provides managed HTTPS, which satisfies the secure-context
   requirement automatically.

Free-tier notes: the instance sleeps after ~15 min idle (first request after that
takes ~1 min to wake), the disk is ephemeral (so `ROOMS_FILE=""` keeps rooms in
memory), and only a single instance runs — matching the single-worker
requirement. CI (`.github/workflows/ci.yml`) runs on every push; `render.yaml`
deploys only after those checks pass (`autoDeployTrigger: checksPass`).

## Scaling note

The WebRTC topology is a mesh: the host sends one encoded stream per viewer. This
is fine for 2–10 viewers. For larger rooms, replace the transport in
`app/sockets/screen_share.py` + `static/js/broadcast.js` with an SFU (e.g. LiveKit);
the room/state logic can stay.

## Known limitations

- The host must keep the tab open and awake to keep streaming.
- No viewer-side quality selection (the host's encoded stream is mirrored as-is).
- Subtitle sync for viewers is estimated from broadcast playback position.
- In-memory room store/rate limiter are per-process (single worker).
