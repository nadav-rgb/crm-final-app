// pages/meeting-house-results.jsx
import { useState, useEffect, useMemo } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { fetchMeetingHousesFromSupabase } from '../lib/meetingHousesSupabase';
import { inProject } from '../lib/projectUtils';

export default function MeetingHouseResultsPage() {
  const { contacts, baseMeetings, activists } = useCrm();
  const { can, apiFetch } = useAuth();
  const [houses, setHouses] = useState([]);
  const achdutActivists = useMemo(() => activists.filter(a => a.role === 'activist' && inProject(a, 1)), [activists]);

  useEffect(() => {
    fetchMeetingHousesFromSupabase(apiFetch).then(setHouses).catch(() => setHouses([]));
  }, [apiFetch]);

  const achdutContacts = contacts.filter(c =>
    c.project_id === 1 && c.meeting_place_number && c.meeting_place_city
  );

  const grouped = {};
  achdutContacts.forEach(c => {
    const key = c.meetingHouseKey || `${c.meeting_place_number}_${c.meeting_place_city}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...c, meetingHouseKey: key });
  });

  const houseCards = Object.entries(grouped).map(([key, clients]) => {
    const [number, ...cityParts] = key.split('_');
    const city = cityParts.join('_');
    const houseData = houses.find(h => {
      const hn = h.houseNumber?.replace(/^AJ-/i, '');
      return hn === number || h.settlement === city || h.city === city;
    });
    const assignedActivistNames = (houseData?.assignedActivists || [])
      .map(id => achdutActivists.find(u => u.id === id)?.name || `פעיל ${id}`)
      .join(', ');
    return {
      key, number, city,
      clientCount: clients.length,
      facilitatorName: houseData?.facilitatorName || '—',
      hostName: houseData?.hostName || '—',
      assignedActivistNames,
      meetings: houseData?.meetings || [],
      status: houseData?.status || '—',
    };
  }).sort((a, b) => b.clientCount - a.clientCount);

  const byFacilitator = {};
  houseCards.forEach(h => {
    const f = h.facilitatorName;
    if (!byFacilitator[f]) byFacilitator[f] = { houses: 0, clients: 0 };
    byFacilitator[f].houses++;
    byFacilitator[f].clients += h.clientCount;
  });
  const facilitatorRanking = Object.entries(byFacilitator)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.clients - a.clients);

  const byCity = {};
  houseCards.forEach(h => {
    if (!byCity[h.city]) byCity[h.city] = { houses: 0, clients: 0 };
    byCity[h.city].houses++;
    byCity[h.city].clients += h.clientCount;
  });
  const cityRanking = Object.entries(byCity)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.clients - a.clients);

  // Activist ranking: count houses where activist submitted the FIRST report (meeting_number === 1)
  const byActivistHouses = {};
  baseMeetings
    .filter(m => Number(m.meeting_number) === 1 && m.submitted && m.house_id)
    .forEach(m => {
      const aid = String(m.activist_id);
      if (!byActivistHouses[aid]) byActivistHouses[aid] = new Set();
      byActivistHouses[aid].add(String(m.house_id));
    });
  const activistRanking = Object.entries(byActivistHouses)
    .map(([id, houseSet]) => ({
      name: achdutActivists.find(u => u.id === Number(id))?.name || `פעיל ${id}`,
      houses: houseSet.size,
    }))
    .sort((a, b) => b.houses - a.houses);

  return (
    <DesktopLayout
      title="תוצאות בתי מפגש"
      subtitle={`${houseCards.length} בתי מפגש · ${achdutContacts.length} משתתפים · אחדות יהודית`}
    >
      {/* House cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 36 }}>
        {houseCards.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14, fontWeight: 500 }}>
            אין נתונים להצגה
          </div>
        ) : houseCards.map(h => (
          <HouseCard key={h.key} house={h} />
        ))}
      </div>

      {/* Rankings */}
      {houseCards.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>
            דירוגים
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            <RankingTable
              title="מנחה"
              rows={facilitatorRanking.map(r => ({ name: r.name, sub: `${r.houses} בתים`, value: r.clients }))}
            />
            <RankingTable
              title="יישוב"
              rows={cityRanking.map(r => ({ name: r.name, sub: `${r.houses} בתים`, value: r.clients }))}
            />
            <RankingTable
              title="פעיל"
              rows={activistRanking.map(r => ({ name: r.name, sub: `${r.houses} בתים`, value: r.houses }))}
            />
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}

function HouseCard({ house }) {
  return (
    <div
      style={{
        background: '#fff', borderRadius: 14, padding: '16px 18px',
        border: '0.5px solid rgba(0,0,0,0.07)', borderRight: '3px solid #6c5ce7',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#2d1f5e' }}>בית מפגש {house.number}</div>
          <div style={{ fontSize: 12, color: '#6c5ce7', fontWeight: 600, marginTop: 2 }}>📍 {house.city}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#6c5ce7', lineHeight: 1 }}>{house.clientCount}</div>
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>משתתפים</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#888', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {house.facilitatorName !== '—' && <span>👨‍🏫 {house.facilitatorName}</span>}
        {house.hostName !== '—' && <span>🏠 {house.hostName}</span>}
        {house.assignedActivistNames && <span>⭐ {house.assignedActivistNames}</span>}
      </div>
    </div>
  );
}

function RankingTable({ title, rows }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '16px 18px',
      border: '0.5px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#2d1f5e', marginBottom: 12 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: '#ccc', fontSize: 12, textAlign: 'center', padding: 12 }}>אין נתונים</div>
      ) : rows.map((row, i) => (
        <div key={row.name} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 0',
          borderBottom: i < rows.length - 1 ? '0.5px solid #f5f5f5' : 'none',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: i === 0 ? '#6c5ce7' : i === 1 ? '#a29bfe' : '#f0effe',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
            color: i < 2 ? '#fff' : '#6c5ce7',
          }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
            {row.sub && <div style={{ fontSize: 10, color: '#aaa' }}>{row.sub}</div>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#6c5ce7', flexShrink: 0 }}>{row.value}</div>
        </div>
      ))}
    </div>
  );
}
