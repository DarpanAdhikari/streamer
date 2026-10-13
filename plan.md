# Project: Watch Together - Real-Time Movie Streaming Platform

Act as a senior full-stack engineer, WebRTC specialist, and UI/UX designer. Build a complete, functional, production-minded web application that allows a host to stream a movie to 2–10 viewers through a shareable room link.

Do not just provide a tutorial, architecture document, or mockup. Implement the actual application with working frontend and backend code.

## 1. Project Goal

Build a browser-based watch-together platform where:

1. A host creates a room and receives a unique invitation link.
2. The host selects a movie file from their local computer.
3. Other users open the invitation link and watch the same movie.
4. The host controls shared playback, including play, pause, seeking, next, and previous.
5. Viewers cannot control shared playback unless the host explicitly permits it.
6. Viewers can independently control local settings such as volume, fullscreen, and brightness where supported.
7. The host can alternatively share their screen, browser tab, or application window.
8. Screen-sharing viewers can watch but cannot control the host's computer or modify the shared screen.
9. The application provides a professional video player inspired by the best features of VLC, MX Player, and YouTube.

Target audience: 2–10 viewers per room.

## 2. Required Technology Stack

Use the following technologies:

**Frontend**
- HTML5
- CSS3
- Vanilla JavaScript (ES6+)
- Socket.IO client
- Video.js or another well-supported browser video player
- No React, Vue, Angular, or other frontend frameworks

**Backend**
- Python 3
- Flask
- Flask-SocketIO
- WebSocket-based real-time communication
- HTTP video delivery with byte-range support
- SQLite for persistent room metadata if needed
- Redis only if justified for production scaling

**Screen sharing**
- WebRTC
- STUN/TURN configuration
- Prefer a WebRTC SFU such as LiveKit for reliable multi-viewer screen sharing
- Keep movie playback synchronization separate from screen-sharing transport

Choose stable, compatible dependency versions and document the installation process.

## 3. Critical Architecture Decision

The host selects a movie from their local computer. Remember that a local browser file is not automatically accessible to other users.

**Chosen implementation (local-first, Architecture A):**

- The host's browser decodes the file locally with a tiered client-side engine
  (native → `mediabunny` remux → ffmpeg.wasm).
- The host mirrors the playing `<video>` to each viewer over WebRTC
  (`captureStream()` → one `RTCPeerConnection` per viewer). The server only
  relays SDP/ICE and metadata; **movie bytes never reach the server**.
- No upload, storage, HTTP Range streaming, or server-side transcoding.
- This keeps the server a pure signaling/state service and avoids multi-hundred-MB
  uploads entirely.

Trade-offs:

- The host's tab must stay open and awake to keep the stream alive.
- Compatibility depends on the host's browser, but the tiered engine makes most
  containers/codecs playable.

Design the transport so it can later be replaced with an SFU (e.g. LiveKit) for
larger rooms without changing the room/state layer.

Do not attempt to distribute movie files through Socket.IO messages.


## 4. Room Management

Implement the following features:

- Create a room.
- Generate a unique, hard-to-guess room ID.
- Generate a secure host credential.
- Provide a copyable invitation link.
- Allow viewers to join through that link.
- Display the number of connected participants.
- Display the host and viewer roles.
- Support users joining after playback has started.
- Synchronize the current playback state when a viewer joins.
- Handle disconnections and reconnections.
- Handle the host leaving the room.
- Provide room expiration and temporary-file cleanup.
- Prevent unauthorized users from modifying room state.
- Support optional room passwords or access tokens.

Do not rely on frontend button visibility for authorization. Enforce permissions on the backend.

## 5. Host Permissions and Shared Playback

The host must have the following controls:

- Play and pause.
- Seek forward and backward.
- Jump to a specific timeline position.
- Select the next or previous movie.
- Manage a playlist or queue.
- Enable or disable viewer playback controls.
- Enable or disable viewer seeking.
- Decide whether viewers may select their own audio tracks and subtitles.
- End the session.
- Switch between movie mode and screen-sharing mode.

Use server-authorized Socket.IO events for shared actions.

Define and document a consistent playback state, including:

- Current media ID.
- Current playback position.
- Playing or paused state.
- Playback speed.
- Server timestamp of the last state update.
- Available media metadata.
- Host permissions.

