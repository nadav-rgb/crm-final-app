// scripts/gen-contacts-seed-beta.js — seed בטא מצומצם: project 1, פעילים 11-14, 5 כל אחד = 20. לא כותב ל-DB.
const TODAY = new Date('2026-05-24');

const activists = [11, 12, 13, 14];
const firstNames = ['אברהם','שרה','משה','רבקה','יצחק','לאה','יעקב','דינה','אהרון','מרים','דוד','חנה','שמואל','רות','נתן','אסתר','יהודה','מיכל','אליהו','תמר'];
const lastNames  = ['כהן','לוי','ישראלי','מזרחי','פרץ','גולן','אברהמי','שמש','ברקוביץ','חדד'];
const cities = ['תל אביב','ירושלים','חיפה','באר שבע','נתניה','פתח תקווה','ראשון לציון','אשדוד'];
const areas  = ['מרכז','צפון','דרום','שרון'];
const depths = ['מתעניין','ידידותי','חברי','תורני','עמוק'];
const profs  = ['מורה','רופא','מהנדס','עורך דין','רואה חשבון','יזם','אדריכל','עצמאי'];
const howMet = ['הומלץ על ידי חבר','אירוע קהילתי','הכרות ישירה','פגישה מקרית','דרך המשפחה'];

const maleBase   = { 'תפילין':2,'שבת':1,'כשרות':2,'לימוד':1,'ברכות':1,'גילוח':0,'כיפה':1,'ציצית':0,'תפילות לאיש':1 };
const femaleBase = { 'שבת':2,'כשרות':2,'לימוד':1,'ברכות':1,'צניעות':1,'טהרת המשפחה':0,'כיסוי ראש':1,'תפילות לאשה':1 };

// פיזור סטטוסים: קשר חי / מתמשך / דורש חידוש / על סף ניתוק / מתמשך — כולם <=120 (אף אחד לא "לשעבר")
const daysByIndex = [4, 22, 55, 105, 18];

const COLS = ['id','activist_id','project_id','name','phone','city','area','depth','profession','age','gender','high_potential','days_since_last_contact','last_interaction_date','next_action','next_action_date','source','joined_at','notes','how_met','mitzvot','mitzvot_history','is_graduate','referred_by','meeting_place_city','meeting_place_number','meetingHouseCity','meetingHouseNumber','meetingHouseKey'];
const JSONB = new Set(['mitzvot','mitzvot_history']);
const QUOTED = new Set(['meetingHouseCity','meetingHouseNumber','meetingHouseKey']);

const dateMinus = d => new Date(TODAY.getTime() - d*86400000).toISOString().split('T')[0];
const lit = (v, col) => {
  if (v === undefined || v === null) return 'null';
  if (JSONB.has(col)) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number')  return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const colName = c => QUOTED.has(c) ? `"${c}"` : c;

const rows = [];
activists.forEach((act, ai) => {
  for (let i = 0; i < 5; i++) {
    const seed = ai*5 + i;
    const gender = seed % 2 === 0 ? 'male' : 'female';
    const days = daysByIndex[i];
    const c = {
      id: act*100 + (i+1),                       // 1101..1105, 1201.., 1301.., 1401..
      activist_id: act,
      project_id: 1,
      name: `${firstNames[seed % firstNames.length]} ${lastNames[(seed*3) % lastNames.length]}`,
      phone: `050-1${String(100000 + act*100 + i).slice(0,6)}`,
      city: cities[seed % cities.length],
      area: areas[i % areas.length],
      depth: depths[i % depths.length],
      profession: profs[seed % profs.length],
      age: 24 + (seed*3) % 45,
      gender,
      high_potential: i === 0,
      days_since_last_contact: days,
      last_interaction_date: dateMinus(days),
      next_action: i < 2 ? ['לתאם פגישה','לשלוח חומר'][i] : null,
      next_action_date: i < 2 ? dateMinus(-(3 + i*4)) : null,   // עתידי
      source: ['manual','referral'][i % 2],
      joined_at: dateMinus(120 + seed*10),
      notes: i % 2 === 0 ? 'מעוניין בחיזוק קשר' : '',
      how_met: howMet[seed % howMet.length],
      mitzvot: gender === 'male' ? {...maleBase} : {...femaleBase},
      mitzvot_history: [],
      is_graduate: true,
      referred_by: null,
      meeting_place_city: null,
      meeting_place_number: null,
      meetingHouseCity: null,
      meetingHouseNumber: null,
      meetingHouseKey: null,
    };
    rows.push('  (' + COLS.map(col => lit(c[col], col)).join(', ') + ')');
  }
});

console.log(
  `insert into public.contacts (${COLS.map(colName).join(', ')}) values\n` +
  rows.join(',\n') + '\n' +
  `on conflict (id) do nothing;`
);
console.error('ROWS=' + rows.length);
