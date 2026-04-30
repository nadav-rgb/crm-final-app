// data/interactions.js — קשרים לדוגמה כולל קשרים מזכים בתשלום

const interactions = [
  // מיכל אברהם (id:21) — אחדות יהודית
  { id:1,  activist_id:21, contact_id:2001, contact_name:'אברהם כהן 2001', project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:45, outcome:'חיובי',          date:'2026-04-28', time:'10:00', notes:'שיחה מעמיקה על שבת', description:'שיחה מעמיקה על שמירת שבת, הלקוח התעניין מאוד' },
  { id:2,  activist_id:21, contact_id:2001, contact_name:'אברהם כהן 2001', project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:60, outcome:'חיובי',          date:'2026-04-20', time:'11:00', notes:'חברותא', description:'למדנו יחד פרק משניות, התקדמות טובה' },
  { id:3,  activist_id:21, contact_id:2001, contact_name:'אברהם כהן 2001', project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:50, outcome:'חיובי',          date:'2026-04-14', time:'09:00', notes:'חברותא', description:'המשך לימוד, הלקוח שואל שאלות' },
  { id:4,  activist_id:21, contact_id:2001, contact_name:'אברהם כהן 2001', project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:40, outcome:'חיובי',          date:'2026-04-07', time:'10:30', notes:'חברותא', description:'4 מפגשי לימוד החודש — בונוס!' },
  { id:5,  activist_id:21, contact_id:2002, contact_name:'שרה לוי 2002',   project_id:2, type:'טלפוני',  quality:'ידידותי', duration_minutes:20, outcome:'חיובי',          date:'2026-04-27', time:'14:00', notes:'שיחה', description:'שיחה נעימה, עדכון שבועי' },
  { id:6,  activist_id:21, contact_id:2002, contact_name:'שרה לוי 2002',   project_id:2, type:'פרונטלי', quality:'ידידותי', duration_minutes:30, outcome:'ניטרלי',         date:'2026-04-22', time:'16:00', notes:'ביקור בית', description:'ביקור בבית, אווירה נעימה' },
  { id:7,  activist_id:21, contact_id:2003, contact_name:'משה ישראלי 2003', project_id:2, type:'פרונטלי', quality:'תורני',   duration_minutes:35, outcome:'חיובי',          date:'2026-04-25', time:'20:00', notes:'שיעור', description:'השתתף בשיעור קבוצתי, נלהב מאוד' },
  { id:8,  activist_id:21, contact_id:2004, contact_name:'רבקה מזרחי 2004', project_id:2, type:'טלפוני', quality:'תורני',   duration_minutes:25, outcome:'ממתין למענה',    date:'2026-04-24', time:'12:00', notes:'שיחה', description:'שוחחנו על תפילה, הבטיחה לחשוב' },

  // אריאל פרץ (id:22) — אחדות יהודית
  { id:9,  activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:50, outcome:'חיובי',          date:'2026-04-28', time:'09:00', notes:'חברותא', description:'לימוד גמרא, התלהב מאוד מהנושא' },
  { id:10, activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:45, outcome:'חיובי',          date:'2026-04-21', time:'09:00', notes:'חברותא', description:'המשך לימוד שבועי' },
  { id:11, activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:40, outcome:'חיובי',          date:'2026-04-14', time:'09:00', notes:'חברותא', description:'שלישי בשורה — מתמיד!' },
  { id:12, activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:55, outcome:'חיובי',          date:'2026-04-07', time:'09:00', notes:'חברותא', description:'רביעי — בונוס התמדה!' },
  { id:13, activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:60, outcome:'חיובי',          date:'2026-03-31', time:'09:00', notes:'חברותא', description:'חמישי בחודש — עלייה לבונוס 6!' },
  { id:14, activist_id:22, contact_id:2011, contact_name:'יצחק פרץ 2011',  project_id:2, type:'פרונטלי', quality:'תורני',    duration_minutes:45, outcome:'חיובי',          date:'2026-03-24', time:'09:00', notes:'חברותא', description:'שישי — בונוס עילי!' },
  { id:15, activist_id:22, contact_id:2012, contact_name:'לאה גולן 2012',   project_id:2, type:'טלפוני',  quality:'ידידותי', duration_minutes:18, outcome:'חיובי',          date:'2026-04-26', time:'15:00', notes:'שיחה', description:'שיחה קצרה ונעימה' },
  { id:16, activist_id:22, contact_id:2013, contact_name:'יעקב אברהמי 2013',project_id:2, type:'וידאו',   quality:'תורני',   duration_minutes:30, outcome:'חיובי',          date:'2026-04-23', time:'21:00', notes:'שיעור', description:'שיעור וידאו על הלכות שבת' },

  // שירה גולן (id:23) — אחדות יהודית
  { id:17, activist_id:23, contact_id:2021, contact_name:'דינה שמש 2021',   project_id:2, type:'פרונטלי', quality:'ידידותי', duration_minutes:25, outcome:'חיובי',          date:'2026-04-27', time:'17:00', notes:'ביקור', description:'ביקור חברי, אווירה מצוינת' },
  { id:18, activist_id:23, contact_id:2022, contact_name:'אהרון ברקוביץ 2022',project_id:2,type:'טלפוני', quality:'תורני',   duration_minutes:22, outcome:'ניטרלי',         date:'2026-04-25', time:'13:00', notes:'שיחה', description:'שיחה על כשרות, מתלבט' },
  { id:19, activist_id:23, contact_id:2021, contact_name:'דינה שמש 2021',   project_id:2, type:'פרונטלי', quality:'תורני',   duration_minutes:40, outcome:'חיובי',          date:'2026-04-20', time:'18:00', notes:'שיעור', description:'הצטרפה לשיעור שבועי — מדהים!' },

  // דוד כהן (id:11) — איילת השחר
  { id:20, activist_id:11, contact_id:1001, contact_name:'אברהם כהן 1001', project_id:1, type:'פרונטלי', quality:'תורני',   duration_minutes:45, outcome:'חיובי',          date:'2026-04-26', time:'10:00', notes:'שיחה', description:'שיחה מעמיקה ומחזקת' },
  { id:21, activist_id:11, contact_id:1002, contact_name:'שרה לוי 1002',   project_id:1, type:'טלפוני',  quality:'ידידותי', duration_minutes:20, outcome:'חיובי',          date:'2026-04-24', time:'14:00', notes:'שיחה', description:'עדכון שבועי, כל טוב' },
  { id:22, activist_id:12, contact_id:1011, contact_name:'אברהם כהן 1011', project_id:1, type:'פרונטלי', quality:'ידידותי', duration_minutes:30, outcome:'חיובי',          date:'2026-04-25', time:'16:00', notes:'ביקור', description:'ביקור בבית, הכרות ראשונית' },
];

module.exports = interactions;
