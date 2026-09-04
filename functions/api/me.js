import { jsonResponse } from '../_helper.js';

export async function onRequestGet({ request }) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
  }

  try {
    const user = JSON.parse(atob(authHeader.substring(7)));
    if (!user || user.exp < Date.now()) {
      return jsonResponse({ success: false, message: 'Session หมดอายุ' }, 401);
    }
    return jsonResponse({ success: true, user });
  } catch (e) {
    return jsonResponse({ success: false, message: 'Token ไม่ถูกต้อง' }, 401);
  }
}
