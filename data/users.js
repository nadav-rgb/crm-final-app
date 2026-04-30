// data/users.js
const users = [
  // מנכ"ל
  { id: 99, username: 'ceo',     password: 'ceo123',     name: 'ישראל ישראלי', role: 'ceo',      project_id: null },

  // ראשי פרויקטים
  { id: 101, username: 'head1',  password: 'head123',    name: 'מיכל כהן',     role: 'head',     project_id: 1 },
  { id: 102, username: 'head2',  password: 'head123',    name: 'דוד לוי',      role: 'head',     project_id: 2 },
  { id: 103, username: 'head3',  password: 'head123',    name: 'שרה גולן',     role: 'head',     project_id: 3 },
  { id: 104, username: 'head4',  password: 'head123',    name: 'אבי מזרחי',    role: 'head',     project_id: 4 },

  // פעילים — איילת השחר
  { id: 11,  username: 'david',  password: 'david123',   name: 'דוד כהן',      role: 'activist', project_id: 1 },
  { id: 12,  username: 'rachel', password: 'rachel123',  name: 'רחל לוי',      role: 'activist', project_id: 1 },
  { id: 13,  username: 'yosef',  password: 'yosef123',   name: 'יוסף מזרחי',   role: 'activist', project_id: 1 },

  // פעילים — אחדות יהודית
  { id: 21,  username: 'michal', password: 'michal123',  name: 'מיכל אברהם',   role: 'activist', project_id: 2 },
  { id: 22,  username: 'ariel',  password: 'ariel123',   name: 'אריאל פרץ',    role: 'activist', project_id: 2 },
  { id: 23,  username: 'shira',  password: 'shira123',   name: 'שירה גולן',    role: 'activist', project_id: 2 },

  // פעילים — שבת מכל הסיבות
  { id: 31,  username: 'natan',  password: 'natan123',   name: 'נתן שמש',      role: 'activist', project_id: 3 },
  { id: 32,  username: 'tamar',  password: 'tamar123',   name: 'תמר ישראלי',   role: 'activist', project_id: 3 },
  { id: 33,  username: 'amos',   password: 'amos123',    name: 'עמוס ברקוביץ', role: 'activist', project_id: 3 },

  // פעילים — נפש יהודי
  { id: 41,  username: 'layla',  password: 'layla123',   name: 'לילה חדד',     role: 'activist', project_id: 4 },
  { id: 42,  username: 'binyamin', password: 'binyamin123', name: 'בנימין רוזנברג', role: 'activist', project_id: 4 },
  { id: 43,  username: 'orit',   password: 'orit123',    name: 'אורית שפירא',  role: 'activist', project_id: 4 },

  // בעלי גישה לתשלומים — אחדות יהודית (ניתן להוסיף עוד בהמשך)
  { id: 201, username: 'finance1', password: 'finance123', name: 'יוסי הלוי',     role: 'finance',  project_id: 2 },
  { id: 202, username: 'finance2', password: 'finance456', name: 'רות אדלר',      role: 'finance',  project_id: 2 },
];

module.exports = users;
