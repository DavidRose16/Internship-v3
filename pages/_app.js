// pages/_app.js — Next.js app wrapper. Loads global CSS.
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
