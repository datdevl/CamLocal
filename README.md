# Android Camera Hub

Biến những chiếc điện thoại Android dư thành camera giám sát realtime.  
Nhiều thiết bị truy cập → nhiều camera hiển thị cùng lúc trên trang Viewer.

## Tính năng

- **WebRTC peer-to-peer** (qua PeerJS) – video đi trực tiếp giữa các thiết bị, không lưu trên server.
- Giao diện đẹp, tối, phù hợp giám sát.
- Hỗ trợ nhiều camera cùng lúc (grid tự động).
- Đặt tên từng camera.
- Chọn camera trước/sau trên điện thoại.
- **Screen Wake Lock** – giữ màn hình sáng để stream ổn định.
- PWA-ready (có thể “Thêm vào màn hình chính”).

## Cách dùng

### 1. Host website
Cần **HTTPS** (hoặc `localhost`) vì trình duyệt chỉ cho phép camera trên secure context.

Cách nhanh:
- Đưa cả thư mục lên Netlify / Vercel / GitHub Pages / Cloudflare Pages.
- Hoặc chạy local:  
  ```bash
  npx serve .
  ```
  (sau đó mở `https://...` hoặc dùng tunneling như ngrok nếu test từ điện thoại thật).

### 2. Tạo Room
- Mở trang chủ → nhập **Mã phòng** (ví dụ: `nha-toi`).
- Dùng **cùng mã phòng** trên tất cả thiết bị.

### 3. Mở Viewer
- Trên máy tính / điện thoại chính → chọn **Xem camera (Viewer)**.
- Giữ trang này mở.

### 4. Biến điện thoại thành Camera
- Trên mỗi Android dư → mở cùng website → chọn **Biến thành Camera**.
- Đặt tên (Phòng khách, Cổng trước…).
- Bấm **Bắt đầu stream** → cho phép camera.
- Bật **Giữ màn hình sáng**.

Mỗi điện thoại sẽ xuất hiện thêm một khung hình trên trang Viewer.

## Lưu ý quan trọng về “tắt màn hình”

Trình duyệt mobile (Chrome Android) **tạm dừng** JavaScript + media stream khi:
- Tắt màn hình
- Chuyển sang app khác
- Tab bị background lâu

**Wake Lock API** chỉ giữ màn hình **không tắt**, chứ không cho chạy khi màn hình đã off.

### Khuyến nghị thực tế:
1. Giữ màn hình sáng + giảm độ sáng xuống thấp.
2. Cắm sạc + bật “Keep screen on while charging” (Developer options).
3. Hoặc dùng app native (IP Webcam, DroidCam…) nếu cần chạy thật sự khi tắt màn hình.

## Cấu trúc thư mục

```
android-camera-web/
├── index.html          # Trang chủ chọn mode
├── viewer.html         # Màn hình xem tất cả camera
├── camera.html         # Mode camera trên điện thoại
├── css/style.css
├── js/viewer.js
├── js/camera.js
├── manifest.json
└── README.md
```

## Công nghệ

- PeerJS (signaling + WebRTC wrapper)
- Screen Wake Lock API
- getUserMedia
- Pure HTML/CSS/JS – không cần backend riêng

## Giới hạn

- PeerJS cloud có giới hạn concurrent connection. Với nhiều camera (>5–8) nên tự host PeerJS server.
- NAT/firewall phức tạp có thể cần TURN server (hiện chỉ dùng STUN miễn phí).

---
Chúc bạn dùng vui!  
Nếu cần thêm ghi âm, ghi video, hoặc tự host signaling server thì có thể mở rộng dễ dàng.
