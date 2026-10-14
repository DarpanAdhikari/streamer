# Watch Together

![Watch Together](static/images/Python%20Streaming%20Together%20Poster.png)

A local-first watch-party app. One person opens a video file from their own
computer, shares a room link, and everyone in the room watches it together, in
sync. Nothing is uploaded, and the server never sees the video.

Built for small groups, roughly two to ten people, and no accounts are needed.

> **Try the live demo:** [**streamer-m26o.onrender.com**](https://streamer-m26o.onrender.com/)
> Create a room, send the link to a friend, and watch together. The free instance
> sleeps when idle, so the first visit can take a minute to wake. Rooms are kept in
> memory there, so a link stops working after the demo restarts or sleeps — create a
> new room if a link says it has ended.

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
- In-room text chat. Your name's browser and OS part (for example "Chrome · Linux")
  is fixed; you can add your own custom name in front of it, so you appear as
  "Alice (Chrome · Linux)". Your custom name is remembered across rooms in this
  browser.
- Timestamps, join and leave notices, and a clear button for the host. Messages
  live in memory for the length of the session.

**Audio call**
- The host can start a room-wide voice call. Everyone else gets an invite to
  accept or decline, and anyone can join or rejoin while the call is live.
- It is a peer-to-peer mesh, so no audio passes through the server. If the host
  hangs up or drops out, the call keeps going for everyone still on it, until the
  last person leaves.
- Mute yourself from the call panel; only the host can end the call for everyone.
- Each participant row also has a **mute-for-me** button that silences just that
  person in your own playback, and a small animated meter that lights up while
  someone is talking.
- Needs microphone permission, and a headset avoids echo on laptop speakers.

**Host moderation**
- A **People** panel lists everyone in the room. The host can **kick** a viewer (✕)
  or **ban** them (⛔).
- A kicked viewer is removed and sees a waiting screen on their next visit. The host
  gets a request alert and can **Approve** them back in or **Ban** them permanently.
- A ban is permanent for the lifetime of the room. Moderation is keyed to the
  browser, not the IP, so other people on the same network are unaffected.

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

### Start an audio call (host)

1. Click **Start call** in the top bar and allow microphone access.
2. Everyone else sees an invite to accept or decline. Anyone can join later with
   the **Join call** button while the call is live.
3. Use **Mute** and **Leave** in the call panel. The host also has **End for all**.
   If the host leaves, the call continues for everyone else until the last person
   hangs up.

### Join an audio call (viewer)

1. Accept the invite, or click **Join call** while a call is active.
2. Mute or leave from the call panel. If your connection drops, you are prompted to
   rejoin.

### Moderating viewers (host)

1. In the **People** panel, click **✕** to **kick** a viewer or **⛔** to **ban**
   them.
2. A kicked viewer is removed immediately. When they reopen the link they wait for
   approval. Click the **🔔** request button to open the list, then choose **Approve**
   (let them back in) or **Ban** (block them permanently).
3. A ban lasts for the lifetime of the room; the same browser cannot rejoin.

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
shared state for playback, the playlist, subtitles, chat, and audio-call
membership. It stores no video.

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

**Audio call.** A separate peer-to-peer mesh over microphone tracks. The server
only tracks who is in the call and relays SDP and ICE, so a call outlives the host:
it ends only when the last participant leaves, the host ends it for everyone, or
the room expires. Muting another person and the talking indicator are both
client-side: the button just mutes that peer's local `<audio>`, and the indicator
runs a WebAudio analyser over the audio you already receive.

**Moderation.** The server relays a room roster (names and host flag) so the People
panel is the same for everyone. A **kick** moves the viewer's client id into a
`pending` set and disconnects them; reopening the link parks them on a waiting screen
and alerts the host, who can **approve** (admit) or **ban** (move to a `banned` set,
refused outright). Both sets live only as long as the room does.

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
matches the single-worker requirement. Rooms are held in memory, so **every restart
or idle sleep clears them** and a shared link then shows "this room has ended".
`render.yaml` sets `autoDeployTrigger: off` so routine pushes do not restart the
service and drop a live room; deploy manually when nothing is in progress. If the
service was created by hand, turn auto-deploy off in the Render dashboard too.

To cut down idle sleeps, point a free uptime monitor (UptimeRobot, cron-job.org,
and the like) at `GET /healthz` every ten minutes. That keeps the instance awake; it
does not help across deploys — turning off auto-deploy is what covers those.

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
screen sharing, chat, audio calls, host moderation, rate limiting, expiry, and
reconnect state.

## Known limitations

- The host's tab must stay open to keep streaming.
- There is no viewer-side quality selection; viewers receive the host's encoded
  stream as-is.
- The WebRTC mesh sends one stream per viewer, which suits small rooms. Larger rooms
  need an SFU, which could replace `app/sockets/screen_share.py` and
  `static/js/broadcast.js` without changing the room and state layer.
- The audio call is also a full mesh, so each participant uploads one stream per
  peer. It is comfortable for small groups and needs an SFU beyond that.
- The room store and rate limiter are in-process, so the app runs as a single
  worker.
- Rooms live in memory. On an ephemeral host such as the free Render tier they do
  not survive a restart or an idle sleep, so shared links expire with them. Persist
  the room store (for example in Redis) if links need to outlive restarts.
- Moderation is keyed to a browser-local client id, not an IP. Clearing the site's
  data or using a private window gives a fresh identity, so a kick or ban is a
  deterrent rather than airtight.
- Subtitle timing for viewers is estimated from the shared playback position.
