export default function NotFoundPage() {
  return (
    <main dir="rtl" style={{ minHeight:'100vh', display:'grid', placeItems:'center', padding:24, fontFamily:'Rubik,sans-serif', background:'#fbf7f1' }}>
      <div style={{ textAlign:'center', color:'#555' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>404</div>
        <h1 style={{ fontSize:20, color:'#2d1f5e', marginBottom:8 }}>העמוד לא נמצא</h1>
        <p>הכתובת שביקשת אינה זמינה.</p>
      </div>
    </main>
  );
}

export function getServerSideProps({ res }) {
  res.statusCode = 404;
  res.setHeader('Cache-Control', 'no-store, private');
  return { props: {} };
}
