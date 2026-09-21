# 🤖 TimeBot (TIMOVNBOT) - Trợ Lý Quản Lý Thời Gian Thông Minh

Hệ thống quản lý lịch trình hoàn chỉnh tích hợp **Website Realtime**, **Telegram Bot**, **AI Gemini** và **Bộ nhắc giờ tự động**.

---

## 🌟 Tính năng nổi bật

- 🖥️ **Website Quản lý lịch trình**: Giao diện Premium, Modern, Minimal hỗ trợ Realtime Sync qua Server-Sent Events (SSE).
- 🤖 **Telegram Bot Instant Polling**: Phản hồi tức thì (<100ms), hỗ trợ Menu điều hướng, 5 bước tạo lịch nhanh, xóa/hoàn thành/gia hạn công việc.
- 🧠 **AI Phân tích lịch trình (Gemini)**: Tự động bóc tách thời khóa biểu phức tạp, bảng lịch học/làm việc nhiều ngày & nhiều cột.
- ⏰ **Background Scheduler**: Hệ thống chạy ngầm quét 10s/lần, tự động phát thông báo nhắc nhở Telegram (`🔔 SẮP ĐẾN GIỜ`, `🚨 ĐÃ ĐẾN GIỜ`, `✅ LỊCH KẾT THÚC`) kèm trích dẫn truyền cảm hứng ngẫu nhiên.
- 💾 **SQLite Database**: Lưu trữ dữ liệu an toàn, lưu phiên làm việc (Session) chống mất dữ liệu khi khởi động lại.

---

## 🚀 Hướng dẫn chạy ứng dụng

```bash
# Cài đặt và chạy máy chủ
node server.js
```

Website sẽ chạy tại: `http://localhost:3000`

---

## 📁 Cấu trúc dự án

```text
timebot/
├── public/              # Giao diện Website (HTML, CSS, JS)
├── src/
│   ├── aiService.js     # Phân tích AI Gemini & Failover Retry
│   ├── config.js        # Quản lý cấu hình & Cài đặt
│   ├── db.js            # Khởi tạo SQLite Database (Tables & Indexes)
│   ├── quotes.js        # Thư viện trích dẫn truyền cảm hứng
│   ├── scheduler.js     # Bộ đếm nhắc giờ ngầm tự động
│   ├── syncEvents.js    # Event Broadcast (SSE Realtime)
│   ├── telegramBot.js   # Động cơ Telegram Bot (Polling & Callbacks)
│   └── timeUtils.js     # Tiện ích thời gian & Chuẩn hóa ngày giờ
├── server.js            # Node.js HTTP Server & REST API Routes
├── .gitignore           # Cấu hình bỏ qua tệp tạm/database
└── README.md            # Tài liệu dự án
```

---

## 🛠️ Công nghệ sử dụng

- **Backend**: Node.js (Standard HTTP Module, `node:sqlite`)
- **Frontend**: Vanilla HTML5, CSS3 Glassmorphism, JavaScript ES6
- **Database**: Native SQLite (`timebot.db`)
- **AI Engine**: Google Gemini API (`gemini-3.6-flash`)
- **Bot Engine**: Telegram Bot API (`https://api.telegram.org`)
