/**
 * VR Arcade Analytics Dashboard
 * ─────────────────────────────
 * Single-file Next.js page — all components defined inline.
 * Deploy to Vercel, set two env vars, done.
 *
 * Env vars required (.env.local / Vercel project settings):
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
 *
 * npm deps needed (beyond Next.js defaults):
 *   npm install @supabase/supabase-js recharts date-fns
 */

"use client";

import { useState, useEffect, useMemo, useCallback } from 'react'
import Head from 'next/head'
import { createClient, RealtimeChannel } from '@supabase/supabase-js'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  subDays, format, startOfDay, endOfDay,
  parseISO, isValid,
} from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// ─────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface GameLog {
  id: number
  computer_id: string
  game_name: string
  start_time: string
  end_time: string
  duration_minutes: number
  revenue_ksh: number
  status: 'FULL GAME' | 'PARTIAL' | 'ERROR'
  date: string
  created_at: string
}

interface MachineStatus {
  computer_id: string
  last_seen: string
  status: string
}

interface MachineWithOnline extends MachineStatus {
  is_online: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmtKSH = (n: number) =>
  `KSH ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const todayStr = () => new Date().toISOString().slice(0, 10)

const statusColor = (s: string) => {
  if (s === 'FULL GAME') return '#10b981'
  if (s === 'PARTIAL')   return '#f59e0b'
  return '#ef4444'
}

const statusBg = (s: string) => {
  if (s === 'FULL GAME') return 'rgba(16,185,129,0.15)'
  if (s === 'PARTIAL')   return 'rgba(245,158,11,0.15)'
  return 'rgba(239,68,68,0.15)'
}


// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────
function useGameLogs(limit = 500) {
  const [logs, setLogs]       = useState<GameLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let channel: RealtimeChannel

    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('game_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (!error && data) setLogs(data as GameLog[])
      setLoading(false)
    }

    fetchLogs()

    channel = supabase
      .channel('game_logs_rt')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_logs' },
        (payload) => {
          setLogs(prev => [payload.new as GameLog, ...prev].slice(0, limit))
        })
      .subscribe()

    return () => { channel?.unsubscribe() }
  }, [limit])

  return { logs, loading }
}

function useMachineStatus() {
  const [machines, setMachines] = useState<MachineStatus[]>([])

  const fetch = useCallback(async () => {
    const { data } = await supabase.from('machine_status').select('*')
    if (data) setMachines(data as MachineStatus[])
  }, [])

  useEffect(() => {
    fetch()
    const channel = supabase
      .channel('machine_status_rt')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'machine_status' },
        () => fetch())
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [fetch])

  const now = Date.now()
  return machines.map(m => ({
    ...m,
    is_online: new Date(m.last_seen).getTime() > now - 5 * 60 * 1000,
  })) as MachineWithOnline[]
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS (all defined in this file)
// ─────────────────────────────────────────────────────────────────────────────

/* ── LOADING SCREEN ── */
function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', gap: '1.5rem',
    }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: 'var(--accent)',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
        Connecting to arcade…
      </p>
    </div>
  )
}

/* ── MACHINE STATUS CARDS ── */
function MachineStatusCards({ machines }: { machines: MachineWithOnline[] }) {
  if (machines.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No machines registered yet.</p>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      {machines.map(m => (
        <div key={m.computer_id} style={{
          ...cardStyle,
          flex: '1 1 180px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderLeft: `3px solid ${m.is_online ? '#10b981' : '#ef4444'}`,
        }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Machine</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{m.computer_id}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Last seen {format(parseISO(m.last_seen), 'HH:mm:ss')}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: m.is_online ? '#10b981' : '#ef4444',
              boxShadow: m.is_online ? '0 0 8px #10b981' : 'none',
              animation: m.is_online ? 'glow 2s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 11, color: m.is_online ? '#10b981' : '#ef4444', fontWeight: 600 }}>
              {m.is_online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── STATS CARDS ── */
function StatsCards({ logs }: { logs: GameLog[] }) {
  const today = todayStr()
  const todayLogs = useMemo(() => logs.filter(l => l.date === today), [logs, today])

  const revenue   = todayLogs.reduce((s, l) => s + l.revenue_ksh, 0)
  const sessions  = todayLogs.length
  const playtime  = todayLogs.reduce((s, l) => s + l.duration_minutes, 0)
  const avg       = sessions ? (playtime / sessions).toFixed(1) : '—'
  const fullGames = todayLogs.filter(l => l.status === 'FULL GAME').length

  const cards = [
    { label: "Today's Revenue",   value: fmtKSH(revenue),          accent: '#10b981' },
    { label: 'Sessions Today',    value: String(sessions),          accent: '#3b82f6' },
    { label: 'Full Games',        value: String(fullGames),         accent: '#8b5cf6' },
    { label: 'Avg Duration',      value: `${avg} min`,              accent: '#f59e0b' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
      {cards.map(c => (
        <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${c.accent}` }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{c.label}</p>
          <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

