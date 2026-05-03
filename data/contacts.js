// data/contacts.js — לקוחות עם high_potential, mitzvot, referral_source

const professions = ['מתכנת בכיר','עובד במיקרוסופט','מנהל חברה','רופא','עורך דין','מהנדס','מנהל בנק','יזם הייטק','מנהל שיווק','אדריכל','פרופסור','רואה חשבון','מנהל פרויקטים','מנתח מערכות','מנהל משאבי אנוש'];
const cities = ['תל אביב','ירושלים','חיפה','באר שבע','נתניה','פתח תקווה','ראשון לציון','אשדוד','אשקלון','רחובות'];
const depths = ['מתעניין','ידידותי','חברי','תורני','עמוק'];
const firstNames = ['אברהם','שרה','משה','רבקה','יצחק','לאה','יעקב','דינה','אהרון','מרים'];
const lastNames  = ['כהן','לוי','ישראלי','מזרחי','פרץ','גולן','אברהמי','שמש','ברקוביץ','חדד'];

// סרגל מצוות לדוגמה
const maleBase   = { 'תפילין':2,'שבת':1,'כשרות':2,'לימוד':1,'ברכות':1,'גילוח':0,'כיפה':1,'ציצית':0,'תפילות לאיש':1 };
const femaleBase = { 'שבת':2,'כשרות':2,'לימוד':1,'ברכות':1,'צניעות':1,'טהרת המשפחה':0,'כיסוי ראש':1,'תפילות לאשה':1 };

function makeName(seed) {
  return `${firstNames[seed % firstNames.length]} ${lastNames[(seed*3)%lastNames.length]}`;
}

function makeContacts(activistId, projectId, startId, isMeetingPlace, houseConfig) {
  const result = [];
  for (let i = 0; i < 10; i++) {
    const id   = startId + i;
    const days = [0,2,5,8,12,18,25,35,50,70][i];
    const city = cities[(activistId*3+i)%cities.length];
    const lastDate = new Date(2026,3,28-days).toISOString().split('T')[0];
    const gender = i%2===0?'male':'female';
    const mitzvot = gender==='male' ? {...maleBase} : {...femaleBase};
    const keys = Object.keys(mitzvot);
    keys.slice(0,3).forEach(k => { mitzvot[k] = Math.min(4, mitzvot[k] + Math.floor(i/3)); });

    const houseCity   = houseConfig?.city ?? city;
    const houseNumber = houseConfig?.number ?? `${10+i}`;

    const c = {
      id, activist_id:activistId, project_id:projectId,
      name: `${makeName(id)} ${id}`,
      phone:`05${(id%4)}-${String(1000000+id).slice(0,7)}`,
      city, area:['מרכז','צפון','דרום','שרון'][i%4],
      depth: depths[i%depths.length],
      profession: professions[(activistId+i)%professions.length],
      age: 25+((activistId*7+i*3)%40),
      gender,
      high_potential: i < 3,
      days_since_last_contact: days,
      last_interaction_date: lastDate,
      next_action: i<4?['לתאם פגישה','לשלוח חומר','לבדוק עניין','להתקשר'][i]:null,
      next_action_date: i<4?new Date(2026,4,1+i*3).toISOString().split('T')[0]:null,
      source: isMeetingPlace?null:['manual','referral','meeting',null][i%4],
      joined_at: new Date(2025,i%12,1+(id%28)).toISOString().split('T')[0],
      notes: i%3===0?'מעוניין בחיזוק קשר':'',
      how_met: isMeetingPlace?null:['הומלץ על ידי חבר','פגישה קהילתית','אירוע','הכרות ישירה'][i%4],
      mitzvot,
      mitzvot_history: [],
      is_graduate: true,
      referred_by: null,
      ...(isMeetingPlace ? {
        meeting_place_city: houseCity,
        meeting_place_number: houseNumber,
        meetingHouseCity: houseCity,
        meetingHouseNumber: houseNumber,
        meetingHouseKey: `${houseNumber}_${houseCity}`,
      } : {}),
    };
    result.push(c);
  }
  return result;
}

const contacts = [
  ...makeContacts(11,1,1001,false),
  ...makeContacts(12,1,1011,false),
  ...makeContacts(13,1,1021,false),
  ...makeContacts(21,2,2001,true,{number:'101',city:'ירושלים'}),
  ...makeContacts(22,2,2011,true,{number:'102',city:'תל אביב'}),
  ...makeContacts(23,2,2021,true,{number:'102',city:'תל אביב'}),
  ...makeContacts(31,3,3001,false),
  ...makeContacts(32,3,3011,false),
  ...makeContacts(33,3,3021,false),
  ...makeContacts(41,4,4001,false),
  ...makeContacts(42,4,4011,false),
  ...makeContacts(43,4,4021,false),
];

module.exports = contacts;
