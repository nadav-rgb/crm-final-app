// pages/_document.jsx
import DocumentBase, { Html, Head, Main, NextScript } from 'next/document';

export default function Document({ nonce }) {
  return (
    <Html lang="he" dir="rtl">
      <Head nonce={nonce}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  );
}

Document.getInitialProps = async (context) => {
  const initialProps = await DocumentBase.getInitialProps(context);
  const nonce = context.req?.headers?.['x-nonce'];
  return { ...initialProps, nonce: typeof nonce === 'string' ? nonce : undefined };
};
