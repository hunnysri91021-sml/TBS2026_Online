// ════════════════════════════════════════════════════════════
//  TBS2026 — Cloudflare Worker proxy
//  คั่นกลางระหว่างหน้าเว็บ (GitHub Pages) กับ Google Apps Script
//  เพื่อซ่อน URL ของ Apps Script จริงไว้ฝั่งเซิร์ฟเวอร์ (PDPA)
//
//  หน้าเว็บเรียก:   https://<worker>.workers.dev/?action=getAll&callback=...
//  Worker ส่งต่อไป:  <GS_URL>?action=getAll&callback=...   (GS_URL เป็น Secret)
//
//  ⚠ ทุกครั้งที่ไฟล์นี้เปลี่ยน ต้องเข้า Cloudflare → Worker → Edit code →
//    วางโค้ดใหม่ทั้งไฟล์ → Deploy ซ้ำด้วยเสมอ (แก้ในนี้ไม่ auto sync ไป Cloudflare)
//
//  วิธี deploy (ครั้งเดียว ~10 นาที):
//  1. สมัคร/ล็อกอิน https://dash.cloudflare.com (แผนฟรีพอ)
//  2. เมนู Workers & Pages → Create → Worker → ตั้งชื่อ เช่น tbs2026 → Deploy
//  3. กด Edit code → ลบโค้ดตัวอย่าง วางไฟล์นี้ทั้งไฟล์แทน → Deploy
//  4. ไปแท็บ Settings → Variables and Secrets → Add ทีละตัว (ทั้งสองตัวเลือก type = Secret):
//     - ชื่อ GS_URL ค่า = URL ของ Apps Script (https://script.google.com/macros/s/.../exec)
//       ⚠ แนะนำให้ Deploy Apps Script เป็น URL ใหม่ก่อน เพราะ URL เดิมเคยหลุดใน
//         ประวัติ GitHub แล้ว (Apps Script → Deploy → New deployment)
//     - ชื่อ APP_KEY ค่า = ตรงกับ WORKER_APP_KEY ใน index.html เป๊ะๆ
//       (ค่าเริ่มต้นในโค้ดคือ XD8jSeXzJiFMTKD8wT8FxvdLyRy5z3Z1 — เปลี่ยนเป็นค่าอื่นได้
//       แต่ต้องไปแก้ WORKER_APP_KEY ใน index.html ให้ตรงกันด้วย)
//  5. จด URL ของ Worker (https://tbs2026.<บัญชี>.workers.dev) แล้วนำไปใส่แทน
//     DEFAULT_GS_URL ใน index.html
//
//  หมายเหตุ: APP_KEY เป็นแค่ตัวกรองชั้นแรก กันคนเปิด URL Worker ตรงๆ โดยไม่ผ่านแอป
//  ไม่ใช่ระบบยืนยันตัวตนที่สมบูรณ์ เพราะค่านี้ก็ยังฝังอยู่ในโค้ดฝั่ง browser (public)
//  เหมือนกัน — การป้องกันที่แท้จริงต้องมีระบบ session/token ตรวจสอบฝั่ง Code.gs ด้วย
// ════════════════════════════════════════════════════════════

// action ฝั่งอ่าน (GET/JSONP) ที่อนุญาตให้ผ่าน — กัน action แปลกๆ ที่ไม่รู้จัก
const ALLOWED_GET_ACTIONS = new Set([
  'getAll', 'validatePin', 'ping', 'test',
]);

// บาง action (เช่น validatePin) หน้าเว็บเรียกด้วย fetch() ธรรมดาแล้วอ่าน response
// ตรงๆ (ไม่ใช่ JSONP แบบ <script>) จึงต้องมี CORS header ให้เบราว์เซอร์อ่านผลได้
// ไม่งั้นจะโดน "blocked by CORS policy" แม้ request จะสำเร็จฝั่งเซิร์ฟเวอร์ก็ตาม
function withCors(headers = {}) {
  return { ...headers, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors() });
    }

    const GS_URL = env.GS_URL;
    if (!GS_URL) return new Response('GS_URL secret not configured', { status: 500, headers: withCors() });

    const url = new URL(request.url);

    // เช็คกุญแจก่อนทุกอย่าง (ถ้าไม่ได้ตั้ง APP_KEY ไว้ ข้ามการเช็คนี้ไปเลย)
    if (env.APP_KEY && url.searchParams.get('k') !== env.APP_KEY) {
      return new Response('forbidden', { status: 403, headers: withCors() });
    }

    // GET = โหมดอ่าน (หน้าเว็บใช้ JSONP สำหรับ getAll: โหลดเป็น <script> แล้ว Google
    // ตอบเป็น JS — และ fetch() ธรรมดาสำหรับ validatePin/ping ซึ่งอ่าน response ตรงๆ)
    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || '';
      if (!ALLOWED_GET_ACTIONS.has(action)) {
        return new Response('unknown action', { status: 400, headers: withCors() });
      }
      // ไม่ส่งกุญแจต่อไปให้ Apps Script (Code.gs ไม่รู้จัก param นี้)
      url.searchParams.delete('k');
      const upstream = await fetch(GS_URL + url.search, { redirect: 'follow' });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: withCors({
          'content-type': upstream.headers.get('content-type') || 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        }),
      });
    }

    // POST = โหมดเขียน (หน้าเว็บยิงแบบ no-cors จึงไม่อ่านผลลัพธ์อยู่แล้ว)
    if (request.method === 'POST') {
      const body = await request.text();
      // จำกัดขนาด payload กันการยิงถล่ม (ข้อมูลจริงของระบบเล็กกว่านี้มาก)
      if (body.length > 1_000_000) return new Response('payload too large', { status: 413, headers: withCors() });
      const upstream = await fetch(GS_URL, { method: 'POST', body, redirect: 'follow' });
      return new Response('ok', { status: upstream.ok ? 200 : upstream.status, headers: withCors() });
    }

    return new Response('method not allowed', { status: 405, headers: withCors() });
  },
};
