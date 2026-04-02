'use strict';

// ─── Lightweight i18n system ────────────────────────────────────────────────
// Usage:
//   t('send_to_kitchen')           → "Send to Kitchen" (en) / "送入厨房" (zh)
//   t('item_count', { n: 3 })      → "3 item(s)"
//   setLang('zh')                  → switch language and persist
//   getLang()                      → current language code

const LANG_KEY = 'bkt_lang';
const SUPPORTED_LANGS = ['en', 'zh'];
const DEFAULT_LANG = 'en';

let _currentLang = localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
let _translations = {};
let _onLangChange = [];

const LANG_STRINGS = {
  en: {
    // ── Header / Nav ──
    history: 'History',
    orders: 'Orders',
    kitchen_status: 'Kitchen Status',
    reports: 'Reports',
    maintenance: 'Maint.',
    pay: 'Pay',
    logout: 'Logout',

    // ── Cart panel ──
    select_table: 'Select Table',
    pax: 'pax',
    order: 'Order',
    clear: 'Clear',
    subtotal: 'Subtotal',
    send_to_kitchen: 'Send to Kitchen',
    update_kitchen_order: 'Update Kitchen Order',
    no_items_found: 'No items found',

    // ── Modifier modal ──
    add_to_order: 'Add to Order',
    update_order: 'Update Order',
    special_requests: 'Special requests, allergies…',
    notes: 'Notes',

    // ── Payment ──
    unpaid_bills: 'Unpaid Bills',
    no_unpaid_bills: 'No unpaid bills',
    proceed_to_payment: 'Proceed to Payment →',
    select_payment: 'Select Payment',
    confirm_cash: 'Confirm Cash',
    payment_received: 'Payment Received',
    verify_receipt: 'Verify Receipt',
    verify_receipt_btn: 'Verify Receipt →',
    confirm_payment: 'Confirm Payment',
    confirm_anyway: 'Confirm Anyway',
    processing_ocr: 'Processing OCR...',
    payment_confirmed: '✓ Payment confirmed',
    cash: 'Cash',
    credit_card: 'Credit Card',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go eWallet',
    duitnow: 'DuitNow QR',
    back: '← Back',
    confirm: 'Confirm',
    bill: 'Bill',
    item_s: 'item(s)',
    no_qr_configured: 'No QR or payment link configured.',
    go_to_settings: 'Go to <b>Items → System Settings</b>.',

    // ── History ──
    order_history: 'Order History',
    no_orders_found: 'No orders found',
    all_tables: 'All Tables',
    table: 'Table',
    details: 'Details',
    reorder: 'Reorder',
    items_added_to_order: '↺ Items added to order',

    // ── Toast messages ──
    item_ready: 'ready',
    all_items_ready: '✅ All items ready for {table}!',
    all_items_served: '✅ All items served · {table} — ready for payment',
    admin_reloading: 'Admin updated data — reloading...',
    order_sent: '✓ Order sent to kitchen · {table}',
    order_updated: '✓ Order updated · {table}',
    order_send_error: 'Error sending order — please try again',
    print_failed: '⚠ Thermal print failed — opening browser print',
    allow_popups: '⚠ Allow pop-ups to print order slip',
    search: 'Search…',

    // ── Table picker ──
    has_active_order: 'Has active order',
    current_table: 'Current table',

    // ── Receipt / Print ──
    new_order: 'NEW ORDER',
    order_update: 'ORDER UPDATE',
    cashier: 'Cashier',
    official_receipt: 'Official Receipt',
    receipt: 'RECEIPT',
    receipt_no: 'Receipt No',
    date: 'Date',
    time: 'Time',
    served_by: 'Served by',
    sst: 'SST',
    service: 'Service',
    total: 'TOTAL',
    payment: 'Payment',
    thank_you: 'Thank you for dining with us!',
    come_again: 'Please come again :)',
    test_print: 'TEST PRINT',
    printer_working: 'Printer is working!',

    // ── KDS ──
    in_kitchen: 'In Kitchen',
    all_served: 'All Served',
    cooking: 'Cooking',
    ready: 'Ready',
    served: 'Served',
    refresh: 'Refresh',
    new_order_table: 'New order: {table}',
    order_updated_table: 'Order updated: {table}',

    // ── Items / Admin ──
    add_item: 'Add Item',
    edit_item: 'Edit Item',
    delete: 'Delete',
    edit: 'Edit',
    category: 'Category',
    base_price: 'Base Price',
    name_en: 'Name (EN)',
    name_zh: 'Name (ZH)',
    description_en: 'Description (EN)',
    description_zh: 'Description (ZH)',
    popular: 'Popular',
    available: 'Available',
    save: 'Save',
    cancel: 'Cancel',

    // ── Categories ──
    cat_all: 'All',
    cat_mains: 'Main Dishes',
    cat_addons: 'Add-ons',
    cat_vegetables: 'Vegetables',
    cat_noodles: 'Noodles',
    cat_soup: 'Soup',
    cat_dessert: 'Dessert',
    cat_beverages: 'Beverages',

    // ── Report ──
    sales_summary: 'Sales Summary',
    sales_detail: 'Sales Detail',
    collection: 'Collection',
    item_sales: 'Item Sales',
    today: 'Today',
    yesterday: 'Yesterday',
    this_week: 'This Week',
    this_month: 'This Month',
    custom: 'Custom',
    revenue: 'Revenue',
    avg_order: 'Avg Order',

    // ── Auth ──
    enter_pin: 'Enter PIN',
    login: 'Login',
    invalid_pin: 'Invalid PIN',

    // ── Language ──
    language: 'Language',
    lang_en: 'English',
    lang_zh: '中文',
  },

  zh: {
    // ── Header / Nav ──
    history: '历史',
    orders: '订单',
    kitchen_status: '厨房状态',
    reports: '报告',
    maintenance: '维护',
    pay: '付款',
    logout: '登出',

    // ── Cart panel ──
    select_table: '选择桌号',
    pax: '人',
    order: '订单',
    clear: '清除',
    subtotal: '小计',
    send_to_kitchen: '送入厨房',
    update_kitchen_order: '更新厨房订单',
    no_items_found: '未找到项目',

    // ── Modifier modal ──
    add_to_order: '加入订单',
    update_order: '更新订单',
    special_requests: '特殊要求、过敏…',
    notes: '备注',

    // ── Payment ──
    unpaid_bills: '未付账单',
    no_unpaid_bills: '没有未付账单',
    proceed_to_payment: '前往付款 →',
    select_payment: '选择付款方式',
    confirm_cash: '确认现金',
    payment_received: '已收款',
    verify_receipt: '验证收据',
    verify_receipt_btn: '验证收据 →',
    confirm_payment: '确认付款',
    confirm_anyway: '仍然确认',
    processing_ocr: 'OCR处理中...',
    payment_confirmed: '✓ 付款已确认',
    cash: '现金',
    credit_card: '信用卡',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go 电子钱包',
    duitnow: 'DuitNow QR',
    back: '← 返回',
    confirm: '确认',
    bill: '账单',
    item_s: '项',
    no_qr_configured: '未配置QR码或付款链接。',
    go_to_settings: '请到 <b>项目 → 系统设置</b>。',

    // ── History ──
    order_history: '订单历史',
    no_orders_found: '未找到订单',
    all_tables: '所有桌号',
    table: '桌号',
    details: '详情',
    reorder: '重新点单',
    items_added_to_order: '↺ 已添加到订单',

    // ── Toast messages ──
    item_ready: '已备好',
    all_items_ready: '✅ {table} 所有项目已备好！',
    all_items_served: '✅ {table} 所有项目已上菜 — 可以付款',
    admin_reloading: '管理员已更新数据 — 重新加载中...',
    order_sent: '✓ 订单已送入厨房 · {table}',
    order_updated: '✓ 订单已更新 · {table}',
    order_send_error: '发送订单失败 — 请重试',
    print_failed: '⚠ 热敏打印失败 — 打开浏览器打印',
    allow_popups: '⚠ 请允许弹窗以打印',
    search: '搜索…',

    // ── Table picker ──
    has_active_order: '有进行中的订单',
    current_table: '当前桌号',

    // ── Receipt / Print ──
    new_order: '新订单',
    order_update: '订单更新',
    cashier: '收银员',
    official_receipt: '正式收据',
    receipt: '收据',
    receipt_no: '收据号',
    date: '日期',
    time: '时间',
    served_by: '服务员',
    sst: '销售税',
    service: '服务费',
    total: '总计',
    payment: '付款方式',
    thank_you: '感谢您的光临！',
    come_again: '欢迎再来 :)',
    test_print: '打印测试',
    printer_working: '打印机正常工作！',

    // ── KDS ──
    in_kitchen: '厨房中',
    all_served: '已上菜',
    cooking: '烹饪中',
    ready: '已备好',
    served: '已上菜',
    refresh: '刷新',
    new_order_table: '新订单: {table}',
    order_updated_table: '订单更新: {table}',

    // ── Items / Admin ──
    add_item: '新增项目',
    edit_item: '编辑项目',
    delete: '删除',
    edit: '编辑',
    category: '分类',
    base_price: '基础价格',
    name_en: '名称 (英)',
    name_zh: '名称 (中)',
    description_en: '描述 (英)',
    description_zh: '描述 (中)',
    popular: '热门',
    available: '可用',
    save: '保存',
    cancel: '取消',

    // ── Categories ──
    cat_all: '全部',
    cat_mains: '主菜',
    cat_addons: '加料',
    cat_vegetables: '蔬菜',
    cat_noodles: '面食',
    cat_soup: '汤类',
    cat_dessert: '甜品',
    cat_beverages: '饮料',

    // ── Report ──
    sales_summary: '销售摘要',
    sales_detail: '销售明细',
    collection: '收款',
    item_sales: '项目销售',
    today: '今天',
    yesterday: '昨天',
    this_week: '本周',
    this_month: '本月',
    custom: '自定义',
    revenue: '营收',
    avg_order: '平均订单',

    // ── Auth ──
    enter_pin: '输入PIN',
    login: '登录',
    invalid_pin: 'PIN无效',

    // ── Language ──
    language: '语言',
    lang_en: 'English',
    lang_zh: '中文',
  },
};

