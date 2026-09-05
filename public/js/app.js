// STR ERP Frontend Application

let currentUser = null;
let currentToken = localStorage.getItem('erp_token') || '';
let searchDebounceTimer = null;
let currentPage = 1;
let currentSearchQuery = '';
let currentSupplierFilter = '';
let currentUsersList = [];

// Store / Company Settings (Default: สหธรรม)
let storeSettings = {
  shop_name: 'สหธรรม',
  shop_subtitle: 'ระบบบริหารจัดการสต็อก วัสดุก่อสร้าง และสถานีบริการน้ำมัน',
  shop_tax_id: '0423533000123',
  shop_phone: '042-298022',
  shop_address: '',
  shop_footer: 'ในนาม สหธรรม'
};

// Role display mappings
const ROLE_NAMES = {
  'admin': 'ผู้ดูแลระบบ (Admin)',
  'manager': 'ผู้จัดการ (Manager)',
  'senior_staff': 'พนักงานอาวุโส (Senior Staff)',
  'staff': 'พนักงานทั่วไป (Staff)'
};

const ROLE_COLORS = {
  'admin': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'manager': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'senior_staff': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'staff': 'bg-blue-500/20 text-blue-300 border-blue-500/30'
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

  await loadStoreSettings();

  if (currentToken) {
    await checkAuth();
  } else {
    navigateTo('login');
  }
});

function refreshIcons() {
  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 10);
  }
}

// Navigation router
function navigateTo(viewName) {
  const views = ['login', 'dashboard', 'search', 'users', 'logs', 'delivery-bill', 'manager-audit', 'executive-dashboard', 'billing-notes', 'settings', 'daily-revenue'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const targetEl = document.getElementById(`view-${viewName}`);
  if (targetEl) targetEl.classList.remove('hidden');

  const header = document.getElementById('app-header');
  if (viewName === 'login') {
    if (header) header.classList.add('hidden');
  } else {
    if (header) header.classList.remove('hidden');
  }

  if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'search') {
    initSearchPage();
  } else if (viewName === 'users') {
    initUsersPage();
  } else if (viewName === 'logs') {
    fetchLoginLogs();
  } else if (viewName === 'delivery-bill') {
    initDeliveryBillPage();
  } else if (viewName === 'manager-audit') {
    initManagerAuditPage();
  } else if (viewName === 'executive-dashboard') {
    initExecutiveDashboardPage();
  } else if (viewName === 'billing-notes') {
    initBillingPage();
  } else if (viewName === 'settings') {
    initSettingsPage();
  } else if (viewName === 'daily-revenue') {
    if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
      showToast('เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น', false);
      navigateTo('dashboard');
      return;
    }
    initDailyRevenuePage();
  }

  refreshIcons();
}

// ==========================================
// STORE SETTINGS
// ==========================================

async function loadStoreSettings() {
  try {
    const cached = localStorage.getItem('erp_settings');
    if (cached) {
      storeSettings = { ...storeSettings, ...JSON.parse(cached) };
      applyStoreSettings();
    }
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.settings) {
        storeSettings = { ...storeSettings, ...data.settings };
        localStorage.setItem('erp_settings', JSON.stringify(storeSettings));
        applyStoreSettings();
      }
    }
  } catch (err) {
    console.error("loadStoreSettings error:", err);
  }
}

function applyStoreSettings() {
  const brandTitle = document.getElementById('brand-title');
  if (brandTitle) brandTitle.innerText = `${storeSettings.shop_name || 'สหธรรม'} ERP`;
  const logoText = document.getElementById('brand-logo-text');
  if (logoText) logoText.innerText = (storeSettings.shop_name || 'สหธรรม').slice(0, 7);
  const subtitle = document.getElementById('brand-subtitle');
  if (subtitle && storeSettings.shop_subtitle) subtitle.innerText = storeSettings.shop_subtitle;
}

function initSettingsPage() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถเข้าถึงหน้านี้ได้', false);
    return navigateTo('dashboard');
  }

  const nameInput = document.getElementById('setting-shop-name');
  const subInput = document.getElementById('setting-shop-subtitle');
  const taxInput = document.getElementById('setting-shop-tax-id');
  const phoneInput = document.getElementById('setting-shop-phone');
  const addrInput = document.getElementById('setting-shop-address');
  const footerInput = document.getElementById('setting-shop-footer');

  if (nameInput) nameInput.value = storeSettings.shop_name || 'สหธรรม';
  if (subInput) subInput.value = storeSettings.shop_subtitle || '';
  if (taxInput) taxInput.value = storeSettings.shop_tax_id || '';
  if (phoneInput) phoneInput.value = storeSettings.shop_phone || '';
  if (addrInput) addrInput.value = storeSettings.shop_address || '';
  if (footerInput) footerInput.value = storeSettings.shop_footer || 'ในนาม สหธรรม';
}

async function handleSaveSettings(e) {
  if (e) e.preventDefault();
  const shop_name = document.getElementById('setting-shop-name').value.trim();
  const shop_subtitle = document.getElementById('setting-shop-subtitle').value.trim();
  const shop_tax_id = document.getElementById('setting-shop-tax-id').value.trim();
  const shop_phone = document.getElementById('setting-shop-phone').value.trim();
  const shop_address = document.getElementById('setting-shop-address').value.trim();
  const shop_footer = document.getElementById('setting-shop-footer').value.trim();

  if (!shop_name) {
    return showToast('กรุณาระบุชื่อร้านค้า', false);
  }

  const btn = document.getElementById('btn-save-settings');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>กำลังบันทึก...</span>`;
    refreshIcons();
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        shop_name,
        shop_subtitle,
        shop_tax_id,
        shop_phone,
        shop_address,
        shop_footer
      })
    });
    const data = await res.json();
    if (data.success) {
      storeSettings = { ...storeSettings, ...data.settings };
      localStorage.setItem('erp_settings', JSON.stringify(storeSettings));
      applyStoreSettings();
      showToast('บันทึกข้อมูลร้านค้าเรียบร้อยแล้ว');
      navigateTo('dashboard');
    } else {
      showToast(data.message || 'บันทึกข้อมูลไม่สำเร็จ', false);
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      refreshIcons();
    }
  }
}

// Toast notification
function showToast(msg, isSuccess = true) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');

  toastMsg.innerText = msg;
  toast.className = `fixed bottom-5 right-5 z-50 transition-all duration-300 pointer-events-none bg-slate-800 border ${
    isSuccess ? 'border-blue-500/50 text-blue-300' : 'border-red-500/50 text-red-300'
  } text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5`;

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3000);
}

// ==========================================
// AUTHENTICATION
// ==========================================

async function checkAuth() {
  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateHeaderUser();
      navigateTo('dashboard');
    } else {
      localStorage.removeItem('erp_token');
      currentToken = '';
      navigateTo('login');
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    navigateTo('login');
  }
}

function updateHeaderUser() {
  if (!currentUser) return;
  const nameEl = document.getElementById('nav-user-name');
  const roleEl = document.getElementById('nav-user-role');
  const badgeEl = document.getElementById('nav-user-badge');

  if (nameEl) nameEl.innerText = currentUser.full_name || currentUser.username;
  if (roleEl) {
    roleEl.innerText = (currentUser.role || 'staff').toUpperCase();
    roleEl.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
      ROLE_COLORS[currentUser.role] || 'bg-slate-700 text-slate-300 border-slate-600'
    }`;
  }
  if (badgeEl) badgeEl.classList.remove('hidden');
}

async function handleLogin(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errDiv = document.getElementById('login-error');
  const errText = document.getElementById('login-error-text');
  const btnSubmit = document.getElementById('btn-login-submit');

  if (!username || !password) return;

  errDiv.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `
    <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
    <span>กำลังตรวจสอบ...</span>
  `;
  refreshIcons();

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('erp_token', currentToken);
      updateHeaderUser();
      showToast(`เข้าสู่ระบบสำเร็จในฐานะ ${ROLE_NAMES[currentUser.role] || currentUser.role}`);
      navigateTo('dashboard');
    } else {
      errText.innerText = data.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      errDiv.classList.remove('hidden');
      refreshIcons();
    }
  } catch (err) {
    errText.innerText = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
    errDiv.classList.remove('hidden');
    refreshIcons();
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `
      <span>เข้าสู่ระบบ</span>
      <i data-lucide="arrow-right" class="w-4 h-4"></i>
    `;
    refreshIcons();
  }
}


function togglePasswordVisibility() {
  const pwd = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    pwd.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  refreshIcons();
}

async function handleLogout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
  } catch (e) {}

  localStorage.removeItem('erp_token');
  currentToken = '';
  currentUser = null;
  navigateTo('login');
  showToast("ออกจากระบบเรียบร้อยแล้ว");
}

// ==========================================
// DASHBOARD VIEW (Role-based Menu Visibility)
// ==========================================

function renderDashboard() {
  if (!currentUser) return;
  const nameEl = document.getElementById('dash-welcome-name');
  const roleBadge = document.getElementById('dash-role-badge');
  const roleDesc = document.getElementById('dash-role-desc');
  const menuScopeBadge = document.getElementById('menu-scope-badge');

  if (nameEl) nameEl.innerText = `คุณ${currentUser.full_name || currentUser.username}`;
  if (roleBadge) {
    roleBadge.innerText = ROLE_NAMES[currentUser.role] || currentUser.role;
    roleBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
      ROLE_COLORS[currentUser.role] || 'bg-slate-700 text-slate-300 border-slate-600'
    }`;
  }

  // Cards
  const cardSearch = document.getElementById('card-menu-search');
  const cardDelivery = document.getElementById('card-menu-delivery-bill');
  const cardExecutive = document.getElementById('card-menu-executive');
  const cardMaster = document.getElementById('card-menu-master');
  const cardBilling = document.getElementById('card-menu-billing');
  const cardRevenue = document.getElementById('card-menu-revenue');
  const cardUsers = document.getElementById('card-menu-users');
  const cardLogs = document.getElementById('card-menu-logs');
  const cardSettings = document.getElementById('card-menu-settings');
  const badgeUsersScope = document.getElementById('badge-users-scope');
  const titleUsers = document.getElementById('title-menu-users');
  const descUsers = document.getElementById('desc-menu-users');

  const role = currentUser.role || 'staff';

  if (role === 'staff' || role === 'senior_staff') {
    // พนักงาน: ค้นหาสินค้า + บันทึกใบส่งของ
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    if (cardExecutive) cardExecutive.classList.add('hidden');
    if (cardMaster) cardMaster.classList.add('hidden');
    if (cardBilling) cardBilling.classList.add('hidden');
    if (cardRevenue) cardRevenue.classList.add('hidden');
    cardUsers.classList.add('hidden');
    cardLogs.classList.add('hidden');
    if (cardSettings) cardSettings.classList.add('hidden');

    roleDesc.innerText = "สิทธิ์พนักงาน: เข้าถึง 2 เมนูหลัก (ค้นหาข้อมูลสินค้า และ บันทึกใบส่งของ)";
    menuScopeBadge.innerText = "พนักงาน: เข้าถึง 2 เมนู";
  } else if (role === 'manager') {
    // ผู้จัดการ: งานขาย, แดชบอร์ดผู้บริหาร, ออกใบวางบิล & รับชำระ, บันทึกรายรับหน้าร้าน, คลังบิลหลัก และจัดการพนักงาน
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    if (cardExecutive) cardExecutive.classList.remove('hidden');
    if (cardMaster) cardMaster.classList.remove('hidden');
    if (cardBilling) cardBilling.classList.remove('hidden');
    if (cardRevenue) cardRevenue.classList.remove('hidden');
    cardUsers.classList.remove('hidden');
    cardLogs.classList.add('hidden');
    if (cardSettings) cardSettings.classList.add('hidden');

    badgeUsersScope.innerText = "จัดการพนักงาน";
    titleUsers.innerText = "จัดการพนักงาน";
    descUsers.innerText = "เพิ่ม ลบ แก้ไขสิทธิ์ และรีเซ็ตรหัสผ่านของพนักงานหน้าร้าน";

    roleDesc.innerText = "สิทธิ์ผู้จัดการ: แดชบอร์ดผู้บริหาร, ออกใบวางบิล & รับชำระ, บันทึกรายรับหน้าร้าน, คลังบิลหลัก และจัดการพนักงาน";
    menuScopeBadge.innerText = "ผู้จัดการ: สิทธิ์บริหาร & วางบิล";
  } else if (role === 'admin') {
    // Admin: สิทธิ์เต็มรูปแบบ
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    if (cardExecutive) cardExecutive.classList.remove('hidden');
    if (cardMaster) cardMaster.classList.remove('hidden');
    if (cardBilling) cardBilling.classList.remove('hidden');
    if (cardRevenue) cardRevenue.classList.remove('hidden');
    cardUsers.classList.remove('hidden');
    cardLogs.classList.remove('hidden');
    if (cardSettings) cardSettings.classList.remove('hidden');

    badgeUsersScope.innerText = "จัดการผู้ใช้ทุกคน";
    titleUsers.innerText = "จัดการผู้เข้าใช้ทั้งหมด";
    descUsers.innerText = "จัดการบัญชีผู้ใช้ทุกระดับ (พนักงาน, ผู้จัดการ, แอดมิน)";

    roleDesc.innerText = "สิทธิ์ผู้ดูแลระบบ (Admin): เข้าถึงได้ทุกฟังก์ชัน รวมทั้งระบบออกใบวางบิลและรับชำระ";
    menuScopeBadge.innerText = "ผู้ดูแลระบบ: สิทธิ์เต็มรูปแบบ";
  }
}

// ==========================================
// PRODUCT SEARCH VIEW
// ==========================================

function initSearchPage() {
  const isManagerOrAdmin = currentUser && (currentUser.role === 'manager' || currentUser.role === 'admin');
  const thCost = document.getElementById('th-cost-price');
  const refreshBtn = document.getElementById('btn-refresh-cache');

  if (isManagerOrAdmin) {
    if (thCost) thCost.classList.remove('hidden');
    if (refreshBtn) refreshBtn.classList.remove('hidden');
  } else {
    if (thCost) thCost.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
  }

  refreshIcons();
  fetchProducts();
}

function onSearchInput(e) {
  currentSearchQuery = e.target.value.trim();
  currentPage = 1;

  const clearBtn = document.getElementById('search-clear-btn');
  if (currentSearchQuery) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    fetchProducts();
  }, 250);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear-btn').classList.add('hidden');
  currentSearchQuery = '';
  currentPage = 1;
  fetchProducts();
}

function onSupplierChange(e) {
  currentSupplierFilter = e.target.value;
  currentPage = 1;
  fetchProducts();
}

async function fetchProducts() {
  const loader = document.getElementById('search-loader');
  const resultCount = document.getElementById('search-result-count');
  loader.classList.remove('hidden');

  const params = new URLSearchParams({
    q: currentSearchQuery,
    supplier: currentSupplierFilter,
    page: currentPage,
    limit: 50
  });

  try {
    const res = await fetch(`/api/products?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();

    if (data.success) {
      resultCount.innerText = data.total.toLocaleString();
      renderSuppliersDropdown(data.suppliers);
      renderProductItems(data.items, data.isManagerOrAdmin);
      renderPagination(data.page, data.totalPages);
    } else {
      showToast(data.message || "เกิดข้อผิดพลาดในการโหลดสินค้า", false);
    }
  } catch (err) {
    console.error("Fetch products error:", err);
  } finally {
    loader.classList.add('hidden');
  }
}

