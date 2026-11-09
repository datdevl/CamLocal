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

  // Fullscreen elements
  const fsOverlay = document.getElementById('fsOverlay');
  const fsVideo = document.getElementById('fsVideo');
  const fsName = document.getElementById('fsName');
  const fsClose = document.getElementById('fsClose');

  roomBadge.textContent = room;

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

  function openFullscreen(entry) {
    if (!entry || !entry.stream) return;

    fsVideo.srcObject = entry.stream;
    fsName.textContent = entry.name || 'Camera';
    fsOverlay.hidden = false;

    // Force reflow then animate in
    requestAnimationFrame(() => {
      fsOverlay.classList.add('open');
    });

    fsVideo.play().catch(() => {});
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
    if (activeCalls.has(remotePeerId)) return;

    const card = document.createElement('div');
    card.className = 'camera-card';
    card.dataset.peer = remotePeerId;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;

    // Subtle inner frame
    const frame = document.createElement('div');
    frame.className = 'cam-frame';

    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `
      <span class="cam-name">${escapeHtml(name || remotePeerId.slice(0, 10))}</span>
      <span class="live">LIVE</span>
    `;

    // Click to enlarge
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

    video.play().catch(() => {});

    // Click / tap to fullscreen
    const open = () => openFullscreen(entry);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  }

  function removeCamera(remotePeerId) {
    const entry = activeCalls.get(remotePeerId);
    if (!entry) return;
    entry.video.srcObject = null;
    entry.card.remove();
    activeCalls.delete(remotePeerId);
    updateGridClass();

    // If this camera is currently fullscreen, close it
    if (fsVideo.srcObject === entry.stream) {
      closeFullscreen();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function initPeer() {
    setStatus(false, 'Đang kết nối...');

    peer = new Peer(viewerPeerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('Viewer peer open:', id);
      setStatus(true, 'Sẵn sàng');
      viewerIdDisplay.textContent = 'ID: ' + id;
    });

    peer.on('call', (call) => {
      call.answer();

      call.on('stream', (remoteStream) => {
        const name = (call.metadata && call.metadata.name) || call.peer;
        addCamera(call.peer, remoteStream, name);
      });

      call.on('close', () => removeCamera(call.peer));
      call.on('error', () => removeCamera(call.peer));
    });

    peer.on('error', (err) => {
      console.error('Peer error', err);
      if (err.type === 'unavailable-id') {
        setStatus(false, 'Room đang được dùng');
      } else {
        setStatus(false, 'Lỗi: ' + (err.type || err.message));
      }
    });

    peer.on('disconnected', () => {
      setStatus(false, 'Mất kết nối...');
      try { peer.reconnect(); } catch (_) {}
    });
  }

  window.addEventListener('beforeunload', () => {
    if (peer) peer.destroy();
  });

  initPeer();
  updateGridClass();
})();
