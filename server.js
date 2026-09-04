const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const googleSheets = require('./services/googleSheets');

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

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error("Payload too large"));
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