let suppliersLoaded = false;
function renderSuppliersDropdown(suppliers) {
  if (suppliersLoaded || !suppliers) return;
  const select = document.getElementById('supplier-select');
  suppliers.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.innerText = s;
    select.appendChild(opt);
  });
  suppliersLoaded = true;
}

function renderProductItems(items, isManagerOrAdmin) {
  const tbody = document.getElementById('products-table-body');
  const mobileContainer = document.getElementById('products-mobile-cards');
  const emptyState = document.getElementById('search-empty-state');

  tbody.innerHTML = '';
  mobileContainer.innerHTML = '';

  if (!items || items.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  items.forEach(p => {
    const details = p.details || {};
    let detailsHtml = '<div class="flex flex-wrap items-center gap-1.5">';
    
    if (details.unit && details.unit !== '-') {
      detailsHtml += `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-700/60 text-slate-200 border border-slate-600/50">
        📦 ${details.unit}${details.packQty ? ` (แพ็ค ${details.packQty})` : ''}
      </span>`;
    }

    if (details.location) {
      detailsHtml += `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
        📍 ชั้น ${details.location}
      </span>`;
    }

    if (details.maxStock) {
      detailsHtml += `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
        📊 Max: ${details.maxStock}
      </span>`;
    }

    if (details.lastReceived) {
      detailsHtml += `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
        📅 ${details.lastReceived}
      </span>`;
    }

    if (details.notes) {
      detailsHtml += `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-400 bg-slate-800 border border-slate-700">
        #${details.notes}
      </span>`;
    }

    detailsHtml += '</div>';

    // Desktop Row
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-700/30 transition duration-150';

    let costTd = '';
    if (isManagerOrAdmin) {
      costTd = `
        <td class="py-3 px-4 text-right font-mono">
          <div class="text-xs font-semibold text-amber-400">${p.cost_price || '0'}</div>
          ${p.profit && p.profit !== '-' ? `<div class="text-[10px] text-blue-400 font-medium">+${p.profit}</div>` : ''}
        </td>
      `;
    }

    tr.innerHTML = `
      <td class="py-3 px-4 font-mono text-xs font-medium text-slate-300">
        <span class="select-all">${p.barcode || '-'}</span>
      </td>
      <td class="py-3 px-4">
        <div class="font-semibold text-slate-100 text-sm">${p.name || '-'}</div>
      </td>
      <td class="py-3 px-4 text-xs text-slate-300">
        ${p.supplier ? `<span class="px-2 py-0.5 rounded bg-slate-700/80 text-slate-200 border border-slate-600/50">${p.supplier}</span>` : '-'}
      </td>
      <td class="py-3 px-4">${detailsHtml}</td>
      ${costTd}
      <td class="py-3 px-4 text-right font-mono font-bold text-blue-400 text-sm">
        ${p.sale_price || '0'}
      </td>
    `;
    tbody.appendChild(tr);

    // Mobile Card
    const card = document.createElement('div');
    card.className = 'bg-slate-800/80 border border-slate-700 rounded-xl p-4 shadow-sm';

    let mobileCostHtml = '';
    if (isManagerOrAdmin) {
      mobileCostHtml = `
        <div class="flex items-center justify-between text-xs py-1 border-t border-slate-700/40 mt-2">
          <span class="text-slate-400">ราคาทุน:</span>
          <div class="text-right">
            <span class="font-mono font-semibold text-amber-400">${p.cost_price || '0'}</span>
            ${p.profit && p.profit !== '-' ? `<span class="text-[10px] text-blue-400 ml-1.5">(กำไร ${p.profit})</span>` : ''}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-mono text-xs font-semibold text-blue-400 select-all">${p.barcode || '-'}</div>
      </div>
      <div class="font-bold text-slate-100 text-sm mb-2 leading-snug">${p.name || '-'}</div>
      <div class="mb-3">${detailsHtml}</div>
      <div class="flex items-center justify-between text-xs pt-2 border-t border-slate-700/60">
        <span class="text-slate-400">ร้านค้า: <strong class="text-slate-200">${p.supplier || '-'}</strong></span>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 mr-1">ราคาขาย:</span>
          <span class="font-mono font-bold text-base text-blue-400">${p.sale_price || '0'}</span>
        </div>
      </div>
      ${mobileCostHtml}
    `;
    mobileContainer.appendChild(card);
  });

  refreshIcons();
}

function renderPagination(page, totalPages) {
  const bar = document.getElementById('pagination-bar');
  const currentEl = document.getElementById('current-page-num');
  const totalEl = document.getElementById('total-page-num');
  const btnPrev = document.getElementById('btn-prev-page');
  const btnNext = document.getElementById('btn-next-page');

  if (totalPages <= 1) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  currentEl.innerText = page;
  totalEl.innerText = totalPages;
  btnPrev.disabled = (page <= 1);
  btnNext.disabled = (page >= totalPages);
}

function changePage(delta) {
  currentPage += delta;
  fetchProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshProductsCache() {
  const icon = document.getElementById('refresh-icon');
  icon.classList.add('animate-spin');

  try {
    const res = await fetch('/api/products/refresh', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast("รีเฟรชฐานข้อมูลสินค้าจาก Google Sheets สำเร็จ");
      fetchProducts();
    } else {
      showToast(data.message || "รีเฟรชไม่สำเร็จ", false);
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  } finally {
    icon.classList.remove('animate-spin');
  }
}

// ==========================================
// USER MANAGEMENT VIEW (Manager & Admin)
// ==========================================

function initUsersPage() {
  const title = document.getElementById('user-mgmt-title');
  const notice = document.getElementById('user-mgmt-notice-text');
  if (currentUser.role === 'manager') {
    title.innerText = "จัดการพนักงานหน้าร้าน";
    notice.innerText = "ผู้จัดการสามารถเพิ่ม แก้ไข และระงับการใช้งานของพนักงานและพนักงานอาวุโสได้";
  } else {
    title.innerText = "จัดการผู้เข้าใช้ทั้งหมด (Admin)";
    notice.innerText = "ผู้ดูแลระบบสามารถจัดการผู้ใช้ได้ทุกระดับ (พนักงาน, ผู้จัดการ, แอดมิน)";
  }
  fetchUsers();
}

async function fetchUsers() {
  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentUsersList = data.users || [];
      renderUsersTable(currentUsersList);
    } else {
      showToast(data.message || "ไม่สามารถโหลดข้อมูลผู้ใช้ได้", false);
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '';

  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 text-xs">ไม่พบข้อมูลผู้ใช้งาน</td></tr>`;
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-700/30 transition duration-150';

    const roleBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ROLE_COLORS[u.role] || 'bg-slate-700 text-slate-300'}">
      ${ROLE_NAMES[u.role] || u.role}
    </span>`;

    const statusBadge = u.is_active
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span> ใช้งาน</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/30"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span> ระงับ</span>`;

    // Action buttons
    let actionButtons = `
      <button onclick='openUserModal(${JSON.stringify(u)})' class="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition">
        แก้ไข
      </button>
      <button onclick="toggleUserStatus('${u.user_id}', ${u.is_active})" class="px-2.5 py-1 rounded-lg ${u.is_active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-emerald-500/30'} text-xs transition">
        ${u.is_active ? 'ระงับ' : 'เปิดใช้'}
      </button>
    `;

    // If manager viewing a manager or admin (should not happen due to backend filter, but safety check)
    if (currentUser.role === 'manager' && (u.role === 'admin' || u.role === 'manager')) {
      actionButtons = `<span class="text-[10px] text-slate-500">ไม่มีสิทธิ์จัดการ</span>`;
    }

    tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-semibold text-cyan-400">${u.username}</td>
      <td class="py-3 px-4 font-medium text-slate-200">${u.full_name || '-'}</td>
      <td class="py-3 px-4">${roleBadge}</td>
      <td class="py-3 px-4 text-center">${statusBadge}</td>
      <td class="py-3 px-4 text-right space-x-1.5">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });

  refreshIcons();
}

function openUserModal(user = null) {
  const modal = document.getElementById('user-modal');
  const title = document.getElementById('user-modal-title');
  const userId = document.getElementById('modal-user-id');
  const username = document.getElementById('modal-username');
  const fullname = document.getElementById('modal-fullname');
  const password = document.getElementById('modal-password');
  const roleSelect = document.getElementById('modal-role');
  const activeChk = document.getElementById('modal-active');
  const pwdNote = document.getElementById('modal-pwd-note');

  // Populate Role Select options based on currentUser
  roleSelect.innerHTML = `
    <option value="staff">พนักงานทั่วไป (Staff)</option>
    <option value="senior_staff">พนักงานอาวุโส (Senior Staff)</option>
  `;
  if (currentUser.role === 'admin') {
    roleSelect.innerHTML += `
      <option value="manager">ผู้จัดการ (Manager)</option>
      <option value="admin">ผู้ดูแลระบบ (Admin)</option>
    `;
  }

  if (user) {
    title.innerHTML = `<i data-lucide="user-check" class="w-4 h-4 text-cyan-400"></i><span>แก้ไขข้อมูล: ${user.username}</span>`;
    userId.value = user.user_id;
    username.value = user.username;
    username.disabled = true;
    username.classList.add('opacity-60', 'cursor-not-allowed');
    fullname.value = user.full_name || '';
    password.value = '';
    password.required = false;
    pwdNote.innerText = "(เว้นว่างไว้หากไม่ต้องการเปลี่ยนรหัสผ่าน)";
    roleSelect.value = user.role;
    activeChk.checked = user.is_active;
  } else {
    title.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 text-cyan-400"></i><span>เพิ่มผู้ใช้งานใหม่</span>`;
    userId.value = '';
    username.value = '';
    username.disabled = false;
    username.classList.remove('opacity-60', 'cursor-not-allowed');
    fullname.value = '';
    password.value = '';
    password.required = true;
    pwdNote.innerText = "* จำเป็นต้องกรอก";
    roleSelect.value = 'staff';
    activeChk.checked = true;
  }

  modal.classList.remove('hidden');
  refreshIcons();
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const userId = document.getElementById('modal-user-id').value;
  const username = document.getElementById('modal-username').value.trim();
  const full_name = document.getElementById('modal-fullname').value.trim();
  const password = document.getElementById('modal-password').value.trim();
  const role = document.getElementById('modal-role').value;
  const is_active = document.getElementById('modal-active').checked;

  const isEdit = !!userId;
  const btn = document.getElementById('btn-save-user');
  btn.disabled = true;

  try {
    let res;
    if (isEdit) {
      res = await fetch('/api/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ user_id: userId, full_name, password, role, is_active })
      });
    } else {
      res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ username, full_name, password, role })
      });
    }

    const data = await res.json();
    if (data.success) {
      showToast(isEdit ? "อัปเดตข้อมูลผู้ใช้เรียบร้อย" : "เพิ่มผู้ใช้ใหม่สำเร็จ");
      closeUserModal();
      fetchUsers();
    } else {
      showToast(data.message || "เกิดข้อผิดพลาดในการบันทึก", false);
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  } finally {
    btn.disabled = false;
  }
}

async function toggleUserStatus(userId, currentStatus) {
  const confirmMsg = currentStatus
    ? "คุณต้องการระงับการใช้งานบัญชีนี้ใช่หรือไม่?"
    : "คุณต้องการเปิดใช้งานบัญชีนี้อีกครั้งใช่หรือไม่?";
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ user_id: userId, is_active: !currentStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(currentStatus ? "ระงับการใช้งานเรียบร้อย" : "เปิดใช้งานเรียบร้อย");
      fetchUsers();
    } else {
      showToast(data.message || "ไม่สามารถเปลี่ยนสถานะได้", false);
    }
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  }
}

// ==========================================
// LOGIN LOGS VIEW (Admin Only)
// ==========================================

async function fetchLoginLogs() {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 text-xs">กำลังโหลดประวัติ...</td></tr>`;

  try {
    const res = await fetch('/api/logs', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      renderLogsTable(data.logs || []);
    } else {
      showToast(data.message || "ไม่สามารถโหลดประวัติได้", false);
    }
  } catch (e) {
    showToast("เกิดข้อผิดพลาด", false);
  }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 text-xs">ยังไม่มีประวัติการเข้าใช้งาน</td></tr>`;
    return;
  }

  logs.forEach(l => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-700/30 transition';

    const isSuccess = l.status === 'SUCCESS';
    const statusBadge = isSuccess
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400">สำเร็จ</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">${l.status}</span>`;

    tr.innerHTML = `
      <td class="py-2.5 px-4 text-slate-300">${l.timestamp || '-'}</td>
      <td class="py-2.5 px-4 text-white font-semibold">${l.username || '-'}</td>
      <td class="py-2.5 px-4 text-slate-400">${l.role || '-'}</td>
      <td class="py-2.5 px-4 text-slate-400">${l.ip_address || '-'}</td>
      <td class="py-2.5 px-4 text-center">${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// DELIVERY BILL ENTRY & CUSTOMERS
// ==========================================

let currentCustomersList = [];
let selectedCustomer = null;
let capturedPhotoBase64 = null;
let customerSearchDebounce = null;

async function initDeliveryBillPage() {
  // 1. Set current date display (locked today date)
  const now = new Date();
  const thDate = now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const displayEl = document.getElementById('bill-today-display');
  if (displayEl) displayEl.innerText = thDate;

  // Set default bill date picker to today (YYYY-MM-DD), allow backdated, max = today
  const picker = document.getElementById('bill-date-picker');
  if (picker) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const isoToday = `${yyyy}-${mm}-${dd}`;
    picker.max = isoToday;
    if (!picker.value) {
      picker.value = isoToday;
    }
    handleBillDateChange(picker.value);
  }

  // 2. Fetch customers if not already loaded
  if (currentCustomersList.length === 0) {
    await fetchCustomers();
  }

  // 3. Fetch today's bills
  fetchTodayBills();
}

function handleBillDateChange(isoVal) {
  if (!isoVal) return;
  const parts = isoVal.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parts[1];
    const d = parts[2];
    const thaiYear = y + 543;
    const thaiDateStr = `${d}/${m}/${thaiYear}`;
    const hiddenEl = document.getElementById('bill-date-thai');
    if (hiddenEl) hiddenEl.value = thaiDateStr;

    const displayEl = document.getElementById('bill-date-thai-display');
    if (displayEl) {
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (isoVal !== todayIso) {
        displayEl.innerHTML = `<span class="text-amber-400 font-semibold flex items-center gap-1"><i data-lucide="history" class="w-3 h-3"></i> บันทึกย้อนหลัง: ${thaiDateStr}</span>`;
      } else {
        displayEl.innerHTML = `<span class="text-slate-400 font-mono text-[10px] flex items-center gap-1"><i data-lucide="check" class="w-3 h-3 text-emerald-400"></i> วันที่บิล: ${thaiDateStr} (วันนี้)</span>`;
      }
      refreshIcons();
    }
  }
}