/* ── REVENUE AREA CHART ── */
function RevenueChart({ logs }: { logs: GameLog[] }) {
  const [days, setDays] = useState<7 | 30 | 90>(7)

  const data = useMemo(() => {
    const today = new Date()
    return Array.from({ length: days }, (_, i) => {
      const day     = subDays(today, days - 1 - i)
      const ds      = startOfDay(day)
      const de      = endOfDay(day)
      const revenue = logs
        .filter(l => { const d = parseISO(l.start_time); return d >= ds && d <= de })
        .reduce((s, l) => s + l.revenue_ksh, 0)
      return { date: format(day, days === 7 ? 'EEE' : 'MMM dd'), revenue: +revenue.toFixed(2) }
    })
  }, [logs, days])

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={sectionTitle}>Revenue Trend</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: days === d ? 'var(--accent)' : 'var(--surface2)',
              color: days === d ? '#fff' : 'var(--muted)',
              transition: 'all 0.15s',
            }}>{d}d</button>
          ))}
        </div>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
             
            />
            <Area type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} fill="url(#revGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ── SESSION BREAKDOWN BAR CHART ── */
function SessionBreakdownChart({ logs }: { logs: GameLog[] }) {
  const data = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const day  = subDays(today, 6 - i)
      const ds   = startOfDay(day)
      const de   = endOfDay(day)
      const dl   = logs.filter(l => { const d = parseISO(l.start_time); return d >= ds && d <= de })
      return {
        date:     format(day, 'EEE'),
        Full:     dl.filter(l => l.status === 'FULL GAME').length,
        Partial:  dl.filter(l => l.status === 'PARTIAL').length,
        Error:    dl.filter(l => l.status === 'ERROR').length,
      }
    })
  }, [logs])

  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 20 }}>Sessions by Day (7d)</h2>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
            <Bar dataKey="Full"    fill="#10b981" radius={[3,3,0,0]} />
            <Bar dataKey="Partial" fill="#f59e0b" radius={[3,3,0,0]} />
            <Bar dataKey="Error"   fill="#ef4444" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
        {[['Full','#10b981'],['Partial','#f59e0b'],['Error','#ef4444']].map(([l,c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── TODAY STATUS PIE ── */
function TodayPieChart({ logs }: { logs: GameLog[] }) {
  const today = todayStr()
  const dl    = useMemo(() => logs.filter(l => l.date === today), [logs, today])

  const data = [
    { name: 'Full',    value: dl.filter(l => l.status === 'FULL GAME').length, color: '#10b981' },
    { name: 'Partial', value: dl.filter(l => l.status === 'PARTIAL').length,   color: '#f59e0b' },
    { name: 'Error',   value: dl.filter(l => l.status === 'ERROR').length,     color: '#ef4444' },
  ].filter(d => d.value > 0)

  if (data.length === 0) return (
    <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180 }}>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions today yet</p>
    </div>
  )

  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Today's Breakdown</h2>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
              dataKey="value" paddingAngle={3}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ── TOP GAMES TABLE ── */
function TopGames({ logs }: { logs: GameLog[] }) {
  const today  = todayStr()
  const dl     = useMemo(() => logs.filter(l => l.date === today), [logs, today])
  const ranked = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>()
    dl.forEach(l => {
      const prev = map.get(l.game_name) ?? { count: 0, revenue: 0 }
      map.set(l.game_name, { count: prev.count + 1, revenue: prev.revenue + l.revenue_ksh })
    })
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
  }, [dl])

  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Top Games Today</h2>
      {ranked.length === 0
        ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions yet today</p>
        : ranked.map(([name, stats], i) => (
          <div key={name} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 0', borderBottom: i < ranked.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 16 }}>#{i+1}</span>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{name}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
              <span>{stats.count} session{stats.count !== 1 ? 's' : ''}</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>{fmtKSH(stats.revenue)}</span>
            </div>
          </div>
        ))
      }
    </div>
  )
}