// ─── Core functions ─────────────────────────────────────────────────────────

function t(key, params) {
  const dict = LANG_STRINGS[_currentLang] || LANG_STRINGS[DEFAULT_LANG];
  let str = dict[key] || LANG_STRINGS[DEFAULT_LANG][key] || key;
  if (params) {
    Object.keys(params).forEach(k => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
  }
  return str;
}

function getLang() {
  return _currentLang;
}

function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  _currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  _onLangChange.forEach(fn => fn(lang));
}

function onLangChange(fn) {
  _onLangChange.push(fn);
}

// ─── Auto-translate DOM elements with data-i18n ─────────────────────────────
// Add data-i18n="key" to any element to auto-translate its textContent
// Add data-i18n-placeholder="key" for placeholder attributes
// Add data-i18n-title="key" for title attributes

function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// ─── Language switcher widget ───────────────────────────────────────────────
// Call initLangSwitcher(containerId) to insert a language toggle button

function createLangSwitcher() {
  const btn = document.createElement('button');
  btn.className = 'lang-switch-btn';
  btn.id = 'lang-switch-btn';
  btn.title = t('language');
  btn.textContent = _currentLang === 'zh' ? '中文' : 'EN';
  btn.style.cssText = 'color:var(--muted,#aaa);background:none;border:1px solid var(--border,#3a3a55);border-radius:var(--radius,8px);padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600;';
  btn.addEventListener('click', () => {
    const next = _currentLang === 'en' ? 'zh' : 'en';
    setLang(next);
    btn.textContent = next === 'zh' ? '中文' : 'EN';
    translatePage();
  });
  return btn;
}
