import { getGoogleAccessToken, jsonResponse } from '../_helper.js';

export async function onRequestPost({ request, env }) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return jsonResponse({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }, 400);
    }

    const token = await getGoogleAccessToken(env);
    const authSheetId = env.AUTH_SHEET_ID || '1uM237XywBb0lFa9wavSP-rxNEOYUQldJp7AnLX09uM8';

    // Fetch users
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

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    if (!matchedUser) {
      // Log failed login
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

    // Success
    await logLogin(token, authSheetId, [['log_' + Date.now(), matchedUser.user_id, matchedUser.username, matchedUser.role, timestamp, clientIp, 'SUCCESS']]);

    // Create lightweight signed/encoded token
    const sessionData = {
      user_id: matchedUser.user_id,
      username: matchedUser.username,
      full_name: matchedUser.full_name,
      role: matchedUser.role,
      exp: Date.now() + 24 * 60 * 60 * 1000
    };
    const sessionToken = btoa(JSON.stringify(sessionData));

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

async function logLogin(token, authSheetId, rows) {
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${authSheetId}/values/'Login_Logs'!A:G:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: rows })
    });
  } catch (e) {
    console.error("Log error:", e);
  }
}