Handle playback drift by periodically comparing viewer playback positions with the authoritative host state. Avoid repeatedly seeking viewers for tiny differences.

When a new viewer joins, synchronize them to the current media and playback position.

## 6. Professional Video Player

Create a custom, responsive, dark-themed player with a premium cinematic appearance.

The UI should look like a serious media application, not a basic HTML video element.

### Main player features

- Play and pause.
- Timeline with buffered and played progress.
- Click-to-seek and keyboard seeking.
- Current time and total duration.
- Volume and mute controls.
- Fullscreen.
- Playback speed.
- Picture-in-picture where supported.
- Keyboard shortcuts.
- Responsive layout for desktop, tablet, and mobile.
- Loading, buffering, and error states.
- Settings menu.
- Double-click fullscreen if appropriate.
- Optional screen lock or control-lock feature.
- Touch-friendly controls.
- Custom hover effects and smooth transitions.

### Audio features

- Enumerate and select available audio tracks when supported.
- Display track language or labels when available.
- Handle media files with unsupported embedded audio tracks gracefully.
- Explain any required remuxing or transcoding.

### Subtitle features

- Select available subtitle tracks.
- Load external subtitle files such as SRT and WebVTT.
- Convert SRT to WebVTT when needed.
- Enable or disable subtitles.
- Adjust subtitle delay.
- Support subtitle font size and appearance settings.
- Provide useful error messages for unsupported formats.

### Quality and media features

- Provide a quality selector when multiple renditions are available.
- Support adaptive streaming using HLS or DASH if implemented.
- Do not pretend that quality switching exists when only one rendition is available.
- Provide a queue or playlist interface.
- Allow the host to change the current movie.
- Update all viewers when the host changes media.

Remember that native browser video support is not equivalent to VLC. Design a media compatibility layer and document which formats work directly and which require remuxing or transcoding.

## 7. Screen-Sharing Mode

Implement a separate screen-sharing mode using WebRTC.

Requirements:

- Allow the host to share a screen, application window, or browser tab.
- Capture system/tab audio when supported by the browser.
- Display the incoming stream to viewers.
- Show a clear screen-sharing status.
- Allow the host to stop sharing.
- Notify viewers when screen sharing ends.
- Prevent viewers from issuing remote input or modifying the host's screen.
- Use a proper WebRTC signaling mechanism.
- Use an SFU such as LiveKit when appropriate for multiple viewers.
- Provide clear connection and permission error messages.
- Handle reconnects and failed connections.
- Require HTTPS in production.
- Document STUN and TURN setup.

Do not confuse browser screen capture with remote desktop control. Remote input is not required.

## 8. UI/UX Requirements

Build a polished application with the following screens:

### Home page
- Application branding.
- Create Room button.
- Join Room option.
- Brief explanation of how the platform works.
- Modern, responsive layout.

### Watch room
- Large video player.
- Room invitation link and copy button.
- Host or viewer badge.
- Participant count.
- Media title and playback status.
- Host control panel.
- Queue/playlist panel.
- Settings panel.
- Screen-sharing mode switch.
- Clear empty state before a movie is selected.

### Upload interface
- File picker.
- Supported format information.
- Upload progress indicator.
- Upload cancellation where feasible.
- File size and duration information when available.
- Error messages for invalid files or failed uploads.

Use consistent spacing, typography, icons, responsive behavior, and accessible controls. Avoid excessive gradients, distracting animations, and unnecessary UI elements.

## 9. Security and Reliability

Implement or clearly isolate the following production requirements:

- Host authorization for all privileged operations.
- Viewer authorization for room and media access.
- Secure random credentials.
- Safe filename handling (metadata only; never used as a server path).
- Rate limiting.
- Room expiration and cleanup.
- Protection against unauthorized room joining.
- Safe CORS configuration.
- CSRF protection where applicable.
- Validation of every Socket.IO event.
- Avoid leaking host credentials to viewers.
- Prevent path traversal and arbitrary file access.
- Serve only static assets and signaling; media is peer-to-peer.
- Use environment variables for secrets.
- Configure HTTPS for production.
- Document reverse-proxy and WebSocket settings.
- Explain how to run multiple backend workers safely.

