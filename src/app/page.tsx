"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  TrendingUp, Clock, Award, Gamepad2, LockKeyhole, RefreshCw,
  PartyPopper, Download, Users, UserPlus, ShieldCheck, Shield, LogOut, ChevronLeft, CheckCircle, Bell,
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
  status: 'FULL GAME' | 'ERROR' | 'TEST';
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
interface ArcadeUser {
  id: string;
  name: string;
  pin_hash: string;
  role: 'owner' | 'supervisor';
  created_at: string;
}
interface ActiveSession {
  userId: string;
  name: string;
  role: 'owner' | 'supervisor';
}
// PIN hashing using Web Crypto (SHA-256 + salt) — never stores plain PINs
const PIN_SALT = 'arcade_vr_kiosk_2025';
async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin + PIN_SALT);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return (await hashPin(pin)) === hash;
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
  pin_code: string | null;
  updated_at: string;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtKSH = (n: number) =>
  `KSH ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const statusColor = (s: string) =>
  s === 'FULL GAME' ? '#10b981' : s === 'ERROR' ? '#ef4444' : '#6b7280';
const statusBg = (s: string) =>
  s === 'FULL GAME' ? 'rgba(16,185,129,0.15)' : s === 'ERROR' ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)';



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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_logs' },
        (payload) => setLogs(prev => prev.map(l => l.id === (payload.new as GameLog).id ? payload.new as GameLog : l)))
      .subscribe();
    return () => { channel?.unsubscribe(); };
  }, [limit]);
  return { logs, setLogs, loading };
}

function useMachineStatus() {
  const [machines, setMachines] = useState<MachineStatus[]>([]);

  const fetchMachines = useCallback(async () => {
    const { data: statusData, error } = await supabase
      .from('machine_status')
      .select('*');

    if (statusData && !error) {
      setMachines(statusData as MachineStatus[]);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
    const ch = supabase.channel('machine_status_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_status' }, () => fetchMachines())
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [fetchMachines]);

  const now = Date.now();

  return {
    // We map over them just to calculate the online/offline status based on the 5-minute window
    machines: machines.map(m => ({
      ...m,
      is_online: new Date(m.last_seen).getTime() > now - 5 * 60 * 1000,
      label: m.computer_id, // Fallback since we removed custom labels
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

  return { settings, loading, updateSettings, refetch: fetchSettings }; // 👈 add refetch
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
// Login Screen — pick name → enter PIN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin, onFirstSetup, onBack }: {
  users: ArcadeUser[];
  onLogin: (user: ArcadeUser) => void;
  onFirstSetup: () => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<'pick' | 'pin' | 'register'>('pick');
  const [selectedUser, setSelectedUser] = useState<ArcadeUser | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  // First-time setup state
  const [regName, setRegName] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regError, setRegError] = useState('');
  const [regSaving, setRegSaving] = useState(false);

  const isFirstTime = users.length === 0;

  const handleSelectUser = (user: ArcadeUser) => {
    setSelectedUser(user);
    setPinInput('');
    setPinError('');
    setStep('pin');
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || pinInput.length !== 4) return;
    setChecking(true);
    const ok = await verifyPin(pinInput, selectedUser.pin_hash);
    setChecking(false);
    if (ok) {
      onLogin(selectedUser);
    } else {
      setPinError('Wrong PIN. Try again.');
      setPinInput('');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    if (!regName.trim()) { setRegError('Please enter your name.'); return; }
    if (regPin.length !== 4) { setRegError('PIN must be exactly 4 digits.'); return; }
    if (regPin !== regConfirm) { setRegError('PINs do not match.'); return; }
    setRegSaving(true);
    const pin_hash = await hashPin(regPin);
    const { data, error } = await supabase.from('arcade_users').insert({
      name: regName.trim(),
      pin_hash,
      role: isFirstTime ? 'owner' : 'supervisor',
    }).select().single();
    setRegSaving(false);
    if (error) { setRegError('Could not save. Name may already exist.'); return; }
    await onFirstSetup();
    if (data) onLogin(data as ArcadeUser);
  };

  const sharedStyles = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0f14; --surface: #151820; --surface2: #1c1f29;
      --border: rgba(255,255,255,0.07); --text: #f0f2f8;
      --muted: #6b7280; --accent: #6366f1;
    }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; }
    @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }
    @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-40px) scale(1.08)} 66%{transform:translate(-20px,20px) scale(0.95)} }
    @keyframes float2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-40px,30px) scale(1.1)} 66%{transform:translate(25px,-25px) scale(0.92)} }
    @keyframes float3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(20px,35px) scale(1.06)} }
    .auth-card { animation: fadeIn 0.25s ease; }
    .orb1 { position:absolute; width:280px; height:280px; border-radius:50%; background:rgba(99,102,241,0.12); animation:float1 12s ease-in-out infinite; top:-60px; left:-80px; pointer-events:none; }
    .orb2 { position:absolute; width:200px; height:200px; border-radius:50%; background:rgba(16,185,129,0.07); animation:float2 16s ease-in-out infinite; bottom:-40px; right:-50px; pointer-events:none; }
    .orb3 { position:absolute; width:140px; height:140px; border-radius:50%; background:rgba(99,102,241,0.06); animation:float3 10s ease-in-out infinite; top:40%; right:8%; pointer-events:none; }
    .user-btn:hover { background: rgba(99,102,241,0.12) !important; border-color: rgba(99,102,241,0.4) !important; }
    .user-btn:hover .user-btn-name { color: #a5b4fc !important; }
  `;

  const wrap = (children: React.ReactNode) => (
    <>
      <style>{sharedStyles}</style>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
        <div className="orb1" /><div className="orb2" /><div className="orb3" />
        <div className="auth-card" style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, padding: 36, width: 380, maxWidth: '92%',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)', position: 'relative', zIndex: 1,
        }}>
          {children}
        </div>
      </div>
    </>
  );

  // ── First-time setup / register ──────────────────────────────────────────
  if (isFirstTime || step === 'register') {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserPlus size={24} color="var(--accent)" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, color: 'var(--text)', marginBottom: 4 }}>
              {isFirstTime ? 'Create Owner Account' : 'Add Your Account'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              {isFirstTime
                ? 'No users yet. Create the first owner account to get started.'
                : 'Register with a name and a 4-digit PIN.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Your Name</label>
            <input
              type="text"
              value={regName}
              onChange={e => setRegName(e.target.value)}
              placeholder="e.g. James"
              autoFocus
              style={{ width: '100%', padding: '11px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Choose a 4-digit PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={regPin}
              onChange={e => setRegPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              style={{ width: '100%', padding: '14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 26, textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={regConfirm}
              onChange={e => setRegConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              style={{ width: '100%', padding: '14px', background: 'var(--surface2)', border: `1px solid ${regError && regConfirm.length === 4 && regPin !== regConfirm ? '#ef4444' : 'var(--border)'}`, borderRadius: 10, color: 'var(--text)', fontSize: 26, textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>
          {regError && <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center' }}>{regError}</p>}
          <button
            type="submit"
            disabled={regSaving || !regName.trim() || regPin.length !== 4 || regConfirm.length !== 4}
            style={{ padding: '13px', background: 'var(--accent)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: regSaving ? 0.7 : 1, marginTop: 4 }}
          >
            {regSaving ? 'Saving…' : isFirstTime ? 'Create Owner Account' : 'Register & Sign In'}
          </button>
          {!isFirstTime && (
            <button type="button" onClick={() => setStep('pick')} style={{ padding: '10px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
              ← Back
            </button>
          )}
        </form>
      </div>
    );
  }

  // ── PIN entry ────────────────────────────────────────────────────────────
  if (step === 'pin' && selectedUser) {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: selectedUser.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', border: `1px solid ${selectedUser.role === 'owner' ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {selectedUser.role === 'owner' ? <ShieldCheck size={24} color="#10b981" /> : <Shield size={24} color="var(--accent)" />}
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, color: 'var(--text)', marginBottom: 4 }}>
              Hi, {selectedUser.name}
            </h2>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: selectedUser.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', color: selectedUser.role === 'owner' ? '#10b981' : 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {selectedUser.role}
            </span>
          </div>
        </div>

        <form onSubmit={handlePinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Enter your PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinInput}
            onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
            placeholder="••••"
            autoFocus
            style={{ width: '100%', padding: '16px', background: 'var(--surface2)', border: `1px solid ${pinError ? '#ef4444' : 'var(--border)'}`, borderRadius: 12, color: 'var(--text)', fontSize: 30, textAlign: 'center', letterSpacing: 14, fontFamily: 'monospace', outline: 'none', transition: 'border-color 0.2s' }}
          />
          {pinError && <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', margin: 0 }}>{pinError}</p>}
          <button
            type="submit"
            disabled={pinInput.length !== 4 || checking}
            style={{ padding: '13px', background: pinInput.length === 4 ? 'var(--accent)' : 'var(--surface2)', border: 'none', borderRadius: 10, color: pinInput.length === 4 ? '#fff' : 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: pinInput.length === 4 ? 'pointer' : 'not-allowed', transition: 'all 0.15s', marginTop: 4 }}
          >
            {checking ? 'Checking…' : 'Unlock Dashboard'}
          </button>
          <button type="button" onClick={() => { setStep('pick'); setPinInput(''); setPinError(''); }} style={{ padding: '10px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
            ← Switch user
          </button>
        </form>
      </div>
    );
  }

  // ── User picker ──────────────────────────────────────────────────────────
  return wrap(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LockKeyhole size={24} color="var(--accent)" />
        </div>
        <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, color: 'var(--text)' }}>VR Arcade</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Select your name to sign in</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {users.map(user => (
          <button
            key={user.id}
            className="user-btn"
            onClick={() => handleSelectUser(user)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: user.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {user.role === 'owner' ? <ShieldCheck size={18} color="#10b981" /> : <Shield size={18} color="var(--accent)" />}
            </div>
            <div style={{ flex: 1 }}>
              <p className="user-btn-name" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2, transition: 'color 0.15s' }}>{user.name}</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{user.role}</p>
            </div>
            <span style={{ fontSize: 18, color: 'var(--muted)', opacity: 0.5 }}>›</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onBack} style={{ marginTop: 8, padding: '10px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <ChevronLeft size={14} /> Back to Home
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Free Play / Birthday Mode Modal
// ─────────────────────────────────────────────────────────────────────────────
type FreePlaySession = { endTime: Date; durationHours: number; label: string } | null;

function FreePlayModal({ onClose, onActivate }: {
  onClose: () => void;
  onActivate: (session: NonNullable<FreePlaySession>) => void;
}) {
  const [duration, setDuration] = useState<1 | 2>(1);
  const [label, setLabel] = useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid rgba(245,158,11,0.35)',
        borderRadius: 16, padding: 32, maxWidth: 420, width: '90%',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <PartyPopper size={22} color="#f59e0b" />
          </div>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text)', margin: 0 }}>Free Play Mode</h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>Birthday packages & unlimited play</p>
          </div>
        </div>
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 22, marginTop: 16 }}>
          <p style={{ fontSize: 13, color: '#fbbf24', lineHeight: 1.6, margin: 0 }}>
            While active, <strong>all new sessions will be logged as TEST</strong> (revenue = KSH 0). Normal billing resumes automatically when the timer ends.
          </p>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Duration</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {([1, 2] as const).map(h => (
              <button key={h} onClick={() => setDuration(h)} style={{
                flex: 1, padding: '12px', borderRadius: 10, border: `1px solid ${duration === h ? '#f59e0b' : 'var(--border)'}`,
                background: duration === h ? 'rgba(245,158,11,0.15)' : 'var(--surface2)',
                color: duration === h ? '#fbbf24' : 'var(--muted)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {h} Hour{h > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Label (optional)</label>
          <input
            type="text"
            placeholder="e.g. John's Birthday Party"
            value={label}
            onChange={e => setLabel(e.target.value)}
            style={{ ...inputStyle, fontSize: 13 }}
            maxLength={60}
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '11px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => {
            const endTime = new Date(Date.now() + duration * 60 * 60 * 1000);
            onActivate({ endTime, durationHours: duration, label: label.trim() || `Free Play (${duration}h)` });
          }} style={{
            flex: 2, padding: '11px', borderRadius: 8, border: 'none',
            background: '#f59e0b', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            🎉 Activate Free Play
          </button>
        </div>
      </div>
    </div>
  );
}

function FreePlayBanner({ session, onEnd }: {
  session: NonNullable<FreePlaySession>;
  onEnd: () => void;
}) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = session.endTime.getTime() - Date.now();
      if (ms <= 0) { onEnd(); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session, onEnd]);
  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(245,158,11,0.22) 0%, rgba(245,158,11,0.09) 100%)',
      borderBottom: '1px solid rgba(245,158,11,0.45)',
      padding: '9px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      position: 'sticky', top: 0, zIndex: 39,   // sits just below the Header (z-index 40)
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <PartyPopper size={16} color="#f59e0b" />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>FREE PLAY ACTIVE</span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>· {session.label}</span>
        <span style={{
          fontSize: 12, color: '#fbbf24', background: 'rgba(245,158,11,0.14)',
          padding: '2px 10px', borderRadius: 20, fontWeight: 700,
        }}>
          ⏱ {remaining} remaining
        </span>
      </div>
      <button onClick={onEnd} style={{
        padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.45)',
        background: 'transparent', color: '#f59e0b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        transition: 'background 0.15s',
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.12)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >End Early</button>
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

function Sidebar({ active, onNavigate, collapsed, onToggle, onRefresh, isRefreshing, onFreePlay, session, onLogout, onBackToLanding }: {
  active: string; onNavigate: (id: string) => void;
  collapsed: boolean; onToggle: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onFreePlay: () => void;
  session: ActiveSession | null;
  onLogout: () => void;
  onBackToLanding: () => void;
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
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'width 0.2s ease, padding 0.2s ease',
        flexShrink: 0,
        position: 'sticky',      // ← new
        top: 0,                  // ← new
        height: '100vh',         // ← new
        overflowY: 'auto',       // ← changed from 'hidden' to allow internal scroll if needed
        zIndex: 50,
      }}>
        {/* Logo + toggle */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          marginBottom: 20, padding: collapsed ? 0 : '0 6px',
        }}>
          {!collapsed && (
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
              Arcade
            </h2>
          )}
          <button onClick={onToggle} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', padding: 4, borderRadius: 6, display: 'flex',
          }}>
            {collapsed ? <Menu size={18} /> : <X size={18} />}
          </button>
        </div>

        {/* User badge */}
        {session && !collapsed && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: session.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {session.role === 'owner' ? <ShieldCheck size={14} color="#10b981" /> : <Shield size={14} color="var(--accent)" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.name}</p>
                <p style={{ fontSize: 10, color: session.role === 'owner' ? '#10b981' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{session.role}</p>
              </div>
            </div>
          </div>
        )}
        {sidebarItems.map(item => {
          // Hide Settings tab from supervisors
          if (item.id === 'settings' && session?.role !== 'owner') return null;
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
        {/* Refresh button (below Settings) */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title={collapsed ? "Refresh data" : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px' : '10px 12px',
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: 'var(--muted)',
            fontSize: 13,
            fontWeight: 500,
            cursor: isRefreshing ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            width: '100%',
            whiteSpace: 'nowrap',
            marginTop: 'auto',
            opacity: isRefreshing ? 0.7 : 1,
          }}
        >
          <RefreshCw
            size={17}
            style={{
              animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
            }}
          />
          {!collapsed && (isRefreshing ? "Refreshing..." : "Refresh")}
        </button>
        {/* Free Play / Birthday Mode button */}
        <button
          onClick={onFreePlay}
          title={collapsed ? "Free Play Mode" : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px' : '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(245,158,11,0.3)',
            background: 'rgba(245,158,11,0.08)',
            color: '#f59e0b',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            width: '100%',
            whiteSpace: 'nowrap',
            marginBottom: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.18)'; e.currentTarget.style.borderColor = '#f59e0b'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
        >
          <PartyPopper size={17} />
          {!collapsed && "Free Play Mode"}
        </button>
        {/* Back to landing */}
        <button
          onClick={onBackToLanding}
          title={collapsed ? "Home" : undefined}
          style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px' : '10px 12px',
            borderRadius: 8, border: 'none',
            background: 'transparent', color: 'var(--muted)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            transition: 'all 0.15s', width: '100%', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; }}
        >
          <ChevronLeft size={17} />
          {!collapsed && "Home"}
        </button>
        {/* Logout button */}
        <button
          onClick={onLogout}
          title={collapsed ? "Sign out" : undefined}
          style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px' : '10px 12px',
            borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)',
            background: 'transparent', color: '#ef4444',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            transition: 'all 0.15s', width: '100%', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <X size={17} />
          {!collapsed && "Sign out"}
        </button>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header({ now, onMenuToggle, mounted }: { now: Date; onMenuToggle: () => void; mounted: boolean }) {
  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: '12px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onMenuToggle} className="mobile-menu-btn" style={{
          display: 'none', background: 'transparent', border: 'none',
          color: 'var(--muted)', cursor: 'pointer', padding: 4,
        }}>
          <Menu size={20} />
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Welcome back,</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>VR XTREME</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        {mounted ? format(now, 'EEE, MMM do · HH:mm:ss') : 'Loading time...'}
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
function StatsCards({ logs, effectiveRevenue }: { logs: GameLog[]; effectiveRevenue: (l: GameLog) => number }) {
  const today = todayStr();
  const todayLogs = useMemo(() => logs.filter(l => l.date === today), [logs, today]);
  const revenue = todayLogs.reduce((s, l) => s + effectiveRevenue(l), 0);
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
      return { date: format(day, 'EEE'), Full: dl.filter(l => l.status === 'FULL GAME').length, Error: dl.filter(l => l.status === 'ERROR').length, Test: dl.filter(l => l.status === 'TEST').length };
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
            <Bar dataKey="Error" fill="#ef4444" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Test" fill="#6b7280" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
        {[['Full', '#10b981'], ['Error', '#ef4444'], ['Test', '#6b7280']].map(([l, c]) => (
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
    { name: 'Error', value: dl.filter(l => l.status === 'ERROR').length, color: '#ef4444' },
    { name: 'Test', value: dl.filter(l => l.status === 'TEST').length, color: '#6b7280' },
  ].filter(d => d.value > 0);
  if (data.length === 0) return <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180 }}><p style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions today yet</p></div>;
  return (
    <div style={cardStyle}>
      <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Today's Breakdown</h2>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              paddingAngle={2}
              stroke="none"               // removes the white border around slices
              strokeWidth={0}             // ensures no stroke
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: 'none',            // removes tooltip border
                borderRadius: 8,
                color: 'var(--text)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }}
              iconType="circle"
            />
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
  { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#f87171' },   // red
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
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24, overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%', }}>
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

function DayTotalBanner({ logs, date, machineFilter, allMachineIds, effectiveStatus, effectiveRevenue }: {
  logs: GameLog[]; date: string; machineFilter: string; allMachineIds: string[];
  effectiveStatus: (l: GameLog) => GameLog['status'];
  effectiveRevenue: (l: GameLog) => number;
}) {
  const dl = logs.filter(l => l.date === date && (machineFilter === 'all' || l.computer_id === machineFilter));
  if (dl.length === 0) return null;

  const totals = (rows: GameLog[]) => ({
    sessions: rows.length,
    revenue: rows.reduce((s, l) => s + effectiveRevenue(l), 0),
    full: rows.filter(l => effectiveStatus(l) === 'FULL GAME').length,
    errors: rows.filter(l => effectiveStatus(l) === 'ERROR').length,
    tests: rows.filter(l => effectiveStatus(l) === 'TEST').length,
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
            { label: 'Errors', value: String(overall.errors), color: '#ef4444' },
            ...(overall.tests > 0 ? [{ label: 'Tests', value: String(overall.tests), color: '#6b7280' }] : []),
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

// ─────────────────────────────────────────────────────────────────────────────
// PIN Confirm Modal — required before any status change
// ─────────────────────────────────────────────────────────────────────────────
function PinConfirmModal({ session, onConfirm, onCancel, targetStatus, logInfo }: {
  session: ActiveSession;
  onConfirm: () => void;
  onCancel: () => void;
  targetStatus: GameLog['status'];
  logInfo: { game: string; from: GameLog['status'] };
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) return;
    setChecking(true);
    // Fetch this user's hash from DB and verify
    const { data } = await supabase
      .from('arcade_users')
      .select('pin_hash')
      .eq('id', session.userId)
      .single();
    setChecking(false);
    if (!data) { setError('Could not verify. Try again.'); return; }
    const ok = await verifyPin(pin, data.pin_hash);
    if (ok) {
      onConfirm();
    } else {
      setError('Incorrect PIN.');
      setPin('');
    }
  };

  const statusLabel = (s: GameLog['status']) =>
    s === 'FULL GAME' ? { label: 'Full Game', color: '#10b981' }
      : s === 'ERROR' ? { label: 'Error', color: '#ef4444' }
        : { label: 'Test', color: '#6b7280' };

  const from = statusLabel(logInfo.from);
  const to = statusLabel(targetStatus);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 18, padding: 30, maxWidth: 360, width: '92%',
        boxShadow: '0 24px 48px rgba(0,0,0,0.55)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LockKeyhole size={20} color="var(--accent)" />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Confirm Status Change</p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{session.name} · Enter your PIN to proceed</p>
          </div>
        </div>

        {/* Change summary */}
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {logInfo.game}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${from.color}20`, color: from.color }}>{from.label}</span>
            <span style={{ fontSize: 16, color: 'var(--muted)' }}>→</span>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${to.color}20`, color: to.color }}>{to.label}</span>
          </div>
          {(targetStatus === 'TEST' || targetStatus === 'ERROR') && (
            <p style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>
              ⚠ Revenue for this session will show as KSH 0
            </p>
          )}
          {targetStatus === 'FULL GAME' && logInfo.from !== 'FULL GAME' && (
            <p style={{ fontSize: 11, color: '#10b981', marginTop: 8 }}>
              ✓ Full game revenue will be restored
            </p>
          )}
        </div>

        {/* PIN input */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
            placeholder="••••"
            autoFocus
            style={{
              width: '100%', padding: '14px',
              background: 'var(--surface2)',
              border: `1px solid ${error ? '#ef4444' : 'var(--border)'}`,
              borderRadius: 12, color: 'var(--text)',
              fontSize: 28, textAlign: 'center',
              letterSpacing: 12, fontFamily: 'monospace',
              outline: 'none', transition: 'border-color 0.2s',
            }}
          />
          {error && <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.length !== 4 || checking}
              style={{ flex: 2, padding: '11px', borderRadius: 10, border: 'none', background: pin.length === 4 ? 'var(--accent)' : 'var(--surface2)', color: pin.length === 4 ? '#fff' : 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: pin.length === 4 ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
            >
              {checking ? 'Verifying…' : 'Confirm Change'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// Portal-based status dropdown — renders outside any overflow container
function StatusDropdown({ currentStatus, anchorRect, onSelect, onClose }: {
  currentStatus: GameLog['status'];
  anchorRect: DOMRect;
  onSelect: (s: GameLog['status']) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 10);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const dropdownStyle: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
    zIndex: 9999,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 4,
    boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
    minWidth: 140,
  };

  return createPortal(
    <div ref={ref} style={dropdownStyle}>
      {(['FULL GAME', 'ERROR', 'TEST'] as const).map(s => (
        <div
          key={s}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(s); onClose(); }}
          style={{
            padding: '8px 12px', cursor: 'pointer', borderRadius: 6,
            fontSize: 12, color: statusColor(s), fontWeight: 600,
            background: s === currentStatus ? statusBg(s) : 'transparent',
            transition: 'background 0.1s',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
          onMouseEnter={e => { if (s !== currentStatus) e.currentTarget.style.background = 'var(--surface2)'; }}
          onMouseLeave={e => { if (s !== currentStatus) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(s), flexShrink: 0 }} />
          {s}
          {s === currentStatus && <span style={{ marginLeft: 'auto', fontSize: 11 }}>✓</span>}
        </div>
      ))}
    </div>,
    document.body
  );
}

function MachineSessionTable({ logs, allMachineIds, showMachineCol, onStatusChange, effectiveStatus, effectiveRevenue }: {
  logs: GameLog[]; allMachineIds: string[]; showMachineCol: boolean;
  onStatusChange?: (logId: number, newStatus: GameLog['status']) => void;
  effectiveStatus?: (l: GameLog) => GameLog['status'];
  effectiveRevenue?: (l: GameLog) => number;
}) {
  const [editingStatus, setEditingStatus] = useState<number | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const getStatus = (l: GameLog) => effectiveStatus ? effectiveStatus(l) : l.status;
  const getRevenue = (l: GameLog) => effectiveRevenue ? effectiveRevenue(l) : l.revenue_ksh;

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
                <td style={{ ...tdStyle, color: getStatus(log) === 'TEST' ? 'var(--muted)' : '#10b981', fontWeight: 600 }}>
                  {getStatus(log) === 'TEST'
                    ? <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{fmtKSH(log.revenue_ksh)}</span>
                    : fmtKSH(getRevenue(log))}
                </td>
                <td style={{ ...tdStyle, position: 'relative' }}>
                  {onStatusChange ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <span
                        onClick={(e) => {
                          if (editingStatus === log.id) {
                            setEditingStatus(null);
                            setAnchorRect(null);
                          } else {
                            setEditingStatus(log.id);
                            setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                          }
                        }}
                        title="Click to change status"
                        style={{
                          padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: statusBg(getStatus(log)), color: statusColor(getStatus(log)),
                          cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
                          border: `1px solid ${statusColor(getStatus(log))}30`,
                        }}
                      >
                        {getStatus(log)}
                        <span style={{ opacity: 0.5, fontSize: 9 }}>▼</span>
                      </span>
                      {editingStatus === log.id && anchorRect && (
                        <StatusDropdown
                          currentStatus={getStatus(log)}
                          anchorRect={anchorRect}
                          onSelect={(s) => { onStatusChange(log.id, s); }}
                          onClose={() => { setEditingStatus(null); setAnchorRect(null); }}
                        />
                      )}
                    </div>
                  ) : (
                    <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusBg(getStatus(log)), color: statusColor(getStatus(log)) }}>{getStatus(log)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActivityView({ logs, freePlaySession, statusOverrides, setStatusOverrides, effectiveStatus, effectiveRevenue, session }: {
  logs: GameLog[];
  freePlaySession: FreePlaySession;
  statusOverrides: Map<number, GameLog['status']>;
  setStatusOverrides: React.Dispatch<React.SetStateAction<Map<number, GameLog['status']>>>;
  effectiveStatus: (l: GameLog) => GameLog['status'];
  effectiveRevenue: (l: GameLog) => number;
  session: ActiveSession | null;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('today');
  const [customDate, setCustomDate] = useState(todayStr());
  const [machineFilter, setMachineFilter] = useState<string>('all');

  // When Free Play is active, auto-mark any newly inserted session as TEST
  const knownLogIds = useRef<Set<number>>(new Set(logs.map(l => l.id)));
  useEffect(() => {
    if (!freePlaySession) return;
    const now = Date.now();
    if (freePlaySession.endTime.getTime() <= now) return;
    const start = freePlaySession.endTime.getTime() - freePlaySession.durationHours * 3600000;
    logs.forEach(l => {
      const logTime = parseISO(l.start_time).getTime();
      if (logTime >= start && !statusOverrides.has(l.id)) {
        setStatusOverrides(prev => new Map(prev).set(l.id, 'TEST'));
      }
    });
  }, [logs, freePlaySession]);

  // When free play ends, clear auto-TEST overrides (keep manually set ones)
  const prevFreePlay = useRef<FreePlaySession>(null);
  useEffect(() => {
    if (prevFreePlay.current && !freePlaySession) {
      setStatusOverrides(prev => {
        const next = new Map(prev);
        logs.forEach(l => {
          if (next.get(l.id) === 'TEST' && l.status !== 'TEST') {
            next.delete(l.id);
          }
        });
        return next;
      });
    }
    prevFreePlay.current = freePlaySession;
  }, [freePlaySession, logs, setStatusOverrides]);

  // ── PIN-gated status change ─────────────────────────────────────────────
  const [pendingChange, setPendingChange] = useState<{ logId: number; newStatus: GameLog['status'] } | null>(null);

  const handleStatusChange = (logId: number, newStatus: GameLog['status']) => {
    // Same status — no-op
    const log = logs.find(l => l.id === logId);
    const current = log ? (statusOverrides.get(logId) ?? log.status) : newStatus;
    if (newStatus === current) return;
    // Always require PIN confirmation before applying any change
    setPendingChange({ logId, newStatus });
  };

  const applyStatusChange = (logId: number, newStatus: GameLog['status']) => {
    setStatusOverrides(prev => {
      const next = new Map(prev);
      const original = logs.find(l => l.id === logId)?.status;
      if (newStatus === original) {
        next.delete(logId);
      } else {
        next.set(logId, newStatus);
      }
      return next;
    });
    setPendingChange(null);
  };

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

  const exportCSV = () => {
    const headers = ['Date', 'Time', 'Day of Week', 'Machine ID', 'Game Name', 'Duration (min)', 'DB Status', 'Display Status', 'Is Test', 'Revenue (KSH)', 'Session ID'];
    const rows = filtered.map(l => {
      const dt = parseISO(l.start_time);
      const dispStatus = effectiveStatus(l);
      return [
        format(dt, 'yyyy-MM-dd'),
        format(dt, 'HH:mm:ss'),
        format(dt, 'EEEE'),
        l.computer_id,
        l.game_name,
        l.duration_minutes.toFixed(1),
        l.status,
        dispStatus,
        dispStatus === 'TEST' ? 'Yes' : 'No',
        effectiveRevenue(l).toFixed(2),
        l.id,
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `arcade-sessions-${filter === 'custom' ? customDate : filter}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

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
      <div style={{ ...cardStyle, padding: '14px 20px', overflowX: 'auto' }}>
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
          {/* Export CSV */}
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface2)', color: filtered.length === 0 ? 'var(--muted)' : 'var(--text)',
              fontSize: 12, fontWeight: 600, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', opacity: filtered.length === 0 ? 0.5 : 1,
            }}
            title="Export sessions to CSV"
          >
            <Download size={13} /> Export CSV
          </button>
          {/* Machine tabs — only shown when >1 machine exists */}
          {allMachineIds.length > 1 && (
            <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24, marginLeft: 'auto', overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%', }}>
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
          <DayTotalBanner logs={logs} date={date} machineFilter={machineFilter} allMachineIds={allMachineIds} effectiveStatus={effectiveStatus} effectiveRevenue={effectiveRevenue} />

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
                        · {machineLogs.length} session{machineLogs.length !== 1 ? 's' : ''} · {fmtKSH(machineLogs.reduce((s, l) => s + effectiveRevenue(l), 0))}
                      </span>
                    </div>
                    <MachineSessionTable logs={machineLogs} allMachineIds={allMachineIds} showMachineCol={false} onStatusChange={handleStatusChange} effectiveStatus={effectiveStatus} effectiveRevenue={effectiveRevenue} />
                  </div>
                );
              })}
            </div>
          ) : (
            /* Single machine view — clean table, no machine column needed */
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <MachineSessionTable logs={dayLogs} allMachineIds={allMachineIds} showMachineCol={false} onStatusChange={handleStatusChange} effectiveStatus={effectiveStatus} effectiveRevenue={effectiveRevenue} />
            </div>
          )}
        </div>
      ))}

      {/* PIN confirmation modal — shown before any status change is applied */}
      {pendingChange && session && (() => {
        const log = logs.find(l => l.id === pendingChange.logId);
        if (!log) return null;
        const fromStatus = statusOverrides.get(log.id) ?? log.status;
        return (
          <PinConfirmModal
            session={session}
            targetStatus={pendingChange.newStatus}
            logInfo={{ game: log.game_name, from: fromStatus }}
            onConfirm={() => applyStatusChange(pendingChange.logId, pendingChange.newStatus)}
            onCancel={() => setPendingChange(null)}
          />
        );
      })()}
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
    const map = new Map<string, { sessions: number; revenue: number; full: number; errors: number; total_minutes: number }>();
    filtered.forEach(l => {
      const p = map.get(l.game_name) ?? { sessions: 0, revenue: 0, full: 0, errors: 0, total_minutes: 0 };
      map.set(l.game_name, {
        sessions: p.sessions + 1,
        revenue: p.revenue + (l.status !== 'TEST' ? l.revenue_ksh : 0),
        full: p.full + (l.status === 'FULL GAME' ? 1 : 0),
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
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 4, borderRadius: 24, overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%', }}>
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
                {['#', 'Game', 'Full Games', 'Revenue', 'Full %', 'Avg Duration', 'Rev/Session'].map(h => (
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
                    <td style={tdStyle}>{g.full}</td>
                    <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{fmtKSH(g.revenue)}</td>
                    <td style={tdStyle}>
                      <span style={{ color: g.completion_rate >= 70 ? '#10b981' : g.completion_rate >= 40 ? '#f59e0b' : '#ef4444' }}>
                        {g.completion_rate}%
                      </span>
                    </td>
                    <td style={tdStyle}>{g.avg_duration.toFixed(1)} min</td>
                    <td style={{ ...tdStyle, color: 'var(--text)' }}>{fmtKSH(g.full > 0 ? g.revenue / g.full : 0)}</td>
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
// User Management — owner only, shown inside SettingsView
// ─────────────────────────────────────────────────────────────────────────────
function UserManagement({ currentUserId, onUsersChanged }: {
  currentUserId: string;
  onUsersChanged: () => void;
}) {
  const [users, setUsers] = useState<ArcadeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [newRole, setNewRole] = useState<'owner' | 'supervisor'>('supervisor');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [changePin, setChangePin] = useState<ArcadeUser | null>(null);
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpError, setCpError] = useState('');
  const [cpSaving, setCpSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('arcade_users').select('*').order('created_at');
    setUsers((data as ArcadeUser[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!newName.trim()) { setAddError('Name is required.'); return; }
    if (newPin.length !== 4) { setAddError('PIN must be 4 digits.'); return; }
    if (newPin !== newConfirm) { setAddError('PINs do not match.'); return; }
    setAddSaving(true);
    const pin_hash = await hashPin(newPin);
    const { error } = await supabase.from('arcade_users').insert({ name: newName.trim(), pin_hash, role: newRole });
    setAddSaving(false);
    if (error) { setAddError('Could not add user. Name may already be taken.'); return; }
    setNewName(''); setNewPin(''); setNewConfirm(''); setNewRole('supervisor');
    setShowAdd(false);
    await fetchUsers();
    onUsersChanged();
  };

  const handleDelete = async (userId: string) => {
    if (userId === currentUserId) return;
    setDeleting(true);
    await supabase.from('arcade_users').delete().eq('id', userId);
    setDeleting(false);
    setDeleteConfirm(null);
    await fetchUsers();
    onUsersChanged();
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpError('');
    if (cpNew.length !== 4) { setCpError('PIN must be 4 digits.'); return; }
    if (cpNew !== cpConfirm) { setCpError('PINs do not match.'); return; }
    setCpSaving(true);
    const pin_hash = await hashPin(cpNew);
    const { error } = await supabase.from('arcade_users').update({ pin_hash }).eq('id', changePin!.id);
    setCpSaving(false);
    if (error) { setCpError('Could not update PIN.'); return; }
    setCpNew(''); setCpConfirm(''); setChangePin(null);
    await fetchUsers();
  };

  const pinInputStyle: React.CSSProperties = { width: '100%', padding: '12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 24, textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace', outline: 'none' };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 28, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} color="var(--accent)" /> User Management
          </h3>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Add or remove staff accounts. Each user has their own name and PIN.</p>
        </div>
        <button
          onClick={() => { setShowAdd(p => !p); setAddError(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: showAdd ? 'var(--surface2)' : 'var(--accent)', color: showAdd ? 'var(--muted)' : '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <UserPlus size={14} /> {showAdd ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div style={{ background: 'var(--surface2)', borderRadius: 12, border: '1px solid var(--border)', padding: '20px', marginBottom: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>New user</h4>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Alice" style={{ ...inputStyle, fontSize: 13 }} autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Role</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value as 'owner' | 'supervisor')} style={{ ...inputStyle, fontSize: 13 }}>
                  <option value="supervisor">Supervisor</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>PIN (4 digits)</label>
                <input type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" style={{ ...pinInputStyle, fontSize: 20, padding: '10px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Confirm PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} value={newConfirm} onChange={e => setNewConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" style={{ ...pinInputStyle, fontSize: 20, padding: '10px', borderColor: newConfirm.length === 4 && newPin !== newConfirm ? '#ef4444' : 'var(--border)' }} />
              </div>
            </div>
            {addError && <p style={{ fontSize: 13, color: '#ef4444' }}>{addError}</p>}
            <button type="submit" disabled={addSaving} style={{ padding: '10px 20px', background: '#10b981', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}>
              {addSaving ? 'Adding…' : 'Add User'}
            </button>
          </form>
        </div>
      )}

      {/* User list */}
      {loading ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map(u => (
            <div key={u.id} style={{ background: 'var(--surface2)', borderRadius: 12, border: '1px solid var(--border)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {u.role === 'owner' ? <ShieldCheck size={17} color="#10b981" /> : <Shield size={17} color="var(--accent)" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{u.name}</span>
                  {u.id === currentUserId && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', fontWeight: 700 }}>You</span>}
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: u.role === 'owner' ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)', color: u.role === 'owner' ? '#10b981' : 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{u.role}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Added {format(parseISO(u.created_at), 'MMM d, yyyy')}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => { setChangePin(u); setCpNew(''); setCpConfirm(''); setCpError(''); }}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Change PIN
                </button>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => setDeleteConfirm(u.id)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, maxWidth: 380, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Remove user?</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  {users.find(u => u.id === deleteConfirm)?.name} will no longer be able to sign in. This cannot be undone.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={deleting} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change PIN modal */}
      {changePin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, maxWidth: 360, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Change PIN — {changePin.name}</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Set a new 4-digit PIN for this user.</p>
            <form onSubmit={handleChangePin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>New PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} value={cpNew} onChange={e => setCpNew(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoFocus style={pinInputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Confirm PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} value={cpConfirm} onChange={e => setCpConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" style={{ ...pinInputStyle, borderColor: cpConfirm.length === 4 && cpNew !== cpConfirm ? '#ef4444' : 'var(--border)' }} />
              </div>
              {cpError && <p style={{ fontSize: 13, color: '#ef4444' }}>{cpError}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setChangePin(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={cpSaving || cpNew.length !== 4 || cpConfirm.length !== 4} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {cpSaving ? 'Saving…' : 'Update PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings View
// ─────────────────────────────────────────────────────────────────────────────
function SettingsView({
  settings,
  updateSettings,
  onClearAllMachines,
  session,
  refreshUsers,
}: {
  settings: ArcadeSettings | null;
  updateSettings: (updates: Partial<ArcadeSettings>) => Promise<any>;
  onClearAllMachines: () => void;
  session: ActiveSession | null;
  refreshUsers: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    price_per_full_game: 400,
    daily_target_ksh: 4000,
    full_game_min_minutes: 4,
    error_max_minutes: 2,
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // PIN state
  const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const [pinSaveStatus, setPinSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [pinError, setPinError] = useState('');

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

  const handlePinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (pinForm.newPin.length !== 4 || !/^\d{4}$/.test(pinForm.newPin)) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    if (pinForm.newPin !== pinForm.confirmPin) {
      setPinError('PINs do not match');
      return;
    }
    if (settings?.pin_code && pinForm.currentPin !== settings.pin_code) {
      setPinError('Current PIN is incorrect');
      return;
    }
    setPinSaveStatus('saving');
    const err = await updateSettings({ pin_code: pinForm.newPin });
    setPinSaveStatus(err ? 'error' : 'ok');
    if (!err) setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
    setTimeout(() => setPinSaveStatus('idle'), 3000);
  };

  if (!settings) return <div style={cardStyle}>Loading settings…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Global pricing / settings card */}
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

      {/* PIN Management card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <LockKeyhole size={18} color="var(--accent)" />
          <h3 style={{ ...sectionTitle, fontSize: 15 }}>Security PIN</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
          Change the 4‑digit access code required to open the dashboard.
        </p>
        <form onSubmit={handlePinChange} style={{ maxWidth: 400 }}>
          {settings.pin_code && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                Current PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinForm.currentPin}
                onChange={e => setPinForm({ ...pinForm, currentPin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                style={{ ...inputStyle, letterSpacing: 8, fontFamily: 'monospace', fontSize: 18, textAlign: 'center' }}
                placeholder="••••"
              />
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              New PIN (4 digits)
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinForm.newPin}
              onChange={e => setPinForm({ ...pinForm, newPin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              style={{ ...inputStyle, letterSpacing: 8, fontFamily: 'monospace', fontSize: 18, textAlign: 'center' }}
              placeholder="••••"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Confirm New PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinForm.confirmPin}
              onChange={e => setPinForm({ ...pinForm, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              style={{ ...inputStyle, letterSpacing: 8, fontFamily: 'monospace', fontSize: 18, textAlign: 'center' }}
              placeholder="••••"
            />
          </div>
          {pinError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{pinError}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              type="submit"
              disabled={pinSaveStatus === 'saving'}
              style={{
                background: pinSaveStatus === 'saving' ? 'var(--surface2)' : '#10b981',
                color: pinSaveStatus === 'saving' ? 'var(--muted)' : '#fff',
                border: 'none', padding: '10px 24px', borderRadius: 8,
                fontSize: 14, fontWeight: 600,
                cursor: pinSaveStatus === 'saving' ? 'not-allowed' : 'pointer',
              }}
            >
              {pinSaveStatus === 'saving' ? 'Saving…' : 'Update PIN'}
            </button>
            {pinSaveStatus === 'ok' && <span style={{ fontSize: 13, color: '#10b981' }}>✓ PIN updated</span>}
            {pinSaveStatus === 'error' && <span style={{ fontSize: 13, color: '#ef4444' }}>✗ Failed to save</span>}
          </div>
        </form>
      </div>
      <div style={{
        ...cardStyle,
        borderColor: 'rgba(239,68,68,0.3)',
        background: 'linear-gradient(135deg, rgba(239,68,68,0.05) 0%, rgba(239,68,68,0.02) 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <AlertTriangle size={18} color="#ef4444" />
          <h3 style={{ ...sectionTitle, fontSize: 15, color: '#ef4444' }}>Danger Zone</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
          Permanently delete all machines and their entire game history. This action cannot be undone.
        </p>
        <button
          onClick={() => setShowClearConfirm(true)}
          style={{
            background: 'transparent',
            border: '1px solid rgba(239,68,68,0.5)',
            borderRadius: 8,
            padding: '10px 20px',
            color: '#ef4444',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
            e.currentTarget.style.borderColor = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)';
          }}
        >
          <Trash2 size={14} />
          Clear All Machines
        </button>
      </div>
      {showClearConfirm && (
        <ConfirmModal
          message="This will permanently delete ALL machines, their full game history, and all revenue records from the database. The live feed and all analytics will be cleared. This cannot be undone."
          onConfirm={() => {
            onClearAllMachines();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

      {/* User Management — owner only */}
      {session?.role === 'owner' && (
        <div style={cardStyle}>
          <UserManagement currentUserId={session.userId} onUsersChanged={refreshUsers} />
        </div>
      )}
    </div>

  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Landing Screen — choose VR Arcade or Jump Zone
// ─────────────────────────────────────────────────────────────────────────────
function LandingScreen({ onVR, onTrampoline }: { onVR: () => void; onTrampoline: () => void }) {
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --bg: #0d0f14; --surface: #151820; --surface2: #1c1f29; --border: rgba(255,255,255,0.07); --text: #f0f2f8; --muted: #6b7280; --accent: #6366f1; }
        body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; }
        @keyframes float1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,-28px)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-18px,22px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .land-card { transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease; cursor: pointer; animation: fadeUp 0.3s ease both; }
        .land-card:hover { transform: translateY(-4px); }
        .land-card-vr:hover { box-shadow: 0 16px 48px rgba(99,102,241,0.25); border-color: rgba(99,102,241,0.5) !important; }
        .land-card-tr:hover { box-shadow: 0 16px 48px rgba(16,185,129,0.2); border-color: rgba(16,185,129,0.4) !important; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', position: 'relative', overflow: 'hidden' }}>
        {/* Ambient orbs */}
        <div style={{ position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: 'rgba(99,102,241,0.07)', top: -80, left: -80, animation: 'float1 14s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'rgba(16,185,129,0.06)', bottom: -60, right: -60, animation: 'float2 18s ease-in-out infinite', pointerEvents: 'none' }} />

        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: 48, position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 32, fontWeight: 800, color: '#f0f2f8', marginBottom: 8, letterSpacing: '-0.5px' }}>
            Xtreme Zone
          </h1>
          <p style={{ fontSize: 15, color: '#6b7280' }}>Select your section to continue</p>
        </div>

        {/* Two cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, width: '100%', maxWidth: 580, position: 'relative', zIndex: 1 }}>

          {/* VR Arcade card */}
          <div
            className="land-card land-card-vr"
            onClick={onVR}
            style={{ background: '#151820', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 20, padding: '36px 28px', animationDelay: '0.05s' }}
          >
            {/* Icon */}
            <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color: '#f0f2f8', marginBottom: 8 }}>VR Xtreme</h2>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
              Supervisor dashboard — track machines, revenue, and game sessions in real time.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
              <span style={{ fontSize: 13, color: '#818cf8', fontWeight: 600 }}>Requires PIN login</span>
            </div>
          </div>

          {/* Trampoline card */}
          <div
            className="land-card land-card-tr"
            onClick={onTrampoline}
            style={{ background: '#151820', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 20, padding: '36px 28px', animationDelay: '0.12s' }}
          >
            {/* Icon */}
            <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color: '#f0f2f8', marginBottom: 8 }}>Jump Xtreme</h2>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
              Trampoline check-in — record kids entering, track jump time, and get exit alerts.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>Open access</span>
            </div>
          </div>
        </div>

        <p style={{ marginTop: 40, fontSize: 12, color: '#374151', position: 'relative', zIndex: 1 }}>
          Jump Xtreme · Operation Portal
        </p>
      </div>
    </>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// TRAMPOLINE PARK — Jump Zone
// ─────────────────────────────────────────────────────────────────────────────
interface JumperSession {
  id: number;
  child_name: string;
  guardian_name: string;
  guardian_phone: string;
  age: number;
  check_in_time: string;
  duration_minutes: number;
  amount_paid: number;
  exit_time: string;        // computed: check_in + duration
  status: 'active' | 'exited' | 'overdue';
  notes: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeUntilExit(exitTime: string): { minutes: number; label: string; urgent: boolean; overdue: boolean } {
  const diff = new Date(exitTime).getTime() - Date.now();
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const overdue = diff < 0;
  const urgent = !overdue && diff < 5 * 60 * 1000;
  const absMins = Math.abs(minutes);
  const absSecs = Math.abs(seconds);
  const label = overdue
    ? `${absMins}m ${absSecs}s overdue`
    : `${minutes}m ${absSecs}s left`;
  return { minutes, label, urgent, overdue };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
}



const DURATION_OPTIONS = [
  { label: '30 min', value: 30, price: 200 },
  { label: '1 hour', value: 60, price: 350 },
  { label: '1.5 hrs', value: 90, price: 500 },
  { label: '2 hours', value: 120, price: 650 },
];

// ─── Timer display (live countdown) ──────────────────────────────────────────
function LiveTimer({ exitTime, status }: { exitTime: string; status: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'active') return;
    const t = setInterval(() => setTick(p => p + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'exited') return <span style={{ color: '#6b7280', fontSize: 13 }}>Exited</span>;
  const { label, urgent, overdue } = timeUntilExit(exitTime);
  return (
    <span style={{
      fontSize: 13, fontWeight: 700,
      color: overdue ? '#ef4444' : urgent ? '#f59e0b' : '#10b981',
    }}>
      {overdue && '⚠ '}{label}
    </span>
  );
}

// ─── Check-in form ────────────────────────────────────────────────────────────
function CheckInForm({ onDone, onCancel, activeSessions }: { onDone: () => void; onCancel: () => void; activeSessions: JumperSession[] }) {
  const [childName, setChildName] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [age, setAge] = useState('');
  const [durationOption, setDurationOption] = useState<'1h' | '2h' | 'custom' | 'unlimited'>('1h');
  const [customMinutesVal, setCustomMinutesVal] = useState('');
  const [customPriceVal, setCustomPriceVal] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Check if the entered child name matches an already-active session
  const nameConflict = useMemo(() => {
    const trimmed = childName.trim().toLowerCase();
    if (!trimmed) return null;
    return activeSessions.find(s => s.child_name.toLowerCase() === trimmed) ?? null;
  }, [childName, activeSessions]);

  const isGuardianRequired = useMemo(() => {
    const ageNum = parseInt(age, 10);
    return !isNaN(ageNum) && ageNum < 18;
  }, [age]);
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, color: '#9ca3af',
    marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', fontSize: 16,
    background: '#1c1f29', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, color: '#f0f2f8', outline: 'none',
    boxSizing: 'border-box',
  };

  const isWeekend = () => {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  };
  const price1h = isWeekend() ? 1250 : 1000;
  const price2h = isWeekend() ? 2500 : 2000;

  const getSelectedDuration = () => {
    if (durationOption === '1h') return { minutes: 60, price: price1h };
    if (durationOption === '2h') return { minutes: 120, price: price2h };
    if (durationOption === 'unlimited') return { minutes: 720, price: 3000 };
    // custom
    const mins = parseInt(customMinutesVal, 10);
    const price = parseFloat(customPriceVal);
    if (isNaN(mins) || mins <= 0) return null;
    return { minutes: mins, price: isNaN(price) ? 0 : price };
  };

  const handleSubmit = async () => {
    setError('');
    if (!childName.trim()) { setError("Name is required."); return; }
    if (nameConflict) { setError(`A person named "${nameConflict.child_name}" is already active. Please change the name.`); return; }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 99) { setError('Please enter a valid age (1–99).'); return; }

    // Guardian name is required only if under 18
    if (isGuardianRequired && !guardianName.trim()) {
      setError("Guardian's name is required for children under 18.");
      return;
    }

    const dur = getSelectedDuration();
    if (!dur) { setError('Please select a valid duration.'); return; }
    if (dur.price <= 0 && durationOption !== 'custom') { setError('Invalid price.'); return; }
    if (durationOption === 'custom' && (dur.price <= 0 || dur.minutes <= 0)) { setError('Enter valid minutes and price.'); return; }

    setSaving(true);
    const checkInTime = new Date().toISOString();
    const exitTime = new Date(Date.now() + dur.minutes * 60000).toISOString();

    const { error: err } = await supabase.from('jumper_sessions').insert({
      child_name: childName.trim(),
      guardian_name: guardianName.trim(),
      guardian_phone: guardianPhone.trim(),
      age: ageNum,
      check_in_time: checkInTime,
      duration_minutes: dur.minutes,
      amount_paid: dur.price,
      exit_time: exitTime,
      status: 'active',
      notes: notes.trim(),
    });
    setSaving(false);
    if (err) { setError('Could not save. Please try again.'); return; }
    onDone();
  };
  return (
    <div style={{ minHeight: '100vh', background: '#0d0f14', padding: '0 0 40px' }}>
      {/* Header (unchanged) */}
      <div style={{ background: '#151820', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}>
          <ChevronLeft size={24} />
        </button>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, color: '#f0f2f8', margin: 0 }}>New Check-in</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Fill in the child's details</p>
        </div>
      </div>

      <div style={{ padding: '24px 20px', maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Child Information (unchanged) */}
        <div style={{ background: '#151820', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#f0f2f8', marginBottom: 16 }}>Client Information</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Client's Name *</label>
              <input type="text" value={childName} onChange={e => setChildName(e.target.value)}
                placeholder="e.g. Jamie Mwangi" autoFocus
                style={{ ...inputStyle, borderColor: nameConflict ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.08)' }} />
              {nameConflict && (
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', margin: '0 0 3px' }}>Name already active</p>
                    <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>
                      <strong style={{ color: '#f0f2f8' }}>{nameConflict.child_name}</strong> (age {nameConflict.age}) checked in at {fmtTime(nameConflict.check_in_time)}, exits {fmtTime(nameConflict.exit_time)}.
                      Please add something to tell them apart — e.g. <em style={{ color: '#d1d5db' }}>{childName.trim()} B</em> or include a surname.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Age *</label>
              <input type="number" value={age} onChange={e => setAge(e.target.value)}
                placeholder="e.g. 8 (or 25 for adults)" min="1" max="99" inputMode="numeric" style={{ ...inputStyle, width: 120 }} />
            </div>
          </div>
        </div>

        {/* Guardian Information (optional for adults) */}
        <div style={{ background: '#151820', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#f0f2f8', marginBottom: 16 }}>Guardian Information</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>
                Guardian's Name {!isGuardianRequired && <span style={{ fontWeight: 'normal', fontSize: 11, color: '#6b7280' }}>(optional for adults)</span>}
                {isGuardianRequired && <span style={{ color: '#ef4444' }}> *</span>}
              </label>
              <input type="text" value={guardianName} onChange={e => setGuardianName(e.target.value)}
                placeholder={isGuardianRequired ? "e.g. Mary Wanjiku" : "Optional for adults"} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone Number (optional)</label>
              <input type="tel" value={guardianPhone} onChange={e => setGuardianPhone(e.target.value)}
                placeholder="e.g. 0712 345 678" inputMode="tel" style={inputStyle} />
            </div>
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* DURATION & PAYMENT SECTION (modified) */}
        {/* ───────────────────────────────────────────────────────────── */}
        <div style={{ background: '#151820', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#f0f2f8', marginBottom: 4 }}>Duration & Payment</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Select jump time</p>

          {/* Preset options: 1h and 2h */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <button onClick={() => setDurationOption('1h')}
              style={{
                padding: '16px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                border: `2px solid ${durationOption === '1h' ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                background: durationOption === '1h' ? 'rgba(99,102,241,0.15)' : '#1c1f29',
              }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: durationOption === '1h' ? '#a5b4fc' : '#f0f2f8', margin: 0 }}>1 hour</p>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{fmtKSH(price1h)}</p>
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{isWeekend() ? 'Weekend rate' : 'Weekday rate'}</p>
            </button>
            <button onClick={() => setDurationOption('2h')}
              style={{
                padding: '16px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                border: `2px solid ${durationOption === '2h' ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                background: durationOption === '2h' ? 'rgba(99,102,241,0.15)' : '#1c1f29',
              }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: durationOption === '2h' ? '#a5b4fc' : '#f0f2f8', margin: 0 }}>2 hours</p>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{fmtKSH(price2h)}</p>
            </button>
          </div>

          {/* Unlimited Day Pass */}
          <button onClick={() => setDurationOption('unlimited')}
            style={{
              width: '100%', padding: '14px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
              border: `2px solid ${durationOption === 'unlimited' ? '#f59e0b' : 'rgba(255,255,255,0.08)'}`,
              background: durationOption === 'unlimited' ? 'rgba(245,158,11,0.15)' : '#1c1f29',
              marginBottom: 16,
            }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: durationOption === 'unlimited' ? '#fbbf24' : '#f0f2f8', margin: 0 }}>🎉 Unlimited Day Pass</p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{fmtKSH(3000)} · All day jumping</p>
          </button>

          {/* Custom duration */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 16, marginTop: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={durationOption === 'custom'} onChange={() => setDurationOption('custom')} />
              <span style={{ fontSize: 13, color: '#f0f2f8' }}>Custom duration</span>
            </div>
            {durationOption === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4, display: 'block' }}>Minutes</label>
                  <input type="number" value={customMinutesVal} onChange={e => setCustomMinutesVal(e.target.value)}
                    placeholder="e.g., 45" min="1" style={{ ...inputStyle, fontSize: 14, padding: '12px' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4, display: 'block' }}>Price (KSH)</label>
                  <input type="number" value={customPriceVal} onChange={e => setCustomPriceVal(e.target.value)}
                    placeholder="Amount" min="0" step="10" style={{ ...inputStyle, fontSize: 14, padding: '12px' }} />
                </div>
              </div>
            )}
          </div>

          {/* Summary of selected */}
          {durationOption !== 'custom' && getSelectedDuration() && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(16,185,129,0.1)', borderRadius: 10, border: '1px solid rgba(16,185,129,0.2)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: '#6b7280' }}>Amount to collect</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#10b981' }}>{fmtKSH(getSelectedDuration()!.price)}</span>
            </div>
          )}
          {durationOption === 'custom' && customMinutesVal && customPriceVal && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(16,185,129,0.1)', borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Duration: {customMinutesVal} min</span>
                <span>Price: {fmtKSH(parseFloat(customPriceVal) || 0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Notes (unchanged) */}
        <div style={{ background: '#151820', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. allergies, special needs, school group..."
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
          />
        </div>

        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#ef4444" />
            <span style={{ fontSize: 14, color: '#ef4444' }}>{error}</span>
          </div>
        )}

        <button onClick={handleSubmit} disabled={saving}
          style={{
            padding: '18px', background: saving ? '#1c1f29' : '#6366f1',
            border: 'none', borderRadius: 14, color: saving ? '#6b7280' : '#fff',
            fontSize: 16, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}>
          {saving ? 'Checking in…' : `✓ Check In`}
        </button>
      </div>
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────
function SessionCard({ session, onExit, onRefresh }: {
  session: JumperSession; onExit: (id: number) => void; onRefresh: () => void;
}) {
  const isActive = session.status === 'active';
  const { urgent, overdue } = isActive ? timeUntilExit(session.exit_time) : { urgent: false, overdue: false };

  const borderColor = !isActive ? 'rgba(255,255,255,0.06)'
    : overdue ? 'rgba(239,68,68,0.4)'
      : urgent ? 'rgba(245,158,11,0.35)'
        : 'rgba(16,185,129,0.25)';

  const accentBg = !isActive ? 'rgba(107,114,128,0.1)'
    : overdue ? 'rgba(239,68,68,0.1)'
      : urgent ? 'rgba(245,158,11,0.1)'
        : 'rgba(16,185,129,0.1)';

  return (
    <div style={{
      background: '#151820', borderRadius: 16,
      border: `1px solid ${borderColor}`,
      padding: '16px 18px', transition: 'border-color 0.3s',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#f0f2f8', margin: '0 0 2px' }}>{session.child_name}</p>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Age {session.age} · Guardian: {session.guardian_name}</p>
          {session.guardian_phone && <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{session.guardian_phone}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: accentBg,
            color: !isActive ? '#6b7280' : overdue ? '#ef4444' : urgent ? '#f59e0b' : '#10b981',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {!isActive ? 'Exited' : overdue ? 'Overdue' : urgent ? 'Leaving soon' : 'Jumping'}
          </span>
        </div>
      </div>

      {/* Time info */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Checked in</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f8', margin: 0 }}>{fmtTime(session.check_in_time)}</p>
        </div>
        <div>
          <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Exit by</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f8', margin: 0 }}>{fmtTime(session.exit_time)}</p>
        </div>
        <div>
          <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Duration</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f8', margin: 0 }}>{session.duration_minutes} min</p>
        </div>
        <div>
          <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Paid</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#10b981', margin: 0 }}>{fmtKSH(session.amount_paid)}</p>
        </div>
      </div>

      {/* Countdown */}
      {isActive && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: accentBg, borderRadius: 8 }}>
          <LiveTimer exitTime={session.exit_time} status={session.status} />
        </div>
      )}

      {session.notes && (
        <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginBottom: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          Note: {session.notes}
        </p>
      )}

      {/* Exit button */}
      {isActive && (
        <button onClick={() => onExit(session.id)}
          style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#ef4444', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <LogOut size={15} /> Mark as Exited
        </button>
      )}
    </div>
  );
}

// ─── Main Trampoline App ───────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Trampoline Records & Analytics View
// ─────────────────────────────────────────────────────────────────────────────
function TrampolineRecords({ allSessions }: { allSessions: JumperSession[] }) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [customDate, setCustomDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'exited'>('all');

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    if (period === 'today') return { rangeStart: startOfDay(now), rangeEnd: endOfDay(now) };
    if (period === 'week') return { rangeStart: startOfWeek(now, { weekStartsOn: 1 }), rangeEnd: endOfWeek(now, { weekStartsOn: 1 }) };
    if (period === 'month') return { rangeStart: startOfMonth(now), rangeEnd: endOfMonth(now) };
    const d = parseISO(customDate);
    return { rangeStart: startOfDay(d), rangeEnd: endOfDay(d) };
  }, [period, customDate]);

  const filtered = useMemo(() => {
    return allSessions.filter(s => {
      const t = parseISO(s.check_in_time);
      if (t < rangeStart || t > rangeEnd) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          s.child_name.toLowerCase().includes(q) ||
          s.guardian_name.toLowerCase().includes(q) ||
          s.notes.toLowerCase().includes(q) ||
          String(s.age).includes(q)
        );
      }
      return true;
    });
  }, [allSessions, rangeStart, rangeEnd, statusFilter, search]);

  // Analytics data — sessions per hour bucket for the period
  const chartData = useMemo(() => {
    if (period === 'today' || period === 'custom') {
      // Hourly breakdown for single day
      return Array.from({ length: 14 }, (_, i) => {
        const hour = i + 7; // 7am – 8pm
        const count = filtered.filter(s => {
          const h = parseISO(s.check_in_time).getHours();
          return h === hour;
        }).length;
        const rev = filtered.filter(s => parseISO(s.check_in_time).getHours() === hour)
          .reduce((sum, s) => sum + s.amount_paid, 0);
        return { label: `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'pm' : 'am'}`, sessions: count, revenue: rev };
      });
    }
    // Daily breakdown for week/month
    const days = period === 'week' ? 7 : 30;
    return Array.from({ length: days }, (_, i) => {
      const day = subDays(rangeEnd, days - 1 - i);
      const ds = startOfDay(day), de = endOfDay(day);
      const daySessions = allSessions.filter(s => {
        const t = parseISO(s.check_in_time);
        return t >= ds && t <= de;
      });
      return {
        label: format(day, days === 7 ? 'EEE' : 'dd'),
        sessions: daySessions.length,
        revenue: daySessions.reduce((sum, s) => sum + s.amount_paid, 0),
      };
    });
  }, [filtered, allSessions, period, rangeStart, rangeEnd]);

  const totalRevenue = filtered.reduce((s, r) => s + r.amount_paid, 0);
  const totalSessions = filtered.length;
  const avgDuration = filtered.length > 0
    ? Math.round(filtered.reduce((s, r) => s + r.duration_minutes, 0) / filtered.length)
    : 0;
  const activeCount = filtered.filter(s => s.status === 'active').length;

  const exportCSV = () => {
    const headers = ['Date', 'Check-in Time', 'Exit Time', 'Child Name', 'Age', 'Guardian', 'Phone', 'Duration (min)', 'Amount (KSH)', 'Status', 'Notes'];
    const rows = filtered.map(s => [
      format(parseISO(s.check_in_time), 'yyyy-MM-dd'),
      format(parseISO(s.check_in_time), 'HH:mm'),
      format(parseISO(s.exit_time), 'HH:mm'),
      s.child_name, s.age, s.guardian_name, s.guardian_phone,
      s.duration_minutes, s.amount_paid, s.status, s.notes,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jumpzone-records-${period === 'custom' ? customDate : period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inp: React.CSSProperties = {
    background: '#1c1f29', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, padding: '10px 14px', color: '#f0f2f8',
    fontSize: 14, outline: 'none', width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Period filter bar */}
      <div style={{ background: '#151820', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(['today', 'week', 'month', 'custom'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: period === p ? '#6366f1' : '#1c1f29', color: period === p ? '#fff' : '#6b7280', transition: 'all 0.15s' }}>
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Pick Date'}
          </button>
        ))}
        {period === 'custom' && (
          <input type="date" value={customDate} max={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => setCustomDate(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '7px 12px', fontSize: 13, cursor: 'pointer' }} />
        )}
        <button onClick={exportCSV}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1c1f29', color: '#9ca3af', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {[
          { label: 'Total Sessions', value: String(totalSessions), color: '#6366f1' },
          { label: 'Revenue', value: `KSH ${totalRevenue.toLocaleString()}`, color: '#10b981' },
          { label: 'Avg Duration', value: `${avgDuration} min`, color: '#f59e0b' },
          { label: 'Still Active', value: String(activeCount), color: '#ef4444' },
        ].map(c => (
          <div key={c.label} style={{ background: '#151820', borderRadius: 12, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{c.label}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Mini bar chart */}
      {chartData.some(d => d.sessions > 0) && (
        <div style={{ background: '#151820', borderRadius: 14, padding: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {period === 'today' || period === 'custom' ? 'Sessions by Hour' : 'Sessions by Day'}
          </p>
          <div style={{ height: 100 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={period === 'month' ? 8 : 14}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  contentStyle={{
                    background: '#1c1f29',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    color: '#f0f2f8',
                    fontSize: 12
                  }}
                  formatter={(v, name) => {
                    const key = String(name ?? '');
                    const isRevenue = key === 'revenue';
                    return [isRevenue ? `KSH ${v}` : v, isRevenue ? 'Revenue' : 'Sessions'];
                  }}
                />
                <Bar dataKey="sessions" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Search + status filter */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, guardian, age, notes…"
            style={{ ...inp, paddingLeft: 36 }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }}>
            <Filter size={14} />
          </span>
        </div>
        {(['all', 'active', 'exited'] as const).map(sf => (
          <button key={sf} onClick={() => setStatusFilter(sf)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              background: statusFilter === sf
                ? (sf === 'active' ? 'rgba(16,185,129,0.15)' : sf === 'exited' ? 'rgba(107,114,128,0.15)' : '#1c1f29')
                : '#151820',
              color: statusFilter === sf
                ? (sf === 'active' ? '#10b981' : sf === 'exited' ? '#9ca3af' : '#fff')
                : '#6b7280',
              border: statusFilter === sf
                ? `1px solid ${sf === 'active' ? 'rgba(16,185,129,0.3)' : sf === 'exited' ? 'rgba(107,114,128,0.3)' : 'rgba(99,102,241,0.4)'}`
                : '1px solid transparent',
              transition: 'all 0.15s',
            }}>
            {sf === 'all' ? 'All' : sf === 'active' ? 'Active' : 'Exited'}
          </button>
        ))}
      </div>

      {/* Records table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', background: '#151820', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <Users size={36} color="#374151" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: 15, color: '#4b5563', marginBottom: 6 }}>No records found</p>
          <p style={{ fontSize: 13 }}>Try adjusting the period or search filter</p>
        </div>
      ) : (
        <div style={{ background: '#151820', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 580 }}>
              <thead>
                <tr style={{ background: '#1c1f29' }}>
                  {['Time In', 'Child', 'Age', 'Guardian', 'Duration', 'Paid', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const isActive = s.status === 'active';
                  const { overdue, urgent } = isActive ? timeUntilExit(s.exit_time) : { overdue: false, urgent: false };
                  return (
                    <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                        <div>{fmtTime(s.check_in_time)}</div>
                        <div style={{ fontSize: 11, color: '#4b5563' }}>{format(parseISO(s.check_in_time), 'MMM d')}</div>
                      </td>
                      <td style={{ padding: '11px 14px', fontWeight: 600, color: '#f0f2f8', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.child_name}
                        {s.notes && <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.notes}</div>}
                      </td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af' }}>{s.age}</td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div>{s.guardian_name}</div>
                        {s.guardian_phone && <div style={{ fontSize: 11, color: '#4b5563' }}>{s.guardian_phone}</div>}
                      </td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{s.duration_minutes} min</td>
                      <td style={{ padding: '11px 14px', color: '#10b981', fontWeight: 700, whiteSpace: 'nowrap' }}>KSH {s.amount_paid}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                          background: !isActive ? 'rgba(107,114,128,0.15)' : overdue ? 'rgba(239,68,68,0.15)' : urgent ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                          color: !isActive ? '#6b7280' : overdue ? '#ef4444' : urgent ? '#f59e0b' : '#10b981',
                        }}>
                          {!isActive ? 'Exited' : overdue ? 'Overdue' : urgent ? 'Soon' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr style={{ background: '#1c1f29', borderTop: '2px solid rgba(255,255,255,0.08)' }}>
                  <td colSpan={5} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Total · {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#10b981', fontWeight: 800, fontSize: 14 }}>
                    KSH {totalRevenue.toLocaleString()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TrampolineApp({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<'home' | 'checkin' | 'history'>('home');
  const [mainTab, setMainTab] = useState<'live' | 'records'>('live');
  const [sessions, setSessions] = useState<JumperSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const [liveSearch, setLiveSearch] = useState('');
  const [alertShown, setAlertShown] = useState<Set<number>>(new Set());
  const tickRef = useRef(0);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('jumper_sessions')
      .select('*')
      .order('check_in_time', { ascending: false })
      .limit(200);
    if (data) setSessions(data as JumperSession[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    // Realtime: new check-ins appear instantly
    const ch = supabase.channel('jumper_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jumper_sessions' }, fetchSessions)
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [fetchSessions]);

  // Live tick every 10s to update timers and check for alerts
  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current += 1;
      setSessions(prev => [...prev]); // force re-render for live timers
    }, 10000);
    return () => clearInterval(t);
  }, []);

  // In-app alert for sessions about to exit (no package needed)
  useEffect(() => {
    sessions.forEach(s => {
      if (s.status !== 'active') return;
      const { minutes, overdue } = timeUntilExit(s.exit_time);
      // Alert at 5 min remaining and when overdue
      if ((minutes <= 5 && minutes > 0 && !alertShown.has(s.id * 1000 + 5)) ||
        (overdue && !alertShown.has(s.id * 1000 + 0))) {
        const key = s.id * 1000 + (overdue ? 0 : 5);
        setAlertShown(prev => new Set([...prev, key]));
      }
    });
  }, [sessions, alertShown]);

  const handleExit = async (id: number) => {
    await supabase.from('jumper_sessions').update({ status: 'exited' }).eq('id', id);
    fetchSessions();
  };

  const active = sessions.filter(s => s.status === 'active');
  const overdueSessions = active.filter(s => timeUntilExit(s.exit_time).overdue);
  const urgentSessions = active.filter(s => { const { urgent, overdue } = timeUntilExit(s.exit_time); return urgent && !overdue; });
  const todayRevenue = sessions
    .filter(s => new Date(s.check_in_time).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.amount_paid, 0);


  const displayed = useMemo(() => {
    if (view === 'checkin') return [];   // placeholder, won't be used
    const base = tab === 'active' ? active : sessions.filter(s =>
      new Date(s.check_in_time).toDateString() === new Date().toDateString()
    );
    if (!liveSearch.trim()) return base;
    const q = liveSearch.toLowerCase();
    return base.filter(s =>
      s.child_name.toLowerCase().includes(q) ||
      s.guardian_name.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q) ||
      String(s.age).includes(q)
    );
  }, [view, tab, active, sessions, liveSearch]);   // add `view` to dependencies

  if (view === 'checkin') {
    return <CheckInForm onDone={() => { fetchSessions(); setView('home'); }} onCancel={() => setView('home')} activeSessions={active} />;
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --bg: #0d0f14; --surface: #151820; --surface2: #1c1f29; --border: rgba(255,255,255,0.07); --text: #f0f2f8; --muted: #6b7280; --accent: #6366f1; }
        body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
        textarea { font-family: inherit; }
        input::placeholder, textarea::placeholder { color: #4b5563; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: '#151820', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} title="Back to home" style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f0f2f8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
            >
              <ChevronLeft size={18} /> Home
            </button>
            <div>
              <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 800, color: '#f0f2f8', margin: 0 }}>Jump Zone</h1>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Trampoline Park · {new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Alert badges — only show on live tab */}
            {mainTab === 'live' && overdueSessions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 20 }}>
                <Bell size={13} color="#ef4444" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>{overdueSessions.length}</span>
              </div>
            )}
            {mainTab === 'live' && urgentSessions.length > 0 && overdueSessions.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20 }}>
                <Clock size={13} color="#f59e0b" />
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>{urgentSessions.length}</span>
              </div>
            )}
            {/* Main tab switcher */}
            <div style={{ display: 'flex', background: '#1c1f29', borderRadius: 10, padding: 3, gap: 2 }}>
              {(['live', 'records'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)}
                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: mainTab === t ? '#6366f1' : 'transparent', color: mainTab === t ? '#fff' : '#6b7280', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                  {t === 'live' ? 'Live' : 'Records'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 100px' }}>

        {/* Records tab */}
        {mainTab === 'records' && (
          <TrampolineRecords allSessions={sessions} />
        )}

        {/* Live tab */}
        {mainTab === 'live' && <>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Jumping now', value: String(active.length), color: '#10b981' },
              { label: "Today's sessions", value: String(sessions.filter(s => new Date(s.check_in_time).toDateString() === new Date().toDateString()).length), color: '#6366f1' },
              { label: "Today's revenue", value: `KSH ${todayRevenue}`, color: '#f59e0b' },
            ].map(c => (
              <div key={c.label} style={{ background: '#151820', borderRadius: 14, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{c.label}</p>
                <p style={{ fontSize: c.label.includes('revenue') ? 17 : 23, fontWeight: 800, color: c.color, fontFamily: ' sans-serif', lineHeight: 1 }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Alert banners */}
          {overdueSessions.map(s => (
            <div key={s.id} style={{ marginBottom: 10, padding: '12px 16px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown 0.3s ease' }}>
              <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', margin: 0 }}>{s.child_name} is overdue!</p>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>Was supposed to exit by {fmtTime(s.exit_time)}</p>
              </div>
            </div>
          ))}

          {urgentSessions.map(s => (
            <div key={s.id} style={{ marginBottom: 10, padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Clock size={18} color="#f59e0b" style={{ flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b', margin: 0 }}>{s.child_name} leaving soon</p>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>Exit by {fmtTime(s.exit_time)} · Guardian: {s.guardian_name}</p>
              </div>
            </div>
          ))}

          {/* Tab filter + search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['active', 'all'] as const).map(t => (
                <button key={t} onClick={() => { setTab(t); setLiveSearch(''); }}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === t ? '#6366f1' : '#151820', color: tab === t ? '#fff' : '#6b7280', transition: 'all 0.15s' }}>
                  {t === 'active' ? `Active (${active.length})` : 'All Today'}
                </button>
              ))}
            </div>
            {/* Search bar */}
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={liveSearch}
                onChange={e => setLiveSearch(e.target.value)}
                placeholder={tab === 'active' ? 'Search active — name, age, guardian, notes…' : 'Search today — name, age, guardian, notes…'}
                style={{
                  width: '100%', padding: '11px 14px 11px 38px', fontSize: 14,
                  background: '#151820', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10, color: '#f0f2f8', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}
              />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }}>
                <Filter size={15} />
              </span>
              {liveSearch && (
                <button onClick={() => setLiveSearch('')}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <X size={15} />
                </button>
              )}
            </div>
            {liveSearch && (
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                {displayed.length} result{displayed.length !== 1 ? 's' : ''} for <span style={{ color: '#a5b4fc' }}>"{liveSearch}"</span>
              </p>
            )}
          </div>

          {/* Sessions list */}
          {loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '40px 0' }}>Loading…</p>
          ) : displayed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
              <Users size={40} color="#374151" style={{ margin: '0 auto 16px' }} />
              <p style={{ fontSize: 16, fontWeight: 600, color: '#4b5563', marginBottom: 8 }}>
                {liveSearch ? `No results for "${liveSearch}"` : tab === 'active' ? 'No one jumping right now' : 'No sessions today yet'}
              </p>
              <p style={{ fontSize: 14 }}>{liveSearch ? 'Try a different name or age' : 'Tap the button below to check in a child'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {displayed.map(s => (
                <SessionCard key={s.id} session={s} onExit={handleExit} onRefresh={fetchSessions} />
              ))}
            </div>
          )}
        </>}
      </div>

      {/* Big check-in button — fixed at bottom, only on live tab */}
      {mainTab === 'live' && <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '16px 20px', background: 'linear-gradient(to top, #0d0f14 70%, transparent)', zIndex: 40 }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <button onClick={() => setView('checkin')}
            style={{ width: '100%', padding: '18px', background: '#6366f1', border: 'none', borderRadius: 16, color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 20px rgba(99,102,241,0.4)', transition: 'all 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#4f46e5'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#6366f1'; }}
          >
            <UserPlus size={20} /> Check In a Client
          </button>
        </div>
      </div>}
    </>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  // ── APP SECTION — landing choice ──────────────────────────────────────────
  const [appSection, setAppSection] = useState<'landing' | 'vr' | 'trampoline'>('landing');

  // ── MULTI-USER AUTH ───────────────────────────────────────────────────────
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [arcadeUsers, setArcadeUsers] = useState<ArcadeUser[]>([]);

  // ── LOCAL STATUS OVERRIDES (frontend-only, never written to DB) ───────────
  // This map stores supervisor-set status overrides keyed by log id.
  // It sits at the top level so Dashboard revenue and StatsCards also reflect it.
  const [statusOverrides, setStatusOverrides] = useState<Map<number, GameLog['status']>>(new Map());

  const getEffectiveStatus = useCallback((log: GameLog): GameLog['status'] => {
    return statusOverrides.get(log.id) ?? log.status;
  }, [statusOverrides]);

  const getEffectiveRevenue = useCallback((log: GameLog): number => {
    const s = statusOverrides.get(log.id) ?? log.status;
    // TEST → always 0
    if (s === 'TEST') return 0;
    // ERROR → always 0 (errors never earn revenue regardless of original status)
    if (s === 'ERROR') return 0;
    // FULL GAME → use the revenue_ksh the PS script logged (already the correct amount)
    return log.revenue_ksh;
  }, [statusOverrides]);

  // ── FREE PLAY MODE ────────────────────────────────────────────────────────
  const [freePlaySession, setFreePlaySession] = useState<FreePlaySession>(null);
  const [showFreePlayModal, setShowFreePlayModal] = useState(false);

  // ── DATA HOOKS (must be called unconditionally) ────────────────────────────
  const { logs, setLogs, loading } = useGameLogs(1000);
  const { machines, setMachines, refetch: refetchMachines } = useMachineStatus();
  const { settings, loading: settingsLoading, updateSettings, refetch: refetchSettings } = useArcadeSettings();
  const [mounted, setMounted] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchMachines(),
        refetchSettings(),
        supabase
          .from('game_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000)
          .then(({ data }) => {
            if (data) setLogs(data as GameLog[]);
          }),
      ]);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchMachines, refetchSettings, setLogs]);
  // ── UI STATE ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('dashboard');
  const [now, setNow] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load users from DB and restore session from sessionStorage
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.from('arcade_users').select('*').order('created_at');
      setArcadeUsers((data as ArcadeUser[]) ?? []);
      // Restore session if browser tab still open
      try {
        const stored = sessionStorage.getItem('arcade_session');
        if (stored) setSession(JSON.parse(stored));
      } catch { }
      setAuthLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    setMounted(true);
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

  const handleLogin = (user: ArcadeUser) => {
    const s: ActiveSession = { userId: user.id, name: user.name, role: user.role };
    setSession(s);
    try { sessionStorage.setItem('arcade_session', JSON.stringify(s)); } catch { }
  };

  const handleLogout = () => {
    setSession(null);
    try { sessionStorage.removeItem('arcade_session'); } catch { }
  };

  const refreshUsers = async () => {
    const { data } = await supabase.from('arcade_users').select('*').order('created_at');
    setArcadeUsers((data as ArcadeUser[]) ?? []);
  };

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
    return logs.filter(l => l.date === today).reduce((s, l) => s + getEffectiveRevenue(l), 0);
  }, [logs, getEffectiveRevenue]);

  // ── Section routing ──────────────────────────────────────────────────────
  if (appSection === 'landing') {
    return (
      <LandingScreen
        onVR={() => setAppSection('vr')}
        onTrampoline={() => setAppSection('trampoline')}
      />
    );
  }

  if (appSection === 'trampoline') {
    return <TrampolineApp onBack={() => setAppSection('landing')} />;
  }

  // ── VR Arcade auth gate ───────────────────────────────────────────────────
  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!session) {
    return (
      <LoginScreen
        users={arcadeUsers}
        onLogin={handleLogin}
        onFirstSetup={refreshUsers}
        onBack={() => setAppSection('landing')}
      />
    );
  }

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
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
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
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          onFreePlay={() => setShowFreePlayModal(true)}
          session={session}
          onLogout={handleLogout}
          onBackToLanding={() => setAppSection('landing')}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Header now={now} onMenuToggle={() => setSidebarCollapsed(p => !p)} mounted={mounted} />
          {freePlaySession && (
            <FreePlayBanner session={freePlaySession} onEnd={() => setFreePlaySession(null)} />
          )}
          <main style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
            {activeTab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <MachineStatusCards machines={machines} onDelete={deleteMachine} onClearAll={clearAllMachines} />
                <ProgressCard todayRevenue={todayRevenue} dailyTarget={settings?.daily_target_ksh || 4000} />
                <StatsCards logs={logs} effectiveRevenue={getEffectiveRevenue} />
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
            {activeTab === 'activity' && <ActivityView logs={logs} freePlaySession={freePlaySession} statusOverrides={statusOverrides} setStatusOverrides={setStatusOverrides} effectiveStatus={getEffectiveStatus} effectiveRevenue={getEffectiveRevenue} session={session} />}
            {activeTab === 'intelligence' && <GameIntelligenceView logs={logs} />}
            {activeTab === 'settings' && session?.role === 'owner' && (<SettingsView settings={settings} updateSettings={updateSettings} onClearAllMachines={clearAllMachines} session={session} refreshUsers={refreshUsers} />)}
          </main>
          {/* Footer */}
          <footer style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12px',
            color: 'var(--muted)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>© {new Date().getFullYear()} VR Arcade</span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span> <span style={{ color: 'var(--accent)', fontWeight: 500 }}></span></span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <a href="mailto:your.email@example.com" style={{
                color: 'var(--muted)',
                textDecoration: 'none',
                transition: 'color 0.15s',
              }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
              >
                For Help Email | charlesmacharia4564@gmail.com
              </a>
              <span style={{ opacity: 0.4 }}>|</span>

              <span >Jump Xtreme</span>
            </div>
          </footer>
        </div>
      </div>
      {showFreePlayModal && (
        <FreePlayModal
          onClose={() => setShowFreePlayModal(false)}
          onActivate={(session) => {
            setFreePlaySession(session);
            setShowFreePlayModal(false);
          }}
        />
      )}
    </>
  );
}