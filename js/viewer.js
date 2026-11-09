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

  const viewerPeerId = 'viewer-' + room;

  let peer = null;
  const activeCalls = new Map();
  let creating = false;
  let retryTimer = null;
  let retryCount = 0;

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
      try {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
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
    console.log('[Viewer] addCamera', remotePeerId, 'tracks:', stream.getVideoTracks().length, 'active:', stream.active);

    stream.getTracks().forEach(t => {
      t.enabled = true;
      console.log('[Viewer] track', t.kind, t.readyState, t.enabled, t.muted);
    });

    if (activeCalls.has(remotePeerId)) {
      const old = activeCalls.get(remotePeerId);
      old.stream = stream;
      old.video.srcObject = null;
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
    video.controls = false;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.style.background = '#000';
    video.srcObject = stream;

    const frame = document.createElement('div');
    frame.className = 'cam-frame';

    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `<span class="cam-name">${escapeHtml(name || 'Camera')}</span><span class="live">LIVE</span>`;

    const enlargeHint = document.createElement('div');
    enlargeHint.className = 'enlarge-hint';
    enlargeHint.innerHTML = '<span>🔍 Phóng to</span>';

    // Fallback "no signal" overlay
    const noSignal = document.createElement('div');
    noSignal.className = 'no-signal';
    noSignal.innerHTML = '<div>Đang nhận tín hiệu...</div>';
    noSignal.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;color:#94a3b8;font-size:0.9rem;z-index:1;';

    card.appendChild(video);
    card.appendChild(noSignal);
    card.appendChild(frame);
    card.appendChild(label);
    card.appendChild(enlargeHint);
    cameraGrid.appendChild(card);

    const entry = { video, card, stream, name: name || 'Camera', noSignal };
    activeCalls.set(remotePeerId, entry);
    updateGridClass();
    forcePlay(video);

    // Hide "no signal" when we get real frames
    const checkFrames = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        noSignal.style.display = 'none';
        return true;
      }
      return false;
    };

    video.addEventListener('playing', () => {
      noSignal.style.display = 'none';
    });

    // Aggressive re-attach if still black
    let tries = 0;
    const reattachInterval = setInterval(() => {
      tries++;
      if (checkFrames() || tries > 15) {
        clearInterval(reattachInterval);
        if (!checkFrames()) {
          noSignal.innerHTML = '<div>Không có hình ảnh<br><small>Thử tắt/bật lại camera</small></div>';
        }
        return;
      }
      // re-set srcObject
      video.srcObject = null;
      video.srcObject = stream;
      forcePlay(video);
    }, 1500);

    const open = () => openFullscreen(entry);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    stream.getVideoTracks().forEach(track => {
      track.onended = () => {
        clearInterval(reattachInterval);
        removeCamera(remotePeerId);
      };
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
      try { peer.destroy(); } catch (_) {}
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
      retryCount = 0;
      console.log('[Viewer] open', id);
      setStatus(true, 'Sẵn sàng');
      if (viewerIdDisplay) viewerIdDisplay.textContent = 'ID: ' + id;
    });

    peer.on('call', call => {
      console.log('[Viewer] incoming call', call.peer);
      call.answer();

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
        retryCount++;
        if (retryCount <= 8) {
          setStatus(false, 'Room đang bị giữ – đang thử lại... (' + retryCount + ')');
          retryTimer = setTimeout(() => createPeer(), 2500);
        } else {
          setStatus(false, 'Room bị chiếm lâu. Hãy đổi Room ID khác');
        }
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setStatus(false, 'Mất kết nối signaling – đang thử lại...');
        retryTimer = setTimeout(() => createPeer(), 3000);
      } else {
        setStatus(false, 'Lỗi: ' + (err.type || 'unknown'));
        retryTimer = setTimeout(() => createPeer(), 4000);
      }
    });

    peer.on('disconnected', () => {
      console.warn('[Viewer] disconnected');
      setStatus(false, 'Mất kết nối signaling – đang thử lại...');
      retryTimer = setTimeout(() => createPeer(), 2500);
    });

    peer.on('close', () => {
      console.log('[Viewer] peer closed');
    });
  }

  window.addEventListener('beforeunload', destroyPeer);
  window.addEventListener('pagehide', destroyPeer);

  createPeer();
  updateGridClass();
})();
