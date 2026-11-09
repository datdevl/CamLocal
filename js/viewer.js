(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || localStorage.getItem('cameraRoomId') || 'default').toLowerCase();

  const roomBadge = document.getElementById('roomBadge');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const emptyState = document.getElementById('emptyState');
  const cameraGrid = document.getElementById('cameraGrid');
  const cameraCountEl = document.getElementById('cameraCount');
  const viewerIdDisplay = document.getElementById('viewerIdDisplay');

  const fsOverlay = document.getElementById('fsOverlay');
  const fsVideo = document.getElementById('fsVideo');
  const fsName = document.getElementById('fsName');
  const fsClose = document.getElementById('fsClose');

  roomBadge.textContent = room;

  // Fixed ID so cameras can find the viewer
  const viewerPeerId = 'viewer-' + room;

  let peer = null;
  const activeCalls = new Map();
  let creating = false;
  let retryTimer = null;

  function setStatus(connected, text) {
    statusText.textContent = text;
    statusEl.classList.toggle('connected', !!connected);
  }

  function updateGridClass() {
    const n = activeCalls.size;
    cameraGrid.className = 'camera-grid cams-' + Math.min(n, 4);
    cameraCountEl.textContent = n === 0 ? '0 camera' : n + ' camera';
    emptyState.style.display = n === 0 ? 'flex' : 'none';
  }

  function forcePlay(video) {
    if (!video) return;
    const tryPlay = () => {
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    };
    tryPlay();
    video.addEventListener('loadedmetadata', tryPlay, { once: true });
    video.addEventListener('canplay', tryPlay, { once: true });
  }

  function openFullscreen(entry) {
    if (!entry || !entry.stream) return;
    fsVideo.srcObject = entry.stream;
    fsName.textContent = entry.name || 'Camera';
    fsOverlay.hidden = false;
    requestAnimationFrame(() => fsOverlay.classList.add('open'));
    forcePlay(fsVideo);
    document.body.style.overflow = 'hidden';
  }

  function closeFullscreen() {
    fsOverlay.classList.remove('open');
    setTimeout(() => {
      fsOverlay.hidden = true;
      fsVideo.srcObject = null;
      document.body.style.overflow = '';
    }, 300);
  }

  fsClose.addEventListener('click', closeFullscreen);
  fsOverlay.querySelector('.fs-backdrop').addEventListener('click', closeFullscreen);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && fsOverlay.classList.contains('open')) closeFullscreen();
  });

  function addCamera(remotePeerId, stream, name) {
    // Always ensure tracks are live
    stream.getTracks().forEach(t => { t.enabled = true; });

    if (activeCalls.has(remotePeerId)) {
      const old = activeCalls.get(remotePeerId);
      old.stream = stream;
      old.video.srcObject = stream;
      forcePlay(old.video);
      return;
    }

    const card = document.createElement('div');
    card.className = 'camera-card';
    card.dataset.peer = remotePeerId;
    card.tabIndex = 0;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.srcObject = stream;

    const frame = document.createElement('div');
    frame.className = 'cam-frame';

    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `<span class="cam-name">${escapeHtml(name || 'Camera')}</span><span class="live">LIVE</span>`;

    const enlargeHint = document.createElement('div');
    enlargeHint.className = 'enlarge-hint';
    enlargeHint.innerHTML = '<span>🔍 Phóng to</span>';

    card.appendChild(video);
    card.appendChild(frame);
    card.appendChild(label);
    card.appendChild(enlargeHint);
    cameraGrid.appendChild(card);

    const entry = { video, card, stream, name: name || 'Camera' };
    activeCalls.set(remotePeerId, entry);
    updateGridClass();
    forcePlay(video);

    // If after 2s still no picture, try re-attach
    setTimeout(() => {
      if (video.videoWidth === 0 && stream.active) {
        video.srcObject = null;
        video.srcObject = stream;
        forcePlay(video);
      }
    }, 2000);

    const open = () => openFullscreen(entry);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    stream.getVideoTracks().forEach(track => {
      track.onended = () => removeCamera(remotePeerId);
    });
  }

  function removeCamera(remotePeerId) {
    const entry = activeCalls.get(remotePeerId);
    if (!entry) return;
    entry.video.srcObject = null;
    entry.card.remove();
    activeCalls.delete(remotePeerId);
    updateGridClass();
    if (fsVideo.srcObject === entry.stream) closeFullscreen();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function destroyPeer() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (peer) {
      try {
        peer.destroy();
      } catch (_) {}
      peer = null;
    }
  }

  function createPeer() {
    if (creating) return;
    creating = true;
    destroyPeer();

    setStatus(false, 'Đang kết nối signaling...');

    peer = new Peer(viewerPeerId, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', id => {
      creating = false;
      console.log('[Viewer] open', id);
      setStatus(true, 'Sẵn sàng');
      if (viewerIdDisplay) viewerIdDisplay.textContent = 'ID: ' + id;
    });

    peer.on('call', call => {
      console.log('[Viewer] incoming call', call.peer);
      call.answer(); // no local stream

      call.on('stream', remoteStream => {
        console.log('[Viewer] stream received', remoteStream.getVideoTracks().length);
        const name = (call.metadata && call.metadata.name) || 'Camera';
        addCamera(call.peer, remoteStream, name);
      });

      call.on('close', () => removeCamera(call.peer));
      call.on('error', () => removeCamera(call.peer));
    });

    peer.on('error', err => {
      creating = false;
      console.warn('[Viewer] error', err.type);

      if (err.type === 'unavailable-id') {
        setStatus(false, 'Room đang bị giữ – đang thử lại...');
        // PeerJS cloud keeps the ID for a while. Wait then force recreate.
        retryTimer = setTimeout(() => createPeer(), 2200);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setStatus(false, 'Mất kết nối signaling – đang thử lại...');
        retryTimer = setTimeout(() => createPeer(), 2500);
      } else {
        setStatus(false, 'Lỗi: ' + (err.type || 'unknown'));
        retryTimer = setTimeout(() => createPeer(), 4000);
      }
    });

    peer.on('disconnected', () => {
      console.warn('[Viewer] disconnected');
      setStatus(false, 'Mất kết nối signaling – đang thử lại...');
      // Don't call peer.reconnect() – it is unreliable on the public cloud.
      // Fully destroy and recreate instead.
      retryTimer = setTimeout(() => createPeer(), 2000);
    });

    peer.on('close', () => {
      console.log('[Viewer] peer closed');
    });
  }

  // Clean destroy when leaving
  window.addEventListener('beforeunload', destroyPeer);
  window.addEventListener('pagehide', destroyPeer);

  // Start
  createPeer();
  updateGridClass();
})();
