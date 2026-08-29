export default function ServerErrorPage() {
  return (
    <main
      dir="rtl"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        fontFamily: 'var(--font-family)',
        background: 'var(--color-bg-page)',
      }}
    >
      <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        <div style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 'var(--font-weight-bold)', marginBlockEnd: 'var(--space-3)' }}>
          500
        </div>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-brand-primary)', marginBlockEnd: 'var(--space-2)' }}>
          משהו השתבש
        </h1>
        <p style={{ fontSize: 'var(--font-size-xl)', lineHeight: 'var(--line-height-relaxed)', margin: 0 }}>
          לא הצלחנו לטעון את העמוד. אפשר לנסות שוב בעוד רגע.
        </p>
      </div>
    </main>
  );
}
