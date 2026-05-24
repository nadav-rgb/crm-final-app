// scripts/gen-contacts-seed.js — מייצר seed.sql מתוך data/contacts.js. לא כותב ל-DB.
const contacts = require('../data/contacts');

const COLS = [
  'id','activist_id','project_id','name','phone','city','area','depth','profession',
  'age','gender','high_potential','days_since_last_contact','last_interaction_date',
  'next_action','next_action_date','source','joined_at','notes','how_met',
  'mitzvot','mitzvot_history','is_graduate','referred_by',
  'meeting_place_city','meeting_place_number',
  'meetingHouseCity','meetingHouseNumber','meetingHouseKey',
];
const JSONB = new Set(['mitzvot','mitzvot_history']);
const QUOTED = new Set(['meetingHouseCity','meetingHouseNumber','meetingHouseKey']);

const lit = (v, col) => {
  if (v === undefined || v === null) return 'null';
  if (JSONB.has(col)) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number')  return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const colName = c => QUOTED.has(c) ? `"${c}"` : c;

const rows = contacts.map(c =>
  '  (' + COLS.map(col => lit(c[col], col)).join(', ') + ')'
).join(',\n');

console.log(
  `insert into public.contacts (${COLS.map(colName).join(', ')}) values\n${rows}\n` +
  `on conflict (id) do nothing;`
);
console.error('ROWS=' + contacts.length);
