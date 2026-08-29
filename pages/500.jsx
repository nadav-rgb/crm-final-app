import styles from '../styles/error-page.module.css';

export default function ServerErrorPage() {
  return (
    <main className={styles.page} dir="rtl" aria-labelledby="server-error-title">
      <section className={styles.panel}>
        <p className={styles.code}>500</p>
        <h1 className={styles.title} id="server-error-title">משהו השתבש</h1>
        <p className={styles.message}>לא הצלחנו לטעון את העמוד. אפשר לנסות שוב בעוד רגע.</p>
      </section>
    </main>
  );
}

ServerErrorPage.isPublicErrorPage = true;
