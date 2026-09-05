const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const googleSheets = require('./services/googleSheets');

const uploadDir = path.join(__dirname, 'public', 'uploads', 'bills');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const slipUploadDir = path.join(__dirname, 'public', 'uploads', 'slips');
if (!fs.existsSync(slipUploadDir)) {
  fs.mkdirSync(slipUploadDir, { recursive: true });
}

// Simple token cache for local dev / lightweight session
const sessions = new Map();

function generateSessionToken(user) {
  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  sessions.set(token, {
    user,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });
  return token;
}

function getSessionUser(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const cookies = (req.headers['cookie'] || '').split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('erp_token=')) {
        token = c.substring(10);
        break;
      }
    }
  }

  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

// Parse JSON body (allows up to 15MB for bill images)
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 15 * 1024 * 1024) {
        req.connection.destroy();
        reject(new Error("Payload too large (Max 15MB)"));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers
  });
  res.end(JSON.stringify(data));
}

// Helper to upload images to Google Drive via Apps Script Web App
async function uploadToGoogleDriveAppsScript(base64Data, fileName, uploadUrl = config.GOOGLE_DRIVE_UPLOAD_URL) {
  if (!uploadUrl || !base64Data) return null;
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data,
        fileName: fileName || `bill_${Date.now()}.jpg`,
        folderName: 'ERP_บิลส่งของ_รูปภาพ'
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && (data.url || data.directUrl || data.webViewLink)) {
        return data.url || data.directUrl || data.webViewLink;
      }
    }
  } catch (err) {
    console.error('Google Drive Apps Script upload error:', err);
  }
  return null;
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // ==========================================
    // API ROUTES
    // ==========================================

    // POST /api/login
    if (pathname === '/api/login' && method === 'POST') {
      const { username, password } = await parseBody(req);
      if (!username || !password) {
        return sendJson(res, 400, { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
      }

      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const user = await googleSheets.findUser(username);

      if (!user) {
        await googleSheets.logLogin('-', username, '-', clientIp, 'FAILED_USER_NOT_FOUND');
        return sendJson(res, 401, { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }

      if (!user.is_active) {
        await googleSheets.logLogin(user.user_id, user.username, user.role, clientIp, 'FAILED_USER_INACTIVE');
        return sendJson(res, 403, { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' });
      }

      if (user.password_hash !== password) {
        await googleSheets.logLogin(user.user_id, user.username, user.role, clientIp, 'FAILED_WRONG_PASSWORD');
        return sendJson(res, 401, { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }

      // Success
      await googleSheets.logLogin(user.user_id, user.username, user.role, clientIp, 'SUCCESS');
      const token = generateSessionToken({
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      });

      return sendJson(res, 200, {
        success: true,
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          full_name: user.full_name,
          role: user.role
        }
      });
    }

    // GET /api/me
    if (pathname === '/api/me' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }
      return sendJson(res, 200, { success: true, user: currentUser });
    }

    // POST /api/logout
    if (pathname === '/api/logout' && method === 'POST') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader.startsWith('Bearer ')) {
        sessions.delete(authHeader.substring(7));
      }
      return sendJson(res, 200, { success: true, message: 'ออกจากระบบเรียบร้อย' });
    }

    // GET /api/products
    if (pathname === '/api/products' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบเพื่อค้นหาสินค้า' });
      }

      const q = reqUrl.searchParams.get('q') || '';
      const supplier = reqUrl.searchParams.get('supplier') || '';
      const page = parseInt(reqUrl.searchParams.get('page')) || 1;
      const limit = parseInt(reqUrl.searchParams.get('limit')) || 50;

      const results = await googleSheets.searchProducts(q, currentUser.role, supplier, limit, page);
      return sendJson(res, 200, { success: true, ...results });
    }

    // POST /api/products/refresh (Manager / Admin only)
    if (pathname === '/api/products/refresh' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'ไม่มีสิทธิ์รีเฟรชแคชข้อมูลสินค้า' });
      }
      await googleSheets.getAllProducts(true);
      return sendJson(res, 200, { success: true, message: 'รีเฟรชฐานข้อมูลสินค้าเรียบร้อย' });
    }

    // ==========================================
    // USER MANAGEMENT APIS (Manager & Admin)
    // ==========================================

    // GET /api/users
    if (pathname === '/api/users' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }
      if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลผู้ใช้งาน' });
      }

      const users = await googleSheets.getUsers(currentUser.role);
      return sendJson(res, 200, {
        success: true,
        requester_role: currentUser.role,
        can_manage_managers: currentUser.role === 'admin',
        users
      });
    }

    // POST /api/users (Create User)
    if (pathname === '/api/users' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }
      if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'ไม่มีสิทธิ์สร้างผู้ใช้งาน' });
      }

      try {
        const body = await parseBody(req);
        const newUser = await googleSheets.createUser(body, currentUser.role);
        return sendJson(res, 201, {
          success: true,
          message: 'เพิ่มผู้ใช้งานสำเร็จ',
          user: newUser
        });
      } catch (err) {
        return sendJson(res, 403, { success: false, message: err.message });
      }
    }

    // PUT /api/users (Update User)
    if (pathname === '/api/users' && method === 'PUT') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }
      if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'ไม่มีสิทธิ์แก้ไขผู้ใช้งาน' });
      }

      try {
        const body = await parseBody(req);
        const { user_id, ...updateData } = body;
        if (!user_id) {
          return sendJson(res, 400, { success: false, message: 'ระบุ user_id ที่ต้องการแก้ไข' });
        }

        const updated = await googleSheets.updateUser(user_id, updateData, currentUser.role);
        return sendJson(res, 200, {
          success: true,
          message: 'อัปเดตข้อมูลผู้ใช้เรียบร้อย',
          user: updated
        });
      } catch (err) {
        return sendJson(res, 403, { success: false, message: err.message });
      }
    }

    // DELETE /api/users (Deactivate User)
    if (pathname === '/api/users' && method === 'DELETE') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }
      if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'ไม่มีสิทธิ์ระงับผู้ใช้งาน' });
      }

      const userId = reqUrl.searchParams.get('id');
      if (!userId) {
        return sendJson(res, 400, { success: false, message: 'ระบุ id ผู้ใช้ที่ต้องการระงับ' });
      }

      await googleSheets.deleteUser(userId, currentUser.role);
      return sendJson(res, 200, {
        success: true,
        message: 'ระงับการใช้งานผู้ใช้เรียบร้อย'
      });
    }

    // GET /api/logs (Admin only)
    if (pathname === '/api/logs' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser || currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่ดูประวัติได้' });
      }
      const logs = await googleSheets.getLoginLogs(50);
      return sendJson(res, 200, { success: true, logs });
    }

    // ==========================================
    // CUSTOMERS & DELIVERY BILLS
    // ==========================================

    // GET /api/customers (Authenticated users)
    if (pathname === '/api/customers' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const q = reqUrl.searchParams.get('q') || '';
      const customers = await googleSheets.getCustomers(q);
      return sendJson(res, 200, { success: true, customers });
    }

    // POST /api/delivery/inbox & /api/delivery/direct (Direct Bill Recording - Staff & higher)
    if ((pathname === '/api/delivery/inbox' || pathname === '/api/delivery/direct') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const body = await parseBody(req);
      const { customerId, customerName, category, customerType, billRef, poRef, amount, notes, imageBase64, photoUrl, date } = body;

      if (!billRef || !billRef.trim()) {
        return sendJson(res, 400, { success: false, message: 'กรุณากรอกเลขที่บิลส่งของ' });
      }

      if (!amount || isNaN(parseFloat(String(amount).replace(/,/g, '')))) {
        return sendJson(res, 400, { success: false, message: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' });
      }

      let finalPhotoUrl = photoUrl || '';

      // If image base64 provided, try Google Drive Apps Script first, then fallback to local disk
      if (imageBase64 && !finalPhotoUrl) {
        const driveUrl = await uploadToGoogleDriveAppsScript(imageBase64, `bill_${Date.now()}.jpg`);
        if (driveUrl) {
          finalPhotoUrl = driveUrl;
        } else if (imageBase64.includes('base64,')) {
          try {
            const matches = imageBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
              const ext = extMap[matches[1]] || 'jpg';
              const buffer = Buffer.from(matches[2], 'base64');
              const fileName = `bill_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
              const diskPath = path.join(uploadDir, fileName);
              fs.writeFileSync(diskPath, buffer);
              finalPhotoUrl = `/uploads/bills/${fileName}`;
            }
          } catch (imgErr) {
            console.error('Image saving error:', imgErr);
          }
        }
      }

      // Determine category: 'store_gov' or 'store_general'
      const assignedCategory = category || (customerType === 'หน่วยงานราชการ' ? 'store_gov' : 'store_general');

      const result = await googleSheets.recordBillDirect({
        category: assignedCategory,
        customerId: customerId || '',
        customerName: customerName || 'ไม่ระบุชื่อ',
        billRef: billRef.trim(),
        poRef: poRef ? poRef.trim() : '',
        amount,
        date,
        photoUrl: finalPhotoUrl,
        notes: notes || ''
      }, currentUser);

      return sendJson(res, 201, {
        success: true,
        message: 'บันทึกบิลเข้าคลังหลักเรียบร้อย (สถานะ: รอวางบิล)',
        bill: result
      });
    }

    // GET /api/delivery/inbox/today & /api/delivery/bills/today & /api/delivery/today
    if ((pathname === '/api/delivery/inbox/today' || pathname === '/api/delivery/bills/today' || pathname === '/api/delivery/today') && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const category = reqUrl.searchParams.get('category') || 'ALL';
      const bills = await googleSheets.getTodayBills(currentUser.username, currentUser.role, category);
      return sendJson(res, 200, {
        success: true,
        bills
      });
    }

    // POST /api/delivery/bills/:id/cancel (Cancel / Void Bill)
    if (pathname.includes('/cancel') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      // Extract bill ID from path, e.g. /api/delivery/bills/BIL-6909-0001/cancel or /api/delivery/inbox/BIL-6909-0001/cancel
      const parts = pathname.split('/');
      const cancelIndex = parts.indexOf('cancel');
      const billId = cancelIndex > 0 ? parts[cancelIndex - 1] : '';

      if (!billId) {
        return sendJson(res, 400, { success: false, message: 'ไม่พบรหัสบิลที่ต้องการยกเลิก' });
      }

      const body = await parseBody(req);
      const reason = body.reason || 'บันทึกข้อมูลผิด ขอยกเลิกเพื่อบันทึกใหม่';

      try {
        const result = await googleSheets.cancelBill(billId, reason, currentUser);
        return sendJson(res, 200, {
          success: true,
          message: 'ยกเลิกบิลเรียบร้อย สามารถบันทึกบิลใหม่แทนได้ทันที',
          ...result
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // ==========================================
    // EXECUTIVE DASHBOARD
    // ==========================================

    // Helper to check manager/admin access
    function checkManagerPermission(req, res) {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
        return null;
      }
      if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
        sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
        return null;
      }
      return currentUser;
    }

    // GET /api/dashboard/executive (Executive Dashboard Stats)
    if (pathname === '/api/dashboard/executive' && method === 'GET') {
      const manager = checkManagerPermission(req, res);
      if (!manager) return;

      const period = reqUrl.searchParams.get('period') || 'ALL';
      const stats = await googleSheets.getExecutiveDashboardStats(period);
      return sendJson(res, 200, {
        success: true,
        stats
      });
    }

    // POST /api/delivery/manager/manual-bill (Add manual fuel or store bill directly to Master)
    if (pathname === '/api/delivery/manager/manual-bill' && method === 'POST') {
      const manager = checkManagerPermission(req, res);
      if (!manager) return;

      const body = await parseBody(req);
      const { category, customerId, customerName, companyRegistration, billRef, amount, notes, imageBase64, photoUrl, date } = body;

      if (!billRef || !billRef.trim()) {
        return sendJson(res, 400, { success: false, message: 'กรุณากรอกเลขที่บิล' });
      }

      if (!amount || isNaN(parseFloat(String(amount).replace(/,/g, '')))) {
        return sendJson(res, 400, { success: false, message: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' });
      }

      let finalPhotoUrl = photoUrl || '';
      if (imageBase64 && !finalPhotoUrl) {
        const driveUrl = await uploadToGoogleDriveAppsScript(imageBase64, `manual_${Date.now()}.jpg`);
        if (driveUrl) {
          finalPhotoUrl = driveUrl;
        } else if (imageBase64.includes('base64,')) {
          try {
            const matches = imageBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
              const ext = extMap[matches[1]] || 'jpg';
              const buffer = Buffer.from(matches[2], 'base64');
              const fileName = `manual_bill_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
              const diskPath = path.join(uploadDir, fileName);
              fs.writeFileSync(diskPath, buffer);
              finalPhotoUrl = `/uploads/bills/${fileName}`;
            }
          } catch (imgErr) {
            console.error('Manual image saving error:', imgErr);
          }
        }
      }

      let compReg = companyRegistration || (category === 'fuel' ? 'ปั๊มน้ำมัน' : 'ร้านค้า');
      let cat = category || (compReg === 'ปั๊มน้ำมัน' ? 'fuel' : 'store_general');

      const result = await googleSheets.addMasterBillManual({
        date,
        category: cat,
        companyRegistration: compReg,
        customerId: customerId || '',
        customerName: customerName || 'ไม่ระบุชื่อ',
        billRef: billRef.trim(),
        amount,
        photoUrl: finalPhotoUrl,
        notes: notes || ''
      }, manager);

      return sendJson(res, 201, {
        success: true,
        message: 'บันทึกบิลเข้าคลังหลัก (Master Bills) เรียบร้อย',
        bill: result
      });
    }

    // GET /api/delivery/manager/master-bills (View Master Bills)
    if (pathname === '/api/delivery/manager/master-bills' && method === 'GET') {
      const manager = checkManagerPermission(req, res);
      if (!manager) return;

      const companyRegistration = reqUrl.searchParams.get('reg') || 'ALL';
      const category = reqUrl.searchParams.get('category') || reqUrl.searchParams.get('cat') || 'ALL';
      const status = reqUrl.searchParams.get('status') || 'ALL';
      const query = reqUrl.searchParams.get('q') || '';

      const bills = await googleSheets.getMasterBills({ companyRegistration, category, status, query });
      return sendJson(res, 200, { success: true, bills });
    }

    // ==========================================
    // BILLING NOTES & PAYMENT COLLECTION
    // ==========================================

    // GET /api/billing/pending-bills (Bills with status 'รอวางบิล' for selected customer)
    if (pathname === '/api/billing/pending-bills' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const customerId = reqUrl.searchParams.get('customerId') || '';
      const customerName = reqUrl.searchParams.get('customerName') || '';

      if (!customerId && !customerName) {
        return sendJson(res, 400, { success: false, message: 'กรุณาระบุรหัสหรือชื่อลูกค้า' });
      }

      try {
        const bills = await googleSheets.getPendingBillsForCustomer(customerId, customerName);
        return sendJson(res, 200, { success: true, bills });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // POST /api/billing/notes (Create Billing Note consolidating selected bills)
    if (pathname === '/api/billing/notes' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      try {
        const body = await parseBody(req);
        const result = await googleSheets.createBillingNote(body, currentUser);
        return sendJson(res, 201, {
          success: true,
          message: `สร้างใบวางบิล ${result.billingNo} สำเร็จ`,
          billingNote: result
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // GET /api/billing/notes (List Billing Notes)
    if (pathname === '/api/billing/notes' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const status = reqUrl.searchParams.get('status') || 'ALL';
      try {
        const notes = await googleSheets.getBillingNotes(status);
        return sendJson(res, 200, { success: true, notes });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // GET /api/billing/notes/:no (Detail of Billing Note + itemized bills)
    if (pathname.startsWith('/api/billing/notes/') && !pathname.endsWith('/payment') && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const billingNo = decodeURIComponent(pathname.replace('/api/billing/notes/', ''));
      if (!billingNo) {
        return sendJson(res, 400, { success: false, message: 'ระบุเลขที่ใบวางบิล' });
      }

      try {
        const detail = await googleSheets.getBillingNoteDetail(billingNo);
        return sendJson(res, 200, { success: true, ...detail });
      } catch (err) {
        return sendJson(res, 404, { success: false, message: err.message });
      }
    }

    // POST /api/billing/notes/:no/payment (Record Payment & Auto-split Accounts)
    if (pathname.includes('/payment') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      const parts = pathname.split('/');
      const payIdx = parts.indexOf('payment');
      const billingNo = payIdx > 0 ? decodeURIComponent(parts[payIdx - 1]) : '';

      if (!billingNo) {
        return sendJson(res, 400, { success: false, message: 'ไม่พบเลขที่ใบวางบิล' });
      }

      try {
        const body = await parseBody(req);
        let finalSlipUrl = body.slipUrl || '';

        // If slip image base64 provided, try Google Drive Apps Script first, then fallback to public/uploads/slips/
        if (body.imageBase64 && !finalSlipUrl) {
          const driveUrl = await uploadToGoogleDriveAppsScript(body.imageBase64, `slip_${Date.now()}.jpg`);
          if (driveUrl) {
            finalSlipUrl = driveUrl;
          } else if (body.imageBase64.includes('base64,')) {
            try {
              const matches = body.imageBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
                const ext = extMap[matches[1]] || 'jpg';
                const buffer = Buffer.from(matches[2], 'base64');
                const fileName = `slip_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
                const diskPath = path.join(slipUploadDir, fileName);
                fs.writeFileSync(diskPath, buffer);
                finalSlipUrl = `/uploads/slips/${fileName}`;
              }
            } catch (imgErr) {
              console.error('Slip saving error:', imgErr);
            }
          }
        }

        const paymentResult = await googleSheets.recordPayment({
          billingNo,
          paymentDate: body.paymentDate,
          paidAmount: body.paidAmount,
          bankAccount: body.bankAccount,
          slipUrl: finalSlipUrl,
          notes: body.notes
        }, currentUser);

        return sendJson(res, 200, {
          success: true,
          message: 'บันทึกรับชำระเงินและตัดยอดบัญชีเรียบร้อย',
          payment: paymentResult
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // GET /api/billing/payments (Payment History)
    if (pathname === '/api/billing/payments' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
      }

      try {
        const payments = await googleSheets.getPaymentsList();
        return sendJson(res, 200, { success: true, payments });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // GET /api/settings (Store Settings)
    if (pathname === '/api/settings' && method === 'GET') {
      try {
        const settings = await googleSheets.getStoreSettings();
        return sendJson(res, 200, { success: true, settings });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // POST /api/settings (Update Store Settings - Admin only)
    if (pathname === '/api/settings' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || currentUser.role !== 'admin') {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' });
      }

      try {
        const body = await parseBody(req);
        const updated = await googleSheets.updateStoreSettings(body, currentUser);
        return sendJson(res, 200, {
          success: true,
          message: 'บันทึกข้อมูลร้านค้าเรียบร้อย',
          settings: updated
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // ==========================================
    // DAILY REVENUE & CASH SETTLEMENT APIS (Phase 5 - Manager & Admin)
    // ==========================================

    // POST /api/revenue/cash-drops
    if (pathname === '/api/revenue/cash-drops' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
      }

      try {
        const body = await parseBody(req);
        const drop = await googleSheets.recordCashDrop(body, currentUser);
        return sendJson(res, 201, {
          success: true,
          message: 'บันทึกการเก็บเงินสดเข้าเซฟเรียบร้อย',
          cashDrop: drop
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // GET /api/revenue/cash-drops
    if (pathname === '/api/revenue/cash-drops' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
      }

      try {
        const date = reqUrl.searchParams.get('date') || '';
        const drops = await googleSheets.getCashDrops(date);
        return sendJson(res, 200, { success: true, drops });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // GET /api/revenue/credit-bills
    if (pathname === '/api/revenue/credit-bills' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
      }

      try {
        const date = reqUrl.searchParams.get('date') || '';
        const result = await googleSheets.getDailyCreditBills(date);
        return sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // POST /api/revenue/daily-closing
    if (pathname === '/api/revenue/daily-closing' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
      }

      try {
        const body = await parseBody(req);
        const closing = await googleSheets.recordDailyClosing(body, currentUser);
        return sendJson(res, 201, {
          success: true,
          message: 'บันทึกปิดยอดรายรับประจำวันเรียบร้อย',
          closing
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // GET /api/revenue/daily-closings
    if (pathname === '/api/revenue/daily-closings' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น' });
      }

      try {
        const closings = await googleSheets.getDailyClosingsList();
        return sendJson(res, 200, { success: true, closings });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // ==========================================
    // STATIC FILES (public/)
    // ==========================================
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        const indexPath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(indexPath, (readErr, content) => {
          if (readErr) {
            res.writeHead(404);
            return res.end("Not Found");
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500);
          return res.end("Internal Server Error");
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });

  } catch (error) {
    console.error("Server Error:", error);
    sendJson(res, 500, { success: false, message: error.message || 'Internal Server Error' });
  }
});

server.listen(config.PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 ERP Server is running at http://localhost:${config.PORT}`);
  console.log(`📡 Google Sheets Database connected`);
  console.log(`👥 User Management API active`);
  console.log(`=======================================================`);
});