async function fetchCustomers() {
  try {
    const res = await fetch('/api/customers', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentCustomersList = data.customers || [];
    }
  } catch (err) {
    console.error("Failed to fetch customers:", err);
  }
}

function handleCustomerSearchInput(e) {
  clearTimeout(customerSearchDebounce);
  const q = (e.target.value || '').trim().toLowerCase();
  const dropdown = document.getElementById('customer-dropdown');
  const clearBtn = document.getElementById('btn-clear-customer');

  if (clearBtn) {
    if (q) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }

  if (!q) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  customerSearchDebounce = setTimeout(() => {
    const matches = currentCustomersList.filter(c => 
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    ).slice(0, 10);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">ไม่พบชื่อหรือรหัสลูกค้านี้ในฐานข้อมูล</div>`;
    } else {
      dropdown.innerHTML = matches.map(c => `
        <div onclick="selectCustomer('${c.id}')" class="p-3 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-amber-500/20 text-amber-300 font-bold">${c.id}</span>
              <span class="text-xs font-semibold text-white">${c.name}</span>
            </div>
            ${c.fullName && c.fullName !== c.name ? `<div class="text-[11px] text-slate-400 mt-0.5">${c.fullName}</div>` : ''}
            ${c.address ? `<div class="text-[10px] text-slate-500 mt-0.5 truncate max-w-sm">${c.address}</div>` : ''}
          </div>
          <div class="text-right">
            ${c.phone ? `<div class="text-[10px] text-slate-400 font-mono">${c.phone}</div>` : ''}
            ${c.contact ? `<div class="text-[10px] text-amber-400/80">${c.contact}</div>` : ''}
          </div>
        </div>
      `).join('');
    }

    dropdown.classList.remove('hidden');
  }, 150);
}

function selectCustomer(customerId) {
  const c = currentCustomersList.find(x => x.id === customerId);
  if (!c) return;

  selectedCustomer = c;
  document.getElementById('bill-customer-id').value = c.id;
  document.getElementById('bill-customer-name').value = c.name;

  // Update UI
  const searchInput = document.getElementById('bill-customer-search');
  searchInput.value = '';
  searchInput.classList.add('hidden');

  const dropdown = document.getElementById('customer-dropdown');
  dropdown.classList.add('hidden');

  const pill = document.getElementById('selected-customer-pill');
  document.getElementById('pill-cust-id').innerText = c.id;
  document.getElementById('pill-cust-name').innerText = `${c.name} ${c.fullName && c.fullName !== c.name ? '(' + c.fullName + ')' : ''}`;
  pill.classList.remove('hidden');

  const clearBtn = document.getElementById('btn-clear-customer');
  if (clearBtn) clearBtn.classList.add('hidden');
}

function clearCustomerSelection() {
  selectedCustomer = null;
  document.getElementById('bill-customer-id').value = '';
  document.getElementById('bill-customer-name').value = '';

  const pill = document.getElementById('selected-customer-pill');
  pill.classList.add('hidden');

  const searchInput = document.getElementById('bill-customer-search');
  searchInput.classList.remove('hidden');
  searchInput.value = '';
  searchInput.focus();

  const clearBtn = document.getElementById('btn-clear-customer');
  if (clearBtn) clearBtn.classList.add('hidden');

  const dropdown = document.getElementById('customer-dropdown');
  dropdown.classList.add('hidden');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('customer-dropdown');
  const searchInput = document.getElementById('bill-customer-search');
  if (dropdown && searchInput && !dropdown.contains(e.target) && e.target !== searchInput) {
    dropdown.classList.add('hidden');
  }
});

// Photo selection & compression
function handleBillPhotoSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Compress image client-side to max 1000px dimension and 0.75 quality for fast mobile uploads
      const maxDim = 1000;
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.75);

      // Show preview
      const previewImg = document.getElementById('photo-preview-img');
      previewImg.src = capturedPhotoBase64;
      document.getElementById('photo-preview-container').classList.remove('hidden');
      document.getElementById('photo-prompt').classList.add('hidden');
      refreshIcons();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function resetBillPhoto(event) {
  if (event) event.stopPropagation();
  capturedPhotoBase64 = null;
  const input = document.getElementById('bill-photo-input');
  if (input) input.value = '';

  document.getElementById('photo-preview-img').src = '';
  document.getElementById('photo-preview-container').classList.add('hidden');
  document.getElementById('photo-prompt').classList.remove('hidden');
  refreshIcons();
}

// Store Category Switcher
let currentStoreCategory = 'store_general';

function selectStoreCategory(cat) {
  currentStoreCategory = cat;
  const btnGen = document.getElementById('btn-cat-general');
  const btnGov = document.getElementById('btn-cat-gov');
  const catInput = document.getElementById('bill-category');
  const poContainer = document.getElementById('container-po-ref');
  const descEl = document.getElementById('cat-description');
  const labelRef = document.getElementById('label-bill-ref');

  if (cat === 'store_gov') {
    if (catInput) catInput.value = 'store_gov';
    if (btnGov) {
      btnGov.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-md";
    }
    if (btnGen) {
      btnGen.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    }
    if (poContainer) poContainer.classList.remove('hidden');
    if (descEl) descEl.innerText = "สำหรับหน่วยงานราชการ อบต. เทศบาล โรงเรียน มีใบส่งของและเลขที่สั่งจ้างกำกับ";
    if (labelRef) labelRef.innerText = "เลขที่บิลส่งของ / ใบส่งของชั่วคราว *";
  } else {
    if (catInput) catInput.value = 'store_general';
    if (btnGen) {
      btnGen.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-amber-500 text-white shadow-md";
    }
    if (btnGov) {
      btnGov.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    }
    if (poContainer) poContainer.classList.add('hidden');
    if (descEl) descEl.innerText = "สำหรับลูกค้าเงินสด, บิลเครดิตบุคคลทั่วไป, ผู้รับเหมา หรือร้านค้าช่วง";
    if (labelRef) labelRef.innerText = "เลขที่บิลส่งของ (บิลกระดาษ) *";
  }
  refreshIcons();
}

// Form Submit: Direct Recording into MASTER_BILLS
async function handleDeliveryBillSubmit(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }

  // Check login session
  if (!currentToken) {
    showToast("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", false);
    navigateTo('login');
    return;
  }

  let customerId = document.getElementById('bill-customer-id') ? document.getElementById('bill-customer-id').value : '';
  let customerName = document.getElementById('bill-customer-name') ? document.getElementById('bill-customer-name').value : '';
  const searchInput = document.getElementById('bill-customer-search');
  const searchInputVal = searchInput ? searchInput.value.trim() : '';

  // Auto-match if customer was typed in search input but not clicked from dropdown
  if ((!customerId || !customerName) && searchInputVal && currentCustomersList && currentCustomersList.length > 0) {
    const qLower = searchInputVal.toLowerCase();
    const match = currentCustomersList.find(c => 
      c.id.toLowerCase() === qLower ||
      c.name.toLowerCase() === qLower ||
      (c.fullName && c.fullName.toLowerCase() === qLower) ||
      c.name.toLowerCase().includes(qLower)
    );
    if (match) {
      selectCustomer(match.id);
      customerId = match.id;
      customerName = match.name;
    }
  }

  if (!customerId || !customerName) {
    showToast("กรุณาเลือกลูกค้าจากรายชื่อก่อนบันทึก", false);
    if (searchInput) {
      searchInput.classList.remove('hidden');
      searchInput.focus();
    }
    return;
  }

  const category = document.getElementById('bill-category') ? document.getElementById('bill-category').value : currentStoreCategory;
  const billDate = document.getElementById('bill-date-thai') ? document.getElementById('bill-date-thai').value : '';
  const billRef = document.getElementById('bill-ref-no') ? document.getElementById('bill-ref-no').value.trim() : '';
  const poRef = document.getElementById('bill-po-no') ? document.getElementById('bill-po-no').value.trim() : '';
  const amount = document.getElementById('bill-amount') ? document.getElementById('bill-amount').value : '';
  const notes = document.getElementById('bill-notes') ? document.getElementById('bill-notes').value.trim() : '';

  if (!billRef) {
    showToast("กรุณาระบุเลขที่บิลส่งของ (บิลกระดาษ)", false);
    const refInput = document.getElementById('bill-ref-no');
    if (refInput) refInput.focus();
    return;
  }

  if (!amount || parseFloat(amount) <= 0) {
    showToast("กรุณากรอกจำนวนเงินให้ถูกต้อง", false);
    const amtInput = document.getElementById('bill-amount');
    if (amtInput) amtInput.focus();
    return;
  }

  const btnSubmit = document.getElementById('btn-submit-bill');
  const originalBtnText = btnSubmit ? btnSubmit.innerHTML : '';
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `
      <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
      <span>กำลังบันทึกลงระบบ...</span>
    `;
  }

  try {
    const res = await fetch('/api/delivery/inbox', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        category,
        customerId,
        customerName,
        date: billDate,
        billRef,
        poRef,
        amount: parseFloat(amount),
        notes,
        imageBase64: capturedPhotoBase64
      })
    });

    const data = await res.json();
    if (data.success) {
      const billId = data.bill?.billId || '';
      showToast(`บันทึกบิลเรียบร้อย! รหัสบิล: ${billId} (สถานะ: รอวางบิล)`, true);

      // Reset form
      if (document.getElementById('bill-ref-no')) document.getElementById('bill-ref-no').value = '';
      if (document.getElementById('bill-po-no')) document.getElementById('bill-po-no').value = '';
      if (document.getElementById('bill-amount')) document.getElementById('bill-amount').value = '';
      if (document.getElementById('bill-notes')) document.getElementById('bill-notes').value = '';
      resetBillPhoto();
      clearCustomerSelection();

      // Reset date picker to today
      const now = new Date();
      const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const picker = document.getElementById('bill-date-picker');
      if (picker) {
        picker.value = isoToday;
        handleBillDateChange(isoToday);
      }

      // Refresh today's list
      await fetchTodayBills();
    } else {
      showToast(data.message || "บันทึกล้มเหลว กรุณาลองใหม่อีกครั้ง", false);
    }
  } catch (err) {
    console.error("Submit bill error:", err);
    showToast("เชื่อมต่อระบบล้มเหลว กรุณาตรวจสอบอินเทอร์เน็ต", false);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalBtnText;
    }
    refreshIcons();
  }
}

// Fetch & Filter Today's Bills
let allTodayBills = [];
let currentTodayFilter = 'ALL';

function filterTodayBills(cat) {
  currentTodayFilter = cat;
  const btnAll = document.getElementById('filter-today-all');
  const btnGen = document.getElementById('filter-today-gen');
  const btnGov = document.getElementById('filter-today-gov');

  [btnAll, btnGen, btnGov].forEach(b => {
    if (b) b.className = "px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition";
  });

  if (cat === 'ALL' && btnAll) btnAll.className = "px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold transition";
  if (cat === 'store_general' && btnGen) btnGen.className = "px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold transition";
  if (cat === 'store_gov' && btnGov) btnGov.className = "px-2.5 py-1 rounded-lg bg-purple-500 text-white font-bold transition";

  renderTodayBills(allTodayBills);
}

async function fetchTodayBills() {
  const container = document.getElementById('today-bills-list');
  try {
    const res = await fetch('/api/delivery/bills/today', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      allTodayBills = data.bills || [];
      renderTodayBills(allTodayBills);
    } else {
      container.innerHTML = `<div class="p-6 text-center text-xs text-red-400">โหลดข้อมูลไม่สำเร็จ</div>`;
    }
  } catch (err) {
    console.error("Error fetching today bills:", err);
    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>`;
  }
}

function renderTodayBills(bills) {
  const container = document.getElementById('today-bills-list');
  const countEl = document.getElementById('stat-today-count');
  const sumEl = document.getElementById('stat-today-sum');

  // Filter bills by current category filter
  let filtered = bills;
  if (currentTodayFilter === 'store_general') {
    filtered = bills.filter(b => (b.source || '').includes('ทั่วไป'));
  } else if (currentTodayFilter === 'store_gov') {
    filtered = bills.filter(b => (b.source || '').includes('หน่วยงาน'));
  }

  // Active stats calculation (exclude cancelled)
  let activeCount = 0;
  let activeSum = 0;
  bills.forEach(b => {
    if (b.status !== 'ยกเลิก') {
      activeCount++;
      const num = parseFloat(String(b.amount).replace(/,/g, '')) || 0;
      activeSum += num;
    }
  });

  if (countEl) countEl.innerText = activeCount;
  if (sumEl) sumEl.innerText = `${activeSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
        <p class="text-xs">ไม่มีรายการบิลในหมวดหมู่นี้</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  container.innerHTML = filtered.map(b => {
    const isCancelled = b.status === 'ยกเลิก';

    // Source Badge
    let sourceBadge = `<span class="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">🏢 ทั่วไป</span>`;
    if ((b.source || '').includes('หน่วยงาน')) {
      sourceBadge = `<span class="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">🏛️ หน่วยงาน</span>`;
    } else if (b.companyRegistration === 'ปั๊มน้ำมัน') {
      sourceBadge = `<span class="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/30">⛽ น้ำมัน</span>`;
    }

    // Status Badge
    const statusBadge = isCancelled
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">ยกเลิกแล้ว</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">รอวางบิล</span>`;

    const amountDisplay = isCancelled
      ? `<span class="line-through text-slate-500 text-xs font-mono">${b.amount}</span>`
      : `<span class="text-sm font-bold text-amber-400 font-mono">${b.amount}</span>`;

    // Action button
    const actionBtn = isCancelled
      ? `<span class="text-[10px] text-red-400/80 italic">ยกเลิกแล้ว (บันทึกบิลใหม่แทนแล้ว)</span>`
      : `<button onclick="openCancelModal('${b.billId}')" class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 text-[10px] font-semibold transition flex items-center gap-1">
           <i data-lucide="trash-2" class="w-3 h-3"></i>
           <span>ขอยกเลิกบิล</span>
         </button>`;

    // Check if backdated
    let dateBadge = `<span class="text-[10px] text-slate-400 font-mono">บิล: ${b.date || '-'}</span>`;
    if (b.date && b.createdAt) {
      const createdDatePart = b.createdAt.split(' ')[0].trim();
      if (b.date !== createdDatePart) {
        dateBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">📅 ย้อนหลัง: ${b.date}</span>`;
      }
    }

    return `
      <div class="p-3.5 ${isCancelled ? 'bg-slate-900/40 border-slate-800 opacity-75' : 'bg-slate-900/70 border-slate-700/60'} border rounded-xl flex flex-col gap-2 transition hover:border-slate-600">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-bold text-white tracking-wide font-mono">${b.billId}</span>
              ${sourceBadge}
              ${statusBadge}
            </div>
            <div class="text-[11px] text-slate-300 mt-1 flex items-center gap-1.5">
              <span class="font-mono text-amber-300 font-bold">${b.billRef || 'ไม่ระบุเลขบิล'}</span>
              <span>•</span>
              <span class="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-800 text-slate-400">${b.customerId || '-'}</span>
              <span class="font-medium text-slate-200 truncate max-w-[180px]">${b.customerName || '-'}</span>
            </div>
          </div>
          <div class="text-right">
            <div>${amountDisplay}</div>
            <div class="mt-1">${dateBadge}</div>
          </div>
        </div>

        ${b.notes ? `<div class="text-[10px] text-slate-400 bg-slate-800/40 p-1.5 rounded-lg italic">${b.notes}</div>` : ''}

        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] text-slate-500">
          <div class="flex items-center gap-3">
            <div>เวลา: <strong class="text-slate-300 font-mono">${b.createdAt ? (b.createdAt.split(' ')[1] || b.createdAt) : '-'}</strong></div>
            <div>ผู้บันทึก: <strong class="text-slate-400">${b.createdBy}</strong></div>
            ${b.photoUrl ? `
              <button onclick="openImageViewer('${b.photoUrl}', '${b.billRef}')" class="text-amber-400 hover:text-amber-300 flex items-center gap-1 underline">
                <i data-lucide="image" class="w-3 h-3"></i>
                <span>ดูรูปบิล</span>
              </button>
            ` : ''}
          </div>
          <div>${actionBtn}</div>
        </div>
      </div>
    `;
  }).join('');

  refreshIcons();
}

