// =====================================================================
// === ZenNotif - Content Script (Keep-Alive Pinger) ===
// =====================================================================

// Script ini berjalan DI DALAM halaman Zendesk (*.zendesk.com)
// Tugasnya HANYA menjaga Service Worker tetap hidup dan bertindak
// sebagai "Pinger" untuk memicu pengecekan super cepat (10/15 detik).
// Logika utama (fetching, komparasi) tetap berada di background.js 
// sehingga aman dari spam API jika ada banyak tab Zendesk yang terbuka.

setInterval(() => {
  try {
    // Kirim ping ke background script setiap 5 detik
    chrome.runtime.sendMessage({ type: 'content-ping' });
  } catch (e) {
    // Abaikan error (biasanya terjadi sesaat setelah ekstensi di-reload atau diupdate)
  }
}, 5000);

// ZenNotif: Content script active for keep-alive pinging
