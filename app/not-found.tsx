export default function NotFound() {
  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>404 — Page not found</h2>
          <a href="/" style={{ fontSize: '0.875rem', color: '#3b82f6', textDecoration: 'underline' }}>Go home</a>
        </div>
      </body>
    </html>
  );
}