// ==========================================
// CANCELLATION / VOID BILL MODAL
// ==========================================

let targetCancelBillId = null;

function openCancelModal(billId) {
  targetCancelBillId = billId;
  const display = document.getElementById('cancel-bill-id-display');
  if (display) display.innerText = billId;
  const reasonInput = document.getElementById('cancel-bill-reason');
  if (reasonInput) reasonInput.value = '';

  document.getElementById('modal-cancel-bill').classList.remove('hidden');
  refreshIcons();
}

function closeCancelModal() {
  document.getElementById('modal-cancel-bill').classList.add('hidden');
  targetCancelBillId = null;
}

async function submitCancelBill() {
  if (!targetCancelBillId) return;
  const reason = (document.getElementById('cancel-bill-reason').value || '').trim();
  if (!reason) {
    showToast("กรุณาระบุเหตุผลในการขอยกเลิกบิล", false);
    return;
  }

  const btn = document.getElementById('btn-confirm-cancel-bill');
  btn.disabled = true;
  btn.innerHTML = `<span class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span><span>กำลังยกเลิก...</span>`;

  try {
    const res = await fetch(`/api/delivery/bills/${targetCancelBillId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ reason })
    });

    const data = await res.json();
    if (data.success) {
      showToast("ยกเลิกบิลเรียบร้อย สามารถบันทึกบิลใบใหม่แทนได้ทันที", true);
      closeCancelModal();
      await fetchTodayBills();
      if (document.getElementById('view-executive-dashboard') && !document.getElementById('view-executive-dashboard').classList.contains('hidden')) {
        loadExecutiveDashboard();
      }
    } else {
      showToast(data.message || "ยกเลิกไม่สำเร็จ", false);
    }
  } catch (err) {
    console.error("Cancel bill error:", err);
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>ยืนยันยกเลิกบิลนี้</span>`;
    refreshIcons();
  }
}

// ==========================================
// MASTER BILLS & FUEL BILLS EXPLORER
// ==========================================

let currentMasterBills = [];
let allMasterBillsCache = [];
let currentMasterCategory = 'ALL';
let masterSearchDebounceTimer = null;
let manualCustDebounceTimer = null;

// ==========================================
// EXECUTIVE DASHBOARD
// ==========================================

let currentExecutivePeriod = 'ALL';

async function initExecutiveDashboardPage() {
  if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
    showToast("เฉพาะผู้บริหารหรือผู้จัดการเท่านั้น", false);
    navigateTo('dashboard');
    return;
  }
  changeDashboardPeriod('ALL');
}

function changeDashboardPeriod(period) {
  currentExecutivePeriod = period;
  const periods = ['all', 'today', 'month', 'year'];
  periods.forEach(p => {
    const btn = document.getElementById(`btn-period-${p}`);
    if (btn) {
      if (p.toUpperCase() === period) {
        btn.className = "px-3 py-1.5 rounded-lg font-semibold bg-indigo-600 text-white transition shadow";
      } else {
        btn.className = "px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition";
      }
    }
  });
  loadExecutiveDashboard();
}

async function loadExecutiveDashboard() {
  try {
    const res = await fetch(`/api/dashboard/executive?period=${currentExecutivePeriod}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success && data.stats) {
      renderExecutiveDashboardStats(data.stats);
    } else {
      showToast(data.message || "โหลดแดชบอร์ดไม่สำเร็จ", false);
    }
  } catch (err) {
    console.error("Dashboard error:", err);
    showToast("เชื่อมต่อข้อมูลแดชบอร์ดล้มเหลว", false);
  }
}

function renderExecutiveDashboardStats(stats) {
  const sum = stats.summary;

  // Row 1: KPI Cards
  const totalAmtEl = document.getElementById('dash-stat-total-amount');
  const totalCntEl = document.getElementById('dash-stat-total-count');
  if (totalAmtEl) totalAmtEl.innerText = `${sum.formattedTotalActiveAmount}`;
  if (totalCntEl) totalCntEl.innerText = sum.totalActiveCount;

  const genAmtEl = document.getElementById('dash-stat-gen-amount');
  const genCntEl = document.getElementById('dash-stat-gen-count');
  if (genAmtEl) genAmtEl.innerText = `${sum.storeGeneral.formattedAmount}`;
  if (genCntEl) genCntEl.innerText = sum.storeGeneral.count;

  const govAmtEl = document.getElementById('dash-stat-gov-amount');
  const govCntEl = document.getElementById('dash-stat-gov-count');
  if (govAmtEl) govAmtEl.innerText = `${sum.storeGov.formattedAmount}`;
  if (govCntEl) govCntEl.innerText = sum.storeGov.count;

  const fuelAmtEl = document.getElementById('dash-stat-fuel-amount');
  const fuelCntEl = document.getElementById('dash-stat-fuel-count');
  if (fuelAmtEl) fuelAmtEl.innerText = `${sum.fuel.formattedAmount}`;
  if (fuelCntEl) fuelCntEl.innerText = sum.fuel.count;

  // Row 2: Status Breakdown
  const pendAmtEl = document.getElementById('dash-stat-pending-amt');
  const pendCntEl = document.getElementById('dash-stat-pending-cnt');
  if (pendAmtEl) pendAmtEl.innerText = `${sum.pendingBilling.formattedAmount}`;
  if (pendCntEl) pendCntEl.innerText = sum.pendingBilling.count;

  const billAmtEl = document.getElementById('dash-stat-billed-amt');
  const billCntEl = document.getElementById('dash-stat-billed-cnt');
  if (billAmtEl) billAmtEl.innerText = `${sum.billed.formattedAmount}`;
  if (billCntEl) billCntEl.innerText = sum.billed.count;

  const paidAmtEl = document.getElementById('dash-stat-paid-amt');
  const paidCntEl = document.getElementById('dash-stat-paid-cnt');
  if (paidAmtEl) paidAmtEl.innerText = `${sum.paid.formattedAmount}`;
  if (paidCntEl) paidCntEl.innerText = sum.paid.count;

  const cancelAmtEl = document.getElementById('dash-stat-cancel-amt');
  const cancelCntEl = document.getElementById('dash-stat-cancel-cnt');
  if (cancelAmtEl) cancelAmtEl.innerText = `${sum.cancelled.formattedAmount}`;
  if (cancelCntEl) cancelCntEl.innerText = sum.cancelled.count;

  // Revenue Mix %
  const totalAmt = sum.totalActiveAmount || 1;
  const pctGen = Math.round((sum.storeGeneral.amount / totalAmt) * 100);
  const pctGov = Math.round((sum.storeGov.amount / totalAmt) * 100);
  const pctFuel = Math.max(0, 100 - pctGen - pctGov);

  const pctGenEl = document.getElementById('pct-mix-gen');
  const pctGovEl = document.getElementById('pct-mix-gov');
  const pctFuelEl = document.getElementById('pct-mix-fuel');
  if (pctGenEl) pctGenEl.innerText = `${pctGen}% (${sum.storeGeneral.formattedAmount})`;
  if (pctGovEl) pctGovEl.innerText = `${pctGov}% (${sum.storeGov.formattedAmount})`;
  if (pctFuelEl) pctFuelEl.innerText = `${pctFuel}% (${sum.fuel.formattedAmount})`;

  const barGen = document.getElementById('bar-mix-gen');
  const barGov = document.getElementById('bar-mix-gov');
  const barFuel = document.getElementById('bar-mix-fuel');
  if (barGen) barGen.style.width = `${pctGen}%`;
  if (barGov) barGov.style.width = `${pctGov}%`;
  if (barFuel) barFuel.style.width = `${pctFuel}%`;

  // Top Debtors Table
  const debtorsTbody = document.getElementById('dash-debtors-tbody');
  if (debtorsTbody) {
    if (!stats.topDebtors || stats.topDebtors.length === 0) {
      debtorsTbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-500 text-xs">ไม่มีรายการหนี้ค้างชำระ</td></tr>`;
    } else {
      debtorsTbody.innerHTML = stats.topDebtors.map(d => `
        <tr class="hover:bg-slate-700/30 transition">
          <td class="py-2.5 px-2">
            <div class="font-semibold text-white">${d.customerName}</div>
            <div class="text-[10px] text-slate-400 font-mono">${d.customerId || '-'} • ${d.billCount} บิล</div>
          </td>
          <td class="py-2.5 px-2 text-right font-mono text-slate-300">${d.storeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="py-2.5 px-2 text-right font-mono text-teal-300">${d.fuelAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="py-2.5 px-2 text-right font-mono font-bold text-amber-400">${d.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `).join('');
    }
  }

  // Cancellation Audit Log
  const cancelList = document.getElementById('dash-cancel-list');
  const badgeCount = document.getElementById('dash-cancel-count-badge');
  if (badgeCount) badgeCount.innerText = `${stats.cancelledBills.length} บิล`;

  if (cancelList) {
    if (!stats.cancelledBills || stats.cancelledBills.length === 0) {
      cancelList.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">ไม่มีประวัติบิลที่ขอยกเลิก</div>`;
    } else {
      cancelList.innerHTML = stats.cancelledBills.map(b => `
        <div class="p-3 bg-slate-900/80 border border-red-500/20 rounded-xl flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="font-mono font-bold text-white text-xs">${b.billId}</span>
              <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-red-500/20 text-red-400">ยกเลิกแล้ว</span>
              <span class="text-[10px] text-slate-400 font-mono">${b.billRef || ''}</span>
            </div>
            <span class="font-mono text-slate-400 line-through text-xs">${b.amount}</span>
          </div>
          <div class="text-xs text-slate-300">${b.customerName}</div>
          <div class="text-[11px] text-red-300/90 bg-red-500/10 p-1.5 rounded-lg mt-0.5">
            ${b.notes || 'ไม่มีเหตุผลระบุ'}
          </div>
          <div class="text-[10px] text-slate-500 flex items-center justify-between pt-1">
            <span>ผู้บันทึก: ${b.createdBy}</span>
            <span>${b.createdAt || b.date}</span>
          </div>
        </div>
      `).join('');
    }
  }

  refreshIcons();
}

// ==========================================
// MASTER BILLS & FUEL BILLS EXPLORER
// ==========================================
async function initManagerAuditPage() {
  if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
    showToast("คุณไม่มีสิทธิ์เข้าถึงหน้านี้", false);
    navigateTo('dashboard');
    return;
  }

  // Pre-load customers list if empty
  if (currentCustomersList.length === 0) {
    await fetchCustomers();
  }

  switchMasterCategory('ALL', false);
  fetchMasterBillsList();
}

// Category Tabs Switching & Filtering
function switchMasterCategory(cat, shouldRender = true) {
  currentMasterCategory = cat || 'ALL';

  const tabs = [
    { id: 'tab-master-cat-all', cat: 'ALL', activeClass: 'bg-emerald-600 text-white font-bold shadow-md' },
    { id: 'tab-master-cat-general', cat: 'store_general', activeClass: 'bg-blue-600 text-white font-bold shadow-md' },
    { id: 'tab-master-cat-gov', cat: 'store_gov', activeClass: 'bg-purple-600 text-white font-bold shadow-md' },
    { id: 'tab-master-cat-fuel', cat: 'fuel', activeClass: 'bg-amber-600 text-white font-bold shadow-md' }
  ];

  tabs.forEach(t => {
    const el = document.getElementById(t.id);
    if (!el) return;
    if (t.cat === currentMasterCategory) {
      el.className = `px-4 py-2 rounded-xl text-xs transition flex items-center gap-2 ${t.activeClass}`;
    } else {
      el.className = `px-4 py-2 rounded-xl text-xs font-medium transition flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-700/50`;
    }
  });

  // Sync category dropdown if exists
  const regSelect = document.getElementById('filter-master-reg');
  if (regSelect && regSelect.value !== currentMasterCategory) {
    regSelect.value = currentMasterCategory;
  }

  if (shouldRender) {
    filterAndRenderMasterBills();
  }
}

function handleMasterCategoryDropdownChange(val) {
  switchMasterCategory(val, true);
}

function updateMasterCategoryBadges(allBills = []) {
  const countAll = allBills.length;
  const countGeneral = allBills.filter(b => b.category === 'store_general' || (!b.category && b.companyRegistration !== 'ปั๊มน้ำมัน' && (!b.source || (!b.source.includes('หน่วยงาน') && !b.source.includes('ราชการ'))))).length;
  const countGov = allBills.filter(b => b.category === 'store_gov' || (!b.category && b.source && (b.source.includes('หน่วยงาน') || b.source.includes('ราชการ')))).length;
  const countFuel = allBills.filter(b => b.category === 'fuel' || (!b.category && b.companyRegistration === 'ปั๊มน้ำมัน')).length;

  const bAll = document.getElementById('badge-master-cat-all');
  const bGen = document.getElementById('badge-master-cat-general');
  const bGov = document.getElementById('badge-master-cat-gov');
  const bFuel = document.getElementById('badge-master-cat-fuel');

  if (bAll) bAll.innerText = countAll;
  if (bGen) bGen.innerText = countGeneral;
  if (bGov) bGov.innerText = countGov;
  if (bFuel) bFuel.innerText = countFuel;
}

