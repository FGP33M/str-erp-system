import { jsonResponse } from '../_helper.js';

export async function onRequestPost() {
  return jsonResponse({ success: true, message: 'ออกจากระบบเรียบร้อย' });
}
