# Watch Together

![Watch Together](static/images/Python%20Streaming%20Together%20Poster.png)

A local-first watch-party app. One person opens a video file from their own
computer, shares a room link, and everyone in the room watches it together, in
sync. Nothing is uploaded, and the server never sees the video.

Built for small groups, roughly two to ten people, and no accounts are needed.

## Why it exists

Watching a movie with friends over the internet usually means one of two things.
Either you upload the file somewhere, which is slow, costs storage, and often runs
into problems with content you do not own the rights to stream. Or you share your
screen, which mangles the audio, locks up your machine, and makes everyone a
passive observer of your desktop.

Watch Together takes a different path. The file is already on the host's computer,
so the host's browser plays it there and mirrors what is on the player to the other
viewers as a live peer-to-peer stream. The server only keeps track of who is in the
room and passes connection details back and forth. The video itself moves directly
between browsers.

## What you get

**Rooms**
- Create a room and get a shareable invite link.
- A host role tied to the browser that created the room, and a viewer role for
  everyone else.
- Live participant count and host/viewer badges.
- Late joiners pick up whatever is currently playing.
- Rooms expire on a timer.

**Player**
- A custom control bar: play/pause, previous/next, volume, a seek bar with a
  buffered range, elapsed and total time, speed from 0.5x to 2x, subtitles,
  picture-in-picture, theater mode, screenshot, fullscreen, and a settings menu.
- Keyboard shortcuts for everything (see the reference below).
- Mouse and touch gestures: scroll to change volume; double-tap the left or right
  side to skip ten seconds; double-tap the middle for fullscreen; drag along the
  left edge for brightness or the right edge for volume; pinch to zoom; press and
  hold for 2x speed.
- Automatic picture-in-picture when you switch tabs, and OS media keys through the
  Media Session API.
- A stats overlay showing resolution, which engine tier is in use, dropped frames,
  and buffer health.
- Screenshots that include any picture adjustments you have applied.

**Audio**
- Pick between embedded audio tracks when a file has more than one.
- Files with audio the browser cannot decode (AC3, EAC3, DTS) are converted on the
  fly.

**Subtitles**
- Use subtitle tracks embedded in the file, or load an external `.srt` or `.vtt`.
- Select a video and its subtitle file together and they are matched automatically.
- Adjust the delay and text size. Subtitle choices are shared with viewers.

**Picture**
- Brightness, contrast, saturation, hue, zoom, rotation, horizontal flip, and
  aspect ratio.
- The host publishes these settings and every client applies them locally. A viewer
  can tweak them for themselves until the host sends a new value.

**Screen sharing**
- Share an entire screen, a single window, or a browser tab, with tab audio when
  the browser allows it. Viewers watch the stream and cannot control the host's
  machine.

**Chat**
- In-room text chat. Your display name is guessed from your browser and operating
  system, for example "Chrome on Linux", and you can change it.
- Timestamps, join and leave notices, and a clear button for the host. Messages
  live in memory for the length of the session.

**Permissions**
- The host can allow viewers to play/pause and to seek.

## How to use it

### Start a room (host)

1. Open the site and click **Create Room**. You land in the room, and your host
   role is remembered in this browser.
2. Click **Copy link** and send it to the people you are watching with.
3. Click **Open video** and pick the file from your computer. If you also have a
   subtitle file, select it at the same time. The player picks the fastest way to
   play the file and starts sharing automatically.
4. Drive playback from the player. Your play/pause, seek, speed, and subtitle
   choices apply to everyone.

### Join a room (viewer)

1. Open the link the host sent you.
2. The video appears as the host plays it and stays in sync. Volume and fullscreen
   are always yours. If the host has allowed it, you also get play/pause and seek.

### Before you start

