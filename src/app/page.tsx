"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  subDays, format, startOfDay, endOfDay,
  parseISO, isValid, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek,
} from 'date-fns';
import {
  LayoutDashboard, BarChart3, Activity, Zap,
  Settings, Menu, X, Trash2, AlertTriangle,
  ChevronDown, ChevronUp, Calendar, Filter,
  TrendingUp, Clock, Award, Gamepad2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface GameLog {
  id: number;
  computer_id: string;
  game_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  revenue_ksh: number;
  status: 'FULL GAME' | 'PARTIAL' | 'ERROR';
  date: string;
  created_at: string;
}
interface MachineStatus { computer_id: string; last_seen: string; status: string; }
interface MachineWithOnline extends MachineStatus {
  is_online: boolean;
  custom_rate_per_full_game: number | null;
  custom_rate_per_minute: number | null;
  label: string;
}
interface MachinePricing {
  computer_id: string;
  custom_rate_per_full_game: number | null;
  custom_rate_per_minute: number | null;
  label: string;
  updated_at: string;
}
interface PricingConfig {
  id: number; use_per_minute: boolean; rate_per_full_game: number;
  rate_per_minute: number; daily_target_ksh: number; updated_at: string;
}
interface ArcadeSettings {
  id: number;
  price_per_full_game: number;
  daily_target_ksh: number;
  full_game_min_minutes: number;
  error_max_minutes: number;
  updated_at: string;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtKSH = (n: number) =>
  `KSH ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const statusColor = (s: string) =>
  s === 'FULL GAME' ? '#10b981' : s === 'PARTIAL' ? '#f59e0b' : '#ef4444';
const statusBg = (s: string) =>
  s === 'FULL GAME' ? 'rgba(16,185,129,0.15)' : s === 'PARTIAL' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';



// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────
function useGameLogs(limit = 1000) {
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let channel: RealtimeChannel;
    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('game_logs').select('*')
        .order('created_at', { ascending: false }).limit(limit);
      if (!error && data) setLogs(data as GameLog[]);
      setLoading(false);
    };
    fetchLogs();
    channel = supabase.channel('game_logs_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_logs' },
        (payload) => setLogs(prev => [payload.new as GameLog, ...prev].slice(0, limit)))
      .subscribe();
    return () => { channel?.unsubscribe(); };
  }, [limit]);
  return { logs, setLogs, loading };
}
function useMachineStatus() {
  const [machines, setMachines] = useState<MachineStatus[]>([]);
  const [pricingMap, setPricingMap] = useState<Record<string, MachinePricing>>({});

  const fetchMachines = useCallback(async () => {
    const [{ data: statusData }, { data: pricingData }] = await Promise.all([
      supabase.from('machine_status').select('*'),
      supabase.from('machine_pricing').select('*'),
    ]);
    if (statusData) setMachines(statusData as MachineStatus[]);
    if (pricingData) {
      const map: Record<string, MachinePricing> = {};
      (pricingData as MachinePricing[]).forEach(p => { map[p.computer_id] = p; });
      setPricingMap(map);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
    const ch = supabase.channel('machine_status_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_status' }, () => fetchMachines())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_pricing' }, () => fetchMachines())
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [fetchMachines]);

  const now = Date.now();

  return {
    machines: machines.map(m => ({
      ...m,
      is_online: new Date(m.last_seen).getTime() > now - 5 * 60 * 1000,
      custom_rate_per_full_game: pricingMap[m.computer_id]?.custom_rate_per_full_game ?? null,
      custom_rate_per_minute: pricingMap[m.computer_id]?.custom_rate_per_minute ?? null,
      label: pricingMap[m.computer_id]?.label ?? m.computer_id,
    })) as MachineWithOnline[],
    setMachines,
    refetch: fetchMachines,
  };
}


function useArcadeSettings() {
  const [settings, setSettings] = useState<ArcadeSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('arcade_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (!error && data) setSettings(data as ArcadeSettings);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: Partial<ArcadeSettings>) => {
    if (!settings) return;
    const { error } = await supabase
      .from('arcade_settings')
      .update(updates)
      .eq('id', 1);
    if (!error) setSettings({ ...settings, ...updates });
    return error;
  };

  return { settings, loading, updateSettings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Styles
// ─────────────────────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, padding: '20px 24px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: 'var(--text)',
  fontFamily: 'var(--font-display)', margin: 0,
};
const tdStyle: React.CSSProperties = { padding: '12px 16px', color: 'var(--muted)', whiteSpace: 'nowrap' };
const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '10px 12px', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none',
};

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Modal
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 28, maxWidth: 400, width: '90%',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={22} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 style={{ margin: '0 0 8px', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 16 }}>
              Confirm Action
            </h3>
            <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{message}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '8px 18px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Yes, Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
const sidebarItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'intelligence', label: 'Game Intel', icon: Zap },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function Sidebar({ active, onNavigate, collapsed, onToggle }: {
  active: string; onNavigate: (id: string) => void;
  collapsed: boolean; onToggle: () => void;
}) {
  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          onClick={onToggle}
          style={{
            display: 'none',
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40,
          }}
          className="mobile-overlay"
        />
      )}
      <aside style={{
        width: collapsed ? 64 : 220,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: collapsed ? '16px 8px' : '20px 10px',
        display: 'flex', flexDirection: 'column', gap: 4,
        transition: 'width 0.2s ease, padding 0.2s ease',
        flexShrink: 0, overflow: 'hidden',
        position: 'relative', zIndex: 50,
      }}>
        {/* Logo + toggle */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          marginBottom: 20, padding: collapsed ? 0 : '0 6px',
        }}>
          {!collapsed && (
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
              VR Arcade
            </h2>
          )}
          <button onClick={onToggle} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 4, borderRadius: 6, display: 'flex',
          }}>
            {collapsed ? <Menu size={18} /> : <X size={18} />}
          </button>
        </div>

        {sidebarItems.map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)} title={collapsed ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px' : '10px 12px',
                borderRadius: 8, border: 'none',
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--muted)',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                transition: 'all 0.15s', width: '100%', whiteSpace: 'nowrap',
              }}>
              <Icon size={17} />
              {!collapsed && item.label}
            </button>
          );
        })}
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header({ now, onMenuToggle }: { now: Date; onMenuToggle: () => void }) {
  return (
    <header style={{
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onMenuToggle} className="mobile-menu-btn" style={{
          display: 'none', background: 'transparent', border: 'none',
          color: 'var(--muted)', cursor: 'pointer', padding: 4,
        }}>
          <Menu size={20} />
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Welcome back,</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Arcade Owner</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        {format(now, 'EEE, MMM do · HH:mm:ss')}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', gap: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[0, 1, 2].map(i => <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>Connecting to arcade…</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Machine Status Cards (with delete)
// ─────────────────────────────────────────────────────────────────────────────
function MachineStatusCards({ machines, onDelete, onClearAll }: {
  machines: MachineWithOnline[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  const [confirm, setConfirm] = useState<{ type: 'single' | 'all'; id?: string } | null>(null);

  if (machines.length === 0)
    return <div style={cardStyle}><p style={{ color: 'var(--muted)', fontSize: 13 }}>No machines registered yet.</p></div>;

  return (
    <>
      {confirm && (
        <ConfirmModal
          message={confirm.type === 'all'
            ? 'This will permanently delete ALL machines, their full game history, and all revenue records from the database. The live feed and all analytics will be cleared. This cannot be undone.'
            : `This will permanently delete "${confirm.id}" and ALL its game logs and revenue history. The live feed will be cleared of this machine's sessions. This cannot be undone.`}
          onConfirm={() => { confirm.type === 'all' ? onClearAll() : onDelete(confirm.id!); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {machines.map(m => (
            <div key={m.computer_id} style={{
              ...cardStyle, flex: '1 1 200px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderLeft: `3px solid ${m.is_online ? '#10b981' : '#ef4444'}`,
            }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Machine</p>
                <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{m.computer_id}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Last seen {isValid(parseISO(m.last_seen)) ? format(parseISO(m.last_seen), 'HH:mm:ss') : '—'}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: m.is_online ? '#10b981' : '#ef4444', boxShadow: m.is_online ? '0 0 8px #10b981' : 'none', animation: m.is_online ? 'glow 2s ease-in-out infinite' : 'none' }} />
                  <span style={{ fontSize: 11, color: m.is_online ? '#10b981' : '#ef4444', fontWeight: 600 }}>{m.is_online ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
                <button
                  onClick={() => setConfirm({ type: 'single', id: m.computer_id })}
                  title="Remove machine"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 4, display: 'flex' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {machines.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setConfirm({ type: 'all' })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8, padding: '6px 14px', color: '#ef4444',
                fontSize: 12, cursor: 'pointer',
              }}>
              <Trash2 size={13} /> Clear All Machines
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress Card
// ─────────────────────────────────────────────────────────────────────────────
function ProgressCard({ todayRevenue, dailyTarget }: { todayRevenue: number; dailyTarget: number }) {
  const percent = dailyTarget > 0 ? Math.min(100, (todayRevenue / dailyTarget) * 100) : 0;
  const remaining = Math.max(0, dailyTarget - todayRevenue);
  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Today's Progress</h2>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
          <span>Revenue</span>
          <span>{fmtKSH(todayRevenue)} / {fmtKSH(dailyTarget)}</span>
        </div>
        <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s ease' }} />
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>{remaining > 0 ? `${fmtKSH(remaining)} to go` : 'Target reached! 🎉'}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats Cards
// ─────────────────────────────────────────────────────────────────────────────
function StatsCards({ logs }: { logs: GameLog[] }) {
  const today = todayStr();
  const todayLogs = useMemo(() => logs.filter(l => l.date === today), [logs, today]);
  const revenue = todayLogs.reduce((s, l) => s + l.revenue_ksh, 0);
  const sessions = todayLogs.length;
  const playtime = todayLogs.reduce((s, l) => s + l.duration_minutes, 0);
  const avg = sessions ? (playtime / sessions).toFixed(1) : '—';
  const fullGames = todayLogs.filter(l => l.status === 'FULL GAME').length;
  const cards = [
    { label: "Today's Revenue", value: fmtKSH(revenue), accent: '#10b981' },
    { label: 'Sessions Today', value: String(sessions), accent: '#3b82f6' },
    { label: 'Full Games', value: String(fullGames), accent: '#8b5cf6' },
    { label: 'Avg Duration', value: `${avg} min`, accent: '#f59e0b' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
      {cards.map(c => (
        <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${c.accent}` }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{c.label}</p>
          <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Chart
// ─────────────────────────────────────────────────────────────────────────────
function RevenueChart({ logs }: { logs: GameLog[] }) {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const data = useMemo(() => {
    const today = new Date();
    return Array.from({ length: days }, (_, i) => {
      const day = subDays(today, days - 1 - i);
      const ds = startOfDay(day), de = endOfDay(day);
      const revenue = logs.filter(l => { const d = parseISO(l.start_time); return d >= ds && d <= de; }).reduce((s, l) => s + l.revenue_ksh, 0);
      return { date: format(day, days === 7 ? 'EEE' : 'MMM dd'), revenue: +revenue.toFixed(2) };
    });
  }, [logs, days]);
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={sectionTitle}>Revenue Trend</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: days === d ? 'var(--accent)' : 'var(--surface2)', color: days === d ? '#fff' : 'var(--muted)', transition: 'all 0.15s' }}>{d}d</button>
          ))}
        </div>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} formatter={(v: any) => [fmtKSH(v as number), 'Revenue']} />
            <Area type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} fill="url(#revGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Breakdown Chart
// ─────────────────────────────────────────────────────────────────────────────
function SessionBreakdownChart({ logs }: { logs: GameLog[] }) {
  const data = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const day = subDays(today, 6 - i);
      const ds = startOfDay(day), de = endOfDay(day);
      const dl = logs.filter(l => { const d = parseISO(l.start_time); return d >= ds && d <= de; });
      return { date: format(day, 'EEE'), Full: dl.filter(l => l.status === 'FULL GAME').length, Partial: dl.filter(l => l.status === 'PARTIAL').length, Error: dl.filter(l => l.status === 'ERROR').length };
    });
  }, [logs]);
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
            <Bar dataKey="Full" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Partial" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Error" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
        {[['Full', '#10b981'], ['Partial', '#f59e0b'], ['Error', '#ef4444']].map(([l, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pie Chart
// ─────────────────────────────────────────────────────────────────────────────
function TodayPieChart({ logs }: { logs: GameLog[] }) {
  const today = todayStr();
  const dl = useMemo(() => logs.filter(l => l.date === today), [logs, today]);
  const data = [
    { name: 'Full', value: dl.filter(l => l.status === 'FULL GAME').length, color: '#10b981' },
    { name: 'Partial', value: dl.filter(l => l.status === 'PARTIAL').length, color: '#f59e0b' },
    { name: 'Error', value: dl.filter(l => l.status === 'ERROR').length, color: '#ef4444' },
  ].filter(d => d.value > 0);
  if (data.length === 0) return <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180 }}><p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions today yet</p></div>;
  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Today's Breakdown</h2>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top Games
// ─────────────────────────────────────────────────────────────────────────────
function TopGames({ logs }: { logs: GameLog[] }) {
  const today = todayStr();
  const dl = useMemo(() => logs.filter(l => l.date === today), [logs, today]);
  const ranked = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    dl.forEach(l => { const p = map.get(l.game_name) ?? { count: 0, revenue: 0 }; map.set(l.game_name, { count: p.count + 1, revenue: p.revenue + l.revenue_ksh }); });
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  }, [dl]);
  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Top Games Today</h2>
      {ranked.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions yet today</p> :
        ranked.map(([name, stats], i) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < ranked.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 16 }}>#{i + 1}</span>
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Summary (Analytics tab)
// ─────────────────────────────────────────────────────────────────────────────
function DailySummary({ logs }: { logs: GameLog[] }) {
  const [date, setDate] = useState(todayStr());
  const dl = useMemo(() => logs.filter(l => l.date === date), [logs, date]);
  const full = dl.filter(l => l.status === 'FULL GAME').length;
  const partial = dl.filter(l => l.status === 'PARTIAL').length;
  const errors = dl.filter(l => l.status === 'ERROR').length;
  const revenue = dl.reduce((s, l) => s + l.revenue_ksh, 0);
  const playtime = dl.reduce((s, l) => s + l.duration_minutes, 0);
  const avg = dl.length ? (playtime / dl.length).toFixed(1) : '—';
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={sectionTitle}>Daily Summary</h2>
        <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)}
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, cursor: 'pointer', outline: 'none' }} />
      </div>
      {dl.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions found for {date}</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
          {[
            { label: 'Sessions', value: String(dl.length) },
            { label: 'Revenue', value: fmtKSH(revenue) },
            { label: 'Full Games', value: String(full) },
            { label: 'Partial', value: String(partial) },
            { label: 'Errors', value: String(errors) },
            { label: 'Total Time', value: `${playtime.toFixed(0)} min` },
            { label: 'Avg Session', value: `${avg} min` },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{c.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Machine color palette — consistent across all views
// ─────────────────────────────────────────────────────────────────────────────
const MACHINE_COLORS = [
  { bg: 'rgba(99,102,241,0.15)', border: '#6366f1', text: '#818cf8' },   // indigo
  { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#34d399' },   // green
  { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', text: '#fbbf24' },   // amber
  { bg: 'rgba(239,68,68,0.15)',  border: '#ef4444', text: '#f87171' },   // red
  { bg: 'rgba(59,130,246,0.15)', border: '#3b82f6', text: '#60a5fa' },   // blue
];

function getMachineColor(machineId: string, allMachineIds: string[]) {
  const idx = allMachineIds.indexOf(machineId);
  return MACHINE_COLORS[idx >= 0 ? idx % MACHINE_COLORS.length : 0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Sessions Table — with machine filter tabs + colored badges
// ─────────────────────────────────────────────────────────────────────────────
function RecentSessionsTable({ logs }: { logs: GameLog[] }) {
  const [machineFilter, setMachineFilter] = useState<string>('all');

  const allMachineIds = useMemo(() =>
    [...new Set(logs.map(l => l.computer_id))].sort(),
  [logs]);

  const displayed = useMemo(() => {
    const base = machineFilter === 'all' ? logs : logs.filter(l => l.computer_id === machineFilter);
    return base.slice(0, 20);
  }, [logs, machineFilter]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--muted)',
  });

  return (
    <div style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={sectionTitle}>Live Session Feed</h2>
        {allMachineIds.length > 1 && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24 }}>
            <button style={tabStyle(machineFilter === 'all')} onClick={() => setMachineFilter('all')}>All</button>
            {allMachineIds.map(id => {
              const mc = getMachineColor(id, allMachineIds);
              return (
                <button key={id} onClick={() => setMachineFilter(id)}
                  style={{
                    ...tabStyle(machineFilter === id),
                    background: machineFilter === id ? mc.border : 'transparent',
                    color: machineFilter === id ? '#fff' : mc.text,
                  }}>
                  {id}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Time', 'Machine', 'Game', 'Duration', 'Revenue', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((log, i) => {
              const t = parseISO(log.start_time);
              const mc = getMachineColor(log.computer_id, allMachineIds);
              return (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.1s' }}>
                  <td style={tdStyle}>{isValid(t) ? format(t, 'HH:mm:ss') : '—'}</td>
                  <td style={{ ...tdStyle }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                      background: mc.bg, color: mc.text, fontWeight: 700, fontSize: 11,
                      border: `1px solid ${mc.border}30`,
                    }}>{log.computer_id}</span>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{log.game_name}</td>
                  <td style={tdStyle}>{log.duration_minutes.toFixed(1)} min</td>
                  <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{fmtKSH(log.revenue_ksh)}</td>
                  <td style={tdStyle}>
                    <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusBg(log.status), color: statusColor(log.status), letterSpacing: '0.04em' }}>{log.status}</span>
                  </td>
                </tr>
              );
            })}
            {displayed.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Waiting for sessions…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY VIEW — with filter tabs, date picker, daily totals banner
// ─────────────────────────────────────────────────────────────────────────────
type ActivityFilter = 'today' | 'week' | 'month' | 'custom';

function DayTotalBanner({ logs, date, machineFilter, allMachineIds }: {
  logs: GameLog[]; date: string; machineFilter: string; allMachineIds: string[];
}) {
  const dl = logs.filter(l => l.date === date && (machineFilter === 'all' || l.computer_id === machineFilter));
  if (dl.length === 0) return null;

  const totals = (rows: GameLog[]) => ({
    sessions: rows.length,
    revenue: rows.reduce((s, l) => s + l.revenue_ksh, 0),
    full: rows.filter(l => l.status === 'FULL GAME').length,
    partial: rows.filter(l => l.status === 'PARTIAL').length,
    errors: rows.filter(l => l.status === 'ERROR').length,
    playtime: rows.reduce((s, l) => s + l.duration_minutes, 0),
  });

  const overall = totals(dl);

  // Per-machine breakdown only when viewing all machines and >1 machine present
  const machineBreakdown = machineFilter === 'all' && allMachineIds.length > 1
    ? allMachineIds.map(id => ({ id, mc: getMachineColor(id, allMachineIds), t: totals(dl.filter(l => l.computer_id === id)) })).filter(x => x.t.sessions > 0)
    : [];

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0.05) 100%)',
      border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 12, padding: '14px 18px', marginBottom: 12,
    }}>
      {/* Date + overall totals */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={15} color="var(--accent)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {date === todayStr() ? 'Today' : format(parseISO(date), 'EEEE, MMM d')}
          </span>
          {machineFilter !== 'all' && (
            <span style={{ fontSize: 11, color: getMachineColor(machineFilter, allMachineIds).text, fontWeight: 600, marginLeft: 4 }}>
              · {machineFilter}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginLeft: 'auto' }}>
          {[
            { label: 'Sessions', value: String(overall.sessions), color: 'var(--text)' },
            { label: 'Revenue', value: fmtKSH(overall.revenue), color: '#10b981' },
            { label: 'Full', value: String(overall.full), color: '#10b981' },
            { label: 'Partial', value: String(overall.partial), color: '#f59e0b' },
            { label: 'Errors', value: String(overall.errors), color: '#ef4444' },
            { label: 'Playtime', value: `${overall.playtime.toFixed(0)}m`, color: 'var(--muted)' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: 'var(--font-display)' }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-machine breakdown row */}
      {machineBreakdown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(99,102,241,0.2)' }}>
          {machineBreakdown.map(({ id, mc, t }) => (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
              background: mc.bg, border: `1px solid ${mc.border}40`, borderRadius: 8,
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 700, color: mc.text }}>{id}</span>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span style={{ color: 'var(--text)' }}>{t.sessions} sessions</span>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>{fmtKSH(t.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MachineSessionTable({ logs, allMachineIds, showMachineCol }: {
  logs: GameLog[]; allMachineIds: string[]; showMachineCol: boolean;
}) {
  if (logs.length === 0) return (
    <p style={{ padding: '16px', color: 'var(--muted)', fontSize: 13 }}>No sessions.</p>
  );
  const cols = showMachineCol
    ? ['Time', 'Machine', 'Game', 'Duration', 'Revenue', 'Status']
    : ['Time', 'Game', 'Duration', 'Revenue', 'Status'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--surface2)' }}>
            {cols.map(h => (
              <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const t = parseISO(log.start_time);
            const mc = getMachineColor(log.computer_id, allMachineIds);
            return (
              <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={tdStyle}>{isValid(t) ? format(t, 'HH:mm:ss') : '—'}</td>
                {showMachineCol && (
                  <td style={{ ...tdStyle }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: mc.bg, color: mc.text, fontWeight: 700, fontSize: 11, border: `1px solid ${mc.border}30` }}>
                      {log.computer_id}
                    </span>
                  </td>
                )}
                <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{log.game_name}</td>
                <td style={tdStyle}>{log.duration_minutes.toFixed(1)} min</td>
                <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{fmtKSH(log.revenue_ksh)}</td>
                <td style={tdStyle}>
                  <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusBg(log.status), color: statusColor(log.status) }}>{log.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActivityView({ logs }: { logs: GameLog[] }) {
  const [filter, setFilter] = useState<ActivityFilter>('today');
  const [customDate, setCustomDate] = useState(todayStr());
  const [machineFilter, setMachineFilter] = useState<string>('all');

  const allMachineIds = useMemo(() =>
    [...new Set(logs.map(l => l.computer_id))].sort(),
  [logs]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    if (filter === 'today') return { rangeStart: startOfDay(now), rangeEnd: endOfDay(now) };
    if (filter === 'week') return { rangeStart: startOfWeek(now, { weekStartsOn: 1 }), rangeEnd: endOfWeek(now, { weekStartsOn: 1 }) };
    if (filter === 'month') return { rangeStart: startOfMonth(now), rangeEnd: endOfMonth(now) };
    const d = parseISO(customDate);
    return { rangeStart: startOfDay(d), rangeEnd: endOfDay(d) };
  }, [filter, customDate]);

  const filtered = useMemo(() =>
    logs.filter(l => {
      const d = parseISO(l.start_time);
      return d >= rangeStart && d <= rangeEnd &&
        (machineFilter === 'all' || l.computer_id === machineFilter);
    }),
  [logs, rangeStart, rangeEnd, machineFilter]);

  // Group by date desc
  const groupedByDate = useMemo(() => {
    const map = new Map<string, GameLog[]>();
    filtered.forEach(l => { const a = map.get(l.date) ?? []; a.push(l); map.set(l.date, a); });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--muted)',
  });

  const machineTabStyle = (id: string): React.CSSProperties => {
    const active = machineFilter === id;
    const mc = id === 'all' ? null : getMachineColor(id, allMachineIds);
    return {
      padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
      fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
      background: active ? (mc ? mc.border : 'var(--accent)') : 'transparent',
      color: active ? '#fff' : (mc ? mc.text : 'var(--muted)'),
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filter bar */}
      <div style={{ ...cardStyle, padding: '14px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
            <Filter size={14} color="var(--muted)" />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Period:</span>
          </div>
          {(['today', 'week', 'month', 'custom'] as ActivityFilter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={filterBtnStyle(filter === f)}>
              {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'Pick Date'}
            </button>
          ))}
          {filter === 'custom' && (
            <input type="date" value={customDate} max={todayStr()} onChange={e => setCustomDate(e.target.value)}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, cursor: 'pointer', outline: 'none' }} />
          )}
          {/* Machine tabs — only shown when >1 machine exists */}
          {allMachineIds.length > 1 && (
            <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24, marginLeft: 'auto' }}>
              <button style={machineTabStyle('all')} onClick={() => setMachineFilter('all')}>All</button>
              {allMachineIds.map(id => (
                <button key={id} style={machineTabStyle(id)} onClick={() => setMachineFilter(id)}>{id}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {groupedByDate.length === 0 ? (
        <div style={cardStyle}><p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions found for this period.</p></div>
      ) : groupedByDate.map(([date, dayLogs]) => (
        <div key={date}>
          <DayTotalBanner logs={logs} date={date} machineFilter={machineFilter} allMachineIds={allMachineIds} />

          {/* When viewing ALL machines: show one sub-table per machine */}
          {machineFilter === 'all' && allMachineIds.length > 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allMachineIds.map(machineId => {
                const machineLogs = dayLogs.filter(l => l.computer_id === machineId);
                if (machineLogs.length === 0) return null;
                const mc = getMachineColor(machineId, allMachineIds);
                return (
                  <div key={machineId} style={{ ...cardStyle, padding: 0, overflow: 'hidden', borderLeft: `3px solid ${mc.border}` }}>
                    <div style={{ padding: '10px 16px', background: mc.bg, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: mc.text }}>{machineId}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        · {machineLogs.length} session{machineLogs.length !== 1 ? 's' : ''} · {fmtKSH(machineLogs.reduce((s, l) => s + l.revenue_ksh, 0))}
                      </span>
                    </div>
                    <MachineSessionTable logs={machineLogs} allMachineIds={allMachineIds} showMachineCol={false} />
                  </div>
                );
              })}
            </div>
          ) : (
            /* Single machine view — clean table, no machine column needed */
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <MachineSessionTable logs={dayLogs} allMachineIds={allMachineIds} showMachineCol={false} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME INTELLIGENCE VIEW (replaces Resources)
// ─────────────────────────────────────────────────────────────────────────────
function GameIntelligenceView({ logs }: { logs: GameLog[] }) {
  const [sortBy, setSortBy] = useState<'revenue' | 'sessions' | 'avg_duration'>('revenue');
  const [period, setPeriod] = useState<7 | 30 | 90 | 999>(30);
  const [machineFilter, setMachineFilter] = useState<string>('all');

  const allMachineIds = useMemo(() =>
    [...new Set(logs.map(l => l.computer_id))].sort(),
  [logs]);

  const filtered = useMemo(() => {
    const byPeriod = period === 999 ? logs : logs.filter(l => parseISO(l.start_time) >= startOfDay(subDays(new Date(), period)));
    return machineFilter === 'all' ? byPeriod : byPeriod.filter(l => l.computer_id === machineFilter);
  }, [logs, period, machineFilter]);

  const gameStats = useMemo(() => {
    const map = new Map<string, { sessions: number; revenue: number; full: number; partial: number; errors: number; total_minutes: number }>();
    filtered.forEach(l => {
      const p = map.get(l.game_name) ?? { sessions: 0, revenue: 0, full: 0, partial: 0, errors: 0, total_minutes: 0 };
      map.set(l.game_name, {
        sessions: p.sessions + 1,
        revenue: p.revenue + l.revenue_ksh,
        full: p.full + (l.status === 'FULL GAME' ? 1 : 0),
        partial: p.partial + (l.status === 'PARTIAL' ? 1 : 0),
        errors: p.errors + (l.status === 'ERROR' ? 1 : 0),
        total_minutes: p.total_minutes + l.duration_minutes,
      });
    });
    return [...map.entries()].map(([name, s]) => ({
      name, ...s,
      avg_duration: s.sessions > 0 ? s.total_minutes / s.sessions : 0,
      completion_rate: s.sessions > 0 ? Math.round((s.full / s.sessions) * 100) : 0,
    })).sort((a, b) => b[sortBy] - a[sortBy]);
  }, [filtered, sortBy]);

  const totalRevenue = gameStats.reduce((s, g) => s + g.revenue, 0);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: active ? 'var(--accent)' : 'var(--surface2)', color: active ? '#fff' : 'var(--muted)', transition: 'all 0.15s',
  });

  const machineTabStyle = (id: string): React.CSSProperties => {
    const active = machineFilter === id;
    const mc = id === 'all' ? null : getMachineColor(id, allMachineIds);
    return {
      padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
      fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
      background: active ? (mc ? mc.border : 'var(--accent)') : 'transparent',
      color: active ? '#fff' : (mc ? mc.text : 'var(--muted)'),
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Summary KPIs — scoped to active machine filter */}
      {allMachineIds.length > 1 && machineFilter !== 'all' && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: getMachineColor(machineFilter, allMachineIds).bg, border: `1px solid ${getMachineColor(machineFilter, allMachineIds).border}40`, fontSize: 13, color: getMachineColor(machineFilter, allMachineIds).text, fontWeight: 600 }}>
          Filtered to: {machineFilter}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Unique Games', value: String(gameStats.length), icon: <Gamepad2 size={18} color="var(--accent)" />, accent: 'var(--accent)' },
          { label: 'Total Revenue', value: fmtKSH(totalRevenue), icon: <TrendingUp size={18} color="#10b981" />, accent: '#10b981' },
          { label: 'Total Sessions', value: String(filtered.length), icon: <Award size={18} color="#3b82f6" />, accent: '#3b82f6' },
          { label: 'Total Playtime', value: `${(filtered.reduce((s, l) => s + l.duration_minutes, 0) / 60).toFixed(1)}h`, icon: <Clock size={18} color="#f59e0b" />, accent: '#f59e0b' },
        ].map(c => (
          <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${c.accent}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>{c.icon}</div>
            <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{c.label}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={sectionTitle}>Game Leaderboard</h2>
            {allMachineIds.length > 1 && (
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24 }}>
                <button style={machineTabStyle('all')} onClick={() => setMachineFilter('all')}>All Machines</button>
                {allMachineIds.map(id => (
                  <button key={id} style={machineTabStyle(id)} onClick={() => setMachineFilter(id)}>{id}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sort:</span>
            <button onClick={() => setSortBy('revenue')} style={btnStyle(sortBy === 'revenue')}>Revenue</button>
            <button onClick={() => setSortBy('sessions')} style={btnStyle(sortBy === 'sessions')}>Sessions</button>
            <button onClick={() => setSortBy('avg_duration')} style={btnStyle(sortBy === 'avg_duration')}>Avg Duration</button>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>Period:</span>
            {([7, 30, 90, 999] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={btnStyle(period === p)}>{p === 999 ? 'All' : `${p}d`}</button>
            ))}
            {machineFilter !== 'all' && (
              <span style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 20, background: getMachineColor(machineFilter, allMachineIds).bg, color: getMachineColor(machineFilter, allMachineIds).text, fontWeight: 600 }}>
                Showing: {machineFilter}
              </span>
            )}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['#', 'Game', 'Sessions', 'Revenue', 'Full %', 'Avg Duration', 'Rev/Session'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gameStats.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No data for this period.</td></tr>
              ) : gameStats.map((g, i) => {
                const revenueShare = totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0;
                return (
                  <tr key={g.name} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: i < 3 ? 'var(--accent)' : 'var(--muted)' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <div>{g.name}</div>
                      <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, marginTop: 4, maxWidth: 120 }}>
                        <div style={{ height: '100%', width: `${revenueShare}%`, background: 'var(--accent)', borderRadius: 2 }} />
                      </div>
                    </td>
                    <td style={tdStyle}>{g.sessions}</td>
                    <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{fmtKSH(g.revenue)}</td>
                    <td style={tdStyle}>
                      <span style={{ color: g.completion_rate >= 70 ? '#10b981' : g.completion_rate >= 40 ? '#f59e0b' : '#ef4444' }}>
                        {g.completion_rate}%
                      </span>
                    </td>
                    <td style={tdStyle}>{g.avg_duration.toFixed(1)} min</td>
                    <td style={{ ...tdStyle, color: 'var(--text)' }}>{fmtKSH(g.sessions > 0 ? g.revenue / g.sessions : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Machine Pricing Overrides
// ─────────────────────────────────────────────────────────────────────────────
function MachinePricingOverrides({
  machines,
  globalConfig,
}: {
  machines: MachineWithOnline[];
  globalConfig: PricingConfig | null;
}) {
  // Local state: per-machine form values keyed by computer_id
  const [forms, setForms] = useState<Record<string, {
    label: string;
    custom_rate_per_full_game: string;
    custom_rate_per_minute: string;
  }>>({});
  const [saving, setSaving] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'error'>>({});

  // Initialise form state whenever machines list changes
  useEffect(() => {
    const init: typeof forms = {};
    machines.forEach(m => {
      init[m.computer_id] = {
        label: m.label && m.label !== m.computer_id ? m.label : '',
        custom_rate_per_full_game: m.custom_rate_per_full_game != null ? String(m.custom_rate_per_full_game) : '',
        custom_rate_per_minute: m.custom_rate_per_minute != null ? String(m.custom_rate_per_minute) : '',
      };
    });
    setForms(init);
  }, [machines]);

  const saveMachine = async (computerId: string) => {
    const f = forms[computerId];
    if (!f) return;
    setSaving(p => ({ ...p, [computerId]: 'saving' }));
    try {
      const payload = {
        computer_id: computerId,
        label: f.label.trim() || computerId,
        custom_rate_per_full_game: f.custom_rate_per_full_game === '' ? null : Number(f.custom_rate_per_full_game),
        custom_rate_per_minute: f.custom_rate_per_minute === '' ? null : Number(f.custom_rate_per_minute),
      };
      const { error } = await supabase
        .from('machine_pricing')
        .upsert(payload, { onConflict: 'computer_id' });
      if (error) throw error;
      setSaving(p => ({ ...p, [computerId]: 'ok' }));
      setTimeout(() => setSaving(p => ({ ...p, [computerId]: 'idle' })), 2500);
    } catch (err) {
      console.error('Machine pricing save error:', err);
      setSaving(p => ({ ...p, [computerId]: 'error' }));
      setTimeout(() => setSaving(p => ({ ...p, [computerId]: 'idle' })), 3000);
    }
  };

  if (machines.length === 0) return null;

  const globalFullRate = globalConfig?.rate_per_full_game ?? 200;
  const globalMinRate = globalConfig?.rate_per_minute ?? 30;

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 28, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
          Machine-Specific Pricing
        </h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Override the global rate for individual machines. Leave a field blank to inherit the global rate.
          The VR script picks up changes on its next 60-second heartbeat.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {machines.map(m => {
          const f = forms[m.computer_id] ?? { label: '', custom_rate_per_full_game: '', custom_rate_per_minute: '' };
          const status = saving[m.computer_id] ?? 'idle';
          const effectiveFull = f.custom_rate_per_full_game !== '' ? Number(f.custom_rate_per_full_game) : globalFullRate;
          const effectiveMin = f.custom_rate_per_minute !== '' ? Number(f.custom_rate_per_minute) : globalMinRate;

          return (
            <div key={m.computer_id} style={{
              background: 'var(--surface2)', borderRadius: 12,
              border: '1px solid var(--border)', padding: '16px 20px',
            }}>
              {/* Machine header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{
                  width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: m.is_online ? '#10b981' : '#ef4444',
                  boxShadow: m.is_online ? '0 0 6px #10b981' : 'none',
                }} />
                <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
                  {m.computer_id}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 2 }}>
                  {m.is_online ? '· Online' : '· Offline'}
                </span>
              </div>

              {/* Form grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {/* Display label */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Display Name
                  </label>
                  <input
                    type="text"
                    placeholder={m.computer_id}
                    value={f.label}
                    onChange={e => setForms(p => ({ ...p, [m.computer_id]: { ...f, label: e.target.value } }))}
                    style={{ ...inputStyle, fontSize: 13 }}
                  />
                </div>

                {/* Custom full game rate */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Full Game Rate (KSH)
                  </label>
                  <input
                    type="number"
                    placeholder={`Global: ${globalFullRate}`}
                    value={f.custom_rate_per_full_game}
                    onChange={e => setForms(p => ({ ...p, [m.computer_id]: { ...f, custom_rate_per_full_game: e.target.value } }))}
                    style={{ ...inputStyle, fontSize: 13 }}
                    min="0" step="10"
                  />
                </div>

                {/* Custom per-minute rate */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Per Minute Rate (KSH)
                  </label>
                  <input
                    type="number"
                    placeholder={`Global: ${globalMinRate}`}
                    value={f.custom_rate_per_minute}
                    onChange={e => setForms(p => ({ ...p, [m.computer_id]: { ...f, custom_rate_per_minute: e.target.value } }))}
                    style={{ ...inputStyle, fontSize: 13 }}
                    min="0" step="5"
                  />
                </div>
              </div>

              {/* Effective rate preview + save */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Effective: <span style={{ color: '#10b981', fontWeight: 600 }}>KSH {effectiveFull} / full game</span>
                  {' · '}
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>KSH {effectiveMin} / min</span>
                  {f.custom_rate_per_full_game === '' && f.custom_rate_per_minute === ''
                    ? <span style={{ color: 'var(--muted)', marginLeft: 6 }}>(using global)</span>
                    : <span style={{ color: 'var(--accent)', marginLeft: 6 }}>(overridden)</span>
                  }
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {status === 'ok' && <span style={{ fontSize: 12, color: '#10b981' }}>✓ Saved</span>}
                  {status === 'error' && <span style={{ fontSize: 12, color: '#ef4444' }}>✗ Failed</span>}
                  <button
                    onClick={() => saveMachine(m.computer_id)}
                    disabled={status === 'saving'}
                    style={{
                      padding: '7px 18px', borderRadius: 8, border: 'none', cursor: status === 'saving' ? 'not-allowed' : 'pointer',
                      background: status === 'saving' ? 'var(--surface)' : 'var(--accent)',
                      color: status === 'saving' ? 'var(--muted)' : '#fff',
                      fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                    }}
                  >
                    {status === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings View
// ─────────────────────────────────────────────────────────────────────────────
function SettingsView({
  settings,
  updateSettings,
}: {
  settings: ArcadeSettings | null;
  updateSettings: (updates: Partial<ArcadeSettings>) => Promise<any>;
}) {
  const [form, setForm] = useState({
    price_per_full_game: 400,
    daily_target_ksh: 4000,
    full_game_min_minutes: 4,
    error_max_minutes: 2,
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  useEffect(() => {
    if (settings) {
      setForm({
        price_per_full_game: settings.price_per_full_game,
        daily_target_ksh: settings.daily_target_ksh,
        full_game_min_minutes: settings.full_game_min_minutes,
        error_max_minutes: settings.error_max_minutes,
      });
    }
  }, [settings]);

  const handleNumberChange = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const num = raw === '' ? 0 : parseFloat(raw);
    setForm(prev => ({ ...prev, [field]: num }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus('idle');
    const err = await updateSettings(form);
    setSaving(false);
    setSaveStatus(err ? 'error' : 'ok');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  if (!settings) return <div style={cardStyle}>Loading settings…</div>;

  return (
    <div style={cardStyle}>
      <h2 style={sectionTitle}>Arcade Configuration</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
        These settings are saved to the cloud and applied to all VR machines.
      </p>
      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
            Price per Full Game (KSH)
          </label>
          <input
            type="number"
            value={form.price_per_full_game}
            onChange={handleNumberChange('price_per_full_game')}
            style={inputStyle}
            step="10"
            min="0"
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
            Daily Revenue Target (KSH)
          </label>
          <input
            type="number"
            value={form.daily_target_ksh}
            onChange={handleNumberChange('daily_target_ksh')}
            style={inputStyle}
            step="100"
            min="0"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Full Game Min (mins)
            </label>
            <input
              type="number"
              value={form.full_game_min_minutes}
              onChange={handleNumberChange('full_game_min_minutes')}
              style={inputStyle}
              step="1"
              min="1"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Error Max (mins)
            </label>
            <input
              type="number"
              value={form.error_max_minutes}
              onChange={handleNumberChange('error_max_minutes')}
              style={inputStyle}
              step="1"
              min="0"
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              background: saving ? 'var(--surface2)' : '#10b981',
              color: saving ? 'var(--muted)' : '#fff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saveStatus === 'ok' && <span style={{ fontSize: 13, color: '#10b981' }}>✓ Saved</span>}
          {saveStatus === 'error' && <span style={{ fontSize: 13, color: '#ef4444' }}>✗ Failed</span>}
        </div>
      </form>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { logs, setLogs, loading } = useGameLogs(1000);
  const { machines, setMachines, refetch: refetchMachines } = useMachineStatus();
 const { settings, loading: settingsLoading, updateSettings } = useArcadeSettings();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [now, setNow] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    const check = () => setSidebarCollapsed(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── MACHINE DELETE FUNCTIONS ─────────────────────────────────────────────────

  const deleteMachine = async (computerId: string) => {
    try {
      // 1. Optimistically update both UI states immediately
      setMachines(prev => prev.filter(m => m.computer_id !== computerId));
      setLogs(prev => prev.filter(l => l.computer_id !== computerId));

      // 2. Delete machine_status row
      const { error: machineError } = await supabase
        .from('machine_status')
        .delete()
        .eq('computer_id', computerId);
      if (machineError) throw machineError;

      // 3. Delete all game_logs for this machine
      const { error: logsError } = await supabase
        .from('game_logs')
        .delete()
        .eq('computer_id', computerId);
      if (logsError) throw logsError;

      // 4. Delete machine_pricing override row if it exists
      await supabase
        .from('machine_pricing')
        .delete()
        .eq('computer_id', computerId);
      // Pricing delete failure is non-fatal — ignore error

    } catch (err) {
      console.error('Error deleting machine:', err);
      alert('Failed to delete machine. Check console for details.');
      // Roll back both states
      refetchMachines();
    }
  };

  const clearAllMachines = async () => {
    try {
      const ids = machines.map(m => m.computer_id);

      // 1. Optimistically clear both UI states immediately
      setMachines([]);
      setLogs([]);

      if (ids.length === 0) return;

      // 2. Delete all machine_status rows
      const { error: machineError } = await supabase
        .from('machine_status')
        .delete()
        .in('computer_id', ids);
      if (machineError) throw machineError;

      // 3. Delete all game_logs for these machines
      const { error: logsError } = await supabase
        .from('game_logs')
        .delete()
        .in('computer_id', ids);
      if (logsError) throw logsError;

      // 4. Delete all machine_pricing override rows
      await supabase
        .from('machine_pricing')
        .delete()
        .in('computer_id', ids);

    } catch (err) {
      console.error('Error clearing machines:', err);
      alert('Failed to clear machines. Check console for details.');
      refetchMachines();
    }
  };

  const todayRevenue = useMemo(() => {
    const today = todayStr();
    return logs.filter(l => l.date === today).reduce((s, l) => s + l.revenue_ksh, 0);
  }, [logs]);

 
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0d0f14; --surface: #151820; --surface2: #1c1f29;
          --border: rgba(255,255,255,0.07); --text: #f0f2f8;
          --muted: #6b7280; --accent: #6366f1;
          --font-display: 'DM Sans', sans-serif; --font-body: 'DM Sans', sans-serif;
        }
        body { background: var(--bg); color: var(--text); font-family: var(--font-body); min-height: 100vh; }
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 6px #10b981} 50%{box-shadow:0 0 14px #10b981,0 0 4px #10b981} }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        tr:hover td { background: rgba(255,255,255,0.02) !important; }
        select option { background: #1c1f29; color: #f0f2f8; }
        @media (max-width: 767px) {
          .mobile-overlay { display: block !important; }
        }
      `}</style>

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar
          active={activeTab}
          onNavigate={(id) => { setActiveTab(id); if (window.innerWidth < 768) setSidebarCollapsed(true); }}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(p => !p)}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Header now={now} onMenuToggle={() => setSidebarCollapsed(p => !p)} />
          <main style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
            {activeTab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <MachineStatusCards machines={machines} onDelete={deleteMachine} onClearAll={clearAllMachines} />
                <ProgressCard todayRevenue={todayRevenue} dailyTarget={settings?.daily_target_ksh || 4000} />
                <StatsCards logs={logs} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                  <TodayPieChart logs={logs} />
                  <TopGames logs={logs} />
                </div>
                <RecentSessionsTable logs={logs} />
              </div>
            )}
            {activeTab === 'analytics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <RevenueChart logs={logs} />
                <SessionBreakdownChart logs={logs} />
                <DailySummary logs={logs} />
              </div>
            )}
            {activeTab === 'activity' && <ActivityView logs={logs} />}
            {activeTab === 'intelligence' && <GameIntelligenceView logs={logs} />}
            {activeTab === 'settings' && (<SettingsView settings={settings} updateSettings={updateSettings} />)}
          </main>
        </div>
      </div>
    </>
  );
}