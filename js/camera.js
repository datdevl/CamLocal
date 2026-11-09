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

  // Restore name
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

  const viewerPeerId = `viewer-${room}`;

  function setConnStatus(text, state) {
    connStatus.textContent = text;
    connStatus.className = 'badge ' + (state || '');
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || !wakeLockToggle.checked) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock active');
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

  // Re-acquire wake lock when page becomes visible again
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
      // Need permission first to get labels
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
        facingMode: 'environment' // prefer back camera on mobile
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

      // Connect to viewer
      connectToViewer(name);
    } catch (err) {
      console.error(err);
      alert('Không thể truy cập camera: ' + err.message);
      setConnStatus('Lỗi camera', '');
      stopStream();
    }
  }

  function connectToViewer(name) {
    setConnStatus('Đang kết nối...', 'connecting');

    peer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('Camera peer open:', id);
      // Call the viewer
      try {
        currentCall = peer.call(viewerPeerId, localStream, {
          metadata: { name }
        });

        if (!currentCall) {
          setConnStatus('Không gọi được viewer', '');
          return;
        }

        currentCall.on('stream', () => {
          // Viewer doesn't send stream back
        });

        currentCall.on('close', () => {
          setConnStatus('Viewer đã ngắt', '');
        });

        currentCall.on('error', (err) => {
          console.error('Call error', err);
          setConnStatus('Lỗi kết nối', '');
        });

        // Give a moment then assume connected if no error
        setTimeout(() => {
          if (currentCall && currentCall.open) {
            setConnStatus('Đang stream', 'connected');
          } else {
            setConnStatus('Chờ viewer...', 'connecting');
          }
        }, 1500);
      } catch (e) {
        console.error(e);
        setConnStatus('Lỗi gọi viewer', '');
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error', err);
      if (err.type === 'peer-unavailable') {
        setConnStatus('Viewer chưa mở – đang chờ...', 'connecting');
        // Retry after a few seconds
        setTimeout(() => {
          if (localStream && peer && !peer.destroyed) {
            try {
              currentCall = peer.call(viewerPeerId, localStream, { metadata: { name } });
              setTimeout(() => {
                if (currentCall && currentCall.open) setConnStatus('Đang stream', 'connected');
              }, 1200);
            } catch (_) {}
          }
        }, 3000);
      } else {
        setConnStatus('Lỗi: ' + (err.type || err.message), '');
      }
    });
  }

  function stopStream() {
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

  // Keep trying to reconnect if viewer comes online later
  setInterval(() => {
    if (localStream && peer && !peer.destroyed && (!currentCall || !currentCall.open)) {
      const name = camNameInput.value.trim() || 'Camera';
      try {
        currentCall = peer.call(viewerPeerId, localStream, { metadata: { name } });
        setTimeout(() => {
          if (currentCall && currentCall.open) setConnStatus('Đang stream', 'connected');
        }, 1000);
      } catch (_) {}
    }
  }, 5000);

  // Init
  loadDevices();
  setConnStatus('Sẵn sàng', '');

  window.addEventListener('beforeunload', () => {
    stopStream();
  });
})();
