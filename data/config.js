// data/config.js
const CONFIG = {

  thresholds: {
    active:   14,
    ongoing:  30,
    renew:    90,
    edge:     120,
  },

  status: {
    active:  'קשר חי',
    ongoing: 'קשר מתמשך',
    renew:   'דורש חידוש',
    edge:    'על סף ניתוק',
    former:  'לשעבר',
    ok:      'קשר חי',
    warning: 'קשר מתמשך',
    urgent:  'דורש חידוש',
    critical:'על סף ניתוק',
  },

  statusEmoji: {
    'קשר חי':         '🟢',
    'קשר מתמשך':      '🔵',
    'דורש חידוש':     '🟡',
    'על סף ניתוק':    '🔴',
  },

  depth: {
    'חברי':    'חברי',
    'מתעניין': 'מתעניין',
    'תורני':   'תורני',
    'עמוק':    'עמוק',
  },

  interactionTypes: ['פרונטלי', 'טלפוני', 'וידאו'],
  interactionQuality: ['תורני', 'ידידותי'],

  outcomeValues: ['חיובי', 'ניטרלי', 'שלילי', 'ממתין למענה'],

  roles: { manager: 'מנהל', activist: 'פעיל' },
  activistStatus: { active: 'פעיל', inactive: 'לא פעיל' },

  contactSources: {
    meeting:  'פגישה',
    manual:   'ידני',
    referral: 'המלצה',
  },

  // תארי ביצוע — אחדות יהודית בלבד
  achdutPerformance: [
    { min: 1,  max: 2,  label: 'מתפקד 💪',        color: '#27ae60', bg: '#edfaf1' },
    { min: 3,  max: 5,  label: 'נותן עבודה 🔥',    color: '#f39c12', bg: '#fff8ec' },
    { min: 6,  max: 9,  label: 'תפקוד גבוה ⭐',    color: '#8e44ad', bg: '#f5eef8' },
    { min: 10, max: 999,label: 'תפקוד עילית 👑',   color: '#c0392b', bg: '#fdf2f8' },
  ],

  mitzvotMale: ['תפילין','שבת','כשרות','לימוד','ברכות','גילוח','כיפה','ציצית','תפילות לאיש'],
  mitzvotFemale: ['שבת','כשרות','לימוד','ברכות','צניעות','טהרת המשפחה','כיסוי ראש','תפילות לאשה'],
  mitzvotLevels: [0, 1, 2, 3, 4],

  activistPerformance: {
    dormant: 'רדום',
    active:  'מתפקד',
    high:    'תפקוד גבוה',
  },
};

module.exports = CONFIG;