function filterAndRenderMasterBills() {
  const badgeEl = document.getElementById('master-bills-count-badge');
  let filtered = allMasterBillsCache;

  if (currentMasterCategory !== 'ALL') {
    filtered = allMasterBillsCache.filter(b => {
      if (currentMasterCategory === 'store_general') {
        return b.category === 'store_general' || (!b.category && b.companyRegistration !== 'ปั๊มน้ำมัน' && (!b.source || (!b.source.includes('หน่วยงาน') && !b.source.includes('ราชการ'))));
      }
      if (currentMasterCategory === 'store_gov') {
        return b.category === 'store_gov' || (!b.category && b.source && (b.source.includes('หน่วยงาน') || b.source.includes('ราชการ')));
      }
      if (currentMasterCategory === 'fuel') {
        return b.category === 'fuel' || (!b.category && b.companyRegistration === 'ปั๊มน้ำมัน');
      }
      return true;
    });
  }

  currentMasterBills = filtered;
  if (badgeEl) badgeEl.innerText = `${filtered.length} บิล`;
  renderMasterBillsTable(filtered);
}

// Master Bills List
async function fetchMasterBillsList() {
  const tbody = document.getElementById('master-bills-table-body');
  tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-500 text-xs">กำลังโหลดคลังบิลหลัก...</td></tr>`;

  const status = document.getElementById('filter-master-status') ? document.getElementById('filter-master-status').value : 'ALL';
  const q = (document.getElementById('search-master-input')?.value || '').trim();

  try {
    const url = `/api/delivery/manager/master-bills?reg=ALL&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      allMasterBillsCache = data.bills || [];
      // Normalize category for items
      allMasterBillsCache.forEach(b => {
        if (!b.category) {
          if (b.companyRegistration === 'ปั๊มน้ำมัน' || (b.source && b.source.includes('ปั๊ม'))) {
            b.category = 'fuel';
          } else if (b.source && (b.source.includes('หน่วยงาน') || b.source.includes('ราชการ'))) {
            b.category = 'store_gov';
          } else {
            b.category = 'store_general';
          }
        }
      });

      updateMasterCategoryBadges(allMasterBillsCache);
      filterAndRenderMasterBills();
    } else {
      tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-red-400 text-xs">${data.message || 'โหลดข้อมูลไม่สำเร็จ'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-500 text-xs">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
  }
}

function renderMasterBillsTable(bills) {
  const tbody = document.getElementById('master-bills-table-body');
  if (bills.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-500 text-xs">ยังไม่มีบิลในคลังหลักตามเงื่อนไขที่เลือก</td></tr>`;
    return;
  }

  tbody.innerHTML = bills.map(b => {
    let regBadge = '';
    if (b.category === 'fuel' || b.companyRegistration === 'ปั๊มน้ำมัน') {
      regBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">⛽ ปั๊มน้ำมัน</span>`;
    } else if (b.category === 'store_gov' || (b.source && (b.source.includes('หน่วยงาน') || b.source.includes('ราชการ')))) {
      regBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">🏛️ ร้านค้า (หน่วยงาน)</span>`;
    } else {
      regBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">🏢 ร้านค้า (ทั่วไป)</span>`;
    }

    const statusBadge = b.status === 'วางบิลแล้ว'
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400">วางบิลแล้ว</span>`
      : b.status === 'ชำระแล้ว'
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-300">ชำระแล้ว</span>`
        : b.status === 'ยกเลิก'
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400">ยกเลิก</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300">รอวางบิล</span>`;

    const photoCell = b.photoUrl
      ? `<button onclick="openImageViewer('${b.photoUrl}', '${b.billRef}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 transition" title="ดูรูปบิล">
           <i data-lucide="image" class="w-3.5 h-3.5"></i>
         </button>`
      : `<span class="text-slate-600">-</span>`;

    const formattedAmount = Number(String(b.amount || 0).replace(/,/g, '')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `
      <tr class="hover:bg-slate-700/20 transition">
        <td class="py-2.5 px-3.5 font-mono font-bold text-white">${b.billId}</td>
        <td class="py-2.5 px-3 font-mono text-slate-400">${b.date}</td>
        <td class="py-2.5 px-3 text-center">${regBadge}</td>
        <td class="py-2.5 px-3 font-mono text-slate-200">${b.billRef || '-'}</td>
        <td class="py-2.5 px-4">
          <div class="font-medium text-slate-200">${b.customerName || '-'}</div>
          <div class="font-mono text-[10px] text-slate-400">${b.customerId || '-'}</div>
        </td>
        <td class="py-2.5 px-4 text-right font-mono font-bold text-amber-400">${formattedAmount}</td>
        <td class="py-2.5 px-3 text-center">${photoCell}</td>
        <td class="py-2.5 px-3 text-center">${statusBadge}</td>
        <td class="py-2.5 px-3 text-slate-400">${b.createdBy || b.approvedBy || '-'}</td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

function debounceMasterSearch() {
  clearTimeout(masterSearchDebounceTimer);
  masterSearchDebounceTimer = setTimeout(() => {
    fetchMasterBillsList();
  }, 250);
}

// Manual Master Bill Modal
function openManualBillModal() {
  const now = new Date();
  const thDate = now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
  document.getElementById('manual-date').value = thDate;
  document.getElementById('manual-bill-ref').value = '';
  document.getElementById('manual-amount').value = '';
  document.getElementById('manual-notes').value = '';
  clearManualCustSelection();

  document.getElementById('modal-manual-master').classList.remove('hidden');
  refreshIcons();
}

function closeManualBillModal() {
  document.getElementById('modal-manual-master').classList.add('hidden');
}

function handleManualCustSearch(e) {
  clearTimeout(manualCustDebounceTimer);
  const q = (e.target.value || '').trim().toLowerCase();
  const dropdown = document.getElementById('manual-cust-dropdown');

  if (!q) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  manualCustDebounceTimer = setTimeout(() => {
    const matches = currentCustomersList.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    ).slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div class="p-2.5 text-xs text-slate-400 text-center">ไม่พบชื่อลูกค้านี้</div>`;
    } else {
      dropdown.innerHTML = matches.map(c => `
        <div onclick="selectManualCust('${c.id}')" class="p-2.5 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between">
          <div>
            <div class="font-bold text-white text-xs">${c.id} - ${c.name}</div>
            ${c.fullName && c.fullName !== c.name ? `<div class="text-[10px] text-slate-400">${c.fullName}</div>` : ''}
          </div>
          <div class="text-[10px] text-slate-400">${c.phone || ''}</div>
        </div>
      `).join('');
    }
    dropdown.classList.remove('hidden');
  }, 150);
}

function selectManualCust(id) {
  const c = currentCustomersList.find(x => x.id === id);
  if (!c) return;

  document.getElementById('manual-cust-id').value = c.id;
  document.getElementById('manual-cust-name').value = c.name;

  document.getElementById('manual-cust-search').classList.add('hidden');
  document.getElementById('manual-cust-dropdown').classList.add('hidden');

  const pill = document.getElementById('manual-selected-cust-pill');
  document.getElementById('manual-pill-text').innerText = `${c.id} - ${c.name}`;
  pill.classList.remove('hidden');
}

function clearManualCustSelection() {
  document.getElementById('manual-cust-id').value = '';
  document.getElementById('manual-cust-name').value = '';

  const pill = document.getElementById('manual-selected-cust-pill');
  pill.classList.add('hidden');

  const searchInput = document.getElementById('manual-cust-search');
  searchInput.classList.remove('hidden');
  searchInput.value = '';
}

async function handleSaveManualMaster(e) {
  e.preventDefault();

  const categoryRadio = document.querySelector('input[name="manualCategory"]:checked');
  const category = categoryRadio ? categoryRadio.value : 'fuel';
  const companyRegistration = (category === 'fuel') ? 'ปั๊มน้ำมัน' : 'ร้านค้า';

  const date = document.getElementById('manual-date').value.trim();
  const billRef = document.getElementById('manual-bill-ref').value.trim();
  const customerId = document.getElementById('manual-cust-id').value;
  const customerName = document.getElementById('manual-cust-name').value;
  const amount = document.getElementById('manual-amount').value;
  const notes = document.getElementById('manual-notes').value.trim();

  if (!customerId || !customerName) {
    showToast("กรุณาเลือกลูกค้าจากรายชื่อก่อนบันทึก", false);
    return;
  }

  if (!billRef) {
    showToast("กรุณาระบุเลขที่บิล", false);
    return;
  }

  if (!amount || parseFloat(amount) <= 0) {
    showToast("กรุณาระบุยอดเงินให้ถูกต้อง", false);
    return;
  }

  const btn = document.getElementById('btn-save-manual-bill');
  btn.disabled = true;
  btn.innerText = "กำลังบันทึก...";

  try {
    const res = await fetch('/api/delivery/manager/manual-bill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        category,
        companyRegistration,
        date,
        billRef,
        customerId,
        customerName,
        amount: parseFloat(amount),
        notes
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`บันทึกเข้า Master สำเร็จ! (รหัส ${data.bill?.billId})`, true);
      closeManualBillModal();
      // Switch to the category of the created bill if not already on it or ALL
      if (currentMasterCategory !== 'ALL' && currentMasterCategory !== category) {
        switchMasterCategory(category, false);
      }
      await fetchMasterBillsList();
    } else {
      showToast(data.message || "บันทึกไม่สำเร็จ", false);
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>บันทึกเข้า Master</span>`;
    refreshIcons();
  }
}

// Lightbox / Image Viewer Modal
function openImageViewer(url, title = 'รูปภาพบิล') {
  if (!url) return;
  const modal = document.getElementById('modal-image-viewer');
  const img = document.getElementById('viewer-img');
  const titleEl = document.getElementById('viewer-title');
  const linkEl = document.getElementById('viewer-open-link');

  let displayUrl = url;
  // If Google Drive link, extract fileId and use high-speed direct CDN
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    displayUrl = `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }

  img.src = displayUrl;
  titleEl.innerText = `รูปบิล: ${title}`;
  linkEl.href = url;

  modal.classList.remove('hidden');
  refreshIcons();
}

function closeImageViewer() {
  const modal = document.getElementById('modal-image-viewer');
  modal.classList.add('hidden');
  document.getElementById('viewer-img').src = '';
}

// ==========================================
// BILLING NOTES & PAYMENT COLLECTION
// ==========================================

let allBillingNotes = [];
let currentBillingFilter = 'ALL';
let currentPendingBNBills = [];
let selectedBNBillIds = new Set();
let selectedBNCustomer = null;
let bnCustomerSearchDebounce = null;
let currentActiveBillingNote = null;
let capturedSlipBase64 = null;

function initBillingPage() {
  // Set default dates
  const now = new Date();
  const yy = (now.getFullYear() + 543).toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const todayStr = `${dd}/${mm}/${yy}`;

  const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dueYy = (due.getFullYear() + 543).toString();
  const dueMm = (due.getMonth() + 1).toString().padStart(2, '0');
  const dueDd = due.getDate().toString().padStart(2, '0');
  const dueStr = `${dueDd}/${dueMm}/${dueYy}`;

  const dateInput = document.getElementById('bn-input-date');
  const dueDateInput = document.getElementById('bn-input-due-date');
  if (dateInput) dateInput.value = todayStr;
  if (dueDateInput) dueDateInput.value = dueStr;

  // Load customer list if empty
  if (currentCustomersList.length === 0) {
    fetchCustomers();
  }

  // Switch to list tab and fetch
  switchBillingTab('list');
}

function switchBillingTab(tab) {
  const btnList = document.getElementById('btn-tab-bn-list');
  const btnCreate = document.getElementById('btn-tab-bn-create');
  const btnPayments = document.getElementById('btn-tab-bn-payments');

  const panelList = document.getElementById('panel-bn-list');
  const panelCreate = document.getElementById('panel-bn-create');
  const panelPayments = document.getElementById('panel-bn-payments');

  // Reset styles
  [btnList, btnCreate, btnPayments].forEach(b => {
    if (b) b.className = "px-3.5 py-2 rounded-lg text-slate-400 hover:text-white transition flex items-center gap-1.5";
  });
  [panelList, panelCreate, panelPayments].forEach(p => {
    if (p) p.classList.add('hidden');
  });

  if (tab === 'list') {
    if (btnList) btnList.className = "px-3.5 py-2 rounded-lg font-bold bg-violet-600 text-white shadow transition flex items-center gap-1.5";
    if (panelList) panelList.classList.remove('hidden');
    fetchBillingNotesList();
  } else if (tab === 'create') {
    if (btnCreate) btnCreate.className = "px-3.5 py-2 rounded-lg font-bold bg-violet-600 text-white shadow transition flex items-center gap-1.5";
    if (panelCreate) panelCreate.classList.remove('hidden');
  } else if (tab === 'payments') {
    if (btnPayments) btnPayments.className = "px-3.5 py-2 rounded-lg font-bold bg-violet-600 text-white shadow transition flex items-center gap-1.5";
    if (panelPayments) panelPayments.classList.remove('hidden');
    fetchPaymentsList();
  }

  refreshIcons();
}

// ----------------------------------------------------
// TAB 1: BILLING NOTES LIST
// ----------------------------------------------------

function filterBillingNotes(status) {
  currentBillingFilter = status;
  const btnAll = document.getElementById('bn-filter-all');
  const btnPending = document.getElementById('bn-filter-pending');
  const btnPaid = document.getElementById('bn-filter-paid');

  [btnAll, btnPending, btnPaid].forEach(b => {
    if (b) b.className = "px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition";
  });

  if (status === 'ALL' && btnAll) btnAll.className = "px-3 py-1.5 rounded-lg font-bold bg-violet-600 text-white transition";
  if (status === 'รอชำระ' && btnPending) btnPending.className = "px-3 py-1.5 rounded-lg font-bold bg-amber-500 text-slate-950 transition";
  if (status === 'ชำระแล้ว' && btnPaid) btnPaid.className = "px-3 py-1.5 rounded-lg font-bold bg-emerald-500 text-slate-950 transition";

  fetchBillingNotesList();
}

async function fetchBillingNotesList() {
  const tbody = document.getElementById('billing-notes-table-body');
  try {
    const res = await fetch(`/api/billing/notes?status=${encodeURIComponent(currentBillingFilter)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      allBillingNotes = data.notes || [];
      renderBillingNotesTable(allBillingNotes);
    } else {
      tbody.innerHTML = `<tr><td colspan="10" class="py-12 text-center text-red-400 text-xs">โหลดข้อมูลไม่สำเร็จ: ${data.message}</td></tr>`;
    }
  } catch (err) {
    console.error("Error fetching billing notes:", err);
    tbody.innerHTML = `<tr><td colspan="10" class="py-12 text-center text-slate-500 text-xs">เกิดข้อผิดพลาดในการเชื่อมต่อ</td></tr>`;
  }
}

function renderBillingNotesTable(notes) {
  const tbody = document.getElementById('billing-notes-table-body');
  if (!notes || notes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="py-14 text-center text-slate-500">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-xs">ไม่พบรายการใบวางบิลในสถานะนี้</p>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  tbody.innerHTML = notes.map(n => {
    const isPaid = n.status === 'ชำระแล้ว';
    const statusBadge = isPaid
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ชำระแล้ว</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">รอชำระ</span>`;

    const payButton = isPaid
      ? `<span class="text-[10px] text-emerald-400/80 font-medium">ชำระเรียบร้อย</span>`
      : `<button onclick="openPaymentModal('${n.billingNo}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shadow transition flex items-center gap-1">
           <i data-lucide="credit-card" class="w-3 h-3"></i>
           <span>รับชำระ</span>
         </button>`;

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3.5 font-mono font-bold text-violet-400 text-xs">${n.billingNo}</td>
        <td class="py-3 px-3 text-slate-300 font-mono text-[11px]">${n.billingDate}</td>
        <td class="py-3 px-3 text-slate-400 font-mono text-[11px]">${n.dueDate || '-'}</td>
        <td class="py-3 px-4">
          <div class="font-semibold text-white text-xs">${n.customerName}</div>
          <div class="text-[10px] text-slate-500 font-mono">${n.customerId || ''}</div>
        </td>
        <td class="py-3 px-3 text-center">
          <span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">${n.billCount} บิล</span>
        </td>
        <td class="py-3 px-3 text-right font-mono text-amber-300 text-xs">${n.storeAmountFormatted}</td>
        <td class="py-3 px-3 text-right font-mono text-teal-300 text-xs">${n.fuelAmountFormatted}</td>
        <td class="py-3 px-4 text-right font-mono font-bold text-white text-sm">${n.grandTotalFormatted}</td>
        <td class="py-3 px-3 text-center">${statusBadge}</td>
        <td class="py-3 px-3">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openBillingVoucherModal('${n.billingNo}')" title="พิมพ์ใบวางบิล" class="p-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 border border-violet-500/30 transition">
              <i data-lucide="printer" class="w-3.5 h-3.5"></i>
            </button>
            ${payButton}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

let bnSearchTimer = null;
function debounceSearchBillingNotes() {
  clearTimeout(bnSearchTimer);
  bnSearchTimer = setTimeout(() => {
    const q = (document.getElementById('search-bn-input')?.value || '').trim().toLowerCase();
    if (!q) {
      renderBillingNotesTable(allBillingNotes);
      return;
    }
    const filtered = allBillingNotes.filter(n =>
      n.billingNo.toLowerCase().includes(q) ||
      n.customerName.toLowerCase().includes(q) ||
      (n.customerId && n.customerId.toLowerCase().includes(q))
    );
    renderBillingNotesTable(filtered);
  }, 200);
}

// ----------------------------------------------------
// TAB 2: CREATE NEW BILLING NOTE WIZARD
// ----------------------------------------------------

function handleBNCustSearch(e) {
  clearTimeout(bnCustomerSearchDebounce);
  const q = (e.target.value || '').trim().toLowerCase();
  const dropdown = document.getElementById('bn-cust-dropdown');

  if (!q) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  bnCustomerSearchDebounce = setTimeout(() => {
    const matches = currentCustomersList.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    ).slice(0, 10);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">ไม่พบชื่อหรือรหัสลูกค้านี้</div>`;
    } else {
      dropdown.innerHTML = matches.map(c => `
        <div onclick="selectBNCustomer('${c.id}')" class="p-3 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-violet-500/20 text-violet-300 font-bold">${c.id}</span>
              <span class="text-xs font-semibold text-white">${c.name}</span>
            </div>
            ${c.fullName && c.fullName !== c.name ? `<div class="text-[11px] text-slate-400 mt-0.5">${c.fullName}</div>` : ''}
          </div>
          <div class="text-right text-[10px] text-slate-400 font-mono">${c.phone || ''}</div>
        </div>
      `).join('');
    }
    dropdown.classList.remove('hidden');
  }, 150);
}

function selectBNCustomer(custId) {
  const c = currentCustomersList.find(x => x.id === custId);
  if (!c) return;

  selectedBNCustomer = c;
  document.getElementById('bn-selected-cust-id').value = c.id;
  document.getElementById('bn-selected-cust-name').value = c.name;

  document.getElementById('bn-pill-id').innerText = c.id;
  document.getElementById('bn-pill-name').innerText = `${c.name} ${c.fullName && c.fullName !== c.name ? '(' + c.fullName + ')' : ''}`;
  document.getElementById('bn-selected-cust-pill').classList.remove('hidden');

  document.getElementById('bn-cust-search').classList.add('hidden');
  document.getElementById('bn-cust-dropdown').classList.add('hidden');

  fetchPendingBillsForCustomer(c.id, c.name);
}

function clearBNCustSelection() {
  selectedBNCustomer = null;
  document.getElementById('bn-selected-cust-id').value = '';
  document.getElementById('bn-selected-cust-name').value = '';

  document.getElementById('bn-selected-cust-pill').classList.add('hidden');
  const searchInput = document.getElementById('bn-cust-search');
  searchInput.value = '';
  searchInput.classList.remove('hidden');

  currentPendingBNBills = [];
  selectedBNBillIds.clear();
  renderBNPendingBillsTable([]);
  updateBNSummaryCalculation();
}

async function fetchPendingBillsForCustomer(customerId, customerName) {
  const tbody = document.getElementById('bn-pending-bills-table-body');
  tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-slate-400 text-xs"><span class="animate-spin inline-block mr-2">⚙️</span> กำลังค้นหาบิลรอวางบิลของลูกค้านี้...</td></tr>`;

  try {
    const res = await fetch(`/api/billing/pending-bills?customerId=${encodeURIComponent(customerId)}&customerName=${encodeURIComponent(customerName)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentPendingBNBills = data.bills || [];
      selectedBNBillIds = new Set(currentPendingBNBills.map(b => b.billId)); // Default: select all
      const checkAll = document.getElementById('bn-check-all');
      if (checkAll) checkAll.checked = (currentPendingBNBills.length > 0);
      renderBNPendingBillsTable(currentPendingBNBills);
      updateBNSummaryCalculation();
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400 text-xs">${data.message}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500 text-xs">เกิดข้อผิดพลาดในการโหลดบิล</td></tr>`;
  }
}

function renderBNPendingBillsTable(bills) {
  const tbody = document.getElementById('bn-pending-bills-table-body');
  if (!bills || bills.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-slate-500">
          <i data-lucide="check-circle" class="w-7 h-7 mx-auto mb-1 text-emerald-500/60"></i>
          <p class="text-xs">ไม่มีบิลค้างรอวางบิลสำหรับลูกค้ารายนี้ (หรือบิลทั้งหมดถูกวางบิลแล้ว)</p>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const isChecked = selectedBNBillIds.has(b.billId);
    let typeBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300">🏢 ร้านค้าทั่วไป</span>`;
    if (b.source && b.source.includes('หน่วยงาน')) {
      typeBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300">🏛️ ร้านค้าหน่วยงาน</span>`;
    } else if (b.companyRegistration === 'ปั๊มน้ำมัน') {
      typeBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/20 text-teal-300">⛽ ปั๊มน้ำมัน</span>`;
    }

    return `
      <tr class="hover:bg-slate-800/60 transition cursor-pointer" onclick="toggleBNBillCheck('${b.billId}')">
        <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
          <input type="checkbox" value="${b.billId}" ${isChecked ? 'checked' : ''} onchange="onBNBillCheckboxChange('${b.billId}', this.checked)"
            class="bn-bill-cb w-4 h-4 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-0 cursor-pointer">
        </td>
        <td class="py-2.5 px-3 font-mono font-bold text-white text-xs">${b.billId}</td>
        <td class="py-2.5 px-3 text-slate-300 font-mono text-[11px]">${b.date}</td>
        <td class="py-2.5 px-3 text-center">${typeBadge}</td>
        <td class="py-2.5 px-3 text-slate-300 text-xs font-mono">
          ${b.billRef || '-'}
          ${b.notes ? `<div class="text-[10px] text-slate-500 italic mt-0.5">${b.notes}</div>` : ''}
        </td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-amber-400 text-xs">${b.amount}</td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

function toggleBNBillCheck(billId) {
  if (selectedBNBillIds.has(billId)) {
    selectedBNBillIds.delete(billId);
  } else {
    selectedBNBillIds.add(billId);
  }
  syncBNCheckboxes();
  updateBNSummaryCalculation();
}

function onBNBillCheckboxChange(billId, isChecked) {
  if (isChecked) {
    selectedBNBillIds.add(billId);
  } else {
    selectedBNBillIds.delete(billId);
  }
  syncBNCheckboxes();
  updateBNSummaryCalculation();
}

function toggleSelectAllBNBills(masterCb) {
  if (masterCb.checked) {
    selectedBNBillIds = new Set(currentPendingBNBills.map(b => b.billId));
  } else {
    selectedBNBillIds.clear();
  }
  syncBNCheckboxes();
  updateBNSummaryCalculation();
}

function syncBNCheckboxes() {
  const cbs = document.querySelectorAll('.bn-bill-cb');
  cbs.forEach(cb => {
    cb.checked = selectedBNBillIds.has(cb.value);
  });
  const masterCb = document.getElementById('bn-check-all');
  if (masterCb && currentPendingBNBills.length > 0) {
    masterCb.checked = (selectedBNBillIds.size === currentPendingBNBills.length);
  }
}

function updateBNSummaryCalculation() {
  let storeSum = 0;
  let fuelSum = 0;

  currentPendingBNBills.forEach(b => {
    if (selectedBNBillIds.has(b.billId)) {
      if (b.companyRegistration === 'ปั๊มน้ำมัน') {
        fuelSum += b.amountNum;
      } else {
        storeSum += b.amountNum;
      }
    }
  });

  const grandTotal = storeSum + fuelSum;

  const countEl = document.getElementById('bn-calc-count');
  const storeEl = document.getElementById('bn-calc-store');
  const fuelEl = document.getElementById('bn-calc-fuel');
  const totalEl = document.getElementById('bn-calc-total');

  if (countEl) countEl.innerText = `${selectedBNBillIds.size} บิล`;
  if (storeEl) storeEl.innerText = `${storeSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (fuelEl) fuelEl.innerText = `${fuelSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (totalEl) totalEl.innerText = `${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function handleCreateBillingNoteSubmit(e) {
  e.preventDefault();

  const customerId = document.getElementById('bn-selected-cust-id').value;
  const customerName = document.getElementById('bn-selected-cust-name').value;
  const billingDate = document.getElementById('bn-input-date').value.trim();
  const dueDate = document.getElementById('bn-input-due-date').value.trim();
  const notes = document.getElementById('bn-input-notes').value.trim();

  if (!customerId || !customerName) {
    showToast("กรุณาเลือกลูกค้าก่อนออกใบวางบิล", false);
    return;
  }

  if (selectedBNBillIds.size === 0) {
    showToast("กรุณาเลือกบิลอย่างน้อย 1 รายการเพื่อออกใบวางบิล", false);
    return;
  }

  const btn = document.getElementById('btn-submit-create-bn');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span><span>กำลังสร้างใบวางบิล...</span>`;

  try {
    const res = await fetch('/api/billing/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        customerId,
        customerName,
        billIds: Array.from(selectedBNBillIds),
        billingDate,
        dueDate,
        notes
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`สร้างใบวางบิล ${data.billingNote?.billingNo} สำเร็จ!`, true);
      clearBNCustSelection();
      document.getElementById('bn-input-notes').value = '';
      
      // Open printable voucher modal immediately for preview
      openBillingVoucherModal(data.billingNote.billingNo);
      
      // Switch to list tab
      switchBillingTab('list');
    } else {
      showToast(data.message || "สร้างใบวางบิลไม่สำเร็จ", false);
    }
  } catch (err) {
    console.error("Create billing note error:", err);
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์", false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
    refreshIcons();
  }
}

// ----------------------------------------------------
// PRINTABLE BILLING NOTE VOUCHER (A4)
// ----------------------------------------------------

async function openBillingVoucherModal(billingNo) {
  const modal = document.getElementById('modal-billing-voucher');
  const target = document.getElementById('voucher-render-target');
  const title = document.getElementById('voucher-header-title');

  title.innerText = billingNo;
  target.innerHTML = `<div class="py-16 text-center text-slate-400">กำลังจัดเตรียมข้อมูลใบวางบิล ${billingNo}...</div>`;
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/billing/notes/${encodeURIComponent(billingNo)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentActiveBillingNote = data.note;
      renderBillingVoucher(data.note, data.bills);
    } else {
      target.innerHTML = `<div class="py-16 text-center text-red-500">โหลดข้อมูลไม่สำเร็จ: ${data.message}</div>`;
    }
  } catch (err) {
    target.innerHTML = `<div class="py-16 text-center text-slate-500">เกิดข้อผิดพลาดในการโหลดใบวางบิล</div>`;
  }
  refreshIcons();
}

function closeBillingVoucherModal() {
  document.getElementById('modal-billing-voucher').classList.add('hidden');
}

function renderBillingVoucher(note, bills) {
  const target = document.getElementById('voucher-render-target');
  const totalNum = note.grandTotal || 0;
  const bahtTextStr = thaiBahtText(totalNum);

  const shopName = storeSettings.shop_name || 'สหธรรม';
  const shopSubtitle = storeSettings.shop_subtitle || 'ระบบบริหารจัดการสต็อก วัสดุก่อสร้าง และสถานีบริการน้ำมัน';
  const shopTaxId = storeSettings.shop_tax_id || '0423533000123';
  const shopPhone = storeSettings.shop_phone || '042-298022';
  const shopAddress = storeSettings.shop_address || '';
  const shopFooter = storeSettings.shop_footer || `ในนาม ${shopName}`;

  target.innerHTML = `
    <div class="space-y-6 text-slate-900 font-sans">
      
      <!-- Company & Document Header -->
      <div class="flex justify-between items-start border-b-2 border-slate-900 pb-4">
        <div>
          <div class="text-xl font-extrabold tracking-wide text-slate-900">${shopName}</div>
          <div class="text-xs text-slate-600 mt-1 leading-relaxed">
            ${shopSubtitle ? `${shopSubtitle}<br>` : ''}
            ${shopTaxId ? `เลขประจำตัวผู้เสียภาษี: ${shopTaxId}` : ''}${shopPhone ? ` • โทร. ${shopPhone}` : ''}
            ${shopAddress ? `<br>${shopAddress}` : ''}
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-black text-slate-900 tracking-wider">ใบวางบิล</div>
          <div class="text-xs font-bold text-slate-600 font-mono tracking-widest uppercase">BILLING NOTE</div>
          <div class="mt-2 text-xs font-mono font-bold text-violet-700 bg-violet-50 px-2.5 py-1 rounded border border-violet-200 inline-block">
            เลขที่: ${note.billingNo}
          </div>
        </div>
      </div>

      <!-- Customer Info & Meta Box -->
      <div class="grid grid-cols-2 gap-4 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs">
        <div>
          <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">ข้อมูลลูกค้า / ผู้รับวางบิล</div>
          <div class="text-sm font-bold text-slate-900">${note.customerName}</div>
          <div class="text-slate-600 font-mono mt-0.5">รหัสลูกค้า: ${note.customerId || '-'}</div>
        </div>
        <div class="text-right space-y-1">
          <div><span class="text-slate-500">วันที่วางบิล:</span> <strong class="font-mono text-slate-800">${note.billingDate}</strong></div>
          <div><span class="text-slate-500">วันครบกำหนดชำระ:</span> <strong class="font-mono text-red-600">${note.dueDate || '-'}</strong></div>
          <div><span class="text-slate-500">ผู้ออกเอกสาร:</span> <span class="text-slate-800 font-medium">${note.issuedBy || '-'}</span></div>
        </div>
      </div>

      <!-- Itemized Bills Table (ลำดับ | เลขที่ใบส่งของ | จำนวนเงิน) -->
      <div>
        <table class="w-full text-left text-xs border border-slate-300">
          <thead class="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
            <tr>
              <th class="py-2.5 px-3 text-center w-14 border-r border-slate-300">ลำดับ</th>
              <th class="py-2.5 px-4 border-r border-slate-300">เลขที่ใบส่งของ</th>
              <th class="py-2.5 px-4 text-right w-40">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 font-sans">
            ${bills.map((b, idx) => `
              <tr>
                <td class="py-2.5 px-3 text-center text-slate-600 border-r border-slate-200 font-mono">${idx + 1}</td>
                <td class="py-2.5 px-4 text-slate-800 border-r border-slate-200">
                  <div class="font-bold text-slate-900 font-mono text-sm">${b.billRef || '-'}</div>
                  <div class="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>วันที่: <strong class="font-mono text-slate-700">${b.date || '-'}</strong></span>
                    ${b.companyRegistration ? `<span class="px-1.5 py-0.2 rounded text-[10px] ${b.companyRegistration === 'ปั๊มน้ำมัน' ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'}">${b.source || b.companyRegistration}</span>` : ''}
                    ${b.notes ? `<span class="italic text-slate-400">(${b.notes})</span>` : ''}
                  </div>
                </td>
                <td class="py-2.5 px-4 text-right font-mono font-bold text-slate-900 text-sm">${b.amount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Subtotals & Split Summary -->
      <div class="grid grid-cols-2 gap-4 pt-2">
        <div class="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-[11px]">
          <div class="font-bold text-slate-700 mb-1">ยอดแยกตามทะเบียนพาณิชย์:</div>
          <div class="flex justify-between text-slate-600">
            <span>• ยอดฝั่งร้านค้า (ทั่วไป / หน่วยงาน):</span>
            <strong class="font-mono text-slate-900">${note.storeAmountFormatted}</strong>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>• ยอดฝั่งปั๊มน้ำมัน (บิลน้ำมัน):</span>
            <strong class="font-mono text-slate-900">${note.fuelAmountFormatted}</strong>
          </div>
          ${note.notes ? `<div class="pt-2 border-t border-slate-200 text-[10px] text-slate-500 italic">หมายเหตุ: ${note.notes}</div>` : ''}
        </div>

        <div class="border border-slate-300 rounded-lg overflow-hidden flex flex-col justify-between">
          <div class="bg-slate-100 p-3 flex items-center justify-between border-b border-slate-300">
            <span class="text-xs font-bold text-slate-800">ยอดรวมสุทธิทั้งสิ้น:</span>
            <span class="text-lg font-black text-slate-900 font-mono">${note.grandTotalFormatted}</span>
          </div>
          <div class="p-2.5 bg-white text-center text-xs font-bold text-slate-800">
            (${bahtTextStr})
          </div>
        </div>
      </div>

      <!-- Signatures Block -->
      <div class="grid grid-cols-2 gap-8 pt-8 border-t border-slate-300 text-xs text-center">
        <div class="space-y-6">
          <div class="text-slate-600 font-medium">ได้รับวางบิลตามรายการข้างต้นถูกต้องเรียบร้อยแล้ว</div>
          <div class="w-48 mx-auto border-b border-slate-400"></div>
          <div>
            <div class="text-slate-800 font-bold">ผู้รับวางบิล (ลูกค้า)</div>
            <div class="text-[11px] text-slate-500 mt-0.5">วันที่: _____/_____/_________</div>
          </div>
        </div>

        <div class="space-y-6">
          <div class="text-slate-600 font-medium">${shopFooter}</div>
          <div class="w-48 mx-auto border-b border-slate-400"></div>
          <div>
            <div class="text-slate-800 font-bold">ผู้วางบิล / ผู้มีอำนาจลงนาม</div>
            <div class="text-[11px] text-slate-500 mt-0.5">วันที่: ${note.billingDate}</div>
          </div>
        </div>
      </div>

    </div>
  `;
}

function printBillingVoucher() {
  const content = document.getElementById('printable-voucher-area');
  if (!content) return window.print();

  // Create isolated iframe to guarantee complete unclipped A4 print layout
  let printFrame = document.getElementById('bn-print-iframe');
  if (!printFrame) {
    printFrame = document.createElement('iframe');
    printFrame.id = 'bn-print-iframe';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.style.visibility = 'hidden';
    document.body.appendChild(printFrame);
  }

  const shopName = storeSettings.shop_name || 'สหธรรม';
  const frameDoc = printFrame.contentWindow.document;
  frameDoc.open();
  frameDoc.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="utf-8">
      <title>ใบวางบิล - ${shopName}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 15mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          font-family: 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #ffffff !important;
          color: #0f172a !important;
          margin: 0;
          padding: 0;
        }
        table {
          border-collapse: collapse !important;
          width: 100% !important;
        }
        th, td {
          border-color: #cbd5e1 !important;
        }
      </style>
    </head>
    <body class="p-2">
      ${content.innerHTML}
    </body>
    </html>
  `);
  frameDoc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 400);
}

// ----------------------------------------------------
// PAYMENT COLLECTION MODAL
// ----------------------------------------------------

async function openPaymentModal(billingNo) {
  const modal = document.getElementById('modal-record-payment');
  currentActiveBillingNote = null;
  capturedSlipBase64 = null;
  clearSlipPreview();

  // Reset fields
  document.getElementById('pay-hidden-bn-no').value = billingNo;
  document.getElementById('pay-modal-bn-no').innerText = billingNo;
  document.getElementById('pay-notes').value = '';

  const now = new Date();
  const yy = (now.getFullYear() + 543).toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  document.getElementById('pay-date').value = `${dd}/${mm}/${yy}`;

  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/billing/notes/${encodeURIComponent(billingNo)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentActiveBillingNote = data.note;
      document.getElementById('pay-modal-customer').innerText = data.note.customerName;
      document.getElementById('pay-modal-grand-total').innerText = `${data.note.grandTotalFormatted}`;
      document.getElementById('pay-modal-split-store').innerText = `${data.note.storeAmountFormatted}`;
      document.getElementById('pay-modal-split-fuel').innerText = `${data.note.fuelAmountFormatted}`;
      document.getElementById('pay-amount').value = data.note.grandTotal;
    }
  } catch (err) {
    console.error("Error opening payment modal:", err);
  }

  refreshIcons();
}

function closePaymentModal() {
  document.getElementById('modal-record-payment').classList.add('hidden');
}

function handleSlipFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    capturedSlipBase64 = evt.target.result;
    document.getElementById('pay-slip-preview-box').classList.remove('hidden');
    refreshIcons();
  };
  reader.readAsDataURL(file);
}

function clearSlipPreview() {
  capturedSlipBase64 = null;
  const input = document.getElementById('pay-slip-input');
  if (input) input.value = '';
  document.getElementById('pay-slip-preview-box').classList.add('hidden');
}

async function handlePaymentSubmit(e) {
  e.preventDefault();

  const billingNo = document.getElementById('pay-hidden-bn-no').value;
  const paymentDate = document.getElementById('pay-date').value.trim();
  const paidAmount = parseFloat(document.getElementById('pay-amount').value);
  const bankAccount = document.getElementById('pay-bank').value;
  const notes = document.getElementById('pay-notes').value.trim();

  if (!paidAmount || paidAmount <= 0) {
    showToast("กรุณาระบุยอดเงินที่รับชำระให้ถูกต้อง", false);
    return;
  }

  const btn = document.getElementById('btn-confirm-payment');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span><span>กำลังบันทึกและตัดยอด...</span>`;

  try {
    const res = await fetch(`/api/billing/notes/${encodeURIComponent(billingNo)}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        paymentDate,
        paidAmount,
        bankAccount,
        imageBase64: capturedSlipBase64,
        notes
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`บันทึกรับเงินสำเร็จ! รหัส ${data.payment?.paymentNo} (ตัดร้านค้า: ${data.payment?.cutStore.toLocaleString()} / ตัดน้ำมัน: ${data.payment?.cutFuel.toLocaleString()})`, true);
      closePaymentModal();
      fetchBillingNotesList();
    } else {
      showToast(data.message || "บันทึกรับชำระเงินไม่สำเร็จ", false);
    }
  } catch (err) {
    console.error("Submit payment error:", err);
    showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
    refreshIcons();
  }
}

// ----------------------------------------------------
// TAB 3: PAYMENTS HISTORY HUB
// ----------------------------------------------------

async function fetchPaymentsList() {
  const tbody = document.getElementById('payments-table-body');
  try {
    const res = await fetch('/api/billing/payments', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      renderPaymentsTable(data.payments || []);
    } else {
      tbody.innerHTML = `<tr><td colspan="10" class="py-10 text-center text-red-400 text-xs">${data.message}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="py-10 text-center text-slate-500 text-xs">เกิดข้อผิดพลาดในการโหลดประวัติการรับเงิน</td></tr>`;
  }
}

function renderPaymentsTable(payments) {
  const tbody = document.getElementById('payments-table-body');
  if (!payments || payments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="py-12 text-center text-slate-500">
          <i data-lucide="receipt" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-xs">ยังไม่มีประวัติการรับชำระเงินในระบบ</p>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  tbody.innerHTML = payments.map(p => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3.5 font-mono font-bold text-emerald-400 text-xs">${p.paymentNo}</td>
      <td class="py-3 px-3 text-slate-300 font-mono text-[11px]">${p.paymentDate}</td>
      <td class="py-3 px-3 font-mono text-violet-300 text-xs">${p.billingNo}</td>
      <td class="py-3 px-4 font-semibold text-white text-xs">${p.customerName}</td>
      <td class="py-3 px-3 text-right font-mono font-bold text-white text-sm">${p.paidAmount}</td>
      <td class="py-3 px-3 text-right font-mono text-amber-300 text-xs">${p.cutStore}</td>
      <td class="py-3 px-3 text-right font-mono text-teal-300 text-xs">${p.cutFuel}</td>
      <td class="py-3 px-3 text-slate-300 text-xs">${p.bankAccount}</td>
      <td class="py-3 px-3 text-center">
        ${p.slipUrl ? `
          <button onclick="openImageViewer('${p.slipUrl}', 'สลิป ${p.paymentNo}')" class="text-emerald-400 hover:text-emerald-300 underline text-xs flex items-center justify-center gap-1 mx-auto">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
            <span>ดูสลิป</span>
          </button>
        ` : '<span class="text-slate-500 text-[10px]">-</span>'}
      </td>
      <td class="py-3 px-3 text-slate-400 text-[11px]">${p.recordedBy}</td>
    </tr>
  `).join('');

  refreshIcons();
}

// ----------------------------------------------------
// THAI BAHT TEXT CONVERTER (Utility)
// ----------------------------------------------------

function thaiBahtText(num) {
  if (isNaN(num)) return '';
  num = Math.round(num * 100) / 100;
  if (num === 0) return 'ศูนย์บาทถ้วน';

  const numbers = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertGroup(n) {
    let s = '';
    const digits = String(n).split('').map(Number);
    const len = digits.length;
    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const pos = len - i - 1;
      if (d !== 0) {
        if (pos === 1 && d === 1) {
          s += 'สิบ';
        } else if (pos === 1 && d === 2) {
          s += 'ยี่สิบ';
        } else if (pos === 0 && d === 1 && len > 1) {
          s += 'เอ็ด';
        } else {
          s += numbers[d] + units[pos];
        }
      }
    }
    return s;
  }

  const parts = num.toFixed(2).split('.');
  let integerPart = parseInt(parts[0], 10);
  const fractionPart = parseInt(parts[1], 10);

  let result = '';

  if (integerPart > 0) {
    let millions = 0;
    if (integerPart >= 1000000) {
      millions = Math.floor(integerPart / 1000000);
      integerPart = integerPart % 1000000;
      result += convertGroup(millions) + 'ล้าน';
    }
    result += convertGroup(integerPart) + 'บาท';
  }

  if (fractionPart === 0) {
    result += 'ถ้วน';
  } else {
    result += convertGroup(fractionPart) + 'สตางค์';
  }

  return result;
}

// ==========================================
// PHASE 5: DAILY STOREFRONT REVENUE & CASH SETTLEMENT
// ==========================================

let revCurrentDate = '';
let revCashDropsList = [];
let revCreditBillsData = { totalAmount: 0, bills: [], count: 0 };
let revHistoryList = [];

function getTodayThaiDateStr() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear() + 543;
  return `${d}/${m}/${y}`;
}

function getTodayTimeStr() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function initDailyRevenuePage() {
  if (!currentUser || (currentUser.role !== 'manager' && currentUser.role !== 'admin')) {
    showToast('เฉพาะผู้จัดการหรือผู้ดูแลระบบเท่านั้น', false);
    return navigateTo('dashboard');
  }

  const dateInput = document.getElementById('rev-date-input');
  if (dateInput && (!dateInput.value || !dateInput.value.trim())) {
    dateInput.value = getTodayThaiDateStr();
  }

  // Reset inputs
  const floatInput = document.getElementById('rev-change-float');
  if (floatInput && (!floatInput.value || floatInput.value === '0')) {
    floatInput.value = '7500';
  }

  switchRevenueTab('closing');
  loadDailyRevenueData();
  loadDailyRevenueHistory();
}

function setRevDateToday() {
  const dateInput = document.getElementById('rev-date-input');
  if (dateInput) {
    dateInput.value = getTodayThaiDateStr();
    loadDailyRevenueData();
  }
}

function switchRevenueTab(tab) {
  const panelClosing = document.getElementById('panel-rev-closing');
  const panelHistory = document.getElementById('panel-rev-history');
  const btnClosing = document.getElementById('btn-rev-tab-closing');
  const btnHistory = document.getElementById('btn-rev-tab-history');

  if (tab === 'closing') {
    if (panelClosing) panelClosing.classList.remove('hidden');
    if (panelHistory) panelHistory.classList.add('hidden');
    if (btnClosing) {
      btnClosing.className = 'px-4 py-2 rounded-lg text-xs font-semibold transition bg-emerald-600 text-white shadow-md';
    }
    if (btnHistory) {
      btnHistory.className = 'px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition';
    }
  } else {
    if (panelClosing) panelClosing.classList.add('hidden');
    if (panelHistory) panelHistory.classList.remove('hidden');
    if (btnClosing) {
      btnClosing.className = 'px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition';
    }
    if (btnHistory) {
      btnHistory.className = 'px-4 py-2 rounded-lg text-xs font-semibold transition bg-emerald-600 text-white shadow-md';
    }
    loadDailyRevenueHistory();
  }
  refreshIcons();
}

async function loadDailyRevenueData() {
  const dateInput = document.getElementById('rev-date-input');
  const targetDate = dateInput ? dateInput.value.trim() : getTodayThaiDateStr();
  revCurrentDate = targetDate;

  // 1. Fetch cash drops for this date
  try {
    const resDrops = await fetch(`/api/revenue/cash-drops?date=${encodeURIComponent(targetDate)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const dropsData = await resDrops.json();
    if (dropsData.success) {
      revCashDropsList = dropsData.drops || [];
    } else {
      revCashDropsList = [];
    }
  } catch (err) {
    console.error("Fetch cash drops error:", err);
    revCashDropsList = [];
  }

  // 2. Fetch daily credit bills for this date
  try {
    const resBills = await fetch(`/api/revenue/credit-bills?date=${encodeURIComponent(targetDate)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const billsData = await resBills.json();
    if (billsData.success) {
      revCreditBillsData = {
        totalAmount: billsData.totalAmount || 0,
        bills: billsData.bills || [],
        count: billsData.count || 0
      };
    } else {
      revCreditBillsData = { totalAmount: 0, bills: [], count: 0 };
    }
  } catch (err) {
    console.error("Fetch credit bills error:", err);
    revCreditBillsData = { totalAmount: 0, bills: [], count: 0 };
  }

  renderCashDropsList();
  renderDailyCreditBills();
  recalcDailyRevenueLive();
}

function renderCashDropsList() {
  const tbody = document.getElementById('rev-cash-drops-tbody');
  const totalDisplay = document.getElementById('rev-cash-drops-total-display');
  if (!tbody) return;

  if (revCashDropsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-500 text-xs">ยังไม่มีรายการเก็บเงินสดเข้าเซฟวันที่ ${revCurrentDate}</td></tr>`;
    if (totalDisplay) totalDisplay.innerText = '0.00';
    return;
  }

  let total = 0;
  tbody.innerHTML = revCashDropsList.map(d => {
    total += d.amount;
    return `
      <tr class="hover:bg-slate-800/60 transition">
        <td class="py-2.5 px-3 font-mono text-slate-300 font-semibold">${d.time || '-'}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">${d.amountFormatted || d.amount.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-slate-300">${d.notes || '<span class="text-slate-500">-</span>'}</td>
        <td class="py-2.5 px-3 text-center text-slate-400 font-medium">${d.recordedBy || '-'}</td>
      </tr>
    `;
  }).join('');

  if (totalDisplay) {
    totalDisplay.innerText = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

function renderDailyCreditBills() {
  const countBadge = document.getElementById('rev-credit-count-badge');
  const totalDisplay = document.getElementById('rev-credit-total-display');
  const listContainer = document.getElementById('rev-credit-bills-list');

  if (countBadge) countBadge.innerText = `${revCreditBillsData.count || 0} รายการ`;
  if (totalDisplay) {
    totalDisplay.innerText = (revCreditBillsData.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  if (listContainer) {
    if (!revCreditBillsData.bills || revCreditBillsData.bills.length === 0) {
      listContainer.innerHTML = `<div class="py-3 text-center text-slate-500 text-xs">ไม่พบบิลเครดิตที่ออกในวันที่ ${revCurrentDate}</div>`;
    } else {
      listContainer.innerHTML = revCreditBillsData.bills.map((b, idx) => `
        <div class="py-2 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="text-slate-500 font-mono">${idx + 1}.</span>
            <div>
              <span class="font-mono font-bold text-slate-200">${b.billRef || b.billId}</span>
              <span class="text-slate-400 ml-1.5">${b.customerName || '-'}</span>
            </div>
          </div>
          <div class="font-mono font-bold text-violet-400">${b.amountFormatted || b.amount.toFixed(2)}</div>
        </div>
      `).join('');
    }
  }
}

function toggleCreditBillsList() {
  const container = document.getElementById('rev-credit-bills-container');
  const label = document.getElementById('rev-toggle-bills-label');
  if (!container) return;

  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    if (label) label.innerText = 'ซ่อนรายการบิลเครดิตของวันนี้';
  } else {
    container.classList.add('hidden');
    if (label) label.innerText = 'แสดงรายการบิลเครดิตของวันนี้';
  }
}

function recalcDailyRevenueLive() {
  const changeFloat = parseFloat(String(document.getElementById('rev-change-float')?.value || '0').replace(/,/g, '')) || 0;
  const drawerClose = parseFloat(String(document.getElementById('rev-drawer-close')?.value || '0').replace(/,/g, '')) || 0;
  const transferTotal = parseFloat(String(document.getElementById('rev-transfer-total')?.value || '0').replace(/,/g, '')) || 0;
  const laborCash = parseFloat(String(document.getElementById('rev-labor-cash')?.value || '0').replace(/,/g, '')) || 0;
  const laborCredit = parseFloat(String(document.getElementById('rev-labor-credit')?.value || '0').replace(/,/g, '')) || 0;

  const dropsTotal = revCashDropsList.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const creditTotal = parseFloat(revCreditBillsData.totalAmount) || 0;

  // Formula calculations
  const cashNet = Math.max(0, (dropsTotal + drawerClose) - changeFloat);
  const cashAndTransfer = cashNet + transferTotal;
  const laborTotal = laborCash + laborCredit;
  const goodsCashTransfer = Math.max(0, cashAndTransfer - laborCash);
  const goodsCredit = Math.max(0, creditTotal - laborCredit);
  const goodsTotal = goodsCashTransfer + goodsCredit;
  const grandTotal = goodsTotal + laborTotal;

  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Update formula badges
  const fDrops = document.getElementById('formula-drops');
  const fDrawer = document.getElementById('formula-drawer');
  const fFloat = document.getElementById('formula-float');
  if (fDrops) fDrops.innerText = fmt(dropsTotal);
  if (fDrawer) fDrawer.innerText = fmt(drawerClose);
  if (fFloat) fFloat.innerText = fmt(changeFloat);

  // Update Net Cash & Cash+Transfer Displays
  const netCashEl = document.getElementById('rev-net-cash-display');
  const cashTransferSumEl = document.getElementById('rev-cash-transfer-sum-display');
  const laborTotalEl = document.getElementById('rev-labor-total-display');

  if (netCashEl) netCashEl.innerText = fmt(cashNet);
  if (cashTransferSumEl) cashTransferSumEl.innerText = fmt(cashAndTransfer);
  if (laborTotalEl) laborTotalEl.innerText = fmt(laborTotal);

  // Update Summary Box A (Goods)
  const sumGoodsCashEl = document.getElementById('rev-sum-goods-cash');
  const sumGoodsCreditEl = document.getElementById('rev-sum-goods-credit');
  const sumGoodsTotalEl = document.getElementById('rev-sum-goods-total');
  if (sumGoodsCashEl) sumGoodsCashEl.innerText = fmt(goodsCashTransfer);
  if (sumGoodsCreditEl) sumGoodsCreditEl.innerText = fmt(goodsCredit);
  if (sumGoodsTotalEl) sumGoodsTotalEl.innerText = fmt(goodsTotal);

  // Update Summary Box B (Labor)
  const sumLaborCashEl = document.getElementById('rev-sum-labor-cash');
  const sumLaborCreditEl = document.getElementById('rev-sum-labor-credit');
  const sumLaborTotalEl = document.getElementById('rev-sum-labor-total');
  if (sumLaborCashEl) sumLaborCashEl.innerText = fmt(laborCash);
  if (sumLaborCreditEl) sumLaborCreditEl.innerText = fmt(laborCredit);
  if (sumLaborTotalEl) sumLaborTotalEl.innerText = fmt(laborTotal);

  // Update Summary Box C (Grand Total)
  const sumCashSafeEl = document.getElementById('rev-sum-cash-to-safe');
  const sumTransferBankEl = document.getElementById('rev-sum-transfer-to-bank');
  const sumCreditArEl = document.getElementById('rev-sum-credit-ar');
  const grandTotalEl = document.getElementById('rev-grand-total-display');

  if (sumCashSafeEl) sumCashSafeEl.innerText = fmt(cashNet);
  if (sumTransferBankEl) sumTransferBankEl.innerText = fmt(transferTotal);
  if (sumCreditArEl) sumCreditArEl.innerText = fmt(creditTotal);
  if (grandTotalEl) grandTotalEl.innerText = fmt(grandTotal);
}

// Cash Drop Modal Handlers
function openCashDropModal() {
  const dateInput = document.getElementById('rev-date-input');
  const dropDate = document.getElementById('modal-drop-date');
  const dropTime = document.getElementById('modal-drop-time');
  const dropAmount = document.getElementById('modal-drop-amount');
  const dropNotes = document.getElementById('modal-drop-notes');

  if (dropDate) dropDate.value = dateInput ? dateInput.value.trim() : getTodayThaiDateStr();
  if (dropTime) dropTime.value = getTodayTimeStr();
  if (dropAmount) dropAmount.value = '';
  if (dropNotes) dropNotes.value = '';

  const modal = document.getElementById('modal-cash-drop');
  if (modal) modal.classList.remove('hidden');
  refreshIcons();
}

function closeCashDropModal() {
  const modal = document.getElementById('modal-cash-drop');
  if (modal) modal.classList.add('hidden');
}

async function handleCashDropSubmit(e) {
  if (e) e.preventDefault();
  const date = document.getElementById('modal-drop-date')?.value.trim();
  const time = document.getElementById('modal-drop-time')?.value.trim();
  const amountStr = document.getElementById('modal-drop-amount')?.value;
  const notes = document.getElementById('modal-drop-notes')?.value.trim();
  const amount = parseFloat(amountStr) || 0;

  if (!date || !time) {
    return showToast('กรุณาระบุวันที่และเวลา', false);
  }
  if (amount <= 0) {
    return showToast('กรุณาระบุจำนวนเงินที่เก็บเข้าเซฟให้ถูกต้อง', false);
  }

  const btn = document.getElementById('btn-confirm-drop');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> กำลังบันทึก...';
    refreshIcons();
  }

  try {
    const res = await fetch('/api/revenue/cash-drops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ date, time, amount, notes })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'บันทึกการเก็บเงินสดล้มเหลว');
    }

    showToast(`บันทึกเก็บเงินสดเข้าเซฟ ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} เรียบร้อย`);
    closeCashDropModal();
    await loadDailyRevenueData();
  } catch (err) {
    showToast(err.message, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
      refreshIcons();
    }
  }
}

async function handleDailyClosingSubmit() {
  const dateInput = document.getElementById('rev-date-input');
  const dateVal = dateInput ? dateInput.value.trim() : getTodayThaiDateStr();
  if (!dateVal) {
    return showToast('กรุณาระบุวันที่ปิดยอด', false);
  }

  const changeFloat = parseFloat(String(document.getElementById('rev-change-float')?.value || '7500').replace(/,/g, '')) || 7500;
  const drawerClose = parseFloat(String(document.getElementById('rev-drawer-close')?.value || '0').replace(/,/g, '')) || 0;
  const transferTotal = parseFloat(String(document.getElementById('rev-transfer-total')?.value || '0').replace(/,/g, '')) || 0;
  const laborCash = parseFloat(String(document.getElementById('rev-labor-cash')?.value || '0').replace(/,/g, '')) || 0;
  const laborCredit = parseFloat(String(document.getElementById('rev-labor-credit')?.value || '0').replace(/,/g, '')) || 0;
  const notes = document.getElementById('rev-closing-notes')?.value.trim() || '';

  const dropsTotal = revCashDropsList.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const creditTotal = parseFloat(revCreditBillsData.totalAmount) || 0;

  const cashNet = Math.max(0, (dropsTotal + drawerClose) - changeFloat);
  const cashAndTransfer = cashNet + transferTotal;
  const laborTotal = laborCash + laborCredit;
  const goodsTotal = Math.max(0, cashAndTransfer - laborCash) + Math.max(0, creditTotal - laborCredit);
  const grandTotal = goodsTotal + laborTotal;

  const confirmMsg = `ยืนยันการบันทึกปิดยอดรายรับประจำวัน ${dateVal} ?\n\n` +
    `- รวมเงินสดเก็บเข้าเซฟ: ${dropsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- เงินสดในลิ้นชักปิดกะ: ${drawerClose.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- หักเงินทอน: ${changeFloat.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- เงินสดสุทธิ: ${cashNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- เงินโอน: ${transferTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- บิลเครดิต: ${creditTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- หักค่าแรงช่างรวม: ${laborTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `- รวมยอดขายสินค้า: ${goodsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
    `=============================\n` +
    `ยอดรับรวมทั้งสิ้น: ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-submit-closing');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> กำลังบันทึกปิดยอด...';
    refreshIcons();
  }

  try {
    const payload = {
      date: dateVal,
      changeFloat,
      cashDropsTotal: dropsTotal,
      cashDrawerClose: drawerClose,
      transferTotal,
      creditTotal,
      laborCash,
      laborCredit,
      notes
    };

    const res = await fetch('/api/revenue/daily-closing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'บันทึกปิดยอดล้มเหลว');
    }

    showToast(`บันทึกปิดยอดรายรับประจำวัน ${data.closing?.closingId || ''} สำเร็จ`);
    switchRevenueTab('history');
  } catch (err) {
    showToast(err.message, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
      refreshIcons();
    }
  }
}

async function loadDailyRevenueHistory() {
  const tbody = document.getElementById('rev-history-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/revenue/daily-closings', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success || !Array.isArray(data.closings) || data.closings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="py-10 text-center text-slate-500">ยังไม่มีประวัติการปิดยอดรายรับ</td></tr>`;
      return;
    }

    revHistoryList = data.closings;
    const fmt = (n) => {
      const num = parseFloat(String(n || '0').replace(/,/g, '')) || 0;
      return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    tbody.innerHTML = revHistoryList.map(c => `
      <tr class="hover:bg-slate-800/60 transition duration-150">
        <td class="py-3 px-3.5 font-mono font-bold text-emerald-400">${c.closingId}</td>
        <td class="py-3 px-3 font-medium text-white">${c.date}</td>
        <td class="py-3 px-3 text-right font-mono text-slate-200">${fmt(c.cashNet)}</td>
        <td class="py-3 px-3 text-right font-mono text-sky-400">${fmt(c.transferTotal)}</td>
        <td class="py-3 px-3 text-right font-mono text-violet-400">${fmt(c.creditTotal)}</td>
        <td class="py-3 px-3 text-right font-mono text-amber-400 font-semibold">${fmt(c.laborTotal)}</td>
        <td class="py-3 px-3 text-right font-mono text-blue-400 font-semibold">${fmt(c.goodsTotal)}</td>
        <td class="py-3 px-3.5 text-right font-mono font-extrabold text-emerald-300">${fmt(c.grandTotal)}</td>
        <td class="py-3 px-3 text-slate-300">${c.recordedBy || '-'}</td>
        <td class="py-3 px-3 text-[11px] text-slate-400 font-mono">${c.recordedAt ? c.recordedAt.split(' ')[0] : '-'}</td>
        <td class="py-3 px-3 text-xs text-slate-400 max-w-xs truncate" title="${c.notes || ''}">${c.notes || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error("loadDailyRevenueHistory error:", err);
    tbody.innerHTML = `<tr><td colspan="11" class="py-10 text-center text-red-400">เกิดข้อผิดพลาดในการโหลดประวัติ: ${err.message}</td></tr>`;
  }
}