- The host's tab has to stay open and awake. Closing it ends the stream.
- WebRTC needs HTTPS in production. `localhost` works during development.
- On strict or corporate networks you may need a TURN server. See
  [Configuration](#configuration).

### Keyboard and gesture reference

| Key | Action |
| --- | --- |
| `Space` / `K` | Play or pause |
| `F` | Fullscreen |
| `T` | Theater mode |
| `M` | Mute |
| `P` | Picture-in-picture |
| `C` | Toggle subtitles |
| `S` | Save a screenshot |
| `Y` | Toggle the stats overlay |
| `V` | Cycle aspect ratio |
| `Left` / `Right` | Skip 5 seconds |
| `J` / `L` | Skip 10 seconds |
| `Up` / `Down` | Volume |
| `,` / `.` | Step one frame (host) |
| `N` | Next item (host) |
| `Esc` | Leave theater or close the menu |

Gestures on the video area: scroll to change volume, double-tap the sides to skip,
double-tap the middle for fullscreen, drag the edges for brightness or volume,
pinch to zoom, and press and hold for 2x speed.

## How it works

**Server.** Flask with Flask-SocketIO. It creates rooms, issues host tokens, tracks
participants, relays WebRTC offers, answers, and ICE candidates, and holds the
shared state for playback, the playlist, subtitles, and chat. It stores no video.

**Host browser.** The file is decoded in tiers, from cheapest to most work:

1. **Native.** The browser plays the file directly when it understands the
   container and codecs.
2. **Lossless remux.** `mediabunny` repackages containers the browser cannot read
   on its own (MKV, TS) into fragmented MP4 for the browser's media stack. AC3,
   EAC3, and DTS audio is converted to AAC by a bundled audio-only ffmpeg build.
3. **ffmpeg.wasm.** Full remux or transcode for everything else (AVI, WMV, unusual
   codecs). The runtime is loaded from a public CDN on first use.

**Transport.** The host captures the playing `<video>` with `captureStream()` and
opens one `RTCPeerConnection` per viewer, a full mesh. The server relays the
signaling but no media. Subtitles are sent as text over Socket.IO rather than mixed
into the video.

**Viewer browser.** Attaches the incoming `MediaStream` to a plain `<video>`
element and receives state updates over Socket.IO.

## Run it locally

Requires Python 3.10 or newer (3.12 recommended).

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`.

## Configuration

Copy `.env.example` to `.env` for local runs. All values are read from the
environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | `dev-secret-key` | Flask secret; set a real value in production |
| `FLASK_DEBUG` | `True` | Debug mode |
| `PORT` | `5000` | Dev server port |
| `ROOM_EXPIRY_HOURS` | `24` | Room lifetime |
| `ROOMS_FILE` | `rooms.json` | Room-store path; set to `""` for in-memory only |
| `STUN_URL` | Google STUN | STUN server for WebRTC |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | — | TURN server for strict networks |
| `SOCKETIO_ASYNC_MODE` | `eventlet` | `eventlet`, `gevent`, or `threading` |
| `CHAT_MAX_LEN` | `500` | Maximum chat message length |
| `CHAT_HISTORY` | `200` | Chat messages kept per room, in memory |

## Deploy

- Serve over **HTTPS**. WebRTC and screen capture both require a secure context.
- Put a reverse proxy in front and make sure it forwards WebSocket upgrades.
- Run a **single worker**. The room store and rate limiter are in-process, so more
  than one worker would see inconsistent state. The recommended setup is gunicorn
  with one gevent worker and `SOCKETIO_ASYNC_MODE=gevent`:

  ```bash
  gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker \
           -w 1 -b 0.0.0.0:5000 wsgi:app
  ```

- To run multiple workers later, back the room store and the Socket.IO message
  queue with something shared, such as Redis, and use sticky sessions.

### Render

The repo includes `render.yaml`, which provisions a single free web service that
installs from `requirements.txt` and runs one GEventWebSocketWorker. Push the repo
to GitHub, create a new Blueprint on Render and point it at the repository, then set
the `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` values when prompted (leave
them blank to use STUN only). Render provides managed HTTPS, which satisfies the
secure-context requirement.

On the free tier the instance sleeps after about fifteen minutes idle and takes
roughly a minute to wake, the disk is ephemeral, and a single instance runs. That
matches the single-worker requirement. `render.yaml` deploys only after the CI
checks in `.github/workflows/ci.yml` pass.

> If you create the service by hand as a plain Web Service instead of a Blueprint,
> Render uses its default `gunicorn app:app`. That still works: gunicorn auto-loads
> the repo-root `gunicorn.conf.py`, which selects the gevent WebSocket worker, keeps
> one worker, and sets the production-friendly environment defaults. The `app`
> package exposes an `app` attribute for that target, and `wsgi.py` is the
> Blueprint and Procfile equivalent.

## Tests

```bash
python -m pytest tests/ -q
```

The suite covers room lifecycle and auth, playlist signaling, permissions, sync,
screen sharing, chat, rate limiting, expiry, and reconnect state.

## Known limitations

- The host's tab must stay open to keep streaming.
- There is no viewer-side quality selection; viewers receive the host's encoded
  stream as-is.
- The WebRTC mesh sends one stream per viewer, which suits small rooms. Larger rooms
  need an SFU, which could replace `app/sockets/screen_share.py` and
  `static/js/broadcast.js` without changing the room and state layer.
- The room store and rate limiter are in-process, so the app runs as a single
  worker.
- Subtitle timing for viewers is estimated from the shared playback position.
