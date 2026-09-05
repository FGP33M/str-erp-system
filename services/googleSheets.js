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
    this.cachedCustomers = null;
    this.customersCacheTime = 0;
    this.keyData = null;
  }

  setKeyData(key) {
    if (key) {
      this.keyData = typeof key === 'string' ? JSON.parse(key) : key;
    }
  }

  getKeyData() {
    if (!this.keyData) {
      if (typeof process !== 'undefined' && process.env && process.env.SERVICE_ACCOUNT_KEY) {
        this.keyData = typeof process.env.SERVICE_ACCOUNT_KEY === 'string' ? JSON.parse(process.env.SERVICE_ACCOUNT_KEY) : process.env.SERVICE_ACCOUNT_KEY;
      } else {
        try {
          if (fs && fs.existsSync && fs.existsSync(config.SERVICE_ACCOUNT_KEY_PATH)) {
            this.keyData = JSON.parse(fs.readFileSync(config.SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
          }
        } catch (e) {}
        if (!this.keyData) {
          try {
            this.keyData = require('../str-erp-system-b07e6bc9c3da.json');
          } catch (e) {}
        }
      }
      if (!this.keyData) {
        throw new Error("Service account key not found");
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

  // ==========================================
  // CUSTOMER MANAGEMENT (CRM)
  // ==========================================

  async getCustomers(query = '') {
    const now = Date.now();
    if (!this.cachedCustomers || now - this.customersCacheTime > config.CACHE_TTL_MS) {
      const token = await this.getAccessToken();
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.CUSTOMERS}/values/Custom!A2:N`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error("Failed to fetch customers from Google Sheets");
      }

      const data = await res.json();
      const rows = data.values || [];

      this.cachedCustomers = rows.map((r, index) => {
        const id = (r[0] || '').trim();
        const name = (r[1] || '').trim();
        const fullName = (r[2] || '').trim();
        const addressParts = [r[3], r[4], r[5], r[6], r[7], r[8]].map(s => (s || '').trim()).filter(Boolean);
        const address = addressParts.join(' ');
        const phone = (r[9] || '').trim();
        const taxId = (r[10] || '').trim();
        const contact = (r[11] || '').trim();
        const contactPhone = (r[12] || '').trim();
        const contactLine = (r[13] || '').trim();

        return {
          id: id || `C_${index + 1}`,
          name: name || fullName || 'ไม่ระบุชื่อ',
          fullName: fullName || name || '',
          address,
          phone,
          taxId,
          contact,
          contactPhone,
          contactLine
        };
      }).filter(c => c.id && c.name && c.name !== 'ไม่ระบุ');

      this.customersCacheTime = now;
    }

    if (!query) {
      return this.cachedCustomers;
    }

    const q = query.trim().toLowerCase();
    return this.cachedCustomers.filter(c => 
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.contact.toLowerCase().includes(q)
    );
  }

  // ==========================================
  // DIRECT BILL RECORDING & CANCELLATION
  // ==========================================

  async recordBillDirect(data, user) {
    const token = await this.getAccessToken();
    const now = new Date();

    const yy = (now.getFullYear() + 543).toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const todayDateStr = `${dd}/${mm}/${now.getFullYear() + 543}`;
    const dateStr = data.date || todayDateStr; // Bill date (can be backdated)
    const timestampStr = `${todayDateStr} ${now.toLocaleTimeString('th-TH')}`; // System locked record timestamp!

    // 1. Get current count in MASTER_BILLS to generate sequential Bill_ID
    const masterRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const masterData = await masterRes.json();
    const masterCount = (masterData.values || []).length;
    const seq = (masterCount + 1).toString().padStart(4, '0');
    const billId = `BIL-${yy}${mm}-${seq}`;

    // 2. Classify Category & Commercial Registration
    let companyRegistration = 'ร้านค้า';
    let source = '1. ร้านค้า - ทั่วไป';

    if (data.category === 'store_gov') {
      companyRegistration = 'ร้านค้า';
      source = '2. ร้านค้า - หน่วยงาน';
    } else if (data.category === 'fuel' || data.companyRegistration === 'ปั๊มน้ำมัน') {
      companyRegistration = 'ปั๊มน้ำมัน';
      source = '3. ปั๊มน้ำมัน';
    } else {
      companyRegistration = 'ร้านค้า';
      source = '1. ร้านค้า - ทั่วไป';
    }

    const numAmount = parseFloat(String(data.amount).replace(/,/g, '')) || 0;
    const formattedAmount = numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let billRef = (data.billRef || '').trim();
    if (data.poRef && data.poRef.trim()) {
      billRef = `${billRef} [PO: ${data.poRef.trim()}]`;
    }

    const creatorName = user.username || user.full_name || 'staff';

    // Safety guard against Google Sheets 50,000 character cell limit
    let safePhotoUrl = data.photoUrl || '';
    if (safePhotoUrl.length > 5000 && safePhotoUrl.startsWith('data:image')) {
      console.warn("Base64 photoUrl exceeds safe sheet cell size (>5000 chars), stripped to prevent Sheet 400 error");
      safePhotoUrl = '';
    }

    // Master row: [Bill_ID, วันที่บิล, ทะเบียนพาณิชย์, แหล่งที่มา, เลขที่บิลกระดาษ, รหัสลูกค้า, ชื่อลูกค้า, จำนวนเงิน, รูปถ่ายบิล, ผู้บันทึก, ผู้ยืนยัน, วันที่บันทึก, เลขที่ใบวางบิล, สถานะบิล, หมายเหตุ]
    const masterRow = [
      billId,
      dateStr,
      companyRegistration,
      source,
      billRef,
      data.customerId || '',
      data.customerName || 'ไม่ระบุชื่อ',
      formattedAmount,
      safePhotoUrl,
      creatorName,
      creatorName, // ยืนยันบันทึกโดยตรง
      timestampStr,
      '', // เลขที่ใบวางบิล
      'รอวางบิล', // สถานะบิลตั้งต้น
      data.notes || ''
    ];

    // Append to MASTER_BILLS
    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A:O:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [masterRow] })
    });

    if (!appendRes.ok) {
      const errText = await appendRes.text();
      throw new Error(`Failed to append bill to MASTER_BILLS: ${errText}`);
    }

    // Also append to INBOX_STAFF for complete audit trail
    try {
      const inboxRow = [
        billId,
        dateStr,
        source,
        data.customerId || '',
        data.customerName || '',
        billRef,
        formattedAmount,
        data.photoUrl || '',
        creatorName,
        timestampStr,
        'รอวางบิล',
        data.notes || ''
      ];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/INBOX_STAFF!A:L:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [inboxRow] })
      });
    } catch (inboxErr) {
      console.warn('Could not mirror to INBOX_STAFF (non-critical):', inboxErr);
    }

    return {
      billId,
      date: dateStr,
      companyRegistration,
      source,
      billRef,
      customerId: data.customerId || '',
      customerName: data.customerName || 'ไม่ระบุชื่อ',
      amount: formattedAmount,
      photoUrl: data.photoUrl || '',
      createdBy: creatorName,
      createdAt: timestampStr,
      status: 'รอวางบิล',
      notes: data.notes || ''
    };
  }

  async addMasterBillManual(data, user) {
    return this.recordBillDirect(data, user);
  }

  async cancelBill(billId, reason, user) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch MASTER_BILLS for cancellation");
    }

    const data = await res.json();
    const rows = data.values || [];
    const index = rows.findIndex(r => (r[0] || '').trim() === billId.trim());

    if (index === -1) {
      throw new Error(`ไม่พบบิลรหัส ${billId} ในฐานข้อมูล`);
    }

    const rowIndex = index + 2;
    const current = rows[index];
    const currentStatus = current[13] || 'รอวางบิล';

    if (currentStatus === 'ยกเลิก') {
      return { success: true, billId, status: 'ยกเลิก', message: 'บิลนี้ถูกยกเลิกแล้วก่อนหน้านี้' };
    }

    if (currentStatus === 'วางบิลแล้ว' || currentStatus === 'ชำระแล้ว') {
      throw new Error(`บิลนี้อยู่ในสถานะ '${currentStatus}' แล้ว ไม่สามารถกดยกเลิกได้โดยตรง กรุณาติดต่อผู้จัดการ`);
    }

    const now = new Date();
    const cancelTime = now.toLocaleDateString('th-TH') + ' ' + now.toLocaleTimeString('th-TH');
    const cancelNote = (current[14] ? current[14] + ' | ' : '') + `[ยกเลิกโดย ${user.username || 'user'} เมื่อ ${cancelTime} เหตุผล: ${reason}]`;

    // Update Col N (Status) and Col O (Notes) in MASTER_BILLS
    const putRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!N${rowIndex}:O${rowIndex}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [['ยกเลิก', cancelNote]]
      })
    });

    if (!putRes.ok) {
      throw new Error("Failed to update cancel status in Google Sheets");
    }

    // Mirror to INBOX_STAFF if found
    try {
      const inboxRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/INBOX_STAFF!A2:L`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const inboxData = await inboxRes.json();
      const inboxRows = inboxData.values || [];
      const inboxIdx = inboxRows.findIndex(r => (r[0] || '').trim() === billId.trim());
      if (inboxIdx !== -1) {
        const inRowIdx = inboxIdx + 2;
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/INBOX_STAFF!K${inRowIdx}:L${inRowIdx}?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [['ยกเลิก', cancelNote]]
          })
        });
      }
    } catch (e) {
      console.warn('Could not mirror cancel to INBOX_STAFF:', e);
    }

    return {
      success: true,
      billId,
      status: 'ยกเลิก',
      cancelNote,
      message: 'ยกเลิกบิลเรียบร้อย สามารถบันทึกบิลใหม่เข้ามาแทนได้ทันที'
    };
  }

  async getTodayBills(username, role, category = 'ALL') {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch bills from MASTER_BILLS");
    }

    const data = await res.json();
    const rows = data.values || [];
    const isManagerOrAdmin = (role === 'manager' || role === 'admin');

    const now = new Date();
    const yy = (now.getFullYear() + 543).toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const todayStr = `${dd}/${mm}/${yy}`;
    const enYearStr = now.getFullYear().toString();

    const isRecordedToday = (createdAtStr) => {
      if (!createdAtStr) return false;
      const datePart = createdAtStr.split(' ')[0].trim();
      if (datePart.includes('/')) {
        const parts = datePart.split('/');
        if (parts.length === 3) {
          const d = parts[0].padStart(2, '0');
          const m = parts[1].padStart(2, '0');
          const y = parts[2];
          return d === dd && m === mm && (y === yy || y === enYearStr);
        }
      } else if (datePart.includes('-')) {
        const parts = datePart.split('-');
        if (parts.length === 3) {
          const y = parts[0];
          const m = parts[1].padStart(2, '0');
          const d = parts[2].padStart(2, '0');
          return d === dd && m === mm && (y === yy || y === enYearStr);
        }
      }
      return datePart === todayStr;
    };

    let bills = rows.map((r, idx) => ({
      rowIndex: idx + 2,
      billId: r[0] || '',
      date: r[1] || '',
      companyRegistration: r[2] || 'ร้านค้า',
      source: r[3] || '1. ร้านค้า - ทั่วไป',
      billRef: r[4] || '',
      customerId: r[5] || '',
      customerName: r[6] || '',
      amount: r[7] || '0',
      photoUrl: r[8] || '',
      createdBy: r[9] || '',
      approvedBy: r[10] || '',
      createdAt: r[11] || '',
      billingNoteNo: r[12] || '',
      status: r[13] || 'รอวางบิล',
      notes: r[14] || ''
    })).filter(b => b.billId);

    // Shift Isolation: Only show bills RECORDED today (past days' bills disappear from daily staff view)
    bills = bills.filter(b => isRecordedToday(b.createdAt));

    // If staff, filter by createdBy
    if (!isManagerOrAdmin) {
      bills = bills.filter(b => (b.createdBy || '').toLowerCase() === (username || '').toLowerCase());
    }

    // Category filter
    if (category === 'store_general') {
      bills = bills.filter(b => b.source.includes('ทั่วไป'));
    } else if (category === 'store_gov') {
      bills = bills.filter(b => b.source.includes('หน่วยงาน'));
    } else if (category === 'fuel') {
      bills = bills.filter(b => b.companyRegistration === 'ปั๊มน้ำมัน');
    }

    return bills.reverse();
  }

  // ==========================================
  // EXECUTIVE DASHBOARD
  // ==========================================

  async getExecutiveDashboardStats(period = 'ALL') {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch master bills for executive dashboard");
    }

    const data = await res.json();
    const rows = data.values || [];

    const now = new Date();
    const yy = (now.getFullYear() + 543).toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const todayStr = `${dd}/${mm}/${yy}`;
    const monthStr = `/${mm}/${yy}`;
    const yearStr = `/${yy}`;

    let totalActiveAmount = 0;
    let totalActiveCount = 0;

    const storeGeneral = { count: 0, amount: 0 };
    const storeGov = { count: 0, amount: 0 };
    const fuel = { count: 0, amount: 0 };

    const pendingBilling = { count: 0, amount: 0 };
    const billed = { count: 0, amount: 0 };
    const paid = { count: 0, amount: 0 };
    const cancelled = { count: 0, amount: 0 };

    const debtorMap = {};
    const cancelledBills = [];
    const allParsedBills = [];

    for (const r of rows) {
      const billId = r[0] || '';
      if (!billId) continue;

      const date = r[1] || '';
      const companyReg = r[2] || 'ร้านค้า';
      const source = r[3] || '1. ร้านค้า - ทั่วไป';
      const billRef = r[4] || '';
      const custId = r[5] || '';
      const custName = r[6] || 'ไม่ระบุ';
      const amtStr = r[7] || '0';
      const amount = parseFloat(String(amtStr).replace(/,/g, '')) || 0;
      const photoUrl = r[8] || '';
      const createdBy = r[9] || '';
      const createdAt = r[11] || '';
      const billingNoteNo = r[12] || '';
      const status = (r[13] || 'รอวางบิล').trim();
      const notes = r[14] || '';

      // Period filter
      if (period === 'TODAY' && !date.includes(todayStr) && !createdAt.includes(todayStr)) continue;
      if (period === 'MONTH' && !date.includes(monthStr) && !createdAt.includes(monthStr)) continue;
      if (period === 'YEAR' && !date.includes(yearStr) && !createdAt.includes(yearStr)) continue;

      const billItem = {
        billId, date, companyRegistration: companyReg, source, billRef,
        customerId: custId, customerName: custName, amount: amtStr, amountNum: amount,
        photoUrl, createdBy, createdAt, billingNoteNo, status, notes
      };
      allParsedBills.push(billItem);

      if (status === 'ยกเลิก') {
        cancelled.count++;
        cancelled.amount += amount;
        cancelledBills.push(billItem);
      } else {
        totalActiveCount++;
        totalActiveAmount += amount;

        // Categories
        if (source.includes('ทั่วไป')) {
          storeGeneral.count++;
          storeGeneral.amount += amount;
        } else if (source.includes('หน่วยงาน')) {
          storeGov.count++;
          storeGov.amount += amount;
        } else if (companyReg === 'ปั๊มน้ำมัน') {
          fuel.count++;
          fuel.amount += amount;
        }

        // Status breakdown
        if (status === 'รอวางบิล') {
          pendingBilling.count++;
          pendingBilling.amount += amount;
        } else if (status === 'วางบิลแล้ว') {
          billed.count++;
          billed.amount += amount;
        } else if (status === 'ชำระแล้ว') {
          paid.count++;
          paid.amount += amount;
        }

        // Debtors (บิลค้างชำระ: รอวางบิล หรือ วางบิลแล้ว)
        if (status === 'รอวางบิล' || status === 'วางบิลแล้ว') {
          const key = custId || custName;
          if (!debtorMap[key]) {
            debtorMap[key] = {
              customerId: custId,
              customerName: custName,
              totalAmount: 0,
              storeAmount: 0,
              fuelAmount: 0,
              billCount: 0
            };
          }
          debtorMap[key].totalAmount += amount;
          debtorMap[key].billCount++;
          if (companyReg === 'ปั๊มน้ำมัน') {
            debtorMap[key].fuelAmount += amount;
          } else {
            debtorMap[key].storeAmount += amount;
          }
        }
      }
    }

    const topDebtors = Object.values(debtorMap)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);

    return {
      period,
      summary: {
        totalActiveAmount,
        totalActiveCount,
        formattedTotalActiveAmount: totalActiveAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        storeGeneral: {
          ...storeGeneral,
          formattedAmount: storeGeneral.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        storeGov: {
          ...storeGov,
          formattedAmount: storeGov.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        fuel: {
          ...fuel,
          formattedAmount: fuel.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        pendingBilling: {
          ...pendingBilling,
          formattedAmount: pendingBilling.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        billed: {
          ...billed,
          formattedAmount: billed.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        paid: {
          ...paid,
          formattedAmount: paid.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
        cancelled: {
          ...cancelled,
          formattedAmount: cancelled.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
      },
      topDebtors,
      cancelledBills: cancelledBills.reverse(),
      recentBills: allParsedBills.reverse().slice(0, 20)
    };
  }

  async getMasterBills(filters = {}) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch bills from MASTER_BILLS");
    }

    const data = await res.json();
    const rows = data.values || [];

    let bills = rows.map((r, idx) => {
      const billId = r[0] || '';
      const date = r[1] || '';
      const companyRegistration = r[2] || 'ร้านค้า';
      const source = r[3] || '';
      let category = 'store_general';
      if (companyRegistration === 'ปั๊มน้ำมัน' || (source && source.includes('น้ำมัน'))) {
        category = 'fuel';
      } else if (source && (source.includes('หน่วยงาน') || source.includes('ราชการ'))) {
        category = 'store_gov';
      } else {
        category = 'store_general';
      }

      return {
        rowIndex: idx + 2,
        billId,
        date,
        companyRegistration,
        source,
        category,
        billRef: r[4] || '',
        customerId: r[5] || '',
        customerName: r[6] || '',
        amount: r[7] || '0',
        photoUrl: r[8] || '',
        createdBy: r[9] || '',
        approvedBy: r[10] || '',
        approvedAt: r[11] || '',
        billingNoteNo: r[12] || '',
        status: r[13] || 'รอวางบิล',
        notes: r[14] || ''
      };
    }).filter(b => b.billId);

    const cat = filters.category || filters.companyRegistration || 'ALL';
    if (cat !== 'ALL') {
      if (cat === 'store_general') {
        bills = bills.filter(b => b.category === 'store_general');
      } else if (cat === 'store_gov') {
        bills = bills.filter(b => b.category === 'store_gov');
      } else if (cat === 'fuel' || cat === 'ปั๊มน้ำมัน') {
        bills = bills.filter(b => b.category === 'fuel');
      } else if (cat === 'ร้านค้า') {
        bills = bills.filter(b => b.category === 'store_general' || b.category === 'store_gov');
      }
    }

    if (filters.status && filters.status !== 'ALL') {
      bills = bills.filter(b => b.status === filters.status);
    }

    if (filters.query) {
      const q = filters.query.toLowerCase();
      bills = bills.filter(b =>
        b.billId.toLowerCase().includes(q) ||
        b.billRef.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.customerId.toLowerCase().includes(q)
      );
    }

    return bills.reverse();
  }

  // ==========================================
  // BILLING NOTES & PAYMENT COLLECTION
  // ==========================================

  /**
   * Get all bills for a specific customer with status 'รอวางบิล'
   */
  async getPendingBillsForCustomer(customerId, customerName = '') {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch MASTER_BILLS for pending bills");
    }

    const data = await res.json();
    const rows = data.values || [];

    const cid = (customerId || '').trim().toLowerCase();
    const cname = (customerName || '').trim().toLowerCase();

    const pendingBills = [];

    rows.forEach((r, idx) => {
      const billId = (r[0] || '').trim();
      if (!billId) return;

      const date = r[1] || '';
      const companyReg = r[2] || 'ร้านค้า';
      const source = r[3] || '1. ร้านค้า - ทั่วไป';
      const billRef = r[4] || '';
      const rowCustId = (r[5] || '').trim().toLowerCase();
      const rowCustName = (r[6] || '').trim().toLowerCase();
      const amtStr = r[7] || '0';
      const amountNum = parseFloat(String(amtStr).replace(/,/g, '')) || 0;
      const photoUrl = r[8] || '';
      const createdBy = r[9] || '';
      const createdAt = r[11] || '';
      const billingNoteNo = (r[12] || '').trim();
      const status = (r[13] || 'รอวางบิล').trim();
      const notes = r[14] || '';

      // Must be 'รอวางบิล' and match customer
      if (status === 'รอวางบิล') {
        const matchesCustomer = (cid && rowCustId === cid) ||
                                (cname && (rowCustName === cname || rowCustName.includes(cname)));
        if (matchesCustomer) {
          pendingBills.push({
            rowIndex: idx + 2,
            billId,
            date,
            companyRegistration: companyReg,
            source,
            billRef,
            customerId: r[5] || '',
            customerName: r[6] || '',
            amount: amtStr,
            amountNum,
            photoUrl,
            createdBy,
            createdAt,
            billingNoteNo,
            status,
            notes
          });
        }
      }
    });

    return pendingBills;
  }

  /**
   * Create a new Billing Note consolidating selected bills
   */
  async createBillingNote(data, user) {
    const { customerId, customerName, billIds, billingDate, dueDate, notes } = data;

    if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
      throw new Error("กรุณาเลือกบิลอย่างน้อย 1 รายการเพื่อออกใบวางบิล");
    }

    const token = await this.getAccessToken();

    // 1. Fetch current MASTER_BILLS to validate bills and calculate amounts
    const masterRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!masterRes.ok) {
      throw new Error("Failed to load MASTER_BILLS to create billing note");
    }
    const masterData = await masterRes.json();
    const masterRows = masterData.values || [];

    let storeAmount = 0;
    let fuelAmount = 0;
    const selectedRows = [];

    for (const id of billIds) {
      const trimmedId = (id || '').trim();
      if (!trimmedId) continue;
      const idx = masterRows.findIndex(r => (r[0] || '').trim() === trimmedId);
      if (idx === -1) {
        throw new Error(`ไม่พบบิลรหัส ${trimmedId} ในระบบ`);
      }
      const row = masterRows[idx];
      const status = (row[13] || '').trim();
      if (status !== 'รอวางบิล') {
        throw new Error(`บิลรหัส ${trimmedId} อยู่ในสถานะ '${status}' ไม่สามารถนำมาวางบิลซ้ำได้`);
      }

      const amtNum = parseFloat(String(row[7] || '0').replace(/,/g, '')) || 0;
      const reg = (row[2] || '').trim();

      if (reg === 'ปั๊มน้ำมัน') {
        fuelAmount += amtNum;
      } else {
        storeAmount += amtNum;
      }

      selectedRows.push({
        rowIndex: idx + 2,
        billId: trimmedId,
        date: row[1] || '',
        billRef: row[4] || '',
        amountNum: amtNum,
        registration: reg,
        source: row[3] || ''
      });
    }

    const grandTotal = storeAmount + fuelAmount;

    // 2. Generate sequential Billing Note ID: BN-YYMM-XXXX
    const now = new Date();
    const yy = (now.getFullYear() + 543).toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const defaultBillingDate = `${dd}/${mm}/${now.getFullYear() + 543}`;

    // Default due date: +7 days
    const dueObj = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dueYy = (dueObj.getFullYear() + 543).toString();
    const dueMm = (dueObj.getMonth() + 1).toString().padStart(2, '0');
    const dueDd = dueObj.getDate().toString().padStart(2, '0');
    const defaultDueDate = `${dueDd}/${dueMm}/${dueYy}`;

    const finalBillingDate = billingDate || defaultBillingDate;
    const finalDueDate = dueDate || defaultDueDate;

    const bnCountRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/BILLING_NOTES!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const bnCountData = await bnCountRes.json();
    const bnCount = (bnCountData.values || []).length;
    const seq = (bnCount + 1).toString().padStart(4, '0');
    const billingNo = `BN-${yy}${mm}-${seq}`;

    // 3. Prepare BILLING_NOTES row:
    // [Billing_No, วันที่วางบิล, วันครบกำหนดชำระ, รหัสลูกค้า, ชื่อลูกค้า, รายการบิลที่รวม, ยอดฝั่งร้านค้า, ยอดฝั่งปั๊มน้ำมัน, ยอดรวมสุทธิ, สถานะชำระ, ผู้ออกเอกสาร, หมายเหตุ]
    const noteRow = [
      billingNo,
      finalBillingDate,
      finalDueDate,
      customerId || '',
      customerName || 'ไม่ระบุชื่อ',
      billIds.join(', '),
      storeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      fuelAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'รอชำระ',
      user.username || user.full_name || 'manager',
      notes || ''
    ];

    // Append to BILLING_NOTES
    const appendBnRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/BILLING_NOTES!A:L:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [noteRow] })
    });
    if (!appendBnRes.ok) {
      const errText = await appendBnRes.text();
      throw new Error(`Failed to append to BILLING_NOTES: ${errText}`);
    }

    // 4. Batch update MASTER_BILLS for selected bills: Col M = Billing_No, Col N = 'วางบิลแล้ว'
    const batchUpdates = selectedRows.map(b => ({
      range: `MASTER_BILLS!M${b.rowIndex}:N${b.rowIndex}`,
      values: [[billingNo, 'วางบิลแล้ว']]
    }));

    const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: batchUpdates
      })
    });

    if (!batchRes.ok) {
      console.warn("Warning: Failed batch update to MASTER_BILLS:", await batchRes.text());
    }

    return {
      success: true,
      billingNo,
      billingDate: finalBillingDate,
      dueDate: finalDueDate,
      customerId,
      customerName,
      billCount: billIds.length,
      storeAmount,
      fuelAmount,
      grandTotal,
      status: 'รอชำระ',
      bills: selectedRows
    };
  }

  /**
   * Get all Billing Notes
   */
  async getBillingNotes(filterStatus = 'ALL') {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/BILLING_NOTES!A2:L`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch BILLING_NOTES");
    }

    const data = await res.json();
    const rows = data.values || [];

    let notes = rows.map((r, idx) => {
      const billingNo = (r[0] || '').trim();
      const storeAmt = parseFloat(String(r[6] || '0').replace(/,/g, '')) || 0;
      const fuelAmt = parseFloat(String(r[7] || '0').replace(/,/g, '')) || 0;
      const totalAmt = parseFloat(String(r[8] || '0').replace(/,/g, '')) || 0;
      const billIdsStr = r[5] || '';
      const billIds = billIdsStr.split(',').map(s => s.trim()).filter(Boolean);

      return {
        rowIndex: idx + 2,
        billingNo,
        billingDate: r[1] || '',
        dueDate: r[2] || '',
        customerId: r[3] || '',
        customerName: r[4] || '',
        billIds,
        billCount: billIds.length,
        storeAmount: storeAmt,
        storeAmountFormatted: storeAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        fuelAmount: fuelAmt,
        fuelAmountFormatted: fuelAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        grandTotal: totalAmt,
        grandTotalFormatted: totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        status: (r[9] || 'รอชำระ').trim(),
        issuedBy: r[10] || '',
        notes: r[11] || ''
      };
    }).filter(n => n.billingNo);

    if (filterStatus && filterStatus !== 'ALL') {
      notes = notes.filter(n => n.status === filterStatus);
    }

    return notes.reverse();
  }

  /**
   * Get Detail of a specific Billing Note with its associated itemized bills
   */
  async getBillingNoteDetail(billingNo) {
    const token = await this.getAccessToken();
    const trimmedNo = billingNo.trim();

    // 1. Fetch note from BILLING_NOTES
    const bnRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/BILLING_NOTES!A2:L`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!bnRes.ok) throw new Error("Failed to fetch BILLING_NOTES");
    const bnData = await bnRes.json();
    const bnRows = bnData.values || [];

    const noteRowIdx = bnRows.findIndex(r => (r[0] || '').trim() === trimmedNo);
    if (noteRowIdx === -1) {
      throw new Error(`ไม่พบใบวางบิลเลขที่ ${trimmedNo}`);
    }

    const r = bnRows[noteRowIdx];
    const storeAmt = parseFloat(String(r[6] || '0').replace(/,/g, '')) || 0;
    const fuelAmt = parseFloat(String(r[7] || '0').replace(/,/g, '')) || 0;
    const totalAmt = parseFloat(String(r[8] || '0').replace(/,/g, '')) || 0;
    const billIdsStr = r[5] || '';
    const billIds = billIdsStr.split(',').map(s => s.trim()).filter(Boolean);

    const note = {
      rowIndex: noteRowIdx + 2,
      billingNo: trimmedNo,
      billingDate: r[1] || '',
      dueDate: r[2] || '',
      customerId: r[3] || '',
      customerName: r[4] || '',
      billIds,
      billCount: billIds.length,
      storeAmount: storeAmt,
      storeAmountFormatted: storeAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      fuelAmount: fuelAmt,
      fuelAmountFormatted: fuelAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      grandTotal: totalAmt,
      grandTotalFormatted: totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      status: (r[9] || 'รอชำระ').trim(),
      issuedBy: r[10] || '',
      notes: r[11] || ''
    };

    // 2. Fetch associated bills from MASTER_BILLS
    const masterRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const masterData = await masterRes.json();
    const masterRows = masterData.values || [];

    const associatedBills = [];
    masterRows.forEach((mb, idx) => {
      const bId = (mb[0] || '').trim();
      const bNoteNo = (mb[12] || '').trim();

      if (bNoteNo === trimmedNo || billIds.includes(bId)) {
        const amt = parseFloat(String(mb[7] || '0').replace(/,/g, '')) || 0;
        associatedBills.push({
          rowIndex: idx + 2,
          billId: bId,
          date: mb[1] || '',
          companyRegistration: mb[2] || 'ร้านค้า',
          source: mb[3] || '',
          billRef: mb[4] || '',
          customerId: mb[5] || '',
          customerName: mb[6] || '',
          amount: mb[7] || '0',
          amountNum: amt,
          photoUrl: mb[8] || '',
          createdBy: mb[9] || '',
          status: mb[13] || '',
          notes: mb[14] || ''
        });
      }
    });

    return { note, bills: associatedBills };
  }

  /**
   * Record payment for a Billing Note & automatically split between Store and Fuel
   */
  async recordPayment(data, user) {
    const { billingNo, paymentDate, paidAmount, bankAccount, slipUrl, notes } = data;
    const trimmedNo = (billingNo || '').trim();

    if (!trimmedNo) {
      throw new Error("กรุณาระบุเลขที่ใบวางบิลที่ต้องการรับชำระ");
    }

    const numPaid = parseFloat(String(paidAmount).replace(/,/g, '')) || 0;
    if (numPaid <= 0) {
      throw new Error("กรุณาระบุยอดเงินที่รับชำระให้ถูกต้อง");
    }

    const token = await this.getAccessToken();

    // 1. Get Billing Note details
    const { note, bills } = await this.getBillingNoteDetail(trimmedNo);
    if (note.status === 'ชำระแล้ว') {
      throw new Error(`ใบวางบิลเลขที่ ${trimmedNo} ได้รับการชำระเงินเรียบร้อยแล้ว`);
    }

    // 2. Calculate automatic split for Store vs Fuel
    // Proportionally or based on note's exact split
    let cutStore = 0;
    let cutFuel = 0;

    if (note.grandTotal > 0) {
      if (Math.abs(numPaid - note.grandTotal) < 0.01) {
        // Exact payment
        cutStore = note.storeAmount;
        cutFuel = note.fuelAmount;
      } else {
        // Partial or adjusted payment: proportional split
        const ratioStore = note.storeAmount / note.grandTotal;
        cutStore = Math.round(numPaid * ratioStore * 100) / 100;
        cutFuel = Math.round((numPaid - cutStore) * 100) / 100;
      }
    } else {
      cutStore = numPaid;
      cutFuel = 0;
    }

    // 3. Generate sequential Payment ID: PAY-YYMM-XXXX
    const now = new Date();
    const yy = (now.getFullYear() + 543).toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const defaultPaymentDate = `${dd}/${mm}/${now.getFullYear() + 543}`;
    const finalPaymentDate = paymentDate || defaultPaymentDate;

    const payCountRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/PAYMENTS!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const payCountData = await payCountRes.json();
    const payCount = (payCountData.values || []).length;
    const seq = (payCount + 1).toString().padStart(4, '0');
    const paymentNo = `PAY-${yy}${mm}-${seq}`;

    // Safety guard against Google Sheets 50,000 character cell limit
    let safeSlipUrl = slipUrl || '';
    if (safeSlipUrl.length > 5000 && safeSlipUrl.startsWith('data:image')) {
      safeSlipUrl = '';
    }

    // 4. Append to PAYMENTS tab:
    // [Payment_No, วันที่รับเงิน, เลขที่ใบวางบิล, ชื่อลูกค้า, ยอดโอนจริง, ตัดบัญชีร้านค้า, ตัดบัญชีปั๊มน้ำมัน, ธนาคารที่รับโอน, สลิปโอนเงิน, ผู้บันทึกการรับเงิน, หมายเหตุ]
    const paymentRow = [
      paymentNo,
      finalPaymentDate,
      trimmedNo,
      note.customerName,
      numPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      cutStore.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      cutFuel.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bankAccount || 'โอนผ่านธนาคาร',
      safeSlipUrl,
      user.username || user.full_name || 'cashier',
      notes || ''
    ];

    const appendPayRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/PAYMENTS!A:K:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [paymentRow] })
    });
    if (!appendPayRes.ok) {
      const errText = await appendPayRes.text();
      throw new Error(`Failed to append payment: ${errText}`);
    }

    // 5. Update BILLING_NOTES: Col J (Row rowIndex) = 'ชำระแล้ว'
    const updateBnRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/BILLING_NOTES!J${note.rowIndex}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [['ชำระแล้ว']] })
    });
    if (!updateBnRes.ok) {
      console.warn("Failed to update status in BILLING_NOTES:", await updateBnRes.text());
    }

    // 6. Update MASTER_BILLS for all bills in this note: Col N = 'ชำระแล้ว'
    if (bills.length > 0) {
      const masterUpdates = bills.map(b => ({
        range: `MASTER_BILLS!N${b.rowIndex}`,
        values: [['ชำระแล้ว']]
      }));

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values:batchUpdate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: masterUpdates
        })
      });
    }

    // 7. Auto-generate Official Receipt in RECEIPTS tab
    let receiptNo = '';
    try {
      const recCountRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/RECEIPTS!A2:A`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const recCountData = await recCountRes.json();
      const recCount = (recCountData.values || []).length;
      const recSeq = (recCount + 1).toString().padStart(4, '0');
      receiptNo = `REC-${yy}${mm}-${recSeq}`;

      const receiptRow = [
        receiptNo,
        finalPaymentDate,
        'ใบเสร็จรับเงิน (จากการวางบิล)',
        trimmedNo,
        note.billIds ? note.billIds.join(', ') : '',
        note.customerId || '',
        note.customerName || '',
        numPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        bankAccount ? (bankAccount === 'เงินสด' ? 'เงินสด' : 'เงินโอน') : 'เงินสด',
        bankAccount || 'เงินสด',
        safeSlipUrl,
        user.username || user.full_name || 'admin',
        notes || '',
        new Date().toLocaleString('th-TH')
      ];

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/RECEIPTS!A:N:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [receiptRow] })
      });
    } catch (recErr) {
      console.error("Receipt generation warning:", recErr);
    }

    return {
      success: true,
      paymentNo,
      receiptNo,
      billingNo: trimmedNo,
      customerName: note.customerName,
      paidAmount: numPaid,
      cutStore,
      cutFuel,
      paymentDate: finalPaymentDate,
      bankAccount: bankAccount || 'โอนผ่านธนาคาร',
      status: 'ชำระแล้ว'
    };
  }

  /**
   * Get all receipts list
   */
  async getReceipts(filters = {}) {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/RECEIPTS!A2:N`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const rows = data.values || [];

    let receipts = rows.map((r, idx) => ({
      rowIndex: idx + 2,
      receiptNo: (r[0] || '').trim(),
      receiptDate: (r[1] || '').trim(),
      receiptType: (r[2] || '').trim(),
      billingNo: (r[3] || '').trim(),
      billIdsStr: (r[4] || '').trim(),
      customerId: (r[5] || '').trim(),
      customerName: (r[6] || '').trim(),
      totalAmount: parseFloat(String(r[7] || '0').replace(/,/g, '')) || 0,
      totalAmountFormatted: (r[7] || '0.00').trim(),
      paymentMethod: (r[8] || '').trim(),
      bankAccount: (r[9] || '').trim(),
      slipUrl: (r[10] || '').trim(),
      issuedBy: (r[11] || '').trim(),
      notes: (r[12] || '').trim(),
      createdAt: (r[13] || '').trim()
    })).filter(x => x.receiptNo);

    if (filters.q) {
      const q = filters.q.toLowerCase().trim();
      receipts = receipts.filter(x =>
        x.receiptNo.toLowerCase().includes(q) ||
        x.customerName.toLowerCase().includes(q) ||
        x.billingNo.toLowerCase().includes(q) ||
        x.customerId.toLowerCase().includes(q)
      );
    }

    return receipts.reverse();
  }

  /**
   * Get full detail for a receipt (including full customer address, tax ID, and itemized bills)
   */
  async getReceiptDetail(receiptNo) {
    const trimmedNo = (receiptNo || '').trim();
    const receipts = await this.getReceipts();
    const receipt = receipts.find(r => r.receiptNo.toLowerCase() === trimmedNo.toLowerCase());
    if (!receipt) {
      throw new Error(`ไม่พบใบเสร็จรับเงินเลขที่ ${trimmedNo}`);
    }

    // 1. Fetch store settings
    const storeSettings = await this.getStoreSettings();

    // 2. Fetch customer details
    let customer = null;
    if (receipt.customerId || receipt.customerName) {
      const customers = await this.getCustomers();
      customer = customers.find(c =>
        (receipt.customerId && c.id.toLowerCase() === receipt.customerId.toLowerCase()) ||
        (receipt.customerName && c.name.toLowerCase() === receipt.customerName.toLowerCase())
      );
    }

    // 3. Fetch itemized bills
    let bills = [];
    if (receipt.billingNo) {
      try {
        const bnDetail = await this.getBillingNoteDetail(receipt.billingNo);
        bills = bnDetail.bills || [];
      } catch (e) {
        console.warn("Could not get billing note detail for receipt:", e);
      }
    } else if (receipt.billIdsStr) {
      const billIds = receipt.billIdsStr.split(',').map(s => s.trim()).filter(Boolean);
      const allMaster = await this.getMasterBills();
      bills = allMaster.filter(b => billIds.includes(b.billId));
    }

    return {
      receipt,
      customer: customer || {
        id: receipt.customerId || '-',
        name: receipt.customerName || 'ไม่ระบุชื่อ',
        fullName: receipt.customerName || 'ไม่ระบุชื่อ',
        address: '',
        taxId: '',
        phone: ''
      },
      bills,
      storeSettings
    };
  }

  /**
   * Create a direct cash receipt for storefront sales
   */
  async createCashReceipt(data, user) {
    if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
      throw new Error("เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้นที่สามารถออกใบเสร็จรับเงินได้");
    }

    const { customerId, customerName, paymentMethod, bankAccount, billIds, notes, date } = data;
    const rawAmt = data.amount !== undefined ? data.amount : data.totalAmount;
    const numAmount = parseFloat(String(rawAmt).replace(/,/g, '')) || 0;
    if (numAmount <= 0) {
      throw new Error("กรุณาระบุยอดเงินให้ถูกต้อง");
    }

    const token = await this.getAccessToken();
    const now = new Date();
    const yy = (now.getFullYear() + 543).toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const receiptDate = date || `${dd}/${mm}/${now.getFullYear() + 543}`;

    const recCountRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/RECEIPTS!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const recCountData = await recCountRes.json();
    const recCount = (recCountData.values || []).length;
    const recSeq = (recCount + 1).toString().padStart(4, '0');
    const receiptNo = `REC-${yy}${mm}-${recSeq}`;

    const billIdsArray = Array.isArray(billIds) ? billIds : (billIds ? String(billIds).split(',').map(s => s.trim()) : []);
    const billIdsStr = billIdsArray.join(', ');

    const receiptRow = [
      receiptNo,
      receiptDate,
      'ใบเสร็จรับเงินสดหน้าร้าน',
      '',
      billIdsStr,
      customerId || '',
      customerName || 'ลูกค้าทั่วไป',
      numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      paymentMethod || 'เงินสด',
      bankAccount || (paymentMethod === 'เงินโอน' ? 'โอนผ่านธนาคาร' : 'เงินสด'),
      '',
      user.username || user.full_name || 'cashier',
      notes || '',
      new Date().toLocaleString('th-TH')
    ];

    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/RECEIPTS!A:N:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [receiptRow] })
    });

    if (!appendRes.ok) {
      const err = await appendRes.text();
      throw new Error(`Failed to append receipt: ${err}`);
    }

    return {
      success: true,
      receiptNo,
      receiptDate,
      customerName,
      amount: numAmount,
      paymentMethod: paymentMethod || 'เงินสด'
    };
  }

  /**
   * Get all payments list
   */
  async getPaymentsList() {
    const token = await this.getAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.SHEETS.DELIVERY_MASTER}/values/PAYMENTS!A2:K`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error("Failed to fetch PAYMENTS");
    }

    const data = await res.json();
    const rows = data.values || [];

    return rows.map((r, idx) => ({
      rowIndex: idx + 2,
      paymentNo: r[0] || '',
      paymentDate: r[1] || '',
      billingNo: r[2] || '',
      customerName: r[3] || '',
      paidAmount: r[4] || '0',
      cutStore: r[5] || '0',
      cutFuel: r[6] || '0',
      bankAccount: r[7] || '',
      slipUrl: r[8] || '',
      recordedBy: r[9] || '',
      notes: r[10] || ''
    })).filter(p => p.paymentNo).reverse();
  }

  async getStoreSettings() {
    const defaultSettings = {
      shop_name: 'สหธรรม',
      shop_subtitle: 'ระบบบริหารจัดการสต็อก วัสดุก่อสร้าง และสถานีบริการน้ำมัน',
      shop_tax_id: '0423533000123',
      shop_phone: '042-298022',
      shop_address: '',
      shop_footer: 'ในนาม สหธรรม'
    };

    try {
      const token = await this.getAccessToken();
      const spreadsheetId = config.SHEETS.DELIVERY_MASTER;
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/SETTINGS!A1:B10`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        try {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: 'SETTINGS' } } }]
            })
          });

          const initData = [
            ["key", "value"],
            ["shop_name", defaultSettings.shop_name],
            ["shop_subtitle", defaultSettings.shop_subtitle],
            ["shop_tax_id", defaultSettings.shop_tax_id],
            ["shop_phone", defaultSettings.shop_phone],
            ["shop_address", defaultSettings.shop_address],
            ["shop_footer", defaultSettings.shop_footer]
          ];

          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/SETTINGS!A1:B7?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: initData })
          });
        } catch (initErr) {
          console.error("Error creating SETTINGS sheet:", initErr);
        }
        return defaultSettings;
      }

      const data = await res.json();
      const rows = data.values || [];
      const settings = { ...defaultSettings };

      rows.forEach(r => {
        if (r[0] && r[0] !== 'key') {
          settings[r[0]] = r[1] !== undefined ? String(r[1]) : '';
        }
      });

      return settings;
    } catch (err) {
      console.error("getStoreSettings error:", err);
      return defaultSettings;
    }
  }

  async updateStoreSettings(newSettings, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถตั้งค่าข้อมูลร้านค้าได้");
    }

    const current = await this.getStoreSettings();
    const merged = {
      shop_name: (newSettings.shop_name !== undefined ? String(newSettings.shop_name).trim() : current.shop_name) || 'สหธรรม',
      shop_subtitle: newSettings.shop_subtitle !== undefined ? String(newSettings.shop_subtitle).trim() : current.shop_subtitle,
      shop_tax_id: newSettings.shop_tax_id !== undefined ? String(newSettings.shop_tax_id).trim() : current.shop_tax_id,
      shop_phone: newSettings.shop_phone !== undefined ? String(newSettings.shop_phone).trim() : current.shop_phone,
      shop_address: newSettings.shop_address !== undefined ? String(newSettings.shop_address).trim() : current.shop_address,
      shop_footer: newSettings.shop_footer !== undefined ? String(newSettings.shop_footer).trim() : current.shop_footer
    };

    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DELIVERY_MASTER;

    const values = [
      ["key", "value"],
      ["shop_name", merged.shop_name],
      ["shop_subtitle", merged.shop_subtitle],
      ["shop_tax_id", merged.shop_tax_id],
      ["shop_phone", merged.shop_phone],
      ["shop_address", merged.shop_address],
      ["shop_footer", merged.shop_footer]
    ];

    const putRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/SETTINGS!A1:B7?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });

    if (!putRes.ok) {
      throw new Error("Failed to update SETTINGS in Google Sheets");
    }

    return merged;
  }

  // ==========================================
  // PHASE 5: DAILY STOREFRONT REVENUE & CLOSING
  // ==========================================

  async recordCashDrop(data, currentUser) {
    if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
      throw new Error("เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้นที่สามารถบันทึกเก็บเงินสดได้");
    }

    const { date, time, amount, notes } = data;
    const numAmount = parseFloat(String(amount).replace(/,/g, ''));
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error("กรุณาระบุจำนวนเงินที่ถูกต้องและมากกว่า 0");
    }

    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DAILY_RECEIPTS;

    // Count rows to generate ID CSH-YYMM-XXXX
    const countRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/CASH_DROPS!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const countData = await countRes.json();
    const totalCount = (countData.values || []).length;
    const nextSeq = totalCount + 1;

    const now = new Date();
    const thaiYearShort = ((now.getFullYear() + 543) % 100).toString().padStart(2, '0');
    const thaiMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const dropId = `CSH-${thaiYearShort}${thaiMonth}-${nextSeq.toString().padStart(4, '0')}`;

    const dateStr = date || `${now.getDate().toString().padStart(2, '0')}/${thaiMonth}/${now.getFullYear() + 543}`;
    const timeStr = time || `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} น.`;
    const recordedAt = `${dateStr} ${timeStr}`;

    const newRow = [
      dropId,
      dateStr,
      timeStr,
      numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      '', // closing_id (blank until daily closing)
      currentUser.username,
      recordedAt,
      notes || ''
    ];

    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/CASH_DROPS!A:H:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [newRow] })
    });

    if (!appendRes.ok) {
      throw new Error("Failed to record cash drop to CASH_DROPS");
    }

    return {
      dropId,
      date: dateStr,
      time: timeStr,
      amount: numAmount,
      amountFormatted: numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      recordedBy: currentUser.username,
      recordedAt,
      notes: notes || ''
    };
  }

  async getCashDrops(targetDate) {
    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DAILY_RECEIPTS;

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/CASH_DROPS!A2:H`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const rows = data.values || [];

    const drops = rows.map((r, idx) => {
      const numAmount = parseFloat(String(r[3] || '0').replace(/,/g, '')) || 0;
      return {
        rowIndex: idx + 2,
        dropId: r[0] || '',
        date: r[1] || '',
        time: r[2] || '',
        amount: numAmount,
        amountFormatted: numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        closingId: r[4] || '',
        recordedBy: r[5] || '',
        recordedAt: r[6] || '',
        notes: r[7] || ''
      };
    }).filter(d => d.dropId);

    const normalizeDate = (dStr) => {
      if (!dStr) return '';
      dStr = String(dStr).trim();
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        if (parts.length === 3) {
          const d = parts[0].padStart(2, '0');
          const m = parts[1].padStart(2, '0');
          let y = parseInt(parts[2]);
          if (y > 2500) y -= 543;
          return `${d}/${m}/${y}`;
        }
      } else if (dStr.includes('-')) {
        const parts = dStr.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0]);
          const m = parts[1].padStart(2, '0');
          const d = parts[2].padStart(2, '0');
          return `${d}/${m}/${y}`;
        }
      }
      return dStr;
    };

    if (targetDate) {
      const normTarget = normalizeDate(targetDate);
      return drops.filter(d => normalizeDate(d.date) === normTarget);
    }
    return drops.reverse();
  }

  async getDailyCreditBills(targetDate) {
    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DELIVERY_MASTER;

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/MASTER_BILLS!A2:O`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      return { totalAmount: 0, bills: [], count: 0 };
    }

    const data = await res.json();
    const rows = data.values || [];

    const normalizeDate = (dStr) => {
      if (!dStr) return '';
      if (dStr.includes('/')) {
        const parts = dStr.split('/');
        if (parts.length === 3) {
          const d = parts[0].padStart(2, '0');
          const m = parts[1].padStart(2, '0');
          let y = parseInt(parts[2]);
          if (y > 2500) y -= 543;
          return `${d}/${m}/${y}`;
        }
      } else if (dStr.includes('-')) {
        const parts = dStr.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0]);
          const m = parts[1].padStart(2, '0');
          const d = parts[2].padStart(2, '0');
          return `${d}/${m}/${y}`;
        }
      }
      return dStr;
    };

    const normTarget = normalizeDate(targetDate);

    const matchedBills = [];
    let totalCredit = 0;

    for (const r of rows) {
      const billId = r[0];
      const billDate = r[1];
      const category = r[2] || '';
      const status = r[13] || '';
      const amount = parseFloat(String(r[7] || '0').replace(/,/g, '')) || 0;

      if (!billId || status === 'ขอยกเลิก' || status === 'ยกเลิก') continue;

      const normBillDate = normalizeDate(billDate);
      if (!normTarget || normBillDate === normTarget) {
        matchedBills.push({
          billId,
          date: billDate,
          category,
          source: r[3] || '',
          billRef: r[4] || '',
          customerId: r[5] || '',
          customerName: r[6] || '',
          amount,
          amountFormatted: amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          status
        });
        totalCredit += amount;
      }
    }

    return {
      totalAmount: totalCredit,
      totalAmountFormatted: totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      count: matchedBills.length,
      bills: matchedBills
    };
  }

  async recordDailyClosing(payload, currentUser) {
    if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
      throw new Error("เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้นที่สามารถปิดยอดรายรับประจำวันได้");
    }

    const {
      date,
      changeFloat = 7500,
      cashDropsTotal = 0,
      cashDrawerClose = 0,
      transferTotal = 0,
      creditTotal = 0,
      laborCash = 0,
      laborCredit = 0,
      notes = ''
    } = payload;

    const numChangeFloat = parseFloat(String(changeFloat).replace(/,/g, '')) || 0;
    const numDropsTotal = parseFloat(String(cashDropsTotal).replace(/,/g, '')) || 0;
    const numDrawerClose = parseFloat(String(cashDrawerClose).replace(/,/g, '')) || 0;
    const numTransferTotal = parseFloat(String(transferTotal).replace(/,/g, '')) || 0;
    const numCreditTotal = parseFloat(String(creditTotal).replace(/,/g, '')) || 0;
    const numLaborCash = parseFloat(String(laborCash).replace(/,/g, '')) || 0;
    const numLaborCredit = parseFloat(String(laborCredit).replace(/,/g, '')) || 0;

    // Mathematical calculations
    const cashNet = Math.max(0, (numDropsTotal + numDrawerClose) - numChangeFloat);
    const cashAndTransfer = cashNet + numTransferTotal;
    const laborTotal = numLaborCash + numLaborCredit;
    const goodsCashTransfer = Math.max(0, cashAndTransfer - numLaborCash);
    const goodsCredit = Math.max(0, numCreditTotal - numLaborCredit);
    const goodsTotal = goodsCashTransfer + goodsCredit;
    const grandTotal = goodsTotal + laborTotal;

    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DAILY_RECEIPTS;

    // Count rows to generate ID DCR-YYMM-XXXX
    const countRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/DAILY_CLOSING!A2:A`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const countData = await countRes.json();
    const totalCount = (countData.values || []).length;
    const nextSeq = totalCount + 1;

    const now = new Date();
    const thaiYearShort = ((now.getFullYear() + 543) % 100).toString().padStart(2, '0');
    const thaiMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const closingId = `DCR-${thaiYearShort}${thaiMonth}-${nextSeq.toString().padStart(4, '0')}`;

    const dateStr = date || `${now.getDate().toString().padStart(2, '0')}/${thaiMonth}/${now.getFullYear() + 543}`;
    const recordedAt = `${now.getDate().toString().padStart(2, '0')}/${thaiMonth}/${now.getFullYear() + 543} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const newRow = [
      closingId,
      dateStr,
      fmt(numChangeFloat),
      fmt(numDropsTotal),
      fmt(numDrawerClose),
      fmt(cashNet),
      fmt(numTransferTotal),
      fmt(cashAndTransfer),
      fmt(numCreditTotal),
      fmt(numLaborCash),
      fmt(numLaborCredit),
      fmt(laborTotal),
      fmt(goodsCashTransfer),
      fmt(goodsCredit),
      fmt(goodsTotal),
      fmt(grandTotal),
      currentUser.username,
      recordedAt,
      notes || ''
    ];

    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/DAILY_CLOSING!A:S:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [newRow] })
    });

    if (!appendRes.ok) {
      throw new Error("Failed to append to DAILY_CLOSING");
    }

    // Update closing_id in CASH_DROPS rows for this date
    try {
      const dropsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/CASH_DROPS!A2:E`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        const dRows = dropsData.values || [];
        const updateRanges = [];
        dRows.forEach((r, idx) => {
          if (r[1] === dateStr && (!r[4] || r[4] === '')) {
            updateRanges.push({
              range: `CASH_DROPS!E${idx + 2}`,
              values: [[closingId]]
            });
          }
        });
        if (updateRanges.length > 0) {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              valueInputOption: 'USER_ENTERED',
              data: updateRanges
            })
          });
        }
      }
    } catch (linkErr) {
      console.error("Link cash drops error:", linkErr);
    }

    return {
      closingId,
      date: dateStr,
      changeFloat: numChangeFloat,
      cashDropsTotal: numDropsTotal,
      cashDrawerClose: numDrawerClose,
      cashNet,
      transferTotal: numTransferTotal,
      cashAndTransfer,
      creditTotal: numCreditTotal,
      laborCash: numLaborCash,
      laborCredit: numLaborCredit,
      laborTotal,
      goodsCashTransfer,
      goodsCredit,
      goodsTotal,
      grandTotal,
      recordedBy: currentUser.username,
      recordedAt,
      notes
    };
  }

  async getDailyClosingsList() {
    const token = await this.getAccessToken();
    const spreadsheetId = config.SHEETS.DAILY_RECEIPTS;

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/DAILY_CLOSING!A2:S`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const rows = data.values || [];

    return rows.map((r, idx) => ({
      rowIndex: idx + 2,
      closingId: r[0] || '',
      date: r[1] || '',
      changeFloat: r[2] || '0.00',
      cashDropsTotal: r[3] || '0.00',
      cashDrawerClose: r[4] || '0.00',
      cashNet: r[5] || '0.00',
      transferTotal: r[6] || '0.00',
      cashAndTransfer: r[7] || '0.00',
      creditTotal: r[8] || '0.00',
      laborCash: r[9] || '0.00',
      laborCredit: r[10] || '0.00',
      laborTotal: r[11] || '0.00',
      goodsCashTransfer: r[12] || '0.00',
      goodsCredit: r[13] || '0.00',
      goodsTotal: r[14] || '0.00',
      grandTotal: r[15] || '0.00',
      recordedBy: r[16] || '',
      recordedAt: r[17] || '',
      notes: r[18] || ''
    })).filter(c => c.closingId).reverse();
  }
}

module.exports = new GoogleSheetsService();
