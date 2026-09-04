import { getGoogleAccessToken, jsonResponse } from '../_helper.js';

export async function onRequest({ request, env }) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
  }

  let currentUser;
  try {
    currentUser = JSON.parse(atob(authHeader.substring(7)));
    if (!currentUser || currentUser.exp < Date.now()) {
      return jsonResponse({ success: false, message: 'Session หมดอายุ' }, 401);
    }
  } catch (e) {
    return jsonResponse({ success: false, message: 'Token ไม่ถูกต้อง' }, 401);
  }

  if (currentUser.role !== 'manager' && currentUser.role !== 'admin') {
    return jsonResponse({ success: false, message: 'ไม่มีสิทธิ์จัดการผู้ใช้งาน' }, 403);
  }

  const token = await getGoogleAccessToken(env);
  const authSheetId = env.AUTH_SHEET_ID || '1uM237XywBb0lFa9wavSP-rxNEOYUQldJp7AnLX09uM8';
  const method = request.method;

  // GET: List users
  if (method === 'GET') {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A2:F100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const rows = data.values || [];
    const users = [];

    for (let i = 0; i < rows.length; i++) {
      const [user_id, username, password_hash, full_name, role, is_active] = rows[i];
      if (!user_id && !username) continue;
      const userRole = role ? role.trim().toLowerCase() : 'staff';

      // Manager only sees staff and senior_staff
      if (currentUser.role === 'manager' && (userRole === 'admin' || userRole === 'manager')) {
        continue;
      }

      users.push({
        row_index: i + 2,
        user_id,
        username,
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

  // POST: Add new user
  if (method === 'POST') {
    const body = await request.json();
    const { username, password, full_name, role } = body;
    if (!username || !password || !role) {
      return jsonResponse({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' }, 400);
    }

    const cleanRole = role.trim().toLowerCase();
    if (currentUser.role === 'manager' && cleanRole !== 'staff' && cleanRole !== 'senior_staff') {
      return jsonResponse({ success: false, message: 'ผู้จัดการสามารถสร้างได้เฉพาะ พนักงาน หรือ พนักงานอาวุโส เท่านั้น' }, 403);
    }

    const newRow = ['id_' + Date.now().toString(36), username.trim(), password.trim(), (full_name || '').trim(), cleanRole, 'active'];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A:F:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [newRow] })
    });

    return jsonResponse({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จ' }, 201);
  }

  // PUT: Update user
  if (method === 'PUT') {
    const body = await request.json();
    const { user_id, full_name, password, role, is_active } = body;
    if (!user_id) {
      return jsonResponse({ success: false, message: 'ระบุ user_id' }, 400);
    }

    // Fetch existing
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

    if (targetIdx === -1) {
      return jsonResponse({ success: false, message: 'ไม่พบผู้ใช้' }, 404);
    }

    const curRole = targetRow[4] ? targetRow[4].trim().toLowerCase() : 'staff';
    if (currentUser.role === 'manager' && (curRole === 'manager' || curRole === 'admin')) {
      return jsonResponse({ success: false, message: 'ผู้จัดการไม่สามารถแก้ไขผู้ใช้ระดับเดียวกันหรือแอดมินได้' }, 403);
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
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [updatedRow] })
    });

    return jsonResponse({ success: true, message: 'อัปเดตข้อมูลเรียบร้อย' });
  }

  // DELETE: Deactivate
  if (method === 'DELETE') {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id');
    if (!userId) return jsonResponse({ success: false, message: 'ระบุ id' }, 400);

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A2:F100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const rows = data.values || [];

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === userId || rows[i][1] === userId) {
        const rowIdx = i + 2;
        const curRole = rows[i][4] ? rows[i][4].trim().toLowerCase() : 'staff';
        if (currentUser.role === 'manager' && (curRole === 'manager' || curRole === 'admin')) {
          return jsonResponse({ success: false, message: 'ไม่มีสิทธิ์ระงับผู้ใช้นี้' }, 403);
        }
        rows[i][5] = 'inactive';
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/Users!A${rowIdx}:F${rowIdx}?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [rows[i]] })
        });
        return jsonResponse({ success: true, message: 'ระงับการใช้งานเรียบร้อย' });
      }
    }

    return jsonResponse({ success: false, message: 'ไม่พบผู้ใช้' }, 404);
  }

  return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
}
