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

  // Fixed ID so cameras know where to call
  const viewerPeerId = `viewer-${room}`;

  let peer = null;
  const activeCalls = new Map(); // peerId -> { video, card, stream, name }

  function setStatus(connected, text) {
    statusText.textContent = text;
    statusEl.classList.toggle('connected', connected);
  }

  function updateGridClass() {
    const n = activeCalls.size;
    cameraGrid.className = 'camera-grid cams-' + Math.min(n, 4);
    cameraCountEl.textContent = n === 0 ? '0 camera' : n + ' camera';
    emptyState.style.display = n === 0 ? 'flex' : 'none';
  }

  function forcePlay(video) {
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay blocked – wait for user gesture
        const resume = () => {
          video.play().catch(() => {});
          document.removeEventListener('click', resume);
          document.removeEventListener('touchstart', resume);
        };
        document.addEventListener('click', resume, { once: true });
        document.addEventListener('touchstart', resume, { once: true });
      });
    }
  }

  function openFullscreen(entry) {
    if (!entry || !entry.stream) return;

    fsVideo.srcObject = entry.stream;
    fsName.textContent = entry.name || 'Camera';
    fsOverlay.hidden = false;

    requestAnimationFrame(() => {
      fsOverlay.classList.add('open');
    });

    forcePlay(fsVideo);
    document.body.style.overflow = 'hidden';
  }

  function closeFullscreen() {
    fsOverlay.classList.remove('open');
    setTimeout(() => {
      fsOverlay.hidden = true;
      fsVideo.srcObject = null;
      document.body.style.overflow = '';
    }, 320);
  }

  fsClose.addEventListener('click', closeFullscreen);
  fsOverlay.querySelector('.fs-backdrop').addEventListener('click', closeFullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fsOverlay.classList.contains('open')) closeFullscreen();
  });

  function addCamera(remotePeerId, stream, name) {
    if (activeCalls.has(remotePeerId)) {
      // Update existing if stream changed
      const existing = activeCalls.get(remotePeerId);
      existing.stream = stream;
      existing.video.srcObject = stream;
      forcePlay(existing.video);
      return;
    }

    // Ensure tracks are enabled
    stream.getVideoTracks().forEach(t => {
      t.enabled = true;
    });

    const card = document.createElement('div');
    card.className = 'camera-card';
    card.dataset.peer = remotePeerId;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.srcObject = stream;

    // Force play when metadata is ready
    video.addEventListener('loadedmetadata', () => forcePlay(video));
    video.addEventListener('canplay', () => forcePlay(video));

    const frame = document.createElement('div');
    frame.className = 'cam-frame';

    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `
      <span class="cam-name">${escapeHtml(name || remotePeerId.slice(0, 10))}</span>
      <span class="live">LIVE</span>
    `;

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

    // Click / tap to fullscreen
    const open = () => openFullscreen(entry);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    // Watch for track ended (camera closed)
    stream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', () => {
        removeCamera(remotePeerId);
      });
    });
  }

  function removeCamera(remotePeerId) {
    const entry = activeCalls.get(remotePeerId);
    if (!entry) return;
    entry.video.srcObject = null;
    entry.card.remove();
    activeCalls.delete(remotePeerId);
    updateGridClass();

    if (fsVideo.srcObject === entry.stream) {
      closeFullscreen();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let retryCount = 0;
  const MAX_RETRIES = 5;

  function createPeer() {
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (_) {}
    }

    peer = new Peer(viewerPeerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('Viewer peer open:', id);
      retryCount = 0;
      setStatus(true, 'Sẵn sàng');
      if (viewerIdDisplay) viewerIdDisplay.textContent = 'ID: ' + id;
    });

    peer.on('call', (call) => {
      console.log('Incoming call from', call.peer, call.metadata);

      // Answer immediately (no local stream)
      call.answer();

      call.on('stream', (remoteStream) => {
        console.log('Got stream from', call.peer, remoteStream.getVideoTracks().length, 'video tracks');
        const name = (call.metadata && call.metadata.name) || call.peer;
        addCamera(call.peer, remoteStream, name);
      });

      call.on('close', () => {
        console.log('Call closed', call.peer);
        removeCamera(call.peer);
      });

      call.on('error', (err) => {
        console.error('Call error', err);
        removeCamera(call.peer);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error', err.type, err);

      if (err.type === 'unavailable-id') {
        // Previous session still holds the ID on PeerJS cloud
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          setStatus(false, `Room đang bị giữ, thử lại (${retryCount}/${MAX_RETRIES})...`);
          setTimeout(() => {
            createPeer();
          }, 1500 + retryCount * 800);
        } else {
          setStatus(false, 'Room bị chiếm. Hãy đổi Room ID hoặc đợi 30s rồi F5');
        }
      } else if (err.type === 'network' || err.type === 'server-error') {
        setStatus(false, 'Lỗi mạng, đang thử lại...');
        setTimeout(() => createPeer(), 2500);
      } else {
        setStatus(false, 'Lỗi: ' + (err.type || err.message));
      }
    });

    peer.on('disconnected', () => {
      setStatus(false, 'Mất kết nối signaling...');
      // PeerJS will try to reconnect automatically in many cases
      setTimeout(() => {
        if (peer && peer.disconnected && !peer.destroyed) {
          try { peer.reconnect(); } catch (_) {
            createPeer();
          }
        }
      }, 2000);
    });

    peer.on('close', () => {
      console.log('Peer closed');
    });
  }

  // Clean up on leave
  window.addEventListener('beforeunload', () => {
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (_) {}
    }
  });

  // Also destroy on pagehide (better for mobile)
  window.addEventListener('pagehide', () => {
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (_) {}
    }
  });

  createPeer();
  updateGridClass();
})();
