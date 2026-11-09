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
  let reconnectTimer = null;
  let isStopped = true;
  let currentName = 'Camera';

  const viewerPeerId = 'viewer-' + room;

  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  };

  function setConnStatus(text, state) {
    connStatus.textContent = text;
    connStatus.className = 'badge ' + (state || '');
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || !wakeLockToggle.checked) return;
    try {
      if (wakeLock) { try { await wakeLock.release(); } catch (_) {} }
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      console.warn('WakeLock', e);
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
    if (wakeLockToggle.checked && localStream) await requestWakeLock();
    else await releaseWakeLock();
  });

  async function loadDevices() {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      temp.getTracks().forEach(t => t.stop());
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === 'videoinput');
      cameraSelect.innerHTML = '';
      cams.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || ('Camera ' + (i + 1));
        cameraSelect.appendChild(opt);
      });
      if (!cams.length) cameraSelect.innerHTML = '<option value="">Không tìm thấy camera</option>';
    } catch (e) {
      cameraSelect.innerHTML = '<option value="">Cần cho phép camera</option>';
    }
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function destroyPeer() {
    clearTimers();
    if (currentCall) {
      try { currentCall.close(); } catch (_) {}
      currentCall = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (_) {}
      peer = null;
    }
  }

  function makeCall() {
    if (isStopped || !peer || peer.destroyed || !localStream) return;

    try {
      if (currentCall) {
        try { currentCall.close(); } catch (_) {}
        currentCall = null;
      }

      // Ensure tracks are enabled before sending
      localStream.getTracks().forEach(t => { t.enabled = true; });

      currentCall = peer.call(viewerPeerId, localStream, {
        metadata: { name: currentName }
      });

      if (!currentCall) {
        setConnStatus('Không gọi được', '');
        return;
      }

      currentCall.on('close', () => {
        if (!isStopped) setConnStatus('Mất kết nối – đang thử lại...', 'connecting');
      });

      currentCall.on('error', () => {
        if (!isStopped) setConnStatus('Lỗi call – đang thử lại...', 'connecting');
      });

      setTimeout(() => {
        if (currentCall && currentCall.open) {
          setConnStatus('Đang stream', 'connected');
        } else if (!isStopped) {
          setConnStatus('Chờ viewer...', 'connecting');
        }
      }, 2000);
    } catch (e) {
      console.error(e);
      setConnStatus('Lỗi gọi', '');
    }
  }

  function startPeerAndCall() {
    destroyPeer();
    if (isStopped || !localStream) return;

    setConnStatus('Đang kết nối...', 'connecting');

    peer = new Peer({
      debug: 0,
      config: ICE_CONFIG
    });

    peer.on('open', id => {
      console.log('[Camera] peer open', id);
      makeCall();
      clearTimers();
      reconnectTimer = setInterval(() => {
        if (isStopped) return;
        if (!currentCall || !currentCall.open) {
          console.log('[Camera] retry call');
          makeCall();
        }
      }, 5000);
    });

    peer.on('error', err => {
      console.warn('[Camera] error', err.type);
      if (err.type === 'peer-unavailable') {
        setConnStatus('Viewer chưa mở – đang chờ...', 'connecting');
      } else {
        setConnStatus('Lỗi signaling – đang thử lại...', 'connecting');
        setTimeout(() => {
          if (!isStopped) startPeerAndCall();
        }, 3000);
      }
    });

    peer.on('disconnected', () => {
      if (isStopped) return;
      setConnStatus('Mất signaling – đang thử lại...', 'connecting');
      setTimeout(() => {
        if (!isStopped) startPeerAndCall();
      }, 2500);
    });
  }

  async function startStream() {
    if (localStream) return;

    currentName = camNameInput.value.trim() || 'Camera';
    localStorage.setItem('camName', currentName);
    camNameDisplay.textContent = currentName;
    isStopped = false;

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
      localStream.getTracks().forEach(t => t.enabled = true);
      localVideo.srcObject = localStream;
      await localVideo.play().catch(() => {});

      await requestWakeLock();

      btnStart.disabled = true;
      btnStop.disabled = false;
      cameraSelect.disabled = true;

      startPeerAndCall();
    } catch (err) {
      console.error(err);
      alert('Không thể truy cập camera: ' + err.message);
      setConnStatus('Lỗi camera', '');
      stopStream();
    }
  }

  function stopStream() {
    isStopped = true;
    destroyPeer();

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

  window.addEventListener('beforeunload', () => { isStopped = true; stopStream(); });
  window.addEventListener('pagehide', () => { isStopped = true; stopStream(); });
})();
