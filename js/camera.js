(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || localStorage.getItem('cameraRoomId') || 'default').toLowerCase();

  const roomBadge = document.getElementById('roomBadge');
  const localVideo = document.getElementById('localVideo');
  const camNameInput = document.getElementById('camName');
  const cameraSelect = document.getElementById('cameraSelect');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const connStatus = document.getElementById('connStatus');
  const camNameDisplay = document.getElementById('camNameDisplay');
  const wakeLockToggle = document.getElementById('wakeLockToggle');

  roomBadge.textContent = room;

  const savedName = localStorage.getItem('camName') || '';
  camNameInput.value = savedName;
  camNameDisplay.textContent = savedName || 'Camera';

  camNameInput.addEventListener('input', () => {
    const n = camNameInput.value.trim() || 'Camera';
    camNameDisplay.textContent = n;
    localStorage.setItem('camName', camNameInput.value.trim());
  });

  let peer = null;
  let localStream = null;
  let currentCall = null;
  let wakeLock = null;
  let devices = [];
  let reconnectTimer = null;
  let isIntentionalStop = false;

  const viewerPeerId = `viewer-${room}`;

  function setConnStatus(text, state) {
    connStatus.textContent = text;
    connStatus.className = 'badge ' + (state || '');
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || !wakeLockToggle.checked) return;
    try {
      if (wakeLock) {
        try { await wakeLock.release(); } catch (_) {}
      }
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  }

  async function releaseWakeLock() {
    if (wakeLock) {
      try { await wakeLock.release(); } catch (_) {}
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && localStream && wakeLockToggle.checked) {
      await requestWakeLock();
    }
  });

  wakeLockToggle.addEventListener('change', async () => {
    if (wakeLockToggle.checked && localStream) {
      await requestWakeLock();
    } else {
      await releaseWakeLock();
    }
  });

  async function loadDevices() {
    try {
      // Request permission to get labels
      const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      temp.getTracks().forEach(t => t.stop());

      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter(d => d.kind === 'videoinput');
      cameraSelect.innerHTML = '';
      devices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(opt);
      });
      if (devices.length === 0) {
        cameraSelect.innerHTML = '<option value="">Không tìm thấy camera</option>';
      }
    } catch (err) {
      console.error(err);
      cameraSelect.innerHTML = '<option value="">Cần cho phép camera</option>';
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function startReconnectLoop(name) {
    clearReconnectTimer();
    reconnectTimer = setInterval(() => {
      if (isIntentionalStop || !localStream) {
        clearReconnectTimer();
        return;
      }
      // If no open call, try again
      if (!currentCall || !currentCall.open) {
        console.log('Retrying call to viewer...');
        makeCall(name);
      }
    }, 4000);
  }

  function makeCall(name) {
    if (!peer || peer.destroyed || !localStream) return;

    try {
      // Close previous attempt if any
      if (currentCall) {
        try { currentCall.close(); } catch (_) {}
        currentCall = null;
      }

      currentCall = peer.call(viewerPeerId, localStream, {
        metadata: { name }
      });

      if (!currentCall) {
        setConnStatus('Không gọi được viewer', '');
        return;
      }

      currentCall.on('stream', () => {
        // Viewer does not send stream back
      });

      currentCall.on('close', () => {
        console.log('Call closed by remote');
        if (!isIntentionalStop) {
          setConnStatus('Mất kết nối – đang thử lại...', 'connecting');
        }
      });

      currentCall.on('error', (err) => {
        console.error('Call error', err);
        if (!isIntentionalStop) {
          setConnStatus('Lỗi kết nối – đang thử lại...', 'connecting');
        }
      });

      // Check after a short delay
      setTimeout(() => {
        if (currentCall && currentCall.open) {
          setConnStatus('Đang stream', 'connected');
        } else if (!isIntentionalStop) {
          setConnStatus('Chờ viewer...', 'connecting');
        }
      }, 1800);
    } catch (e) {
      console.error('makeCall error', e);
      setConnStatus('Lỗi gọi viewer', '');
    }
  }

  function connectToViewer(name) {
    setConnStatus('Đang kết nối...', 'connecting');
    isIntentionalStop = false;

    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (_) {}
    }

    peer = new Peer({
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
      console.log('Camera peer open:', id);
      makeCall(name);
      startReconnectLoop(name);
    });

    peer.on('error', (err) => {
      console.error('Peer error', err.type, err);
      if (err.type === 'peer-unavailable') {
        setConnStatus('Viewer chưa mở – đang chờ...', 'connecting');
      } else if (err.type === 'network') {
        setConnStatus('Lỗi mạng...', 'connecting');
      } else {
        setConnStatus('Lỗi: ' + (err.type || ''), '');
      }
    });

    peer.on('disconnected', () => {
      if (!isIntentionalStop) {
        setConnStatus('Mất signaling – đang thử lại...', 'connecting');
        setTimeout(() => {
          if (peer && peer.disconnected && !peer.destroyed) {
            try { peer.reconnect(); } catch (_) {}
          }
        }, 2000);
      }
    });
  }

  async function startStream() {
    if (localStream) return;

    const name = camNameInput.value.trim() || 'Camera';
    localStorage.setItem('camName', name);
    camNameDisplay.textContent = name;

    const constraints = {
      audio: false,
      video: {
        deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: cameraSelect.value ? undefined : 'environment'
      }
    };

    try {
      setConnStatus('Đang mở camera...', 'connecting');
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideo.srcObject = localStream;
      await localVideo.play().catch(() => {});

      await requestWakeLock();

      btnStart.disabled = true;
      btnStop.disabled = false;
      cameraSelect.disabled = true;

      connectToViewer(name);
    } catch (err) {
      console.error(err);
      alert('Không thể truy cập camera: ' + err.message);
      setConnStatus('Lỗi camera', '');
      stopStream();
    }
  }

  function stopStream() {
    isIntentionalStop = true;
    clearReconnectTimer();

    if (currentCall) {
      try { currentCall.close(); } catch (_) {}
      currentCall = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (_) {}
      peer = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    localVideo.srcObject = null;
    releaseWakeLock();

    btnStart.disabled = false;
    btnStop.disabled = true;
    cameraSelect.disabled = false;
    setConnStatus('Đã dừng', '');
  }

  btnStart.addEventListener('click', startStream);
  btnStop.addEventListener('click', stopStream);

  loadDevices();
  setConnStatus('Sẵn sàng', '');

  window.addEventListener('beforeunload', () => {
    isIntentionalStop = true;
    stopStream();
  });
  window.addEventListener('pagehide', () => {
    isIntentionalStop = true;
    stopStream();
  });
})();
