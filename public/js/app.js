// STR ERP Frontend Application

let currentUser = null;
let currentToken = localStorage.getItem('erp_token') || '';
let searchDebounceTimer = null;
let currentPage = 1;
let currentSearchQuery = '';
let currentSupplierFilter = '';
let currentUsersList = [];

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
  'staff': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

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
  const views = ['login', 'dashboard', 'search', 'users', 'logs'];
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
  }

  refreshIcons();
}

// Toast notification
function showToast(msg, isSuccess = true) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');

  toastMsg.innerText = msg;
  toast.className = `fixed bottom-5 right-5 z-50 transition-all duration-300 pointer-events-none bg-slate-800 border ${
    isSuccess ? 'border-emerald-500/50 text-emerald-300' : 'border-red-500/50 text-red-300'
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

function fillAndLogin(u, p) {
  document.getElementById('login-username').value = u;
  document.getElementById('login-password').value = p;
  handleLogin();
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
  const cardIncome = document.getElementById('card-menu-income');
  const cardPurchase = document.getElementById('card-menu-purchase');
  const cardUsers = document.getElementById('card-menu-users');
  const cardLogs = document.getElementById('card-menu-logs');
  const badgeUsersScope = document.getElementById('badge-users-scope');
  const titleUsers = document.getElementById('title-menu-users');
  const descUsers = document.getElementById('desc-menu-users');

  const role = currentUser.role || 'staff';

  if (role === 'staff' || role === 'senior_staff') {
    // พนักงาน: เห็นแค่ 2 เมนู (ค้นหาสินค้า + บันทึกใบส่งของ)
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    cardIncome.classList.add('hidden');
    cardPurchase.classList.add('hidden');
    cardUsers.classList.add('hidden');
    cardLogs.classList.add('hidden');

    roleDesc.innerText = "สิทธิ์พนักงาน: เข้าถึง 2 เมนู (ค้นหาข้อมูลสินค้า และ บันทึกใบส่งของ • ซ่อนราคาทุน)";
    menuScopeBadge.innerText = "พนักงาน: เข้าถึง 2 เมนู";
  } else if (role === 'manager') {
    // ผู้จัดการ: เห็นทั้งหมด และจัดการพนักงานได้
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    cardIncome.classList.remove('hidden');
    cardPurchase.classList.remove('hidden');
    cardUsers.classList.remove('hidden');
    cardLogs.classList.add('hidden');

    badgeUsersScope.innerText = "จัดการพนักงาน";
    titleUsers.innerText = "จัดการพนักงาน";
    descUsers.innerText = "เพิ่ม ลบ แก้ไขสิทธิ์ และรีเซ็ตรหัสผ่านของพนักงานหน้าร้าน";

    roleDesc.innerText = "สิทธิ์ผู้จัดการ: เข้าถึงทุกเมนู, เห็นราคาทุนและผลกำไร, สามารถจัดการบัญชีพนักงานได้";
    menuScopeBadge.innerText = "ผู้จัดการ: สิทธิ์จัดการพนักงาน & เข้าถึงทุกเมนู";
  } else if (role === 'admin') {
    // Admin: เห็นทุกอย่าง + จัดการผู้ใช้ทุกคน + ดู Login Logs
    cardSearch.classList.remove('hidden');
    cardDelivery.classList.remove('hidden');
    cardIncome.classList.remove('hidden');
    cardPurchase.classList.remove('hidden');
    cardUsers.classList.remove('hidden');
    cardLogs.classList.remove('hidden');

    badgeUsersScope.innerText = "จัดการผู้ใช้ทุกคน";
    titleUsers.innerText = "จัดการผู้เข้าใช้ทั้งหมด";
    descUsers.innerText = "จัดการบัญชีผู้ใช้ทุกระดับ (พนักงาน, ผู้จัดการ, แอดมิน)";

    roleDesc.innerText = "สิทธิ์ผู้ดูแลระบบ (Admin): เข้าถึงได้ทุกฟังก์ชันและจัดการผู้ใช้งานได้ทั้งหมด";
    menuScopeBadge.innerText = "ผู้ดูแลระบบ: สิทธิ์ระดับสูงสุด";
  }
}

// ==========================================
// PRODUCT SEARCH VIEW
// ==========================================

function initSearchPage() {
  const isManagerOrAdmin = currentUser && (currentUser.role === 'manager' || currentUser.role === 'admin');
  const thCost = document.getElementById('th-cost-price');
  const costIndicator = document.getElementById('cost-visibility-indicator');
  const costStatusText = document.getElementById('cost-status-text');
  const costIcon = document.getElementById('cost-icon');
  const refreshBtn = document.getElementById('btn-refresh-cache');

  if (isManagerOrAdmin) {
    if (thCost) thCost.classList.remove('hidden');
    if (refreshBtn) refreshBtn.classList.remove('hidden');
    if (costStatusText) costStatusText.innerText = "แสดงราคาทุน (สิทธิ์ผู้จัดการ / Admin)";
    if (costIndicator) costIndicator.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-300";
    if (costIcon) costIcon.setAttribute('data-lucide', 'eye');
  } else {
    if (thCost) thCost.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
    if (costStatusText) costStatusText.innerText = "ซ่อนราคาทุน (สิทธิ์พนักงาน)";
    if (costIndicator) costIndicator.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-900/80 border border-slate-700 text-slate-400";
    if (costIcon) costIcon.setAttribute('data-lucide', 'eye-off');
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

    const stockNum = parseInt(p.stock_qty) || 0;
    const stockBadge = stockNum > 0
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">${p.stock_qty || 0}</span>`
      : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30">หมด</span>`;

    // Desktop Row
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-700/30 transition duration-150';

    let costTd = '';
    if (isManagerOrAdmin) {
      costTd = `
        <td class="py-3 px-4 text-right font-mono">
          <div class="text-xs font-semibold text-amber-400">฿${p.cost_price || '0'}</div>
          ${p.profit && p.profit !== '-' ? `<div class="text-[10px] text-emerald-400 font-medium">+฿${p.profit}</div>` : ''}
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
      <td class="py-3 px-4 text-right font-mono font-bold text-emerald-400 text-sm">
        ฿${p.sale_price || '0'}
      </td>
      <td class="py-3 px-4 text-center">${stockBadge}</td>
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
            <span class="font-mono font-semibold text-amber-400">฿${p.cost_price || '0'}</span>
            ${p.profit && p.profit !== '-' ? `<span class="text-[10px] text-emerald-400 ml-1.5">(กำไร ฿${p.profit})</span>` : ''}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-mono text-xs font-semibold text-emerald-400 select-all">${p.barcode || '-'}</div>
        <div>${stockBadge}</div>
      </div>
      <div class="font-bold text-slate-100 text-sm mb-2 leading-snug">${p.name || '-'}</div>
      <div class="mb-3">${detailsHtml}</div>
      <div class="flex items-center justify-between text-xs pt-2 border-t border-slate-700/60">
        <span class="text-slate-400">ร้านค้า: <strong class="text-slate-200">${p.supplier || '-'}</strong></span>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 mr-1">ราคาขาย:</span>
          <span class="font-mono font-bold text-base text-emerald-400">฿${p.sale_price || '0'}</span>
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
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ใช้งาน</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/30"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span> ระงับ</span>`;

    // Action buttons
    let actionButtons = `
      <button onclick='openUserModal(${JSON.stringify(u)})' class="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition">
        แก้ไข
      </button>
      <button onclick="toggleUserStatus('${u.user_id}', ${u.is_active})" class="px-2.5 py-1 rounded-lg ${u.is_active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'} text-xs transition">
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
    <option value="staff">พนักงานทั่วไป (Staff) - เห็น 2 เมนู, ซ่อนราคาทุน</option>
    <option value="senior_staff">พนักงานอาวุโส (Senior Staff) - เห็น 2 เมนู, ซ่อนราคาทุน</option>
  `;
  if (currentUser.role === 'admin') {
    roleSelect.innerHTML += `
      <option value="manager">ผู้จัดการ (Manager) - เห็นครบ, จัดการพนักงานได้</option>
      <option value="admin">ผู้ดูแลระบบ (Admin) - สิทธิ์ทั้งหมด</option>
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
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400">สำเร็จ</span>`
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
