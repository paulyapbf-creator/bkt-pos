'use strict';

// ─── Lightweight i18n system ────────────────────────────────────────────────
// Usage:
//   t('send_to_kitchen')           → "Send to Kitchen" (en) / "送入厨房" (zh)
//   t('item_count', { n: 3 })      → "3 item(s)"
//   setLang('zh')                  → switch language and persist
//   getLang()                      → current language code

const LANG_KEY = 'bkt_lang';
const SUPPORTED_LANGS = ['en', 'zh', 'th', 'vi', 'ms', 'km', 'id'];
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

    // ── Admin tabs ──
    items: 'Items',
    users: 'Users',
    system_settings: 'System Settings',
    user_management: 'User Management',
    user_management_hint: 'Manage POS users. Super users have full access; cashiers can only use POS and view items.',
    add_user: 'Add User',
    general_settings: 'General Settings',
    shop_name: 'Shop Name',
    shop_address: 'Shop Address',
    managed_by_admin: 'managed by administrator',
    payment_settings: 'Payment Settings',
    payment_settings_hint: 'Configure payment links and QR codes for e-wallet payments.',
    tng_payment_link: 'Touch & Go eWallet — Payment Link',
    tng_qr_image: 'Touch & Go eWallet — QR Image URL (optional)',
    enable_ewallet_verify: 'Enable e-Wallet Receipt Verification',
    airwallex_card: 'Airwallex Card Payments',
    airwallex_hint: 'Configure Airwallex credentials for credit/debit card payments. Use demo mode for testing.',
    enable_card: 'Enable Credit / Debit Card Payments',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'Environment',
    tax_service: 'Tax & Service Charge',
    tax_service_hint: 'Configure SST and service charge. These appear as a breakdown on bills and receipts.',
    enable_sst: 'Enable SST',
    enable_service: 'Enable Service Charge',
    printer_settings: 'Printer Settings',
    printer_hint: 'Configure a LAN thermal printer (ESC/POS, 80mm). Leave IP empty to use browser print dialog.',
    print_order_slip: 'Print order slip (kitchen)',
    print_receipt: 'Print payment receipt',
    printer_ip: 'Printer IP Address',
    printer_port: 'Printer Port',
    relay_url: 'Local Relay URL (for cloud server)',
    save_settings: 'Save Settings',
    currency_settings: 'Currency Settings',
    currency_hint: 'Set the currency symbol shown on prices. Choose to follow the selected language or use a fixed symbol.',
    currency_follow_lang: 'Follow language default',
    currency_fixed: 'Fixed currency symbol',
    network_info: 'Network Info',
    network_desc: 'Connect other devices on the same WiFi using these addresses:',
    sync_cloud: 'Sync to Cloud',
    sync_desc: 'Manually push all local order history, settings and menu to cloud MongoDB backup.',
    sync_now: 'Sync Now',
    reset_go_live: 'Reset & Go Live',
    reset_desc: 'Clears all active orders, kitchen data, sales history and KDS history. Menu items and payment settings are kept.',
    confirm_action: 'Confirm Action',
    cannot_undo: 'This action cannot be undone.',
    yes_delete: 'Yes, Delete',
    name: 'Name',
    pin: 'PIN (4 digits)',
    role: 'Role',
    cashier_role: 'Cashier',
    super_role: 'Super (Admin)',
    save_user: 'Save User',

    // ── Auth ──
    enter_pin: 'Enter PIN',
    login: 'Login',
    invalid_pin: 'Invalid PIN',

    // ── Language ──
    language: 'Language',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
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

    // ── Admin tabs ──
    items: '项目',
    users: '用户',
    system_settings: '系统设置',
    user_management: '用户管理',
    user_management_hint: '管理POS用户。超级用户拥有完全权限；收银员只能使用POS和查看项目。',
    add_user: '添加用户',
    general_settings: '常规设置',
    shop_name: '店名',
    shop_address: '店铺地址',
    managed_by_admin: '由管理员管理',
    payment_settings: '支付设置',
    payment_settings_hint: '配置电子钱包的支付链接和二维码。',
    tng_payment_link: 'Touch & Go 电子钱包 — 支付链接',
    tng_qr_image: 'Touch & Go 电子钱包 — 二维码图片URL（可选）',
    enable_ewallet_verify: '启用电子钱包收据验证',
    airwallex_card: 'Airwallex 银行卡支付',
    airwallex_hint: '配置Airwallex凭据用于信用卡/借记卡支付。使用演示模式进行测试。',
    enable_card: '启用信用卡/借记卡支付',
    client_id: '客户端ID',
    api_key: 'API密钥',
    environment: '环境',
    tax_service: '税费和服务费',
    tax_service_hint: '配置SST和服务费。这些会在账单和收据上显示为明细。',
    enable_sst: '启用SST',
    enable_service: '启用服务费',
    printer_settings: '打印机设置',
    printer_hint: '配置局域网热敏打印机（ESC/POS, 80mm）。IP留空则使用浏览器打印对话框。',
    print_order_slip: '打印下单小票（厨房）',
    print_receipt: '打印付款收据',
    printer_ip: '打印机IP地址',
    printer_port: '打印机端口',
    relay_url: '本地中继URL（用于云服务器）',
    save_settings: '保存设置',
    currency_settings: '货币设置',
    currency_hint: '设置价格显示的货币符号。选择跟随语言默认或使用固定符号。',
    currency_follow_lang: '跟随语言默认',
    currency_fixed: '固定货币符号',
    network_info: '网络信息',
    network_desc: '使用以下地址连接同一WiFi上的其他设备：',
    sync_cloud: '同步到云端',
    sync_desc: '手动将所有本地订单历史、设置和菜单推送到云端MongoDB备份。',
    sync_now: '立即同步',
    reset_go_live: '重置并上线',
    reset_desc: '清除所有活动订单、厨房数据、销售历史和KDS历史。菜单项目和支付设置将保留。',
    confirm_action: '确认操作',
    cannot_undo: '此操作无法撤销。',
    yes_delete: '是，删除',
    name: '名称',
    pin: 'PIN（4位数字）',
    role: '角色',
    cashier_role: '收银员',
    super_role: '超级管理员',
    save_user: '保存用户',

    // ── Auth ──
    enter_pin: '输入PIN',
    login: '登录',
    invalid_pin: 'PIN无效',

    // ── Language ──
    language: '语言',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
  },

  th: {
    // ── Header / Nav ──
    history: 'ประวัติ',
    orders: 'ออเดอร์',
    kitchen_status: 'สถานะครัว',
    reports: 'รายงาน',
    maintenance: 'ดูแล',
    pay: 'ชำระเงิน',
    logout: 'ออกจากระบบ',

    // ── Cart panel ──
    select_table: 'เลือกโต๊ะ',
    pax: 'คน',
    order: 'ออเดอร์',
    clear: 'ล้าง',
    subtotal: 'รวม',
    send_to_kitchen: 'ส่งเข้าครัว',
    update_kitchen_order: 'อัปเดตออเดอร์ครัว',
    no_items_found: 'ไม่พบรายการ',

    // ── Modifier modal ──
    add_to_order: 'เพิ่มในออเดอร์',
    update_order: 'อัปเดตออเดอร์',
    special_requests: 'คำขอพิเศษ, แพ้อาหาร…',
    notes: 'หมายเหตุ',

    // ── Payment ──
    unpaid_bills: 'บิลค้างชำระ',
    no_unpaid_bills: 'ไม่มีบิลค้างชำระ',
    proceed_to_payment: 'ไปชำระเงิน →',
    select_payment: 'เลือกวิธีชำระเงิน',
    confirm_cash: 'ยืนยันเงินสด',
    payment_received: 'รับเงินแล้ว',
    verify_receipt: 'ตรวจสอบใบเสร็จ',
    verify_receipt_btn: 'ตรวจสอบใบเสร็จ →',
    confirm_payment: 'ยืนยันการชำระเงิน',
    confirm_anyway: 'ยืนยันอยู่ดี',
    processing_ocr: 'กำลังประมวลผล OCR...',
    payment_confirmed: '✓ ชำระเงินแล้ว',
    cash: 'เงินสด',
    credit_card: 'บัตรเครดิต',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go อีวอลเล็ต',
    duitnow: 'DuitNow QR',
    back: '← กลับ',
    confirm: 'ยืนยัน',
    bill: 'บิล',
    item_s: 'รายการ',
    no_qr_configured: 'ยังไม่ได้ตั้งค่า QR หรือลิงก์ชำระเงิน',
    go_to_settings: 'ไปที่ <b>รายการ → ตั้งค่าระบบ</b>',

    // ── History ──
    order_history: 'ประวัติออเดอร์',
    no_orders_found: 'ไม่พบออเดอร์',
    all_tables: 'ทุกโต๊ะ',
    table: 'โต๊ะ',
    details: 'รายละเอียด',
    reorder: 'สั่งอีกครั้ง',
    items_added_to_order: '↺ เพิ่มในออเดอร์แล้ว',

    // ── Toast messages ──
    item_ready: 'พร้อมแล้ว',
    all_items_ready: '✅ รายการทั้งหมดพร้อมแล้ว {table}!',
    all_items_served: '✅ เสิร์ฟครบแล้ว · {table} — พร้อมชำระเงิน',
    admin_reloading: 'แอดมินอัปเดตข้อมูล — กำลังโหลดใหม่...',
    order_sent: '✓ ส่งออเดอร์เข้าครัวแล้ว · {table}',
    order_updated: '✓ อัปเดตออเดอร์แล้ว · {table}',
    order_send_error: 'ส่งออเดอร์ไม่สำเร็จ — ลองอีกครั้ง',
    print_failed: '⚠ พิมพ์ไม่สำเร็จ — เปิดหน้าพิมพ์เบราว์เซอร์',
    allow_popups: '⚠ กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์',
    search: 'ค้นหา…',

    // ── Table picker ──
    has_active_order: 'มีออเดอร์ค้างอยู่',
    current_table: 'โต๊ะปัจจุบัน',

    // ── Receipt / Print ──
    new_order: 'ออเดอร์ใหม่',
    order_update: 'อัปเดตออเดอร์',
    cashier: 'แคชเชียร์',
    official_receipt: 'ใบเสร็จรับเงิน',
    receipt: 'ใบเสร็จ',
    receipt_no: 'เลขที่ใบเสร็จ',
    date: 'วันที่',
    time: 'เวลา',
    served_by: 'พนักงานเสิร์ฟ',
    sst: 'ภาษี',
    service: 'ค่าบริการ',
    total: 'รวมทั้งหมด',
    payment: 'การชำระเงิน',
    thank_you: 'ขอบคุณที่มาทานอาหารกับเรา!',
    come_again: 'เชิญมาอีกนะครับ/ค่ะ :)',
    test_print: 'ทดสอบพิมพ์',
    printer_working: 'เครื่องพิมพ์ทำงานปกติ!',

    // ── KDS ──
    in_kitchen: 'ในครัว',
    all_served: 'เสิร์ฟครบ',
    cooking: 'กำลังทำ',
    ready: 'พร้อม',
    served: 'เสิร์ฟแล้ว',
    refresh: 'รีเฟรช',
    new_order_table: 'ออเดอร์ใหม่: {table}',
    order_updated_table: 'อัปเดตออเดอร์: {table}',

    // ── Items / Admin ──
    add_item: 'เพิ่มรายการ',
    edit_item: 'แก้ไขรายการ',
    delete: 'ลบ',
    edit: 'แก้ไข',
    category: 'หมวดหมู่',
    base_price: 'ราคาพื้นฐาน',
    name_en: 'ชื่อ (EN)',
    name_zh: 'ชื่อ (ZH)',
    description_en: 'คำอธิบาย (EN)',
    description_zh: 'คำอธิบาย (ZH)',
    popular: 'ยอดนิยม',
    available: 'มีจำหน่าย',
    save: 'บันทึก',
    cancel: 'ยกเลิก',

    // ── Categories ──
    cat_all: 'ทั้งหมด',
    cat_mains: 'จานหลัก',
    cat_addons: 'เพิ่มเติม',
    cat_vegetables: 'ผัก',
    cat_noodles: 'เส้น',
    cat_soup: 'ซุป',
    cat_dessert: 'ขนมหวาน',
    cat_beverages: 'เครื่องดื่ม',

    // ── Report ──
    sales_summary: 'สรุปยอดขาย',
    sales_detail: 'รายละเอียดยอดขาย',
    collection: 'ยอดรับ',
    item_sales: 'ยอดขายรายการ',
    today: 'วันนี้',
    yesterday: 'เมื่อวาน',
    this_week: 'สัปดาห์นี้',
    this_month: 'เดือนนี้',
    custom: 'กำหนดเอง',
    revenue: 'รายได้',
    avg_order: 'ออเดอร์เฉลี่ย',

    // ── Admin tabs ──
    items: 'รายการ',
    users: 'ผู้ใช้',
    system_settings: 'ตั้งค่าระบบ',
    user_management: 'จัดการผู้ใช้',
    user_management_hint: 'จัดการผู้ใช้ POS ผู้ใช้ระดับสูงมีสิทธิ์เต็ม แคชเชียร์ใช้ได้เฉพาะ POS และดูรายการ',
    add_user: 'เพิ่มผู้ใช้',
    general_settings: 'ตั้งค่าทั่วไป',
    shop_name: 'ชื่อร้าน',
    shop_address: 'ที่อยู่ร้าน',
    managed_by_admin: 'จัดการโดยผู้ดูแล',
    payment_settings: 'ตั้งค่าการชำระเงิน',
    payment_settings_hint: 'ตั้งค่าลิงก์ชำระเงินและ QR โค้ดสำหรับอีวอลเล็ต',
    tng_payment_link: 'Touch & Go อีวอลเล็ต — ลิงก์ชำระเงิน',
    tng_qr_image: 'Touch & Go อีวอลเล็ต — URL รูป QR (ไม่บังคับ)',
    enable_ewallet_verify: 'เปิดใช้การตรวจสอบใบเสร็จอีวอลเล็ต',
    airwallex_card: 'Airwallex บัตรเครดิต',
    airwallex_hint: 'ตั้งค่า Airwallex สำหรับบัตรเครดิต/เดบิต ใช้โหมดทดสอบเพื่อทดลอง',
    enable_card: 'เปิดใช้บัตรเครดิต/เดบิต',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'สภาพแวดล้อม',
    tax_service: 'ภาษีและค่าบริการ',
    tax_service_hint: 'ตั้งค่า SST และค่าบริการ จะแสดงในบิลและใบเสร็จ',
    enable_sst: 'เปิดใช้ SST',
    enable_service: 'เปิดใช้ค่าบริการ',
    printer_settings: 'ตั้งค่าเครื่องพิมพ์',
    printer_hint: 'ตั้งค่าเครื่องพิมพ์ความร้อน LAN (ESC/POS, 80mm) เว้น IP ว่างเพื่อใช้การพิมพ์ของเบราว์เซอร์',
    print_order_slip: 'พิมพ์ใบสั่งอาหาร (ครัว)',
    print_receipt: 'พิมพ์ใบเสร็จชำระเงิน',
    printer_ip: 'IP เครื่องพิมพ์',
    printer_port: 'พอร์ตเครื่องพิมพ์',
    relay_url: 'URL รีเลย์ (สำหรับเซิร์ฟเวอร์คลาวด์)',
    save_settings: 'บันทึกการตั้งค่า',
    currency_settings: 'ตั้งค่าสกุลเงิน',
    currency_hint: 'ตั้งค่าสัญลักษณ์สกุลเงินที่แสดงบนราคา เลือกตามภาษาหรือใช้สัญลักษณ์คงที่',
    currency_follow_lang: 'ตามภาษาที่เลือก',
    currency_fixed: 'สัญลักษณ์คงที่',
    network_info: 'ข้อมูลเครือข่าย',
    network_desc: 'เชื่อมต่ออุปกรณ์อื่นบน WiFi เดียวกันด้วยที่อยู่เหล่านี้:',
    sync_cloud: 'ซิงค์ไปคลาวด์',
    sync_desc: 'ส่งข้อมูลออเดอร์ ตั้งค่า และเมนูทั้งหมดไปยัง MongoDB สำรอง',
    sync_now: 'ซิงค์เลย',
    reset_go_live: 'รีเซ็ตและเริ่มใช้งาน',
    reset_desc: 'ล้างออเดอร์ ข้อมูลครัว ประวัติขาย และ KDS รายการเมนูและตั้งค่าการชำระเงินจะยังอยู่',
    confirm_action: 'ยืนยันการดำเนินการ',
    cannot_undo: 'การดำเนินการนี้ไม่สามารถย้อนกลับได้',
    yes_delete: 'ใช่ ลบ',
    name: 'ชื่อ',
    pin: 'PIN (4 หลัก)',
    role: 'บทบาท',
    cashier_role: 'แคชเชียร์',
    super_role: 'ซูเปอร์ (แอดมิน)',
    save_user: 'บันทึกผู้ใช้',

    // ── Auth ──
    enter_pin: 'กรอก PIN',
    login: 'เข้าสู่ระบบ',
    invalid_pin: 'PIN ไม่ถูกต้อง',

    // ── Language ──
    language: 'ภาษา',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
  },

  vi: {
    // ── Header / Nav ──
    history: 'Lịch sử',
    orders: 'Đơn hàng',
    kitchen_status: 'Trạng thái bếp',
    reports: 'Báo cáo',
    maintenance: 'Bảo trì',
    pay: 'Thanh toán',
    logout: 'Đăng xuất',

    // ── Cart panel ──
    select_table: 'Chọn bàn',
    pax: 'khách',
    order: 'Đơn',
    clear: 'Xóa',
    subtotal: 'Tạm tính',
    send_to_kitchen: 'Gửi vào bếp',
    update_kitchen_order: 'Cập nhật đơn bếp',
    no_items_found: 'Không tìm thấy món',

    // ── Modifier modal ──
    add_to_order: 'Thêm vào đơn',
    update_order: 'Cập nhật đơn',
    special_requests: 'Yêu cầu đặc biệt, dị ứng…',
    notes: 'Ghi chú',

    // ── Payment ──
    unpaid_bills: 'Hóa đơn chưa thanh toán',
    no_unpaid_bills: 'Không có hóa đơn chưa thanh toán',
    proceed_to_payment: 'Thanh toán →',
    select_payment: 'Chọn phương thức',
    confirm_cash: 'Xác nhận tiền mặt',
    payment_received: 'Đã nhận tiền',
    verify_receipt: 'Xác minh biên lai',
    verify_receipt_btn: 'Xác minh biên lai →',
    confirm_payment: 'Xác nhận thanh toán',
    confirm_anyway: 'Vẫn xác nhận',
    processing_ocr: 'Đang xử lý OCR...',
    payment_confirmed: '✓ Đã thanh toán',
    cash: 'Tiền mặt',
    credit_card: 'Thẻ tín dụng',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go eWallet',
    duitnow: 'DuitNow QR',
    back: '← Quay lại',
    confirm: 'Xác nhận',
    bill: 'Hóa đơn',
    item_s: 'món',
    no_qr_configured: 'Chưa cấu hình QR hoặc liên kết thanh toán.',
    go_to_settings: 'Vào <b>Món → Cài đặt hệ thống</b>.',

    // ── History ──
    order_history: 'Lịch sử đơn hàng',
    no_orders_found: 'Không tìm thấy đơn hàng',
    all_tables: 'Tất cả bàn',
    table: 'Bàn',
    details: 'Chi tiết',
    reorder: 'Đặt lại',
    items_added_to_order: '↺ Đã thêm vào đơn',

    // ── Toast messages ──
    item_ready: 'sẵn sàng',
    all_items_ready: '✅ Tất cả món đã sẵn sàng {table}!',
    all_items_served: '✅ Đã phục vụ xong · {table} — sẵn sàng thanh toán',
    admin_reloading: 'Admin đã cập nhật — đang tải lại...',
    order_sent: '✓ Đã gửi đơn vào bếp · {table}',
    order_updated: '✓ Đã cập nhật đơn · {table}',
    order_send_error: 'Gửi đơn thất bại — vui lòng thử lại',
    print_failed: '⚠ In nhiệt thất bại — mở in trình duyệt',
    allow_popups: '⚠ Cho phép popup để in',
    search: 'Tìm kiếm…',

    // ── Table picker ──
    has_active_order: 'Có đơn đang xử lý',
    current_table: 'Bàn hiện tại',

    // ── Receipt / Print ──
    new_order: 'ĐƠN MỚI',
    order_update: 'CẬP NHẬT ĐƠN',
    cashier: 'Thu ngân',
    official_receipt: 'Hóa đơn chính thức',
    receipt: 'BIÊN LAI',
    receipt_no: 'Số biên lai',
    date: 'Ngày',
    time: 'Giờ',
    served_by: 'Phục vụ',
    sst: 'Thuế',
    service: 'Phí dịch vụ',
    total: 'TỔNG CỘNG',
    payment: 'Thanh toán',
    thank_you: 'Cảm ơn quý khách!',
    come_again: 'Hẹn gặp lại :)',
    test_print: 'IN THỬ',
    printer_working: 'Máy in hoạt động tốt!',

    // ── KDS ──
    in_kitchen: 'Trong bếp',
    all_served: 'Đã phục vụ',
    cooking: 'Đang nấu',
    ready: 'Sẵn sàng',
    served: 'Đã phục vụ',
    refresh: 'Làm mới',
    new_order_table: 'Đơn mới: {table}',
    order_updated_table: 'Cập nhật đơn: {table}',

    // ── Items / Admin ──
    add_item: 'Thêm món',
    edit_item: 'Sửa món',
    delete: 'Xóa',
    edit: 'Sửa',
    category: 'Danh mục',
    base_price: 'Giá gốc',
    name_en: 'Tên (EN)',
    name_zh: 'Tên (ZH)',
    description_en: 'Mô tả (EN)',
    description_zh: 'Mô tả (ZH)',
    popular: 'Phổ biến',
    available: 'Có sẵn',
    save: 'Lưu',
    cancel: 'Hủy',

    // ── Categories ──
    cat_all: 'Tất cả',
    cat_mains: 'Món chính',
    cat_addons: 'Thêm',
    cat_vegetables: 'Rau',
    cat_noodles: 'Mì/Phở',
    cat_soup: 'Súp',
    cat_dessert: 'Tráng miệng',
    cat_beverages: 'Đồ uống',

    // ── Report ──
    sales_summary: 'Tổng hợp doanh thu',
    sales_detail: 'Chi tiết doanh thu',
    collection: 'Thu',
    item_sales: 'Doanh thu theo món',
    today: 'Hôm nay',
    yesterday: 'Hôm qua',
    this_week: 'Tuần này',
    this_month: 'Tháng này',
    custom: 'Tùy chọn',
    revenue: 'Doanh thu',
    avg_order: 'Đơn TB',

    // ── Admin tabs ──
    items: 'Món',
    users: 'Người dùng',
    system_settings: 'Cài đặt hệ thống',
    user_management: 'Quản lý người dùng',
    user_management_hint: 'Quản lý người dùng POS. Người dùng cấp cao có toàn quyền; thu ngân chỉ dùng POS và xem món.',
    add_user: 'Thêm người dùng',
    general_settings: 'Cài đặt chung',
    shop_name: 'Tên cửa hàng',
    shop_address: 'Địa chỉ cửa hàng',
    managed_by_admin: 'do quản trị viên quản lý',
    payment_settings: 'Cài đặt thanh toán',
    payment_settings_hint: 'Cấu hình liên kết thanh toán và mã QR cho ví điện tử.',
    tng_payment_link: 'Touch & Go eWallet — Liên kết thanh toán',
    tng_qr_image: 'Touch & Go eWallet — URL hình QR (tùy chọn)',
    enable_ewallet_verify: 'Bật xác minh biên lai ví điện tử',
    airwallex_card: 'Airwallex Thẻ tín dụng',
    airwallex_hint: 'Cấu hình Airwallex cho thanh toán thẻ tín dụng/ghi nợ. Dùng chế độ demo để thử.',
    enable_card: 'Bật thanh toán thẻ tín dụng/ghi nợ',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'Môi trường',
    tax_service: 'Thuế & Phí dịch vụ',
    tax_service_hint: 'Cấu hình thuế và phí dịch vụ. Hiển thị trên hóa đơn và biên lai.',
    enable_sst: 'Bật thuế SST',
    enable_service: 'Bật phí dịch vụ',
    printer_settings: 'Cài đặt máy in',
    printer_hint: 'Cấu hình máy in nhiệt LAN (ESC/POS, 80mm). Để trống IP để dùng in trình duyệt.',
    print_order_slip: 'In phiếu đơn hàng (bếp)',
    print_receipt: 'In biên lai thanh toán',
    printer_ip: 'Địa chỉ IP máy in',
    printer_port: 'Cổng máy in',
    relay_url: 'URL relay nội bộ (cho máy chủ cloud)',
    save_settings: 'Lưu cài đặt',
    currency_settings: 'Cài đặt tiền tệ',
    currency_hint: 'Đặt ký hiệu tiền tệ hiển thị trên giá. Chọn theo ngôn ngữ hoặc dùng ký hiệu cố định.',
    currency_follow_lang: 'Theo ngôn ngữ mặc định',
    currency_fixed: 'Ký hiệu cố định',
    network_info: 'Thông tin mạng',
    network_desc: 'Kết nối thiết bị khác trên cùng WiFi bằng địa chỉ này:',
    sync_cloud: 'Đồng bộ lên cloud',
    sync_desc: 'Đẩy toàn bộ lịch sử đơn, cài đặt và menu lên MongoDB sao lưu.',
    sync_now: 'Đồng bộ ngay',
    reset_go_live: 'Đặt lại & Bắt đầu',
    reset_desc: 'Xóa tất cả đơn, dữ liệu bếp, lịch sử bán hàng và KDS. Menu và cài đặt thanh toán được giữ lại.',
    confirm_action: 'Xác nhận hành động',
    cannot_undo: 'Hành động này không thể hoàn tác.',
    yes_delete: 'Có, Xóa',
    name: 'Tên',
    pin: 'PIN (4 chữ số)',
    role: 'Vai trò',
    cashier_role: 'Thu ngân',
    super_role: 'Quản lý (Admin)',
    save_user: 'Lưu người dùng',

    // ── Auth ──
    enter_pin: 'Nhập PIN',
    login: 'Đăng nhập',
    invalid_pin: 'PIN không hợp lệ',

    // ── Language ──
    language: 'Ngôn ngữ',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
  },

  ms: {
    // ── Header / Nav ──
    history: 'Sejarah',
    orders: 'Pesanan',
    kitchen_status: 'Status Dapur',
    reports: 'Laporan',
    maintenance: 'Selenggara',
    pay: 'Bayar',
    logout: 'Log Keluar',

    // ── Cart panel ──
    select_table: 'Pilih Meja',
    pax: 'orang',
    order: 'Pesanan',
    clear: 'Kosongkan',
    subtotal: 'Jumlah Kecil',
    send_to_kitchen: 'Hantar ke Dapur',
    update_kitchen_order: 'Kemaskini Pesanan Dapur',
    no_items_found: 'Tiada item dijumpai',

    // ── Modifier modal ──
    add_to_order: 'Tambah ke Pesanan',
    update_order: 'Kemaskini Pesanan',
    special_requests: 'Permintaan khas, alahan…',
    notes: 'Nota',

    // ── Payment ──
    unpaid_bills: 'Bil Belum Bayar',
    no_unpaid_bills: 'Tiada bil belum bayar',
    proceed_to_payment: 'Teruskan Bayaran →',
    select_payment: 'Pilih Pembayaran',
    confirm_cash: 'Sahkan Tunai',
    payment_received: 'Bayaran Diterima',
    verify_receipt: 'Sahkan Resit',
    verify_receipt_btn: 'Sahkan Resit →',
    confirm_payment: 'Sahkan Pembayaran',
    confirm_anyway: 'Sahkan Juga',
    processing_ocr: 'Memproses OCR...',
    payment_confirmed: '✓ Bayaran disahkan',
    cash: 'Tunai',
    credit_card: 'Kad Kredit',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go eWallet',
    duitnow: 'DuitNow QR',
    back: '← Kembali',
    confirm: 'Sahkan',
    bill: 'Bil',
    item_s: 'item',
    no_qr_configured: 'QR atau pautan bayaran belum dikonfigurasi.',
    go_to_settings: 'Pergi ke <b>Item → Tetapan Sistem</b>.',

    // ── History ──
    order_history: 'Sejarah Pesanan',
    no_orders_found: 'Tiada pesanan dijumpai',
    all_tables: 'Semua Meja',
    table: 'Meja',
    details: 'Butiran',
    reorder: 'Pesan Semula',
    items_added_to_order: '↺ Item ditambah ke pesanan',

    // ── Toast messages ──
    item_ready: 'sedia',
    all_items_ready: '✅ Semua item sedia untuk {table}!',
    all_items_served: '✅ Semua item dihidang · {table} — sedia untuk bayar',
    admin_reloading: 'Admin kemaskini data — memuat semula...',
    order_sent: '✓ Pesanan dihantar ke dapur · {table}',
    order_updated: '✓ Pesanan dikemaskini · {table}',
    order_send_error: 'Gagal hantar pesanan — sila cuba lagi',
    print_failed: '⚠ Cetak gagal — membuka cetakan pelayar',
    allow_popups: '⚠ Benarkan popup untuk mencetak',
    search: 'Cari…',

    // ── Table picker ──
    has_active_order: 'Ada pesanan aktif',
    current_table: 'Meja semasa',

    // ── Receipt / Print ──
    new_order: 'PESANAN BARU',
    order_update: 'KEMASKINI PESANAN',
    cashier: 'Juruwang',
    official_receipt: 'Resit Rasmi',
    receipt: 'RESIT',
    receipt_no: 'No Resit',
    date: 'Tarikh',
    time: 'Masa',
    served_by: 'Dilayan oleh',
    sst: 'SST',
    service: 'Perkhidmatan',
    total: 'JUMLAH',
    payment: 'Pembayaran',
    thank_you: 'Terima kasih kerana menjamu selera!',
    come_again: 'Sila datang lagi :)',
    test_print: 'CETAK UJI',
    printer_working: 'Pencetak berfungsi!',

    // ── KDS ──
    in_kitchen: 'Dalam Dapur',
    all_served: 'Semua Dihidang',
    cooking: 'Memasak',
    ready: 'Sedia',
    served: 'Dihidang',
    refresh: 'Muat Semula',
    new_order_table: 'Pesanan baru: {table}',
    order_updated_table: 'Pesanan dikemaskini: {table}',

    // ── Items / Admin ──
    add_item: 'Tambah Item',
    edit_item: 'Edit Item',
    delete: 'Padam',
    edit: 'Edit',
    category: 'Kategori',
    base_price: 'Harga Asas',
    name_en: 'Nama (EN)',
    name_zh: 'Nama (ZH)',
    description_en: 'Penerangan (EN)',
    description_zh: 'Penerangan (ZH)',
    popular: 'Popular',
    available: 'Tersedia',
    save: 'Simpan',
    cancel: 'Batal',

    // ── Categories ──
    cat_all: 'Semua',
    cat_mains: 'Hidangan Utama',
    cat_addons: 'Tambahan',
    cat_vegetables: 'Sayur',
    cat_noodles: 'Mi',
    cat_soup: 'Sup',
    cat_dessert: 'Pencuci Mulut',
    cat_beverages: 'Minuman',

    // ── Report ──
    sales_summary: 'Ringkasan Jualan',
    sales_detail: 'Butiran Jualan',
    collection: 'Kutipan',
    item_sales: 'Jualan Item',
    today: 'Hari Ini',
    yesterday: 'Semalam',
    this_week: 'Minggu Ini',
    this_month: 'Bulan Ini',
    custom: 'Tersuai',
    revenue: 'Hasil',
    avg_order: 'Pesanan Purata',

    // ── Admin tabs ──
    items: 'Item',
    users: 'Pengguna',
    system_settings: 'Tetapan Sistem',
    user_management: 'Pengurusan Pengguna',
    user_management_hint: 'Urus pengguna POS. Pengguna super mempunyai akses penuh; juruwang hanya boleh guna POS dan lihat item.',
    add_user: 'Tambah Pengguna',
    general_settings: 'Tetapan Umum',
    shop_name: 'Nama Kedai',
    shop_address: 'Alamat Kedai',
    managed_by_admin: 'diurus oleh pentadbir',
    payment_settings: 'Tetapan Pembayaran',
    payment_settings_hint: 'Konfigurasi pautan bayaran dan kod QR untuk e-wallet.',
    tng_payment_link: 'Touch & Go eWallet — Pautan Bayaran',
    tng_qr_image: 'Touch & Go eWallet — URL Imej QR (pilihan)',
    enable_ewallet_verify: 'Aktifkan Pengesahan Resit eWallet',
    airwallex_card: 'Airwallex Kad Kredit',
    airwallex_hint: 'Konfigurasi Airwallex untuk kad kredit/debit. Guna mod demo untuk ujian.',
    enable_card: 'Aktifkan Bayaran Kad Kredit/Debit',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'Persekitaran',
    tax_service: 'Cukai & Caj Perkhidmatan',
    tax_service_hint: 'Konfigurasi SST dan caj perkhidmatan. Dipaparkan pada bil dan resit.',
    enable_sst: 'Aktifkan SST',
    enable_service: 'Aktifkan Caj Perkhidmatan',
    printer_settings: 'Tetapan Pencetak',
    printer_hint: 'Konfigurasi pencetak terma LAN (ESC/POS, 80mm). Kosongkan IP untuk guna cetak pelayar.',
    print_order_slip: 'Cetak slip pesanan (dapur)',
    print_receipt: 'Cetak resit bayaran',
    printer_ip: 'Alamat IP Pencetak',
    printer_port: 'Port Pencetak',
    relay_url: 'URL Relay Tempatan (untuk pelayan awan)',
    save_settings: 'Simpan Tetapan',
    currency_settings: 'Tetapan Mata Wang',
    currency_hint: 'Tetapkan simbol mata wang pada harga. Pilih ikut bahasa atau guna simbol tetap.',
    currency_follow_lang: 'Ikut bahasa lalai',
    currency_fixed: 'Simbol mata wang tetap',
    network_info: 'Maklumat Rangkaian',
    network_desc: 'Sambungkan peranti lain pada WiFi yang sama menggunakan alamat ini:',
    sync_cloud: 'Segerak ke Awan',
    sync_desc: 'Tolak semua sejarah pesanan, tetapan dan menu ke sandaran MongoDB awan.',
    sync_now: 'Segerak Sekarang',
    reset_go_live: 'Set Semula & Mula',
    reset_desc: 'Padam semua pesanan aktif, data dapur, sejarah jualan dan KDS. Item menu dan tetapan bayaran dikekalkan.',
    confirm_action: 'Sahkan Tindakan',
    cannot_undo: 'Tindakan ini tidak boleh dibatalkan.',
    yes_delete: 'Ya, Padam',
    name: 'Nama',
    pin: 'PIN (4 digit)',
    role: 'Peranan',
    cashier_role: 'Juruwang',
    super_role: 'Super (Admin)',
    save_user: 'Simpan Pengguna',

    // ── Auth ──
    enter_pin: 'Masukkan PIN',
    login: 'Log Masuk',
    invalid_pin: 'PIN tidak sah',

    // ── Language ──
    language: 'Bahasa',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
  },

  km: {
    // ── Header / Nav ──
    history: 'ប្រវត្តិ',
    orders: 'ការបញ្ជា',
    kitchen_status: 'ស្ថានភាពផ្ទះបាយ',
    reports: 'របាយការណ៍',
    maintenance: 'ថែទាំ',
    pay: 'បង់ប្រាក់',
    logout: 'ចាកចេញ',

    // ── Cart panel ──
    select_table: 'ជ្រើសតុ',
    pax: 'នាក់',
    order: 'ការបញ្ជា',
    clear: 'សម្អាត',
    subtotal: 'សរុបរង',
    send_to_kitchen: 'ផ្ញើទៅផ្ទះបាយ',
    update_kitchen_order: 'ធ្វើបច្ចុប្បន្នភាពការបញ្ជា',
    no_items_found: 'រកមិនឃើញមុខម្ហូប',

    // ── Modifier modal ──
    add_to_order: 'បន្ថែមក្នុងការបញ្ជា',
    update_order: 'ធ្វើបច្ចុប្បន្នភាព',
    special_requests: 'សំណើពិសេស, អាឡែស៊ី…',
    notes: 'កំណត់ចំណាំ',

    // ── Payment ──
    unpaid_bills: 'វិក្កយបត្រមិនទាន់បង់',
    no_unpaid_bills: 'គ្មានវិក្កយបត្រមិនទាន់បង់',
    proceed_to_payment: 'បន្តបង់ប្រាក់ →',
    select_payment: 'ជ្រើសវិធីបង់ប្រាក់',
    confirm_cash: 'បញ្ជាក់សាច់ប្រាក់',
    payment_received: 'បានទទួលប្រាក់',
    verify_receipt: 'ផ្ទៀងផ្ទាត់បង្កាន់ដៃ',
    verify_receipt_btn: 'ផ្ទៀងផ្ទាត់បង្កាន់ដៃ →',
    confirm_payment: 'បញ្ជាក់ការបង់ប្រាក់',
    confirm_anyway: 'បញ្ជាក់ទោះជាយ៉ាងណា',
    processing_ocr: 'កំពុងដំណើរការ OCR...',
    payment_confirmed: '✓ បានបង់ប្រាក់រួច',
    cash: 'សាច់ប្រាក់',
    credit_card: 'កាតឥណទាន',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go eWallet',
    duitnow: 'DuitNow QR',
    back: '← ត្រឡប់',
    confirm: 'បញ្ជាក់',
    bill: 'វិក្កយបត្រ',
    item_s: 'មុខ',
    no_qr_configured: 'មិនទាន់កំណត់ QR ឬតំណបង់ប្រាក់។',
    go_to_settings: 'ទៅ <b>មុខម្ហូប → ការកំណត់ប្រព័ន្ធ</b>។',

    // ── History ──
    order_history: 'ប្រវត្តិការបញ្ជា',
    no_orders_found: 'រកមិនឃើញការបញ្ជា',
    all_tables: 'តុទាំងអស់',
    table: 'តុ',
    details: 'ព័ត៌មានលម្អិត',
    reorder: 'បញ្ជាម្តងទៀត',
    items_added_to_order: '↺ បានបន្ថែមក្នុងការបញ្ជា',

    // ── Toast messages ──
    item_ready: 'រួចរាល់',
    all_items_ready: '✅ មុខម្ហូបទាំងអស់រួចរាល់ {table}!',
    all_items_served: '✅ រៀបចំគ្រប់មុខ · {table} — រង់ចាំបង់ប្រាក់',
    admin_reloading: 'Admin ធ្វើបច្ចុប្បន្នភាព — កំពុងផ្ទុកឡើងវិញ...',
    order_sent: '✓ បានផ្ញើការបញ្ជាទៅផ្ទះបាយ · {table}',
    order_updated: '✓ បានធ្វើបច្ចុប្បន្នភាព · {table}',
    order_send_error: 'ផ្ញើការបញ្ជាមិនបាន — សូមព្យាយាមម្តងទៀត',
    print_failed: '⚠ បោះពុម្ពមិនបាន — បើកបោះពុម្ពកម្មវិធីរុករក',
    allow_popups: '⚠ សូមអនុញ្ញាត popup ដើម្បីបោះពុម្ព',
    search: 'ស្វែងរក…',

    // ── Table picker ──
    has_active_order: 'មានការបញ្ជាកំពុងដំណើរការ',
    current_table: 'តុបច្ចុប្បន្ន',

    // ── Receipt / Print ──
    new_order: 'ការបញ្ជាថ្មី',
    order_update: 'ធ្វើបច្ចុប្បន្នភាពការបញ្ជា',
    cashier: 'អ្នកគិតលុយ',
    official_receipt: 'បង្កាន់ដៃផ្លូវការ',
    receipt: 'បង្កាន់ដៃ',
    receipt_no: 'លេខបង្កាន់ដៃ',
    date: 'កាលបរិច្ឆេទ',
    time: 'ម៉ោង',
    served_by: 'បម្រើដោយ',
    sst: 'ពន្ធ',
    service: 'សេវាកម្ម',
    total: 'សរុប',
    payment: 'ការបង់ប្រាក់',
    thank_you: 'អរគុណសម្រាប់ការមកទទួលទានអាហារ!',
    come_again: 'សូមអញ្ជើញមកម្តងទៀត :)',
    test_print: 'សាកល្បងបោះពុម្ព',
    printer_working: 'ម៉ាស៊ីនបោះពុម្ពដំណើរការល្អ!',

    // ── KDS ──
    in_kitchen: 'ក្នុងផ្ទះបាយ',
    all_served: 'បម្រើគ្រប់មុខ',
    cooking: 'កំពុងចម្អិន',
    ready: 'រួចរាល់',
    served: 'បម្រើរួច',
    refresh: 'ផ្ទុកឡើងវិញ',
    new_order_table: 'ការបញ្ជាថ្មី: {table}',
    order_updated_table: 'ធ្វើបច្ចុប្បន្នភាព: {table}',

    // ── Items / Admin ──
    add_item: 'បន្ថែមមុខម្ហូប',
    edit_item: 'កែមុខម្ហូប',
    delete: 'លុប',
    edit: 'កែ',
    category: 'ប្រភេទ',
    base_price: 'តម្លៃមូលដ្ឋាន',
    name_en: 'ឈ្មោះ (EN)',
    name_zh: 'ឈ្មោះ (ZH)',
    description_en: 'ការពិពណ៌នា (EN)',
    description_zh: 'ការពិពណ៌នា (ZH)',
    popular: 'ពេញនិយម',
    available: 'មាន',
    save: 'រក្សាទុក',
    cancel: 'បោះបង់',

    // ── Categories ──
    cat_all: 'ទាំងអស់',
    cat_mains: 'មុខម្ហូបមេ',
    cat_addons: 'បន្ថែម',
    cat_vegetables: 'បន្លែ',
    cat_noodles: 'មី',
    cat_soup: 'ស៊ុប',
    cat_dessert: 'បង្អែម',
    cat_beverages: 'ភេសជ្ជៈ',

    // ── Report ──
    sales_summary: 'សង្ខេបការលក់',
    sales_detail: 'ព័ត៌មានលម្អិតការលក់',
    collection: 'ការប្រមូល',
    item_sales: 'ការលក់តាមមុខម្ហូប',
    today: 'ថ្ងៃនេះ',
    yesterday: 'ម្សិលមិញ',
    this_week: 'សប្តាហ៍នេះ',
    this_month: 'ខែនេះ',
    custom: 'កំណត់ផ្ទាល់',
    revenue: 'ចំណូល',
    avg_order: 'ការបញ្ជាមធ្យម',

    // ── Admin tabs ──
    items: 'មុខម្ហូប',
    users: 'អ្នកប្រើប្រាស់',
    system_settings: 'ការកំណត់ប្រព័ន្ធ',
    user_management: 'គ្រប់គ្រងអ្នកប្រើប្រាស់',
    user_management_hint: 'គ្រប់គ្រងអ្នកប្រើប្រាស់ POS។ អ្នកប្រើប្រាស់កម្រិតខ្ពស់មានសិទ្ធិពេញ អ្នកគិតលុយប្រើបានតែ POS និងមើលមុខម្ហូប។',
    add_user: 'បន្ថែមអ្នកប្រើប្រាស់',
    general_settings: 'ការកំណត់ទូទៅ',
    shop_name: 'ឈ្មោះហាង',
    shop_address: 'អាសយដ្ឋានហាង',
    managed_by_admin: 'គ្រប់គ្រងដោយអ្នកគ្រប់គ្រង',
    payment_settings: 'ការកំណត់ការបង់ប្រាក់',
    payment_settings_hint: 'កំណត់តំណបង់ប្រាក់និង QR កូដសម្រាប់កាបូបអេឡិចត្រូនិច។',
    tng_payment_link: 'Touch & Go eWallet — តំណបង់ប្រាក់',
    tng_qr_image: 'Touch & Go eWallet — URL រូប QR (ជម្រើស)',
    enable_ewallet_verify: 'បើកការផ្ទៀងផ្ទាត់បង្កាន់ដៃកាបូបអេឡិចត្រូនិច',
    airwallex_card: 'Airwallex កាតឥណទាន',
    airwallex_hint: 'កំណត់ Airwallex សម្រាប់កាតឥណទាន/ឥណពន្ធ។ ប្រើមុខងារសាកល្បង។',
    enable_card: 'បើកការបង់ប្រាក់តាមកាតឥណទាន/ឥណពន្ធ',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'បរិស្ថាន',
    tax_service: 'ពន្ធ និងសេវាកម្ម',
    tax_service_hint: 'កំណត់ពន្ធនិងសេវាកម្ម។ បង្ហាញក្នុងវិក្កយបត្រនិងបង្កាន់ដៃ។',
    enable_sst: 'បើកពន្ធ SST',
    enable_service: 'បើកសេវាកម្ម',
    printer_settings: 'ការកំណត់ម៉ាស៊ីនបោះពុម្ព',
    printer_hint: 'កំណត់ម៉ាស៊ីនបោះពុម្ព LAN (ESC/POS, 80mm)។ ទុក IP ទទេដើម្បីប្រើកម្មវិធីរុករក។',
    print_order_slip: 'បោះពុម្ពស្លីបការបញ្ជា (ផ្ទះបាយ)',
    print_receipt: 'បោះពុម្ពបង្កាន់ដៃបង់ប្រាក់',
    printer_ip: 'អាសយដ្ឋាន IP ម៉ាស៊ីនបោះពុម្ព',
    printer_port: 'ច្រកម៉ាស៊ីនបោះពុម្ព',
    relay_url: 'URL Relay មូលដ្ឋាន (សម្រាប់ម៉ាស៊ីនមេពពក)',
    save_settings: 'រក្សាទុកការកំណត់',
    currency_settings: 'ការកំណត់រូបិយប័ណ្ណ',
    currency_hint: 'កំណត់និមិត្តសញ្ញារូបិយប័ណ្ណលើតម្លៃ។ ជ្រើសតាមភាសា ឬប្រើនិមិត្តសញ្ញាថេរ។',
    currency_follow_lang: 'តាមភាសាលំនាំដើម',
    currency_fixed: 'និមិត្តសញ្ញាថេរ',
    network_info: 'ព័ត៌មានបណ្តាញ',
    network_desc: 'ភ្ជាប់ឧបករណ៍ផ្សេងលើ WiFi តែមួយដោយប្រើអាសយដ្ឋានទាំងនេះ:',
    sync_cloud: 'ធ្វើសមកាលកម្មទៅពពក',
    sync_desc: 'ផ្ញើប្រវត្តិការបញ្ជា ការកំណត់ និងម៉ឺនុយទៅ MongoDB បម្រុងទុក។',
    sync_now: 'ធ្វើសមកាលកម្មឥឡូវ',
    reset_go_live: 'កំណត់ឡើងវិញ និងចាប់ផ្តើម',
    reset_desc: 'លុបការបញ្ជាទាំងអស់ ទិន្នន័យផ្ទះបាយ ប្រវត្តិលក់ និង KDS។ មុខម្ហូបនិងការកំណត់បង់ប្រាក់នឹងរក្សាទុក។',
    confirm_action: 'បញ្ជាក់សកម្មភាព',
    cannot_undo: 'សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។',
    yes_delete: 'បាទ/ចាស លុប',
    name: 'ឈ្មោះ',
    pin: 'PIN (៤ ខ្ទង់)',
    role: 'តួនាទី',
    cashier_role: 'អ្នកគិតលុយ',
    super_role: 'កម្រិតខ្ពស់ (Admin)',
    save_user: 'រក្សាទុកអ្នកប្រើប្រាស់',

    // ── Auth ──
    enter_pin: 'បញ្ចូល PIN',
    login: 'ចូលប្រើ',
    invalid_pin: 'PIN មិនត្រឹមត្រូវ',

    // ── Language ──
    language: 'ភាសា',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
  },

  id: {
    // ── Header / Nav ──
    history: 'Riwayat',
    orders: 'Pesanan',
    kitchen_status: 'Status Dapur',
    reports: 'Laporan',
    maintenance: 'Perawatan',
    pay: 'Bayar',
    logout: 'Keluar',

    // ── Cart panel ──
    select_table: 'Pilih Meja',
    pax: 'orang',
    order: 'Pesanan',
    clear: 'Hapus',
    subtotal: 'Subtotal',
    send_to_kitchen: 'Kirim ke Dapur',
    update_kitchen_order: 'Perbarui Pesanan Dapur',
    no_items_found: 'Item tidak ditemukan',

    // ── Modifier modal ──
    add_to_order: 'Tambah ke Pesanan',
    update_order: 'Perbarui Pesanan',
    special_requests: 'Permintaan khusus, alergi…',
    notes: 'Catatan',

    // ── Payment ──
    unpaid_bills: 'Tagihan Belum Bayar',
    no_unpaid_bills: 'Tidak ada tagihan belum bayar',
    proceed_to_payment: 'Lanjut Bayar →',
    select_payment: 'Pilih Pembayaran',
    confirm_cash: 'Konfirmasi Tunai',
    payment_received: 'Pembayaran Diterima',
    verify_receipt: 'Verifikasi Struk',
    verify_receipt_btn: 'Verifikasi Struk →',
    confirm_payment: 'Konfirmasi Pembayaran',
    confirm_anyway: 'Konfirmasi Saja',
    processing_ocr: 'Memproses OCR...',
    payment_confirmed: '✓ Pembayaran dikonfirmasi',
    cash: 'Tunai',
    credit_card: 'Kartu Kredit',
    tng: 'Touch & Go',
    tng_ewallet: 'Touch & Go eWallet',
    duitnow: 'DuitNow QR',
    back: '← Kembali',
    confirm: 'Konfirmasi',
    bill: 'Tagihan',
    item_s: 'item',
    no_qr_configured: 'QR atau tautan pembayaran belum dikonfigurasi.',
    go_to_settings: 'Buka <b>Item → Pengaturan Sistem</b>.',

    // ── History ──
    order_history: 'Riwayat Pesanan',
    no_orders_found: 'Pesanan tidak ditemukan',
    all_tables: 'Semua Meja',
    table: 'Meja',
    details: 'Detail',
    reorder: 'Pesan Ulang',
    items_added_to_order: '↺ Item ditambahkan ke pesanan',

    // ── Toast messages ──
    item_ready: 'siap',
    all_items_ready: '✅ Semua item siap untuk {table}!',
    all_items_served: '✅ Semua item tersaji · {table} — siap bayar',
    admin_reloading: 'Admin memperbarui data — memuat ulang...',
    order_sent: '✓ Pesanan dikirim ke dapur · {table}',
    order_updated: '✓ Pesanan diperbarui · {table}',
    order_send_error: 'Gagal mengirim pesanan — silakan coba lagi',
    print_failed: '⚠ Cetak gagal — membuka cetak browser',
    allow_popups: '⚠ Izinkan popup untuk mencetak',
    search: 'Cari…',

    // ── Table picker ──
    has_active_order: 'Ada pesanan aktif',
    current_table: 'Meja saat ini',

    // ── Receipt / Print ──
    new_order: 'PESANAN BARU',
    order_update: 'PERBARUI PESANAN',
    cashier: 'Kasir',
    official_receipt: 'Struk Resmi',
    receipt: 'STRUK',
    receipt_no: 'No Struk',
    date: 'Tanggal',
    time: 'Waktu',
    served_by: 'Dilayani oleh',
    sst: 'Pajak',
    service: 'Layanan',
    total: 'TOTAL',
    payment: 'Pembayaran',
    thank_you: 'Terima kasih telah makan di sini!',
    come_again: 'Silakan datang lagi :)',
    test_print: 'CETAK UJI',
    printer_working: 'Printer berfungsi!',

    // ── KDS ──
    in_kitchen: 'Di Dapur',
    all_served: 'Semua Tersaji',
    cooking: 'Memasak',
    ready: 'Siap',
    served: 'Tersaji',
    refresh: 'Muat Ulang',
    new_order_table: 'Pesanan baru: {table}',
    order_updated_table: 'Pesanan diperbarui: {table}',

    // ── Items / Admin ──
    add_item: 'Tambah Item',
    edit_item: 'Edit Item',
    delete: 'Hapus',
    edit: 'Edit',
    category: 'Kategori',
    base_price: 'Harga Dasar',
    name_en: 'Nama (EN)',
    name_zh: 'Nama (ZH)',
    description_en: 'Deskripsi (EN)',
    description_zh: 'Deskripsi (ZH)',
    popular: 'Populer',
    available: 'Tersedia',
    save: 'Simpan',
    cancel: 'Batal',

    // ── Categories ──
    cat_all: 'Semua',
    cat_mains: 'Hidangan Utama',
    cat_addons: 'Tambahan',
    cat_vegetables: 'Sayur',
    cat_noodles: 'Mi',
    cat_soup: 'Sup',
    cat_dessert: 'Makanan Penutup',
    cat_beverages: 'Minuman',

    // ── Report ──
    sales_summary: 'Ringkasan Penjualan',
    sales_detail: 'Detail Penjualan',
    collection: 'Koleksi',
    item_sales: 'Penjualan Item',
    today: 'Hari Ini',
    yesterday: 'Kemarin',
    this_week: 'Minggu Ini',
    this_month: 'Bulan Ini',
    custom: 'Kustom',
    revenue: 'Pendapatan',
    avg_order: 'Pesanan Rata-rata',

    // ── Admin tabs ──
    items: 'Item',
    users: 'Pengguna',
    system_settings: 'Pengaturan Sistem',
    user_management: 'Manajemen Pengguna',
    user_management_hint: 'Kelola pengguna POS. Pengguna super memiliki akses penuh; kasir hanya dapat menggunakan POS dan melihat item.',
    add_user: 'Tambah Pengguna',
    general_settings: 'Pengaturan Umum',
    shop_name: 'Nama Toko',
    shop_address: 'Alamat Toko',
    managed_by_admin: 'dikelola oleh administrator',
    payment_settings: 'Pengaturan Pembayaran',
    payment_settings_hint: 'Konfigurasi tautan pembayaran dan kode QR untuk e-wallet.',
    tng_payment_link: 'Touch & Go eWallet — Tautan Pembayaran',
    tng_qr_image: 'Touch & Go eWallet — URL Gambar QR (opsional)',
    enable_ewallet_verify: 'Aktifkan Verifikasi Struk eWallet',
    airwallex_card: 'Airwallex Kartu Kredit',
    airwallex_hint: 'Konfigurasi Airwallex untuk kartu kredit/debit. Gunakan mode demo untuk pengujian.',
    enable_card: 'Aktifkan Pembayaran Kartu Kredit/Debit',
    client_id: 'Client ID',
    api_key: 'API Key',
    environment: 'Lingkungan',
    tax_service: 'Pajak & Biaya Layanan',
    tax_service_hint: 'Konfigurasi pajak dan biaya layanan. Ditampilkan pada tagihan dan struk.',
    enable_sst: 'Aktifkan Pajak SST',
    enable_service: 'Aktifkan Biaya Layanan',
    printer_settings: 'Pengaturan Printer',
    printer_hint: 'Konfigurasi printer termal LAN (ESC/POS, 80mm). Kosongkan IP untuk cetak browser.',
    print_order_slip: 'Cetak slip pesanan (dapur)',
    print_receipt: 'Cetak struk pembayaran',
    printer_ip: 'Alamat IP Printer',
    printer_port: 'Port Printer',
    relay_url: 'URL Relay Lokal (untuk server cloud)',
    save_settings: 'Simpan Pengaturan',
    currency_settings: 'Pengaturan Mata Uang',
    currency_hint: 'Atur simbol mata uang pada harga. Pilih ikut bahasa atau gunakan simbol tetap.',
    currency_follow_lang: 'Ikut bahasa default',
    currency_fixed: 'Simbol mata uang tetap',
    network_info: 'Info Jaringan',
    network_desc: 'Hubungkan perangkat lain di WiFi yang sama menggunakan alamat ini:',
    sync_cloud: 'Sinkronkan ke Cloud',
    sync_desc: 'Dorong semua riwayat pesanan, pengaturan dan menu ke cadangan MongoDB cloud.',
    sync_now: 'Sinkronkan Sekarang',
    reset_go_live: 'Reset & Mulai',
    reset_desc: 'Hapus semua pesanan aktif, data dapur, riwayat penjualan dan KDS. Item menu dan pengaturan pembayaran dipertahankan.',
    confirm_action: 'Konfirmasi Tindakan',
    cannot_undo: 'Tindakan ini tidak dapat dibatalkan.',
    yes_delete: 'Ya, Hapus',
    name: 'Nama',
    pin: 'PIN (4 digit)',
    role: 'Peran',
    cashier_role: 'Kasir',
    super_role: 'Super (Admin)',
    save_user: 'Simpan Pengguna',

    // ── Auth ──
    enter_pin: 'Masukkan PIN',
    login: 'Masuk',
    invalid_pin: 'PIN tidak valid',

    // ── Language ──
    language: 'Bahasa',
    lang_en: 'English',
    lang_zh: '中文',
    lang_th: 'ไทย',
    lang_vi: 'Tiếng Việt',
    lang_ms: 'Melayu',
    lang_km: 'ខ្មែរ',
    lang_id: 'Indonesia',
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

// ─── Currency per language ──────────────────────────────────────────────────
const LANG_CURRENCY = { en: 'RM', zh: 'RM', th: '฿', vi: '₫', ms: 'RM', km: '៛', id: 'Rp' };

function getCurrency() {
  try {
    const saved = localStorage.getItem('bkt_currency');
    if (saved) {
      const cfg = JSON.parse(saved);
      if (cfg.mode === 'fixed' && cfg.symbol) return cfg.symbol;
    }
  } catch {}
  return LANG_CURRENCY[_currentLang] || 'RM';
}

function _applyCurrencyOverride() {
  _onLangChange.forEach(fn => fn(_currentLang));
}

function fmtPrice(amount) {
  const c = getCurrency();
  const n = typeof amount === 'number' ? amount.toFixed(2) : amount;
  return `${c} ${n}`;
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
  const sel = document.createElement('select');
  sel.className = 'lang-switch-btn';
  sel.id = 'lang-switch-btn';
  sel.title = t('language');
  sel.style.cssText = 'color:var(--muted,#aaa);background:var(--header,#1a1a2e);border:1px solid var(--border,#3a3a55);border-radius:var(--radius,8px);padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600;outline:none;';
  SUPPORTED_LANGS.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = (LANG_STRINGS[code] && LANG_STRINGS[code]['lang_' + code]) || code.toUpperCase();
    opt.style.cssText = 'background:var(--header,#1a1a2e);color:var(--text,#fff);';
    if (code === _currentLang) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    setLang(sel.value);
    translatePage();
  });
  return sel;
}
