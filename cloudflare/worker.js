// ════════════════════════════════════════════════════════════
//  TBS2026 — Cloudflare Worker proxy
//  คั่นกลางระหว่างหน้าเว็บ (GitHub Pages) กับ Google Apps Script
//  เพื่อซ่อน URL ของ Apps Script จริงไว้ฝั่งเซิร์ฟเวอร์ (PDPA)
//
//  หน้าเว็บเรียก:   https://<worker>.workers.dev/?action=getAll&callback=...
//  Worker ส่งต่อไป:  <GS_URL>?action=getAll&callback=...   (GS_URL เป็น Secret)
//
//  วิธี deploy (ครั้งเดียว ~10 นาที):
//  1. สมัคร/ล็อกอิน https://dash.cloudflare.com (แผนฟรีพอ)
//  2. เมนู Workers & Pages → Create → Worker → ตั้งชื่อ เช่น tbs2026 → Deploy
//  3. กด Edit code → ลบโค้ดตัวอย่าง วางไฟล์นี้ทั้งไฟล์แทน → Deploy
//  4. ไปแท็บ Settings → Variables and Secrets → Add →
//     เลือก type = Secret, ชื่อ GS_URL,
//     ค่า = URL ของ Apps Script (https://script.google.com/macros/s/.../exec)
//     ⚠ แนะนำให้ Deploy Apps Script เป็น URL ใหม่ก่อน เพราะ URL เดิมเคยหลุดใน
//       ประวัติ GitHub แล้ว (Apps Script → Deploy → New deployment)
//  5. จด URL ของ Worker (https://tbs2026.<บัญชี>.workers.dev) แล้วนำไปใส่แทน
//     DEFAULT_GS_URL ใน index.html
// ════════════════════════════════════════════════════════════

// action ฝั่งอ่าน (GET/JSONP) ที่อนุญาตให้ผ่าน — กัน action แปลกๆ ที่ไม่รู้จัก
const ALLOWED_GET_ACTIONS = new Set([
  'getAll', 'validatePin', 'ping', 'test',
]);

export default {
  async fetch(request, env) {
    const GS_URL = env.GS_URL;
    if (!GS_URL) return new Response('GS_URL secret not configured', { status: 500 });

    const url = new URL(request.url);

    // GET = โหมดอ่าน (หน้าเว็บใช้ JSONP: โหลดเป็น <script> แล้ว Google ตอบเป็น JS)
    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || '';
      if (!ALLOWED_GET_ACTIONS.has(action)) {
        return new Response('unknown action', { status: 400 });
      }
      const upstream = await fetch(GS_URL + url.search, { redirect: 'follow' });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') || 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    // POST = โหมดเขียน (หน้าเว็บยิงแบบ no-cors จึงไม่อ่านผลลัพธ์อยู่แล้ว)
    if (request.method === 'POST') {
      const body = await request.text();
      // จำกัดขนาด payload กันการยิงถล่ม (ข้อมูลจริงของระบบเล็กกว่านี้มาก)
      if (body.length > 1_000_000) return new Response('payload too large', { status: 413 });
      const upstream = await fetch(GS_URL, { method: 'POST', body, redirect: 'follow' });
      return new Response('ok', { status: upstream.ok ? 200 : upstream.status });
    }

    return new Response('method not allowed', { status: 405 });
  },
};
