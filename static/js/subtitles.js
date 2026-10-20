/*
 * Subtitles: embedded subtitle tracks are extracted on the host and broadcast
 * as timed cues over Socket.IO. Cues are rendered as a DOM overlay (they would
 * not be captured by captureStream()), so host and viewers render the same
 * cue list. Each viewer can toggle the overlay locally (CC button).
 */

let subtitleCues = [];
let subtitlesEnabled = true;
let remoteClock = null;        // { base, at } estimate of host position
let embeddedTracks = [];
let scannedSubtitleFile = null;
let subtitleRafId = null;
let subtitleDelay = 0;         // seconds; positive shifts cues later
let subtitleFontScale = 1;     // multiplier on the base overlay font size

function parseTimestamp(str) {
    const m = String(str).trim().match(/(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

function parseCues(text) {
    const blocks = String(text).replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n{2,}/);
    const cues = [];
    blocks.forEach(function (block) {
        const lines = block.split('\n').filter(function (l) { return l.length; });
        if (!lines.length) return;
        let idx = lines[0].indexOf('-->') !== -1 ? 0 : 1;
        const timeLine = lines[idx];
        if (!timeLine || timeLine.indexOf('-->') === -1) return;
        const parts = timeLine.split('-->');
        const start = parseTimestamp(parts[0]);
        const end = parseTimestamp(parts[1]);
        if (start == null || end == null) return;
        const body = lines.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
        if (body) cues.push({ start: start, end: end, text: body });
    });
    return cues;
}

function currentSubtitleTime() {
    const remote = typeof player !== 'undefined' && player && player.srcObject;
    if (!remote) {
        return (typeof player !== 'undefined' && player) ? (player.currentTime || 0) : 0;
    }
    if (remoteClock) return remoteClock.base + (Date.now() - remoteClock.at) / 1000;
    return 0;
}

function renderSubtitles() {
    const el = document.getElementById('subtitleOverlay');
    if (el) {
        const t = currentSubtitleTime() - subtitleDelay;
        let text = '';
        if (subtitlesEnabled) {
            for (let i = 0; i < subtitleCues.length; i++) {
                const c = subtitleCues[i];
                if (t >= c.start && t <= c.end) { text = c.text; break; }
            }
        }
        el.textContent = text;
        el.style.fontSize = (1.6 * subtitleFontScale).toFixed(2) + 'rem';
    }
    subtitleRafId = requestAnimationFrame(renderSubtitles);
}

function hasActiveSubtitles() {
    return subtitleCues.length > 0;
}

function toggleSubtitles(on) {
    subtitlesEnabled = (typeof on === 'boolean') ? on : !subtitlesEnabled;
    if (typeof updateCcButton === 'function') updateCcButton();
}

function applyRemoteSubtitles(data) {
    subtitleCues = (data && data.cues) || [];
    if (data && typeof data.delay === 'number') setSubtitleDelay(data.delay, { broadcast: false });
    if (typeof updateCcButton === 'function') updateCcButton();
}

function updateRemoteClock(state) {
    if (state && typeof state.position === 'number') remoteClock = { base: state.position, at: Date.now() };
}

function broadcastSubtitle() {
    if (!isHost || !socket) return;
    socket.emit('subtitle_set', { room_id: roomId, token: hostToken, cues: subtitleCues, delay: subtitleDelay });
}

function setSubtitleDelay(value, opts) {
    opts = opts || {};
    subtitleDelay = Math.max(-10, Math.min(10, Number(value) || 0));
    const input = document.getElementById('subDelay');
    if (input) input.value = subtitleDelay;
    const label = document.getElementById('subDelayVal');
    if (label) label.textContent = subtitleDelay.toFixed(1) + 's';
    if (opts.broadcast) broadcastSubtitle();
}

function setSubtitleSize(value) {
    subtitleFontScale = Math.max(0.5, Math.min(2.2, Number(value) || 1));
    const input = document.getElementById('subSize');
    if (input) input.value = Math.round(subtitleFontScale * 100);
    const label = document.getElementById('subSizeVal');
    if (label) label.textContent = Math.round(subtitleFontScale * 100) + '%';
}

async function loadExternalSubtitle(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const cues = parseCues(text);
        if (!cues.length) {
            if (typeof showToast === 'function') showToast('No subtitle cues found in ' + file.name);
            return;
        }
        subtitleCues = cues;
        subtitlesEnabled = true;
        broadcastSubtitle();
        if (typeof updateCcButton === 'function') updateCcButton();
        if (typeof showToast === 'function') showToast('Loaded ' + file.name + ' · ' + cues.length + ' cues');
    } catch (e) {
        if (typeof showToast === 'function') showToast('Could not read subtitle file');
    }
}

function subtitleStem(name) { return String(name).replace(/\.[^.]+$/, '').toLowerCase(); }
function isSubtitleFile(name) { return /\.(srt|vtt)$/i.test(String(name)); }

function findMatchingSubtitle(files, videoFile) {
    const stem = subtitleStem(videoFile.name);
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f === videoFile) continue;
        if (isSubtitleFile(f.name) && subtitleStem(f.name) === stem) return f;
    }
    return null;
}

