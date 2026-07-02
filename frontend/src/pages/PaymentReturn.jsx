import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function PaymentReturn({ session }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('processing')

  useEffect(() => {
    const orderReference = searchParams.get('orderReference')
    console.log('Payment return — orderReference:', orderReference)
    setTimeout(() => {
      setStatus('done')
      setTimeout(() => navigate(session ? '/dashboard' : '/login'), 2000)
    }, 2000)
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0B1220', color: '#F2EFE9', fontFamily: 'Inter, sans-serif', flexDirection: 'column', gap: 16 }}>
      {status === 'processing' ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 500 }}>Processing your payment...</div>
          <div style={{ fontSize: 14, color: '#8B96A8' }}>Please wait a moment.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 500, color: '#4F9C6E' }}>Payment received.</div>
          <div style={{ fontSize: 14, color: '#8B96A8' }}>Redirecting you to your dashboard...</div>
        </>
      )}
    </div>
  )
}