Never claim the application is production-secure merely because basic token checks are present.

## 10. Suggested Project Structure

Use a maintainable structure similar to:

watch-together/
├── app.py
├── config.py
├── requirements.txt
├── .env.example
├── README.md
├── app/
│   ├── __init__.py
│   ├── routes/
│   │   └── rooms.py
│   ├── services/
│   │   ├── room_service.py
│   │   └── rate_limit.py
│   └── sockets/
│       ├── rooms.py
│       ├── playback.py
│       ├── screen_share.py
│       └── registry.py
├── templates/
│   ├── index.html
│   └── room.html
├── static/
│   ├── css/
│   │   ├── main.css
│   │   └── player.css
│   └── js/
│       ├── app.js
│       ├── room.js
│       ├── player.js
│       ├── synchronization.js
│       ├── subtitles.js
│       ├── media-local.js
│       ├── broadcast.js
│       ├── engine.js
│       └── vendor/
└── tests/

You may adjust this structure when there is a clear technical reason.

## 11. Development and Delivery Process

Work in the following order.

**Phase 1: Functional foundation**
- Create the Flask application.
- Build the home page and room interface.
- Implement room creation and joining.
- Implement host-local tiered playback (native → remux → ffmpeg.wasm).
- Mirror the host's video to viewers over WebRTC.
- Add basic playback synchronization.

**Phase 2: Player**
- Integrate the chosen player library.
- Build custom controls.
- Add subtitles and audio-track handling.
- Add playlist and next/previous functionality.
- Improve buffering and error handling.

**Phase 3: Permissions and synchronization**
- Implement host/viewer roles.
- Validate all shared actions on the server.
- Add late-join synchronization.
- Handle reconnection and playback drift.
- Add room settings.

**Phase 4: Screen sharing**
- Implement WebRTC signaling.
- Integrate the selected WebRTC transport or SFU.
- Add screen and audio capture.
- Implement viewer playback and connection recovery.

**Phase 5: Hardening**
- Add upload quotas and cleanup.
- Add automated tests.
- Test concurrent viewers.
- Document HTTPS, TURN, deployment, and environment variables.
- Add monitoring and logging.

## 12. Testing Requirements

Include tests or a documented test plan for:

- Creating and joining rooms.
- Invalid room IDs.
- Host authorization.
- Unauthorized playback commands.
- Playlist metadata sync (`media_add`, `queue_update`).
- Play, pause, and seek synchronization.
- Late viewers joining an active room.
- Viewer reconnection.
- Host disconnection.
- Room expiration.
- Screen-sharing / video-broadcast start and stop.
- Two to ten concurrent viewers.
- Broadcast negotiation failures.

## 13. How You Must Work

Follow these instructions strictly:

1. Inspect the existing project files before making changes, if a project already exists.
2. If no project exists, create the complete project structure.
3. Implement working functionality instead of returning pseudocode or isolated examples.
4. Use concise, maintainable code and separate responsibilities into modules.
5. Do not leave important features as TODO comments while claiming the application is complete.
6. Do not fake WebRTC, audio-track selection, subtitles, or synchronization with static UI.
7. If a feature requires an external service, provide its integration code, configuration variables, and setup instructions.
8. Keep secrets out of source control.
9. Run available tests and fix errors before finishing.
10. Clearly identify any remaining limitations.
11. Provide exact installation and run commands.
12. If you have filesystem and terminal access, create and test the actual files instead of only printing their contents.
13. If you cannot edit files directly, provide complete file contents in manageable stages, preserving consistent interfaces across files.
14. Do not overwhelm the response with the entire codebase at once. Implement the project in coherent phases and verify each phase before moving forward.

## 14. First Task

Begin by:
1. Summarizing the proposed architecture in a few sentences.
2. Identifying the most important technical limitations and assumptions.
3. Creating the project structure.
4. Implementing Phase 1 completely.
5. Running the application and its tests if your environment supports it.
6. Reporting the files created, features verified, exact commands to run the application, and any remaining issues.

The final result should be a usable foundation for a real watch-together platform, with an excellent player experience, reliable synchronization, secure room permissions, and a clear path to multi-viewer WebRTC screen sharing.