function turnOffSubtitles() {
    subtitleCues = [];
    if (isHost && socket) socket.emit('subtitle_off', { room_id: roomId, token: hostToken });
    if (typeof updateCcButton === 'function') updateCcButton();
}

function setSubtitleStatus(text, kind) {
    const el = document.getElementById('subtitleScanStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sub-status' + (kind ? ' ' + kind : '');
    el.classList.toggle('hidden', !text);
}

/* "eng · SRT" style labels; falls back to "Embedded N" for tracks with no
   language. Kept in the same shape the reference player uses. */
function embeddedTrackLabel(track, i) {
    const parts = [];
    if (track.language) parts.push(String(track.language).toUpperCase());
    else if (track.name) parts.push(track.name);
    if (track.codec) parts.push(String(track.codec).toUpperCase());
    if (parts.length) return parts.join(' · ');
    return 'Embedded ' + (i + 1);
}

async function refreshSubtitleSources(force) {
    if (!isHost || !window.WTLocal || !window.WTLocal.listEmbeddedSubtitles) return;
    const file = window.WTLocal.file;
    if (!file) {
        embeddedTracks = [];
        scannedSubtitleFile = null;
        setSubtitleStatus('');
        updateSubtitleDropdown();
        return;
    }
    if (!force && file === scannedSubtitleFile) { updateSubtitleDropdown(); return; }
    setSubtitleStatus('Scanning for subtitle tracks…', 'busy');
    try {
        embeddedTracks = await window.WTLocal.listEmbeddedSubtitles();
        scannedSubtitleFile = file;
        setSubtitleStatus('');
    } catch (e) {
        embeddedTracks = [];
        setSubtitleStatus('Could not scan for subtitle tracks', 'error');
    }
    updateSubtitleDropdown();
}

function updateSubtitleDropdown() {
    const select = document.getElementById('subtitleTrack');
    if (!select) return;
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = embeddedTracks.length
        ? 'Off'
        : 'None found';
    select.appendChild(none);

    embeddedTracks.forEach(function (track, i) {
        const opt = document.createElement('option');
        opt.value = 'embed:' + i;
        opt.textContent = embeddedTrackLabel(track, i);
        select.appendChild(opt);
    });

    const count = document.getElementById('subtitleCount');
    if (count) {
        count.textContent = embeddedTracks.length
            ? embeddedTracks.length + (embeddedTracks.length === 1 ? ' track' : ' tracks')
            : '';
        count.classList.toggle('hidden', !embeddedTracks.length);
    }
}

async function selectSubtitle(value) {
    if (!value) { turnOffSubtitles(); setSubtitleStatus(''); return; }
    if (value.indexOf('embed:') === 0) {
        const index = parseInt(value.slice(6), 10);
        const track = embeddedTracks[index];
        setSubtitleStatus('Extracting… (first use downloads a ~30 MB engine)', 'busy');
        try {
            const srt = await window.WTLocal.extractSubtitle(index);
            subtitleCues = parseCues(srt);
            subtitlesEnabled = true;
            setSubtitleStatus(subtitleCues.length
                ? subtitleCues.length + ' cues from ' + embeddedTrackLabel(track, index)
                : '');
            broadcastSubtitle();
        } catch (e) {
            console.warn('Could not extract embedded subtitle:', e && e.message);
            const msg = (e && e.code === 'subtitle' && e.message)
                ? e.message
                : (e && e.message) || 'unknown error';
            setSubtitleStatus('Could not load this track: ' + msg, 'error');
            if (typeof showToast === 'function') showToast('Could not load that subtitle track');
            subtitleCues = [];
            broadcastSubtitle();
        }
        if (typeof updateCcButton === 'function') updateCcButton();
    }
}

function setupSubtitleUI() {
    const select = document.getElementById('subtitleTrack');
    if (select) select.addEventListener('change', function () { selectSubtitle(this.value); });

    const delay = document.getElementById('subDelay');
    if (delay) delay.addEventListener('input', function () {
        setSubtitleDelay(this.value, { broadcast: isHost });
    });
    const size = document.getElementById('subSize');
    if (size) size.addEventListener('input', function () { setSubtitleSize(this.value / 100); });

    const loadBtn = document.getElementById('loadSubtitleBtn');
    const fileInput = document.getElementById('subtitleFileInput');
    if (loadBtn && fileInput) loadBtn.addEventListener('click', function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function () {
        const f = this.files && this.files[0];
        this.value = '';
        if (f) loadExternalSubtitle(f);
    });

    if (subtitleRafId === null) subtitleRafId = requestAnimationFrame(renderSubtitles);
    updateSubtitleDropdown();
    setSubtitleDelay(subtitleDelay, { broadcast: false });
    setSubtitleSize(subtitleFontScale);
}

document.addEventListener('DOMContentLoaded', setupSubtitleUI);
