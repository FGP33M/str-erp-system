// Unified Cloudflare Worker with Static Assets
import { getGoogleAccessToken, parseProductDetails, jsonResponse } from './functions/_helper.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // ==========================================
    // API ROUTES
    // ==========================================
    if (pathname.startsWith('/api/')) {
      const authSheetId = env.AUTH_SHEET_ID || '1uM237XywBb0lFa9wavSP-rxNEOYUQldJp7AnLX09uM8';
      const productSheetId = env.PRODUCT_SHEET_ID || '1pCuUFizx8K2VTjMGGXB4MYfVJQndIFseky_gKuzApPg';

      // 1. POST /api/login
      if (pathname === '/api/login' && method === 'POST') {
        try {
          const { username, password } = await request.json();
          if (!username || !password) {
            return jsonResponse({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }, 400);
          }

          const token = await getGoogleAccessToken(env);
          const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A2:F100`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!res.ok) {
            return jsonResponse({ success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลผู้ใช้งาน' }, 500);
          }

          const data = await res.json();
          const rows = data.values || [];
          let matchedUser = null;

          for (const r of rows) {
            const [user_id, uName, password_hash, full_name, role, is_active] = r;
            if (uName && uName.trim().toLowerCase() === username.trim().toLowerCase()) {
              matchedUser = {
                user_id,
                username: uName,
                password_hash,
                full_name,
                role: role ? role.trim().toLowerCase() : 'staff',
                is_active: is_active ? is_active.trim().toLowerCase() === 'active' : true
              };
              break;
            }
          }

          const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
          const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

          if (!matchedUser) {
            await logLogin(token, authSheetId, [['log_' + Date.now(), '-', username, '-', timestamp, clientIp, 'FAILED_USER_NOT_FOUND']]);
            return jsonResponse({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
          }

          if (!matchedUser.is_active) {
            await logLogin(token, authSheetId, [['log_' + Date.now(), matchedUser.user_id, matchedUser.username, matchedUser.role, timestamp, clientIp, 'FAILED_USER_INACTIVE']]);
            return jsonResponse({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' }, 403);
          }

          if (matchedUser.password_hash !== password) {
            await logLogin(token, authSheetId, [['log_' + Date.now(), matchedUser.user_id, matchedUser.username, matchedUser.role, timestamp, clientIp, 'FAILED_WRONG_PASSWORD']]);
            return jsonResponse({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
          }

          await logLogin(token, authSheetId, [['log_' + Date.now(), matchedUser.user_id, matchedUser.username, matchedUser.role, timestamp, clientIp, 'SUCCESS']]);

          const sessionData = {
            user_id: matchedUser.user_id,
            username: matchedUser.username,
            full_name: matchedUser.full_name,
            role: matchedUser.role,
            exp: Date.now() + 24 * 60 * 60 * 1000
          };
          const sessionToken = btoa(unescape(encodeURIComponent(JSON.stringify(sessionData))));

          return jsonResponse({
            success: true,
            token: sessionToken,
            user: {
              user_id: matchedUser.user_id,
              username: matchedUser.username,
              full_name: matchedUser.full_name,
              role: matchedUser.role
            }
          });
        } catch (err) {
          return jsonResponse({ success: false, message: err.message }, 500);
        }
      }

      // Helper: Get user from token
      const authHeader = request.headers.get('Authorization') || '';
      let currentUser = null;
      if (authHeader.startsWith('Bearer ')) {
        try {
          const raw = authHeader.substring(7);
          const jsonStr = decodeURIComponent(escape(atob(raw)));
          const parsed = JSON.parse(jsonStr);
          if (parsed && parsed.exp > Date.now()) {
            currentUser = parsed;
          }
        } catch (e) {}
      }

      // 2. GET /api/me
      if (pathname === '/api/me' && method === 'GET') {
        if (!currentUser) return jsonResponse({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
        return jsonResponse({ success: true, user: currentUser });
      }

      // 3. POST /api/logout
      if (pathname === '/api/logout' && method === 'POST') {
        return jsonResponse({ success: true, message: 'ออกจากระบบเรียบร้อย' });
      }

      // 4. GET /api/products
      if (pathname === '/api/products' && method === 'GET') {
        if (!currentUser) return jsonResponse({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);

        try {
          const q = (url.searchParams.get('q') || '').trim().toLowerCase();
          const supplierFilter = (url.searchParams.get('supplier') || '').trim().toLowerCase();
          const page = parseInt(url.searchParams.get('page')) || 1;
          const limit = parseInt(url.searchParams.get('limit')) || 50;

          const token = await getGoogleAccessToken(env);
          const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${productSheetId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const meta = await metaRes.json();
          const tabTitle = meta.sheets[0].properties.title;

          const range = encodeURIComponent(`'${tabTitle}'!A2:G`);
          const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${productSheetId}/values/${range}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!valRes.ok) return jsonResponse({ success: false, message: 'ไม่สามารถโหลดสินค้าได้' }, 500);

          const valData = await valRes.json();
          const rows = valData.values || [];

          const isManagerOrAdmin = (currentUser.role === 'manager' || currentUser.role === 'admin');
          const allSuppliers = new Set();
          const filtered = [];

          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const barcode = (r[0] || '').trim();
            const name = (r[1] || '').trim();
            if (!barcode && !name) continue;

            const supplier = (r[2] || '').trim();
            if (supplier) allSuppliers.add(supplier);

            const rawDetails = (r[3] || '').trim();
            const costPrice = (r[4] || '0').trim();
            const salePrice = (r[5] || '0').trim();
            const stock = (r[6] || '0').trim();

            const parsed = parseProductDetails(rawDetails);
            const searchIndex = `${barcode} ${name} ${supplier} ${parsed.location} ${parsed.unit}`.toLowerCase();

            if (supplierFilter && supplier.toLowerCase() !== supplierFilter) continue;
            if (q) {
              const terms = q.split(/\s+/).filter(Boolean);
              if (!terms.every(t => searchIndex.includes(t))) continue;
            }

            const item = {
              id: i + 1,
              barcode,
              name,
              supplier,
              details: parsed,
              sale_price: salePrice,
              stock_qty: stock
            };

            // STRICT SECURITY: Strip cost for staff
            if (isManagerOrAdmin) {
              item.cost_price = costPrice;
              const costNum = parseFloat(costPrice.replace(/,/g, ''));
              const saleNum = parseFloat(salePrice.replace(/,/g, ''));
              if (!isNaN(costNum) && !isNaN(saleNum) && costNum > 0) {
                item.profit = (saleNum - costNum).toLocaleString();
              } else {
                item.profit = '-';
              }
            }

            filtered.push(item);
          }

          const totalCount = filtered.length;
          const startIndex = (page - 1) * limit;
          const paginated = filtered.slice(startIndex, startIndex + limit);

          return jsonResponse({
            success: true,
            total: totalCount,
            page,
            limit,
            totalPages: Math.ceil(totalCount / limit),
            role: currentUser.role,
            isManagerOrAdmin,
            suppliers: Array.from(allSuppliers).sort(),
            items: paginated
          });
        } catch (err) {
          return jsonResponse({ success: false, message: err.message }, 500);
        }
      }

      // 5. POST /api/products/refresh
      if (pathname === '/api/products/refresh' && method === 'POST') {
        return jsonResponse({ success: true, message: 'รีเฟรชข้อมูลสินค้าเรียบร้อย' });
      }

      // 6. USER MANAGEMENT APIS (/api/users)
      if (pathname === '/api/users') {
        if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
          return jsonResponse({ success: false, message: 'ไม่มีสิทธิ์จัดการผู้ใช้งาน' }, 403);
        }

        const token = await getGoogleAccessToken(env);

        if (method === 'GET') {
          const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A2:F100`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          const rows = data.values || [];
          const users = [];

          for (let i = 0; i < rows.length; i++) {
            const [user_id, uName, password_hash, full_name, role, is_active] = rows[i];
            if (!user_id && !uName) continue;
            const userRole = role ? role.trim().toLowerCase() : 'staff';
            if (currentUser.role === 'manager' && (userRole === 'admin' || userRole === 'manager')) continue;

            users.push({
              row_index: i + 2,
              user_id,
              username: uName,
              full_name,
              role: userRole,
              is_active: is_active ? is_active.trim().toLowerCase() === 'active' : true
            });
          }

          return jsonResponse({
            success: true,
            requester_role: currentUser.role,
            can_manage_managers: currentUser.role === 'admin',
            users
          });
        }

        if (method === 'POST') {
          const body = await request.json();
          const { username, password, full_name, role } = body;
          if (!username || !password || !role) {
            return jsonResponse({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' }, 400);
          }
          const cleanRole = role.trim().toLowerCase();
          if (currentUser.role === 'manager' && cleanRole !== 'staff' && cleanRole !== 'senior_staff') {
            return jsonResponse({ success: false, message: 'ผู้จัดการสร้างได้เฉพาะ พนักงาน หรือ พนักงานอาวุโส' }, 403);
          }
          const newRow = ['id_' + Date.now().toString(36), username.trim(), password.trim(), (full_name || '').trim(), cleanRole, 'active'];
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A:F:append?valueInputOption=USER_ENTERED`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [newRow] })
          });
          return jsonResponse({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จ' }, 201);
        }

        if (method === 'PUT') {
          const body = await request.json();
          const { user_id, full_name, password, role, is_active } = body;
          const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A2:F100`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          const rows = data.values || [];
          let targetIdx = -1;
          let targetRow = null;
          for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === user_id || rows[i][1] === user_id) {
              targetIdx = i + 2;
              targetRow = rows[i];
              break;
            }
          }
          if (targetIdx === -1) return jsonResponse({ success: false, message: 'ไม่พบผู้ใช้' }, 404);

          const curRole = targetRow[4] ? targetRow[4].trim().toLowerCase() : 'staff';
          if (currentUser.role === 'manager' && (curRole === 'manager' || curRole === 'admin')) {
            return jsonResponse({ success: false, message: 'ผู้จัดการไม่สามารถแก้ไขผู้ใช้ระดับนี้ได้' }, 403);
          }

          const updatedRow = [
            targetRow[0],
            targetRow[1],
            password && password.trim() ? password.trim() : targetRow[2],
            full_name !== undefined ? full_name.trim() : targetRow[3],
            role ? role.trim().toLowerCase() : curRole,
            is_active !== undefined ? (is_active ? 'active' : 'inactive') : targetRow[5]
          ];

          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A${targetIdx}:F${targetIdx}?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [updatedRow] })
          });
          return jsonResponse({ success: true, message: 'อัปเดตเรียบร้อย' });
        }
      }

      // 7. GET /api/logs
      if (pathname === '/api/logs' && method === 'GET') {
        if (!currentUser || currentUser.role !== 'admin') {
          return jsonResponse({ success: false, message: 'เฉพาะ Admin เท่านั้น' }, 403);
        }
        const token = await getGoogleAccessToken(env);
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/'Login_Logs'!A2:G`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const rows = (data.values || []).reverse().slice(0, 50);
        return jsonResponse({
          success: true,
          logs: rows.map(r => ({ timestamp: r[4], username: r[2], role: r[3], ip_address: r[5], status: r[6] }))
        });
      }

      return jsonResponse({ success: false, message: 'Endpoint not found' }, 404);
    }

    // ==========================================
    // STATIC ASSETS (Frontend from public/)
    // ==========================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function logLogin(token, authSheetId, rows) {
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/'Login_Logs'!A:G:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows })
    });
  } catch (e) {}
}
