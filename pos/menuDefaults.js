// ─── Shared menu defaults ─────────────────────────────────────────────────────
// Included by both index.html (app.js) and items.html (items.js).
// localStorage key: 'bkt_menu_items'  (live data overrides these defaults)

const STORAGE_KEY = 'bkt_menu_items';

const CATEGORIES = [
  { id: 'all',        name: 'All',         nameZh: '全部' },
  { id: 'mains',      name: 'Main Dishes', nameZh: '主菜' },
  { id: 'addons',     name: 'Add-ons',     nameZh: '加料' },
  { id: 'vegetables', name: 'Vegetables',  nameZh: '蔬菜' },
  { id: 'noodles',    name: 'Noodles',     nameZh: '面食' },
  { id: 'beverages',  name: 'Beverages',   nameZh: '饮料' },
];

const MENU_ITEMS = [
  // ── Main Dishes ────────────────────────────────────────────────────────────
  {
    id: 'mn001', name: 'Bak Kut Teh', nameZh: '肉骨茶',
    category: 'mains', price: 22.00, isPopular: true, isAvailable: true,
    description: 'Signature pork rib soup with herbs & spices (per pax)',
    descriptionZh: '招牌药材猪骨汤（每位）',
  },
  {
    id: 'mn002', name: 'Ribs', nameZh: '排骨',
    category: 'mains', price: 35.00, isPopular: true, isAvailable: true,
    description: 'Choice of small or big bone (per pax)',
    descriptionZh: '可选小骨或大骨（每位）',
    modifierGroups: [{
      id: 'bone_type', name: 'Bone Type', nameZh: '骨类', required: true, multiSelect: false,
      options: [
        { id: 'small', label: 'Small Bone (小骨)', labelZh: '小骨', priceAdjustment: 0 },
        { id: 'big',   label: 'Big Bone (大骨)',   labelZh: '大骨', priceAdjustment: 0 },
      ],
    }],
  },
  {
    id: 'mn003', name: 'Dry & Spicy Bak Kut Teh', nameZh: '干辣肉骨茶',
    category: 'mains', price: 22.00, isPopular: true, isAvailable: true,
    description: 'Dry-style spicy BKT with fragrant dried chillies (per pax)',
    descriptionZh: '干式辣椒肉骨茶，香辣过瘾（每位）',
  },
  {
    id: 'mn004', name: 'Braised Chicken Feet', nameZh: '卤鸡脚',
    category: 'mains', price: 12.00, isAvailable: true,
    description: 'Tender braised chicken feet in rich soy sauce',
    descriptionZh: '浓郁酱香卤鸡脚，软糯入味',
    modifierGroups: [{
      id: 'size', name: 'Size', nameZh: '份量', required: true, multiSelect: false,
      options: [
        { id: 'small', label: 'Small', labelZh: '小份', priceAdjustment: 0 },
        { id: 'big',   label: 'Big',   labelZh: '大份', priceAdjustment: 11.00 },
      ],
    }],
  },
  {
    id: 'mn005', name: 'Braised Pork', nameZh: '卤肉',
    category: 'mains', price: 24.00, isAvailable: true,
    description: 'Slow-braised pork in aromatic soy and spice sauce',
    descriptionZh: '慢火卤制猪肉，香浓入味',
  },
  {
    id: 'mn006', name: 'Pig Trotter with Black Vinegar', nameZh: '猪脚醋',
    category: 'mains', price: 23.00, isPopular: true, isAvailable: true,
    description: 'Traditional pig trotter braised in black vinegar and ginger',
    descriptionZh: '传统猪脚黑醋姜，酸甜滋补',
    modifierGroups: [{
      id: 'size', name: 'Size', nameZh: '份量', required: true, multiSelect: false,
      options: [
        { id: 'small', label: 'Small', labelZh: '小份', priceAdjustment: 0 },
        { id: 'big',   label: 'Big',   labelZh: '大份', priceAdjustment: 21.00 },
      ],
    }],
  },
  {
    id: 'mn007', name: 'Braised Pork Tendon', nameZh: '卤猪腱',
    category: 'mains', price: 48.00, isAvailable: true,
    description: 'Melt-in-the-mouth slow-braised pork tendon',
    descriptionZh: '慢火卤制猪腱，软糯Q弹',
  },
  {
    id: 'mn008', name: 'Claypot Spare Rib', nameZh: '砂锅排骨',
    category: 'mains', price: 55.00, isPopular: true, isAvailable: true,
    description: 'Spare ribs simmered in herbal broth in a traditional claypot',
    descriptionZh: '砂锅慢炖药材排骨，鲜香浓郁',
    modifierGroups: [{
      id: 'size', name: 'Size', nameZh: '份量', required: true, multiSelect: false,
      options: [
        { id: 'small', label: 'Small', labelZh: '小份', priceAdjustment: 0 },
        { id: 'big',   label: 'Big',   labelZh: '大份', priceAdjustment: 25.00 },
      ],
    }],
  },
  // ── Add-ons ────────────────────────────────────────────────────────────────
  { id: 'ao001', name: 'You Tiao',           nameZh: '油条',       category: 'addons', price: 3.50, isAvailable: true, description: 'Crispy deep-fried dough stick', descriptionZh: '香脆油条' },
  { id: 'ao002', name: 'Tofu Puff',          nameZh: '豆腐卜',     category: 'addons', price: 5.00, isAvailable: true, description: 'Fried tofu puffs, great for soaking up BKT broth', descriptionZh: '炸豆腐卜，蘸肉骨茶汤一流' },
  { id: 'ao003', name: 'Tofu Skin',          nameZh: '腐竹',       category: 'addons', price: 6.00, isAvailable: true, description: 'Silky tofu skin simmered in broth', descriptionZh: '嫩滑腐竹，吸饱汤汁' },
  { id: 'ao004', name: 'Enoki Mushroom',     nameZh: '金针菇',     category: 'addons', price: 6.00, isAvailable: true, description: 'Fresh enoki mushrooms cooked in BKT broth', descriptionZh: '新鲜金针菇，鲜嫩爽滑' },
  { id: 'ao005', name: 'Mushroom',           nameZh: '冬菇',       category: 'addons', price: 6.00, isAvailable: true, description: 'Shiitake mushrooms braised in herbal broth', descriptionZh: '卤制冬菇，香浓入味' },
  { id: 'ao006', name: 'Rice (Large)',       nameZh: '白饭（大碗）',category: 'addons', price: 2.50, isAvailable: true, description: 'Steamed white rice, large bowl', descriptionZh: '蒸白饭，大碗' },
  { id: 'ao007', name: 'Rice (Small)',       nameZh: '白饭（小碗）',category: 'addons', price: 2.00, isAvailable: true, description: 'Steamed white rice, small bowl', descriptionZh: '蒸白饭，小碗' },
  { id: 'ao008', name: 'Yam / Longbean Rice',nameZh: '芋头/豆角饭',category: 'addons', price: 5.00, isAvailable: true, description: 'Fragrant rice cooked with yam or long beans', descriptionZh: '芋头或豆角香饭' },
  // ── Vegetables ────────────────────────────────────────────────────────────
  {
    id: 'vg001', name: "Lettuce & Lady's Finger", nameZh: '生菜/秋葵',
    category: 'vegetables', price: 12.00, isAvailable: true,
    description: "Blanched lettuce and lady's finger with dipping sauce",
    descriptionZh: '灼生菜及秋葵配酱料',
    modifierGroups: [{
      id: 'size', name: 'Size', nameZh: '份量', required: true, multiSelect: false,
      options: [
        { id: 'small', label: 'Small', labelZh: '小份', priceAdjustment: 0 },
        { id: 'big',   label: 'Big',   labelZh: '大份', priceAdjustment: 6.00 },
      ],
    }],
  },
  // ── Noodles ────────────────────────────────────────────────────────────────
  { id: 'nd001', name: 'BKT Noodle (Yee Mee)',      nameZh: '肉骨茶伊面',   category: 'noodles', price: 14.80, isAvailable: true, description: 'Braised egg noodles in rich BKT broth', descriptionZh: '肉骨茶汤底伊面，香浓够味' },
  { id: 'nd002', name: 'BKT Noodle (Mee Sua)',       nameZh: '肉骨茶面线',   category: 'noodles', price: 14.80, isAvailable: true, description: 'Fine rice vermicelli in rich BKT broth', descriptionZh: '肉骨茶汤底面线，细滑爽口' },
  { id: 'nd003', name: 'Dry & Spicy BKT Noodle',    nameZh: '干辣肉骨茶面', category: 'noodles', price: 14.80, isAvailable: true, description: 'Tossed noodles with dry-style spicy BKT sauce', descriptionZh: '干辣肉骨茶拌面，香辣够劲' },
  // ── Beverages ─────────────────────────────────────────────────────────────
  {
    id: 'bv001', name: 'Herbal Tea Pot', nameZh: '花茶/普洱/铁观音/菊花',
    category: 'beverages', price: 4.00, isAvailable: true,
    description: 'Teapot for 1–2 pax. Additional pax +RM 1.50 each',
    descriptionZh: '1–2人份茶壶，追加每位 +RM 1.50',
    modifierGroups: [{
      id: 'tea_type', name: 'Tea Type', nameZh: '茶叶', required: true, multiSelect: false,
      options: [
        { id: 'jasmine',    label: 'Jasmine (茉莉花)',    labelZh: '茉莉花', priceAdjustment: 0 },
        { id: 'puer',       label: 'Puer (普洱)',          labelZh: '普洱',   priceAdjustment: 0 },
        { id: 'tieguanyin', label: 'Tieguanyin (铁观音)', labelZh: '铁观音', priceAdjustment: 0 },
        { id: 'kekwa',      label: 'Kekwa (菊花)',         labelZh: '菊花',   priceAdjustment: 0 },
      ],
    }],
  },
  { id: 'bv002', name: 'King Tea (Pot)',       nameZh: '皇茶',        category: 'beverages', price: 8.00,  isAvailable: true, description: 'Premium king tea for 1–2 pax. Additional pax +RM 2.00 each', descriptionZh: '1–2人份皇茶，追加每位 +RM 2.00' },
  { id: 'bv003', name: 'Plain Water (cup)',    nameZh: '白开水',      category: 'beverages', price: 0.50,  isAvailable: true, description: 'Cup of plain drinking water', descriptionZh: '一杯白开水' },
  { id: 'bv004', name: 'Chinese Tea (cup)',    nameZh: '中国茶',      category: 'beverages', price: 1.00,  isAvailable: true, description: 'Cup of Chinese tea', descriptionZh: '一杯中国茶' },
  { id: 'bv005', name: 'Own Tea',             nameZh: '自带茶',      category: 'beverages', price: 1.00,  isAvailable: true, description: 'Bring your own tea leaves — service charge applies', descriptionZh: '自带茶叶，收服务费' },
  { id: 'bv006', name: 'Soft Drinks',         nameZh: '汽水',        category: 'beverages', price: 3.50,  isAvailable: true, description: 'Canned or bottled soft drinks', descriptionZh: '罐装或瓶装汽水' },
  { id: 'bv007', name: 'Honey Calamansi',     nameZh: '蜂蜜柑桔',    category: 'beverages', price: 3.50,  isAvailable: true, description: 'Refreshing honey and calamansi lime drink', descriptionZh: '清爽蜂蜜柑桔饮料' },
  { id: 'bv008', name: 'Guinness Stout (Big)',nameZh: '健力士黑啤（大）', category: 'beverages', price: 24.00, isAvailable: true, description: 'Large bottle of Guinness Stout', descriptionZh: '大瓶健力士黑啤酒' },
  { id: 'bv009', name: 'Tiger Beer (Big)',    nameZh: '虎牌啤酒（大）',  category: 'beverages', price: 22.00, isAvailable: true, description: 'Large bottle of Tiger Beer', descriptionZh: '大瓶虎牌啤酒' },
];