/* ── DAILY SUMMARY (date picker) ── */
function DailySummary({ logs }: { logs: GameLog[] }) {
  const [date, setDate] = useState(todayStr())
  const dl = useMemo(() => logs.filter(l => l.date === date), [logs, date])

  const full     = dl.filter(l => l.status === 'FULL GAME').length
  const partial  = dl.filter(l => l.status === 'PARTIAL').length
  const errors   = dl.filter(l => l.status === 'ERROR').length
  const revenue  = dl.reduce((s, l) => s + l.revenue_ksh, 0)
  const playtime = dl.reduce((s, l) => s + l.duration_minutes, 0)
  const avg      = dl.length ? (playtime / dl.length).toFixed(1) : '—'

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={sectionTitle}>Daily Summary</h2>
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={e => setDate(e.target.value)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 12px', color: 'var(--text)',
            fontSize: 13, cursor: 'pointer', outline: 'none',
          }}
        />
      </div>

      {dl.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions found for {date}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[
            { label: 'Sessions',    value: String(dl.length)   },
            { label: 'Revenue',     value: fmtKSH(revenue)     },
            { label: 'Full Games',  value: String(full)        },
            { label: 'Partial',     value: String(partial)     },
            { label: 'Errors',      value: String(errors)      },
            { label: 'Total Time',  value: `${playtime.toFixed(0)} min` },
            { label: 'Avg Session', value: `${avg} min`        },
          ].map(c => (
            <div key={c.label} style={{
              background: 'var(--surface2)', borderRadius: 10,
              padding: '12px 14px',
            }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{c.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── RECENT SESSIONS TABLE ── */
function RecentSessionsTable({ logs }: { logs: GameLog[] }) {
  const recent = logs.slice(0, 15)

  return (
    <div style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={sectionTitle}>Live Session Feed</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Time', 'Machine', 'Game', 'Duration', 'Revenue', 'Status'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left', fontSize: 11,
                  color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map((log, i) => {
              const t = parseISO(log.start_time)
              return (
                <tr key={log.id} style={{
                  borderBottom: '1px solid var(--border)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  transition: 'background 0.1s',
                }}>
                  <td style={tdStyle}>{isValid(t) ? format(t, 'HH:mm:ss') : '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text)' }}>{log.computer_id}</td>
                  <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.game_name}</td>
                  <td style={tdStyle}>{log.duration_minutes.toFixed(1)} min</td>
                  <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{fmtKSH(log.revenue_ksh)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: statusBg(log.status), color: statusColor(log.status),
                      letterSpacing: '0.04em',
                    }}>{log.status}</span>
                  </td>
                </tr>
              )
            })}
            {recent.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  Waiting for sessions…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── LIVE TICKER (new sessions pop in at top) ── */
function LiveTicker({ logs }: { logs: GameLog[] }) {
  const [latest, setLatest] = useState<GameLog | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (logs.length === 0) return
    const newest = logs[0]
    // only flash if it's a recent insert (within last 10 seconds)
    const age = Date.now() - new Date(newest.created_at).getTime()
    if (age < 10_000) {
      setLatest(newest)
      setVisible(true)
      const t = setTimeout(() => setVisible(false), 5000)
      return () => clearTimeout(t)
    }
  }, [logs])

  if (!visible || !latest) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 999,
      background: 'var(--surface)', border: `1px solid ${statusColor(latest.status)}`,
      borderRadius: 12, padding: '14px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      maxWidth: 320, animation: 'slideUp 0.3s ease',
    }}>
      <p style={{ fontSize: 11, color: statusColor(latest.status), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        🎮 New Session — {latest.status}
      </p>
      <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>{latest.game_name}</p>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        {latest.computer_id} · {latest.duration_minutes.toFixed(1)} min · {fmtKSH(latest.revenue_ksh)}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 14,
  padding:      '20px 24px',
}

const sectionTitle: React.CSSProperties = {
  fontSize:     16,
  fontWeight:   700,
  color:        'var(--text)',
  fontFamily:   'var(--font-display)',
  margin:       0,
}

const tdStyle: React.CSSProperties = {
  padding:    '12px 16px',
  color:      'var(--muted)',
  whiteSpace: 'nowrap',
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { logs, loading } = useGameLogs(500)
  const machines          = useMachineStatus()
  const [now, setNow]     = useState(new Date())

  // tick clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  if (loading) return <LoadingScreen />

  return (
    <>
      <Head>
        <title>VR Arcade Analytics</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:           #0d0f14;
          --surface:      #151820;
          --surface2:     #1c1f29;
          --border:       rgba(255,255,255,0.07);
          --text:         #f0f2f8;
          --muted:        #6b7280;
          --accent:       #6366f1;
          --font-display: 'Syne', sans-serif;
          --font-body:    'DM Sans', sans-serif;
        }

        body {
          background:  var(--bg);
          color:       var(--text);
          font-family: var(--font-body);
          min-height:  100vh;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }

        @keyframes glow {
          0%, 100% { box-shadow: 0 0 6px #10b981; }
          50%       { box-shadow: 0 0 14px #10b981, 0 0 4px #10b981; }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(0.6);
          cursor: pointer;
        }

        ::-webkit-scrollbar       { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

        tr:hover td { background: rgba(255,255,255,0.02) !important; }
      `}</style>

      {/* Live toast */}
      <LiveTicker logs={logs} />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              VR Arcade <span style={{ color: 'var(--accent)' }}>Analytics</span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Live KSH tracking · Real-time data</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.02em' }}>
              {format(now, 'HH:mm:ss')}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{format(now, 'EEEE, dd MMM yyyy')}</p>
          </div>
        </div>

        {/* ── MACHINE STATUS ── */}
        <MachineStatusCards machines={machines} />

        {/* ── TODAY'S KPIs ── */}
        <StatsCards logs={logs} />

        {/* ── CHARTS ROW ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.25rem' }}>
          <RevenueChart logs={logs} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          <SessionBreakdownChart logs={logs} />
          <TodayPieChart logs={logs} />
          <TopGames logs={logs} />
        </div>

        {/* ── DAILY SUMMARY ── */}
        <DailySummary logs={logs} />

        {/* ── LIVE SESSIONS TABLE ── */}
        <RecentSessionsTable logs={logs} />

        {/* ── FOOTER ── */}
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
          FPS Arena · Powered by Supabase Realtime
        </p>
      </div>
    </>
  )
}
