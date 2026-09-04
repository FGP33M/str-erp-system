const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { parseProductDetails } = require('./parser');

class GoogleSheetsService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.cachedProducts = null;
    this.productsCacheTime = 0;
    this.keyData = null;
  }

  getKeyData() {
    if (!this.keyData) {
      if (typeof process.env.SERVICE_ACCOUNT_KEY === 'string') {
        this.keyData = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
      } else if (fs.existsSync(config.SERVICE_ACCOUNT_KEY_PATH)) {
        this.keyData = JSON.parse(fs.readFileSync(config.SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
      } else {
        throw new Error("Service account key file not found: " + config.SERVICE_ACCOUNT_KEY_PATH);
      }
    }
    return this.keyData;
  }

  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.tokenExpiry > now + 60) {
      return this.accessToken;
    }

    const key = this.getKeyData();
    const iat = now;
    const exp = now + 3600;

    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp,
      iat
    };

    const base64Url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signatureInput = `${base64Url(header)}.${base64Url(claimSet)}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    signer.end();
    const signature = signer.sign(key.private_key, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google OAuth error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = now + (data.expires_in || 3600);
    return this.accessToken;
  }

  // ==========================================
  // AUTHENTICATION & USER MANAGEMENT
  // ==========================================

  // Find user by username (for login)
  async findUser(username) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/Users!A2:F100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch users from Google Sheets");
    }

    const data = await res.json();
    const rows = data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const [user_id, uName, password_hash, full_name, role, is_active] = r;
      if (uName && uName.trim().toLowerCase() === username.trim().toLowerCase()) {
        return {
          row_index: i + 2,
          user_id,
          username: uName,
          password_hash,
          full_name,
          role: role ? role.trim().toLowerCase() : 'staff',
          is_active: is_active ? is_active.trim().toLowerCase() === 'active' : true
        };
      }
    }
    return null;
  }

  // Get all users (filtered by requester's role)
  async getUsers(requesterRole) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/Users!A2:F100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch users from Google Sheets");
    }

    const data = await res.json();
    const rows = data.values || [];
    const users = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const [user_id, username, password_hash, full_name, role, is_active] = r;
      if (!user_id && !username) continue;

      const userRole = role ? role.trim().toLowerCase() : 'staff';
      
      // Manager can only view staff and senior_staff
      if (requesterRole === 'manager' && (userRole === 'admin' || userRole === 'manager')) {
        continue;
      }

      users.push({
        row_index: i + 2,
        user_id: user_id || `id_${i+1}`,
        username: username || '',
        full_name: full_name || '',
        role: userRole,
        is_active: is_active ? is_active.trim().toLowerCase() === 'active' : true
      });
    }

    return users;
  }

  // Create new user
  async createUser(userData, requesterRole) {
    const { username, password, full_name, role } = userData;
    if (!username || !password || !role) {
      throw new Error("กรุณากรอกข้อมูลให้ครบถ้วน");
    }

    const cleanRole = role.trim().toLowerCase();
    // Permission check
    if (requesterRole === 'manager') {
      if (cleanRole !== 'staff' && cleanRole !== 'senior_staff') {
        throw new Error("ผู้จัดการสามารถสร้างได้เฉพาะ พนักงาน หรือ พนักงานอาวุโส เท่านั้น");
      }
    } else if (requesterRole !== 'admin') {
      throw new Error("ไม่มีสิทธิ์จัดการผู้ใช้งาน");
    }

    // Check username uniqueness
    const existing = await this.findUser(username);
    if (existing) {
      throw new Error(`ชื่อผู้ใช้ '${username}' มีอยู่ในระบบแล้ว`);
    }

    const token = await this.getAccessToken();
    const user_id = 'id_' + Date.now().toString(36);
    const newRow = [user_id, username.trim(), password.trim(), (full_name || '').trim(), cleanRole, 'active'];

    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/Users!A:F:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [newRow] })
    });

    if (!appendRes.ok) {
      throw new Error("ไม่สามารถบันทึกผู้ใช้ลง Google Sheet ได้");
    }

    return { user_id, username, full_name, role: cleanRole, is_active: true };
  }

  // Update existing user
  async updateUser(userId, updateData, requesterRole) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/Users!A2:F100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const rows = data.values || [];

    let targetRowIndex = -1;
    let targetUser = null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r[0] === userId || r[1] === userId) {
        targetRowIndex = i + 2;
        targetUser = {
          user_id: r[0],
          username: r[1],
          password_hash: r[2],
          full_name: r[3],
          role: r[4],
          is_active: r[5]
        };
        break;
      }
    }

    if (!targetUser || targetRowIndex === -1) {
      throw new Error("ไม่พบผู้ใช้งานนี้ในระบบ");
    }

    const currentRole = targetUser.role ? targetUser.role.trim().toLowerCase() : 'staff';

    // Permission check
    if (requesterRole === 'manager') {
      if (currentRole === 'admin' || currentRole === 'manager') {
        throw new Error("ผู้จัดการไม่สามารถแก้ไขผู้ใช้งานระดับผู้จัดการหรือแอดมินได้");
      }
      if (updateData.role && updateData.role !== 'staff' && updateData.role !== 'senior_staff') {
        throw new Error("ผู้จัดการสามารถกำหนดสิทธิ์ได้เฉพาะ พนักงาน หรือ พนักงานอาวุโส เท่านั้น");
      }
    } else if (requesterRole !== 'admin') {
      throw new Error("ไม่มีสิทธิ์แก้ไขผู้ใช้งาน");
    }

    // Apply updates
    const updatedFullname = updateData.full_name !== undefined ? updateData.full_name.trim() : targetUser.full_name;
    const updatedPassword = updateData.password && updateData.password.trim() ? updateData.password.trim() : targetUser.password_hash;
    const updatedRole = updateData.role ? updateData.role.trim().toLowerCase() : currentRole;
    const updatedStatus = updateData.is_active !== undefined ? (updateData.is_active ? 'active' : 'inactive') : targetUser.is_active;

    const rowValues = [
      targetUser.user_id,
      targetUser.username,
      updatedPassword,
      updatedFullname,
      updatedRole,
      updatedStatus
    ];

    const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/Users!A${targetRowIndex}:F${targetRowIndex}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [rowValues] })
    });

    if (!updateRes.ok) {
      throw new Error("ไม่สามารถอัปเดตข้อมูลผู้ใช้ใน Google Sheet ได้");
    }

    return {
      user_id: targetUser.user_id,
      username: targetUser.username,
      full_name: updatedFullname,
      role: updatedRole,
      is_active: updatedStatus === 'active'
    };
  }

  // Delete user (Soft delete by setting is_active = inactive)
  async deleteUser(userId, requesterRole) {
    return this.updateUser(userId, { is_active: false }, requesterRole);
  }

  // Record login log
  async logLogin(user_id, username, role, ip_address, status) {
    try {
      const token = await this.getAccessToken();
      const log_id = 'log_' + Date.now();
      const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const row = [[log_id, user_id, username, role, timestamp, ip_address || '127.0.0.1', status]];

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/'Login_Logs'!A:G:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: row })
      });
    } catch (err) {
      console.error("Failed to write login log:", err);
    }
  }

  // Get login logs (for Admin)
  async getLoginLogs(limit = 50) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.AUTH}/values/'Login_Logs'!A2:G`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = data.values || [];
    // Return newest first
    return rows.reverse().slice(0, limit).map(r => ({
      log_id: r[0],
      user_id: r[1],
      username: r[2],
      role: r[3],
      timestamp: r[4],
      ip_address: r[5],
      status: r[6]
    }));
  }

  // ==========================================
  // PRODUCTS & CACHING
  // ==========================================

  async getAllProducts(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedProducts && (now - this.productsCacheTime < config.CACHE_TTL_MS)) {
      return this.cachedProducts;
    }

    const token = await this.getAccessToken();
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.PRODUCTS}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meta = await metaRes.json();
    const tabTitle = meta.sheets[0].properties.title;

    const range = encodeURIComponent(`'${tabTitle}'!A2:G`);
    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.PRODUCTS}/values/${range}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!valRes.ok) {
      throw new Error("Failed to fetch products from Google Sheets");
    }

    const valData = await valRes.json();
    const rows = valData.values || [];

    const products = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const barcode = (r[0] || '').trim();
      const name = (r[1] || '').trim();
      if (!barcode && !name) continue;

      const supplier = (r[2] || '').trim();
      const rawDetails = (r[3] || '').trim();
      const costPrice = (r[4] || '0').trim();
      const salePrice = (r[5] || '0').trim();
      const stock = (r[6] || '0').trim();

      const parsed = parseProductDetails(rawDetails);

      products.push({
        id: i + 1,
        barcode,
        name,
        supplier,
        details: parsed,
        cost_price: costPrice,
        sale_price: salePrice,
        stock_qty: stock,
        search_index: `${barcode} ${name} ${supplier} ${parsed.location} ${parsed.unit}`.toLowerCase()
      });
    }

    this.cachedProducts = products;
    this.productsCacheTime = now;
    console.log(`[Cache] Loaded and cached ${products.length} products`);
    return products;
  }

  async searchProducts(query = '', role = 'staff', supplierFilter = '', limit = 50, page = 1) {
    const all = await this.getAllProducts();
    const q = query.trim().toLowerCase();
    const sFilter = supplierFilter.trim().toLowerCase();

    let filtered = all;

    if (sFilter) {
      filtered = filtered.filter(p => p.supplier.toLowerCase() === sFilter);
    }

    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      filtered = filtered.filter(p => {
        return terms.every(term => p.search_index.includes(term));
      });
    }

    const totalCount = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const isManagerOrAdmin = (role === 'manager' || role === 'admin');

    const sanitized = paginated.map(p => {
      const item = {
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        supplier: p.supplier,
        details: p.details,
        sale_price: p.sale_price,
        stock_qty: p.stock_qty
      };

      if (isManagerOrAdmin) {
        item.cost_price = p.cost_price;
        const costNum = parseFloat(p.cost_price.replace(/,/g, ''));
        const saleNum = parseFloat(p.sale_price.replace(/,/g, ''));
        if (!isNaN(costNum) && !isNaN(saleNum) && costNum > 0) {
          item.profit = (saleNum - costNum).toLocaleString();
          item.margin_percent = (((saleNum - costNum) / saleNum) * 100).toFixed(1) + '%';
        } else {
          item.profit = '-';
          item.margin_percent = '-';
        }
      }

      return item;
    });

    const suppliers = Array.from(new Set(all.map(p => p.supplier).filter(Boolean))).sort();

    return {
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      role,
      isManagerOrAdmin,
      suppliers,
      items: sanitized
    };
  }
}

module.exports = new GoogleSheetsService();
