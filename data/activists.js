// data/activists.js

const activists = [
  // איילת השחר (project_id: 1)
  { id: 11, name: 'דוד כהן',       phone: '050-1110001', city: 'תל אביב',       address: 'רחוב הרצל 12', age: 34, role: 'activist', status: 'active', project_id: 1, joined_at: '2024-06-01' },
  { id: 12, name: 'רחל לוי',       phone: '052-1110002', city: 'חיפה',           address: 'שדרות הנשיא 5', age: 28, role: 'activist', status: 'active', project_id: 1, joined_at: '2024-09-15' },
  { id: 13, name: 'יוסף מזרחי',    phone: '054-1110003', city: 'ירושלים',        address: 'רחוב יפו 88',   age: 41, role: 'activist', status: 'active', project_id: 1, joined_at: '2025-01-10' },

  // אחדות יהודית (project_id: 2)
  { id: 21, name: 'מיכל אברהם',    phone: '050-2220001', city: 'באר שבע',        address: 'רחוב רגר 22',   age: 31, role: 'activist', status: 'active', project_id: 2, joined_at: '2024-07-01' },
  { id: 22, name: 'אריאל פרץ',     phone: '052-2220002', city: 'אשדוד',          address: 'שדרות ירושלים 4', age: 25, role: 'activist', status: 'active', project_id: 2, joined_at: '2024-11-20' },
  { id: 23, name: 'שירה גולן',     phone: '054-2220003', city: 'נתניה',          address: 'רחוב הרצוג 17', age: 38, role: 'activist', status: 'active', project_id: 2, joined_at: '2025-02-05' },

  // שבת מכל הסיבות (project_id: 3)
  { id: 31, name: 'נתן שמש',       phone: '050-3330001', city: 'פתח תקווה',      address: 'רחוב אחד העם 9', age: 29, role: 'activist', status: 'active', project_id: 3, joined_at: '2024-08-01' },
  { id: 32, name: 'תמר ישראלי',    phone: '052-3330002', city: 'ראשון לציון',    address: 'שדרות ראשון 33', age: 45, role: 'activist', status: 'active', project_id: 3, joined_at: '2025-01-01' },
  { id: 33, name: 'עמוס ברקוביץ',  phone: '054-3330003', city: 'רחובות',         address: 'רחוב ויצמן 7',  age: 36, role: 'activist', status: 'active', project_id: 3, joined_at: '2025-03-15' },

  // נפש יהודי (project_id: 4)
  { id: 41, name: 'לילה חדד',      phone: '050-4440001', city: 'אשקלון',         address: 'רחוב הגבורים 14', age: 27, role: 'activist', status: 'active', project_id: 4, joined_at: '2024-10-01' },
  { id: 42, name: 'בנימין רוזנברג', phone: '052-4440002', city: 'כפר סבא',       address: 'רחוב ביאליק 3',  age: 52, role: 'activist', status: 'active', project_id: 4, joined_at: '2025-02-20' },
  { id: 43, name: 'אורית שפירא',   phone: '054-4440003', city: 'הרצליה',         address: 'שדרות בן גוריון 21', age: 33, role: 'activist', status: 'active', project_id: 4, joined_at: '2025-04-01' },

  { id: 99, name: 'ישראל ישראלי', phone: '050-9999999', city: 'תל אביב', address: 'רחוב דיזנגוף 1', age: 50, role: 'manager', status: 'active', project_id: null, joined_at: '2023-01-01' },
];

module.exports = activists;
