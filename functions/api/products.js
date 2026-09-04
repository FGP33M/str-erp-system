import { getGoogleAccessToken, parseProductDetails, jsonResponse } from '../_helper.js';

export async function onRequestGet({ request, env }) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
    }

    let user;
    try {
      user = JSON.parse(atob(authHeader.substring(7)));
      if (!user || user.exp < Date.now()) {
        return jsonResponse({ success: false, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401);
      }
    } catch (e) {
      return jsonResponse({ success: false, message: 'Token ไม่ถูกต้อง' }, 401);
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const supplierFilter = (url.searchParams.get('supplier') || '').trim().toLowerCase();
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 50;

    const token = await getGoogleAccessToken(env);
    const productSheetId = env.PRODUCT_SHEET_ID || '1pCuUFizx8K2VTjMGGXB4MYfVJQndIFseky_gKuzApPg';

    // Get metadata to get tab title
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${productSheetId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meta = await metaRes.json();
    const tabTitle = meta.sheets[0].properties.title;

    // Fetch product rows
    const range = encodeURIComponent(`'${tabTitle}'!A2:G`);
    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${productSheetId}/values/${range}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!valRes.ok) {
      return jsonResponse({ success: false, message: 'ไม่สามารถโหลดข้อมูลสินค้าได้' }, 500);
    }

    const valData = await valRes.json();
    const rows = valData.values || [];

    const isManagerOrAdmin = (user.role === 'manager' || user.role === 'admin');
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

      // Apply supplier filter
      if (supplierFilter && supplier.toLowerCase() !== supplierFilter) {
        continue;
      }

      // Apply query search
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        const matches = terms.every(term => searchIndex.includes(term));
        if (!matches) continue;
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

      // STRICT SECURITY: Include cost and profit ONLY for manager/admin
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
      role: user.role,
      isManagerOrAdmin,
      suppliers: Array.from(allSuppliers).sort(),
      items: paginated
    });

  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}
