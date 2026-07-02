import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handlePasswordLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    else setMessage('Check your email to confirm your account.')
    setLoading(false)
  }

  async function handleMagicLink(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) setError(error.message)
    else setMessage('Magic link sent — check your email.')
    setLoading(false)
  }

  return (
    <div style={styles.page}>
      <div style={styles.left}>
        <div style={styles.eyebrow}>Built on verified rails</div>
        <h1 style={styles.headline}>Billing your customers shouldn't feel like a leap of faith.</h1>
        <p style={styles.sub}>KeoteraPay charges your customers automatically, on schedule, and never marks a payment successful until it's actually confirmed.</p>
        <div style={styles.trustGrid}>
          {[
            { title: 'Verified, not trusted blindly', desc: 'Every payment event is signature-checked before it touches your ledger.' },
            { title: 'No double charges', desc: 'A unique reference on every attempt makes accidental retries harmless.' },
            { title: 'Your data, only yours', desc: 'Row-level security means no customer can ever see another\'s records.' },
            { title: 'Every attempt, kept', desc: 'A full, append-only history — nothing overwritten, nothing hidden.' },
          ].map((item, i) => (
            <div key={i} style={styles.trustItem}>
              <div style={styles.trustIcon}>✦</div>
              <div>
                <div style={styles.trustTitle}>{item.title}</div>
                <div style={styles.trustDesc}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.right}>
        <div style={styles.card}>
          <div style={styles.logo}>Keotera<span style={{ color: '#CCA300' }}>Pay</span></div>
          <div style={styles.tabs}>
            {['password', 'magic'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); setMessage('') }}
                style={{ ...styles.tab, ...(mode === m ? styles.tabActive : {}) }}>
                {m === 'password' ? 'Password' : 'Magic link'}
              </button>
            ))}
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {message && <div style={styles.success}>{message}</div>}

          {mode === 'password' ? (
            <form>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" placeholder="you@company.com"
                value={email} onChange={e => setEmail(e.target.value)} />
              <label style={styles.label}>Password</label>
              <input style={styles.input} type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} />
              <button style={styles.submit} onClick={handlePasswordLogin} disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <button style={{ ...styles.submit, background: 'transparent', border: '1px solid #1E2A42', color: '#F2EFE9', marginTop: 8 }}
                onClick={handleSignUp} disabled={loading}>
                {loading ? '...' : 'Create account'}
              </button>
            </form>
          ) : (
            <form>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" placeholder="you@company.com"
                value={email} onChange={e => setEmail(e.target.value)} />
              <button style={styles.submit} onClick={handleMagicLink} disabled={loading}>
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
              <p style={styles.magicNote}>We'll email you a one-time link — no password needed.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: { display: 'flex', minHeight: '100vh', background: '#0B1220', color: '#F2EFE9', fontFamily: 'Inter, sans-serif' },
  left: { flex: 1.1, padding: '80px 64px', borderRight: '1px solid #1E2A42', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  eyebrow: { color: '#E8C766', fontSize: 13, fontWeight: 500, letterSpacing: '0.03em', textTransform: 'uppercase', marginBottom: 24 },
  headline: { fontSize: 42, fontWeight: 500, lineHeight: 1.1, maxWidth: 500, marginBottom: 20, margin: '0 0 20px 0' },
  sub: { color: '#8B96A8', fontSize: 16, lineHeight: 1.6, maxWidth: 440, marginBottom: 40 },
  trustGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 520 },
  trustItem: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  trustIcon: { color: '#CCA300', fontSize: 16, marginTop: 2, flexShrink: 0 },
  trustTitle: { fontSize: 14, fontWeight: 600, marginBottom: 4 },
  trustDesc: { fontSize: 13, color: '#8B96A8', lineHeight: 1.5 },
  right: { flex: 0.85, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 },
  card: { width: 360, background: '#121B2E', border: '1px solid #1E2A42', borderRadius: 14, padding: '32px 28px' },
  logo: { fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: 20, marginBottom: 24, textAlign: 'center' },
  tabs: { display: 'flex', gap: 4, background: '#16213A', borderRadius: 8, padding: 4, marginBottom: 24 },
  tab: { flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 500, color: '#8B96A8', background: 'transparent', border: 'none', cursor: 'pointer' },
  tabActive: { background: '#CCA300', color: '#1A1404' },
  label: { display: 'block', fontSize: 13, color: '#8B96A8', marginBottom: 6 },
  input: { width: '100%', background: '#0B1220', border: '1px solid #1E2A42', borderRadius: 8, padding: '10px 12px', color: '#F2EFE9', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' },
  submit: { width: '100%', background: '#CCA300', color: '#1A1404', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  error: { background: '#2A1515', border: '1px solid #C2554E', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#E87B74', marginBottom: 16 },
  success: { background: '#0F2A1A', border: '1px solid #4F9C6E', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#7BC49A', marginBottom: 16 },
  magicNote: { fontSize: 12, color: '#5A6478', textAlign: 'center', marginTop: 12, lineHeight: 1.5 },
}
