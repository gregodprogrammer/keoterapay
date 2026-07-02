import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard({ session }) {
  const [subscriptions, setSubscriptions] = useState([])
  const [charges, setCharges] = useState([])
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: subs }, { data: chgs }] = await Promise.all([
      supabase.from('subscriptions').select('*, plans(name, amount, currency, interval)').order('created_at', { ascending: false }),
      supabase.from('charges').select('*').order('charged_at', { ascending: false }).limit(20)
    ])
    setSubscriptions(subs || [])
    setCharges(chgs || [])
    setLoading(false)
  }

  async function handleCheckout() {
    setCheckoutLoading(true)
    setError('')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_FUNCTION_URL}/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ amount: '100.00' })
      })
      const data = await res.json()
      if (data.checkoutLink) {
        window.location.href = data.checkoutLink
      } else {
        setError(data.error || 'Failed to create checkout session')
      }
    } catch (err) {
      setError('Network error — please try again')
    }
    setCheckoutLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const statusColor = { successful: '#4F9C6E', pending: '#CCA300', failed: '#C2554E' }
  const statusDot = s => ({ width: 7, height: 7, borderRadius: '50%', background: statusColor[s] || '#5A6478', flexShrink: 0 })

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.logo}>Keotera<span style={{ color: '#CCA300' }}>Pay</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#8B96A8' }}>{session.user.email}</span>
          <button style={styles.btnGhost} onClick={handleSignOut}>Sign out</button>
        </div>
      </nav>

      <div style={styles.body}>
        <div style={styles.pageHead}>
          <div style={{ fontSize: 13, color: '#8B96A8', marginBottom: 6 }}>Welcome back</div>
          <h1 style={styles.title}>Your billing, at a glance.</h1>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {loading ? (
          <div style={{ color: '#8B96A8', fontSize: 14 }}>Loading your data...</div>
        ) : (
          <>
            <div style={styles.statRow}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Active subscriptions</div>
                <div style={styles.statValue}>{subscriptions.filter(s => s.status === 'active').length}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total charges</div>
                <div style={styles.statValue}>{charges.length}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Successful payments</div>
                <div style={{ ...styles.statValue, color: '#E8C766' }}>{charges.filter(c => c.status === 'successful').length}</div>
              </div>
            </div>

            <div style={styles.sectionRow}>
              <div style={styles.sectionTitle}>Subscriptions</div>
              <button style={styles.btnGold} onClick={handleCheckout} disabled={checkoutLoading}>
                {checkoutLoading ? 'Creating...' : '+ New subscription'}
              </button>
            </div>

            {subscriptions.length === 0 ? (
              <div style={styles.emptyCard}>
                <div style={{ fontSize: 14, color: '#8B96A8', marginBottom: 8 }}>No active subscriptions yet.</div>
                <div style={{ fontSize: 13, color: '#5A6478' }}>Click "New subscription" to get started.</div>
              </div>
            ) : (
              subscriptions.map(sub => (
                <div key={sub.id} style={styles.planCard}>
                  <div>
                    <div style={styles.planName}>{sub.plans?.name || 'Plan'}</div>
                    <div style={styles.planMeta}>
                      <span style={{ fontFamily: 'monospace', color: '#E8C766' }}>₦{sub.plans?.amount?.toLocaleString()}</span>
                      {' '}{sub.plans?.interval} · {sub.status}
                    </div>
                  </div>
                  <div style={{ ...statusDot(sub.status === 'active' ? 'successful' : sub.status), width: 10, height: 10 }} />
                </div>
              ))
            )}

            <div style={{ height: 32 }} />

            <div style={styles.sectionTitle}>Charge history</div>
            <div style={styles.ledger}>
              <div style={styles.ledgerHead}>
                <span>Date</span><span>Reference</span><span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Status</span>
              </div>
              {charges.length === 0 ? (
                <div style={{ padding: '24px', color: '#5A6478', fontSize: 13, textAlign: 'center' }}>No charges yet.</div>
              ) : charges.map(charge => (
                <div key={charge.id} style={styles.ledgerRow}>
                  <span style={styles.mono}>{new Date(charge.charged_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span>
                  <span style={{ ...styles.mono, color: '#8B96A8' }}>{charge.order_reference?.slice(0, 8)}…</span>
                  <span style={{ ...styles.mono, textAlign: 'right' }}>₦{Number(charge.amount).toLocaleString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 12, color: '#8B96A8' }}>{charge.status}</span>
                    <div style={statusDot(charge.status)} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#0B1220', color: '#F2EFE9', fontFamily: 'Inter, sans-serif' },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 48px', borderBottom: '1px solid #1E2A42' },
  logo: { fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: 18 },
  body: { padding: '40px 48px 80px' },
  pageHead: { marginBottom: 32 },
  title: { fontSize: 26, fontWeight: 500, margin: 0 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 36 },
  statCard: { background: '#121B2E', border: '1px solid #1E2A42', borderRadius: 12, padding: '20px 22px' },
  statLabel: { fontSize: 13, color: '#8B96A8', marginBottom: 8 },
  statValue: { fontFamily: 'monospace', fontSize: 24, fontWeight: 500 },
  sectionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: 600, marginBottom: 16 },
  emptyCard: { background: '#121B2E', border: '1px solid #1E2A42', borderRadius: 12, padding: 28, textAlign: 'center', marginBottom: 36 },
  planCard: { background: '#121B2E', border: '1px solid #1E2A42', borderRadius: 12, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  planName: { fontSize: 15, fontWeight: 600, marginBottom: 4 },
  planMeta: { fontSize: 13, color: '#8B96A8' },
  ledger: { background: '#121B2E', border: '1px solid #1E2A42', borderRadius: 12, overflow: 'hidden' },
  ledgerHead: { display: 'grid', gridTemplateColumns: '80px 1fr 100px 100px', padding: '10px 20px', borderBottom: '1px solid #1E2A42', fontSize: 11, color: '#5A6478', textTransform: 'uppercase', letterSpacing: '0.04em' },
  ledgerRow: { display: 'grid', gridTemplateColumns: '80px 1fr 100px 100px', padding: '14px 20px', borderBottom: '1px solid #1E2A42', alignItems: 'center' },
  mono: { fontFamily: 'monospace', fontSize: 13 },
  btnGhost: { border: '1px solid #1E2A42', color: '#F2EFE9', background: 'transparent', padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  btnGold: { background: '#CCA300', color: '#1A1404', border: 'none', padding: '9px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  error: { background: '#2A1515', border: '1px solid #C2554E', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#E87B74', marginBottom: 20 },
}
