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
  PartyPopper, Download, Users, UserPlus, ShieldCheck, Shield, LogOut, ChevronLeft, CheckCircle, Bell, Edit,
  Package, TimerReset, Cake, GraduationCap, Handshake, PlusCircle,
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
    const freePlayStart = freePlaySession.endTime.getTime() - freePlaySession.durationHours * 3600000;
    logs.forEach(l => {
      if (!knownLogIds.current.has(l.id)) {
        knownLogIds.current.add(l.id);
        const logTime = parseISO(l.start_time).getTime();
        if (logTime >= freePlayStart) {
          setStatusOverrides(prev => {
            if (prev.has(l.id)) return prev;
            const next = new Map(prev);
            next.set(l.id, 'TEST');
            return next;
          });
        }
      }
    });
  }, [logs, freePlaySession, setStatusOverrides]);

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
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color: '#f0f2f8', marginBottom: 8 }}>Jump Zone</h2>
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
          Jump Xtreme· Portal
        </p>
      </div>
    </>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// TRAMPOLINE PARK — Jump Zone
// ─────────────────────────────────────────────────────────────────────────────
// Per-kid description stored as array in JSON
interface KidDesc {
  tops: string[];
  bottoms: string[];
  colors: string[];
  gender?: 'male' | 'female' | 'other';
  isAdult?: boolean;
}

interface JumperSession {
  id: number;
  kid_count: number;            // number of children in the group
  check_in_time: string;
  duration_hours: number;       // base hours: 1, 2, 3 …
  bonus_minutes: number;        // extra time: 0, 10, 20, 30, 40
  exit_time: string;            // scheduled = check_in + duration_hours*60 + bonus_minutes
  actual_exit_time: string | null; // set when worker presses Exit
  status: 'active' | 'exited';
  package_type: string | null;  // null = standard; 'birthday'|'school'|'team_building'|custom string
  group_note: string | null;    // optional group-level note (used for group packages)
  top_wear: string;
  bottom_wear: string;
  colors: string;
  kid_descs: string | null;     // JSON: KidDesc[] — one entry per kid
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

// ─── Clothing options ───────────────────────────────────────────────────────
const TOP_WEAR_OPTIONS = [
  { id: 'tshirt', label: 'T-Shirt', icon: '👕' },
  { id: 'sweater', label: 'Sweater', icon: '🧥' },
  { id: 'hoodie', label: 'Hoodie', icon: '🧤' },
  { id: 'jacket', label: 'Jacket', icon: '🧣' },
  { id: 'vest', label: 'Vest', icon: '🎽' },
  { id: 'blouse', label: 'Blouse', icon: '👚' },
];
const BOTTOM_WEAR_OPTIONS = [
  { id: 'shorts', label: 'Shorts', icon: '🩳' },
  { id: 'trousers', label: 'Trousers', icon: '👖' },
  { id: 'skirt', label: 'Skirt/Dress', icon: '👗' },
  { id: 'leggings', label: 'Leggings', icon: '🧦' },
  { id: 'jeans', label: 'Jeans', icon: '👖' },
];
const COLOR_OPTIONS = [
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'green', label: 'Green', hex: '#22c55e' },
  { id: 'yellow', label: 'Yellow', hex: '#eab308' },
  { id: 'black', label: 'Black', hex: '#1f2937' },
  { id: 'white', label: 'White', hex: '#e5e7eb' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'pink', label: 'Pink', hex: '#ec4899' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
  { id: 'brown', label: 'Brown', hex: '#92400e' },
  { id: 'grey', label: 'Grey', hex: '#6b7280' },
  { id: 'navy', label: 'Navy', hex: '#1e3a5f' },
];

// ─── Stepper button ───────────────────────────────────────────────────────────
function Stepper({ value, onDec, onInc, min = 1, max = 99, large = false }: {
  value: number; onDec: () => void; onInc: () => void;
  min?: number; max?: number; large?: boolean;
}) {
  const sz = large ? 64 : 52;
  const fnt = large ? 32 : 24;
  const numFnt = large ? 48 : 36;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: large ? 20 : 14 }}>
      <button
        onClick={onDec} disabled={value <= min}
        style={{
          width: sz, height: sz, borderRadius: 16,
          background: value <= min ? '#1a1d26' : '#282a32',
          border: 'none', color: value <= min ? '#3a3d4a' : '#c9c4d8',
          fontSize: fnt, fontWeight: 300, cursor: value <= min ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.12s', flexShrink: 0,
        }}
        onMouseDown={e => { if (value > min) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.94)'; }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
      >−</button>
      <span style={{ fontSize: numFnt, fontWeight: 800, color: '#e1e1ed', fontFamily: 'Inter, sans-serif', minWidth: large ? 60 : 44, textAlign: 'center', lineHeight: 1 }}>
        {String(value).padStart(2, '0')}
      </span>
      <button
        onClick={onInc} disabled={value >= max}
        style={{
          width: sz, height: sz, borderRadius: 16,
          background: 'linear-gradient(135deg, #917eff 0%, #7B61FF 100%)',
          border: 'none', color: '#fff',
          fontSize: fnt, fontWeight: 300, cursor: value >= max ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.12s', flexShrink: 0,
          opacity: value >= max ? 0.4 : 1,
        }}
        onMouseDown={e => { if (value < max) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.94)'; }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
      >+</button>
    </div>
  );
}

// ─── Per-kid description panel ──────────────────────────────────────────────
function KidDescPanel({ kidIndex, kidCount, desc, onChange }: {
  kidIndex: number;
  kidCount: number;
  desc: KidDesc;
  onChange: (d: KidDesc) => void;
}) {
  const toggle = (field: 'tops' | 'bottoms' | 'colors', id: string) => {
    const arr = desc[field];
    onChange({ ...desc, [field]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] });
  };

  const clothBtn = (selected: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '12px 8px', borderRadius: 14, border: 'none', cursor: 'pointer',
    background: selected ? 'rgba(123,97,255,0.25)' : '#282a32',
    outline: selected ? '2px solid #7B61FF' : '2px solid transparent',
    transition: 'all 0.12s', flex: 1, minWidth: 64,
  });

  // Accent color per kid slot for visual distinction
  const kidColors = ['#7B61FF', '#00C853', '#f59e0b', '#ef4444', '#3b82f6',
    '#ec4899', '#06b6d4', '#8b5cf6', '#10b981', '#f97316'];
  const accent = kidColors[(kidIndex) % kidColors.length];

  return (
    <div style={{ background: '#0c0e16', borderRadius: 18, padding: '18px 16px' }}>
      {/* Kid label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{kidIndex + 1}</span>
        </div>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#e1e1ed', margin: 0 }}>
          Kid {kidIndex + 1}
          {kidCount > 1 && <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400, marginLeft: 8 }}>
            — describe their clothing
          </span>}
        </p>
      </div>

      {/* Top Wear */}
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Top Wear</p>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
        {TOP_WEAR_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => toggle('tops', opt.id)} style={clothBtn(desc.tops.includes(opt.id))}>
            <span style={{ fontSize: 20 }}>{opt.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: desc.tops.includes(opt.id) ? '#c9bfff' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Bottom Wear */}
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Bottoms</p>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
        {BOTTOM_WEAR_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => toggle('bottoms', opt.id)} style={clothBtn(desc.bottoms.includes(opt.id))}>
            <span style={{ fontSize: 20 }}>{opt.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: desc.bottoms.includes(opt.id) ? '#c9bfff' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Colors */}
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Color(s)</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {COLOR_OPTIONS.map(c => {
          const sel = desc.colors.includes(c.id);
          return (
            <button key={c.id} onClick={() => toggle('colors', c.id)} title={c.label}
              style={{
                width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: c.hex,
                outline: sel ? `3px solid ${accent}` : '3px solid transparent',
                outlineOffset: 3,
                transform: sel ? 'scale(1.2)' : 'scale(1)',
                transition: 'all 0.12s',
                boxShadow: c.id === 'white' ? 'inset 0 0 0 1px rgba(255,255,255,0.25)' : 'none',
              }} />
          );
        })}
      </div>
      {desc.colors.length > 0 && (
        <p style={{ fontSize: 11, color: accent, marginTop: 8, fontWeight: 600 }}>
          {desc.colors.map(id => COLOR_OPTIONS.find(c => c.id === id)?.label).join(', ')}
        </p>
      )}

      {/* Gender */}
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 16, marginBottom: 10 }}>Gender</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['male', 'female', 'other'] as const).map(g => (
          <button key={g} onClick={() => onChange({ ...desc, gender: g })}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: desc.gender === g ? '#7B61FF' : '#282a32',
              color: desc.gender === g ? '#fff' : '#c9c4d8',
              fontSize: 13, fontWeight: 600, transition: 'all 0.12s',
            }}>
            {g === 'male' ? '👦 Male' : g === 'female' ? '👧 Female' : '👤 Other'}
          </button>
        ))}
      </div>

      {/* Adult / Kid toggle */}
      <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 16, marginBottom: 10 }}>Age Group</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onChange({ ...desc, isAdult: false })}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: desc.isAdult === false ? '#7B61FF' : '#282a32',
            color: desc.isAdult === false ? '#fff' : '#c9c4d8',
            fontSize: 13, fontWeight: 600, transition: 'all 0.12s',
          }}>
          🧒 Kid
        </button>
        <button onClick={() => onChange({ ...desc, isAdult: true })}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: desc.isAdult === true ? '#7B61FF' : '#282a32',
            color: desc.isAdult === true ? '#fff' : '#c9c4d8',
            fontSize: 13, fontWeight: 600, transition: 'all 0.12s',
          }}>
          👤 Adult
        </button>
      </div>
    </div>
  );
}

// ─── PIN Authentication Modal ─────────────────────────────────────────────────
// Reusable PIN gate — fetches all arcade_users and verifies against any of them.
// onSuccess receives the verified user's name + role.
function PinAuthModal({ title, subtitle, onSuccess, onCancel, actionLabel = 'Confirm' }: {
  title: string;
  subtitle?: string;
  onSuccess: (userName: string, role: string) => void;
  onCancel: () => void;
  actionLabel?: string;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) verify(next);
  };
  const handleBack = () => setPin(p => p.slice(0, -1));

  const verify = async (code: string) => {
    setChecking(true);
    const { data: users } = await supabase.from('arcade_users').select('*');
    if (!users || users.length === 0) { setError('No users found.'); setPin(''); setChecking(false); return; }
    for (const u of users as ArcadeUser[]) {
      const ok = await verifyPin(code, u.pin_hash);
      if (ok) { setChecking(false); onSuccess(u.name, u.role); return; }
    }
    setChecking(false);
    setError('Wrong PIN. Try again.');
    setPin('');
  };

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1d1f28', borderRadius: 24, width: '100%', maxWidth: 340, padding: '28px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {/* Icon */}
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(123,97,255,0.15)', border: '1px solid rgba(123,97,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <LockKeyhole size={24} color="#917eff" />
        </div>
        <p style={{ fontSize: 17, fontWeight: 800, color: '#e1e1ed', margin: '0 0 4px', textAlign: 'center' }}>{title}</p>
        {subtitle && <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 24px', textAlign: 'center', lineHeight: 1.5 }}>{subtitle}</p>}
        {!subtitle && <div style={{ marginBottom: 24 }} />}

        {/* PIN dots */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
          {dots.map((filled, i) => (
            <div key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: filled ? '#7B61FF' : '#282a32', border: `2px solid ${filled ? '#917eff' : 'rgba(255,255,255,0.1)'}`, transition: 'all 0.12s' }} />
          ))}
        </div>
        {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '4px 0 12px', textAlign: 'center' }}>{error}</p>}
        {!error && <div style={{ marginBottom: 20 }} />}

        {/* Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%', marginBottom: 14 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
            d === '' ? <div key={i} /> :
              <button key={i}
                onClick={() => d === '⌫' ? handleBack() : handleDigit(d)}
                disabled={checking}
                style={{
                  padding: '18px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: d === '⌫' ? '#282a32' : 'rgba(255,255,255,0.05)',
                  color: d === '⌫' ? '#9ca3af' : '#e1e1ed',
                  fontSize: d === '⌫' ? 20 : 22, fontWeight: 700,
                  transition: 'all 0.1s', opacity: checking ? 0.5 : 1,
                }}
                onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.93)'; }}
                onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
              >{checking && d !== '⌫' ? '' : d}</button>
          ))}
        </div>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', padding: '6px 16px', borderRadius: 8 }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Add Time Modal (PIN-gated) ───────────────────────────────────────────────
function AddTimeModal({ session, onClose, onSaved }: {
  session: JumperSession;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pinVerified, setPinVerified] = useState(false);
  const [addMins, setAddMins] = useState(10);
  const [customMins, setCustomMins] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const presets = [10, 15, 20, 30, 45, 60];
  const finalMins = useCustom ? parseInt(customMins || '0', 10) : addMins;

  const currentExit = new Date(session.exit_time);
  const newExit = new Date(currentExit.getTime() + finalMins * 60000);
  const newExitLabel = newExit.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });

  const handleSave = async () => {
    if (!finalMins || finalMins <= 0) { setError('Please select or enter a valid time.'); return; }
    setSaving(true);

    const updates: Partial<JumperSession> = {
      exit_time: newExit.toISOString(),
      bonus_minutes: session.bonus_minutes + finalMins,
    };

    // If session was exited, reactivate it
    if (session.status === 'exited') {
      updates.status = 'active';
      updates.actual_exit_time = null;
    }

    const { error: err } = await supabase.from('jumper_sessions').update(updates).eq('id', session.id);
    setSaving(false);

    if (err) { setError('Failed to update time. Try again.'); return; }
    onSaved();
    onClose();
  };

  if (!pinVerified) {
    return (
      <PinAuthModal
        title={session.status === 'exited' ? "Authorise Reactivation" : "Authorise Time Extension"}
        subtitle="Only authorised staff can extend session time."
        actionLabel={session.status === 'exited' ? "Reactivate & Extend" : "Extend Time"}
        onSuccess={() => setPinVerified(true)}
        onCancel={onClose}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1d1f28', borderRadius: 24, maxWidth: 400, width: '100%', padding: '24px 20px', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: session.status === 'exited' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TimerReset size={18} color={session.status === 'exited' ? '#34d399' : '#818cf8'} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#e1e1ed', margin: 0 }}>
              {session.status === 'exited' ? 'Reactivate Session' : 'Extend Session'}
            </p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              Group of {session.kid_count} · current exit {new Date(session.exit_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </p>
          </div>
        </div>

        {/* New exit preview */}
        {finalMins > 0 && (
          <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '10px 14px', margin: '14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#818cf8' }}>New exit time</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#a5b4fc' }}>{newExitLabel}</span>
          </div>
        )}

        {/* Presets */}
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '14px 0 10px' }}>Add time</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {presets.map(m => (
            <button key={m}
              onClick={() => { setUseCustom(false); setAddMins(m); }}
              style={{
                padding: '10px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 700,
                background: !useCustom && addMins === m ? '#6366f1' : '#282a32',
                color: !useCustom && addMins === m ? '#fff' : '#c9c4d8',
                transition: 'all 0.12s',
              }}>
              +{m}m
            </button>
          ))}
          <button
            onClick={() => setUseCustom(true)}
            style={{
              padding: '10px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
              background: useCustom ? '#6366f1' : '#282a32',
              color: useCustom ? '#fff' : '#c9c4d8',
              transition: 'all 0.12s',
            }}>
            Custom
          </button>
        </div>

        {useCustom && (
          <div style={{ marginBottom: 14 }}>
            <input
              type="number" min={1} max={240}
              value={customMins}
              onChange={e => setCustomMins(e.target.value)}
              placeholder="Enter minutes (e.g. 25)"
              style={{ background: '#0c0e16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 14px', color: '#e1e1ed', fontSize: 16, width: '100%', outline: 'none' }}
              autoFocus
            />
          </div>
        )}

        {error && <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#282a32', color: '#c9c4d8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || finalMins <= 0} style={{ flex: 2, padding: '12px', borderRadius: 12, border: 'none', background: finalMins > 0 ? '#6366f1' : '#282a32', color: finalMins > 0 ? '#fff' : '#4b5563', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.12s' }}>
            {saving ? 'Saving…' : `Add +${finalMins}m`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Time Edit Modal (supervisor/owner PIN‑gated) ────────────────────────────
function TimeEditModal({
  checkInTime,
  exitTime,
  hours,
  bonusMins,
  fineTune,
  onSave,
  onClose,
}: {
  checkInTime: Date;
  exitTime: Date;
  hours: number;
  bonusMins: number;
  fineTune: number;
  onSave: (newCheckIn: Date, newExit: Date, newHours: number, newBonus: number, newFine: number) => void;
  onClose: () => void;
}) {
  const [localCheckIn, setLocalCheckIn] = useState(checkInTime);
  const [localExit, setLocalExit] = useState(exitTime);
  const [localHours, setLocalHours] = useState(hours);
  const [localBonus, setLocalBonus] = useState(bonusMins);
  const [localFine, setLocalFine] = useState(fineTune);
  const [autoMode, setAutoMode] = useState<'duration' | 'exit'>('duration');

  // Derived exit preview
  const derivedExit = new Date(localCheckIn.getTime() + (localHours * 60 + localBonus + localFine) * 60000);
  const isBackDated = localCheckIn.getTime() < (Date.now() - 60000);
  const exitIsOverdue = derivedExit.getTime() < Date.now();
  const minsUntilExit = Math.round((derivedExit.getTime() - Date.now()) / 60000);

  // When duration changes in 'duration' mode, update exit
  useEffect(() => {
    if (autoMode === 'duration') {
      const totalMins = localHours * 60 + localBonus + localFine;
      const newExit = new Date(localCheckIn.getTime() + totalMins * 60000);
      setLocalExit(newExit);
    }
  }, [localHours, localBonus, localFine, localCheckIn, autoMode]);

  const handleExitChange = (newExit: Date) => {
    setLocalExit(newExit);
    if (autoMode === 'exit') {
      const diffMins = Math.round((newExit.getTime() - localCheckIn.getTime()) / 60000);
      const hrs = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      setLocalHours(Math.max(1, hrs));
      let remaining = mins;
      if (remaining >= 40) { setLocalBonus(40); remaining -= 40; }
      else if (remaining >= 30) { setLocalBonus(30); remaining -= 30; }
      else if (remaining >= 20) { setLocalBonus(20); remaining -= 20; }
      else if (remaining >= 10) { setLocalBonus(10); remaining -= 10; }
      else { setLocalBonus(0); }
      setLocalFine(remaining);
    }
  };

  const handleSave = () => {
    onSave(localCheckIn, localExit, localHours, localBonus, localFine);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1d1f28', borderRadius: 24, maxWidth: 480, width: '100%', padding: '24px', boxShadow: '0 24px 60px rgba(0,0,0,0.6)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#e1e1ed', marginBottom: 6 }}>Edit Session Times</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>Set the actual check‑in time and duration for a client who arrived before check‑in.</p>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, background: '#0c0e16', borderRadius: 12, padding: 4 }}>
          <button
            onClick={() => setAutoMode('duration')}
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: autoMode === 'duration' ? '#6366f1' : 'transparent', color: autoMode === 'duration' ? '#fff' : '#6b7280' }}
          >Set Duration → Exit</button>
          <button
            onClick={() => setAutoMode('exit')}
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: autoMode === 'exit' ? '#6366f1' : 'transparent', color: autoMode === 'exit' ? '#fff' : '#6b7280' }}
          >Set Exit → Duration</button>
        </div>

        {/* Check‑in time */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Check‑in Time</label>
          <input
            type="datetime-local"
            value={format(localCheckIn, "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setLocalCheckIn(d); }}
            style={{ width: '100%', background: '#0c0e16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px', color: '#e1e1ed', fontSize: 14, boxSizing: 'border-box' }}
          />
          {isBackDated && (
            <p style={{ fontSize: 11, color: '#f59e0b', marginTop: 5 }}>
              ⚠️ Back‑dated: client arrived {Math.round((Date.now() - localCheckIn.getTime()) / 60000)}m ago
            </p>
          )}
        </div>

        {/* Duration controls */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Duration</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: '#c9c4d8' }}>Hours</span>
              <Stepper value={localHours} onDec={() => setLocalHours(v => Math.max(1, v - 1))} onInc={() => setLocalHours(v => Math.min(12, v + 1))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#c9c4d8' }}>Bonus</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {[0, 10, 20, 30, 40].map(m => (
                  <button key={m} onClick={() => setLocalBonus(m)} style={{ padding: '6px 10px', borderRadius: 8, background: localBonus === m ? '#6366f1' : '#282a32', color: localBonus === m ? '#fff' : '#c9c4d8', border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>{m === 0 ? 'None' : `+${m}m`}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: '#c9c4d8' }}>Fine‑tune</span>
              <Stepper value={localFine} min={-10} max={10} onDec={() => setLocalFine(v => Math.max(-10, v - 1))} onInc={() => setLocalFine(v => Math.min(10, v + 1))} />
            </div>
          </div>
        </div>

        {/* Exit time */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            Exit Time {autoMode === 'duration' ? '(auto‑calculated)' : '(editable)'}
          </label>
          <input
            type="datetime-local"
            value={format(localExit, "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) handleExitChange(d); }}
            disabled={autoMode === 'duration'}
            style={{ width: '100%', background: '#0c0e16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px', color: '#e1e1ed', fontSize: 14, opacity: autoMode === 'duration' ? 0.6 : 1, boxSizing: 'border-box' }}
          />
        </div>

        {/* Live preview */}
        <div style={{ borderRadius: 14, padding: '12px 16px', marginBottom: 20, background: exitIsOverdue ? 'rgba(239,68,68,0.1)' : isBackDated ? 'rgba(245,158,11,0.1)' : 'rgba(99,102,241,0.1)', border: `1px solid ${exitIsOverdue ? 'rgba(239,68,68,0.3)' : isBackDated ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.25)'}` }}>
          <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Session Preview</p>
          <p style={{ fontSize: 14, color: '#e1e1ed', margin: 0, fontWeight: 600 }}>
            {format(localCheckIn, 'HH:mm')} → {format(localExit, 'HH:mm')}
            {' '}
            <span style={{ fontWeight: 400, color: '#6b7280' }}>
              ({localHours}h{localBonus > 0 ? ` +${localBonus}m` : ''}{localFine !== 0 ? ` ${localFine > 0 ? '+' : ''}${localFine}m` : ''})
            </span>
          </p>
          {exitIsOverdue ? (
            <p style={{ fontSize: 12, color: '#ef4444', margin: '4px 0 0', fontWeight: 700 }}>⚠️ Exit time already passed — session card will show Overdue immediately</p>
          ) : isBackDated ? (
            <p style={{ fontSize: 12, color: '#f59e0b', margin: '4px 0 0' }}>⏳ {minsUntilExit}m remaining on session timer from now</p>
          ) : (
            <p style={{ fontSize: 12, color: '#34d399', margin: '4px 0 0' }}>✓ Timer will count down normally</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#282a32', color: '#c9c4d8', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Apply Times</button>
        </div>
      </div>
    </div>
  );
}

// ─── Check-in form (Two-screen: Standard + Group Package, with full duration controls) ───
function CheckInForm({ onDone, onCancel, activeSessions }: {
  onDone: () => void; onCancel: () => void; activeSessions: JumperSession[];
}) {
  // ── Top-level mode ─────────────────────────────────────────────────────
  const [checkInMode, setCheckInMode] = useState<'standard' | 'package'>('standard');

  // ── Shared fields ──────────────────────────────────────────────────────
  const [kidCount, setKidCount] = useState(1);
  const [hours, setHours] = useState(1);
  const [customHourMode, setCustomHourMode] = useState(false);
  const [customHourInput, setCustomHourInput] = useState('');
  const [bonusMins, setBonusMins] = useState(0);
  const [fineTune, setFineTune] = useState(0);

  // ── Special Categories (Standard mode only) ────────────────────────────
  const [showSpecial, setShowSpecial] = useState(false);
  const [specialCategory, setSpecialCategory] = useState<string | null>(null);

  // ── Custom check‑in time (PIN‑gated) ──
  const [checkInTime, setCheckInTime] = useState<Date>(new Date());
  const [showPinModalForTime, setShowPinModalForTime] = useState(false);

  // ── Per‑kid descriptions (Standard mode only) ──────────────────────────
  const [kidDescs, setKidDescs] = useState<KidDesc[]>([
    { tops: [], bottoms: [], colors: [], gender: 'other', isAdult: false }
  ]);
  const [activeKid, setActiveKid] = useState(0);

  // ── Group Package fields ───────────────────────────────────────────────
  const PACKAGE_OPTIONS = [
    { id: 'birthday', label: 'Birthday Package', icon: '🎂', color: '#f472b6', desc: 'Party & play for birthday celebrations' },
    { id: 'school', label: 'School Group', icon: '🎓', color: '#60a5fa', desc: 'Educational group & school trips' },
    { id: 'team_building', label: 'Team Building', icon: '🤝', color: '#34d399', desc: 'Corporate & team activities' },
    { id: 'other', label: 'Other / Custom', icon: '📦', color: '#a78bfa', desc: 'Custom group package' },
  ];
  const [selectedPackage, setSelectedPackage] = useState<string>('birthday');
  const [customPackageName, setCustomPackageName] = useState('');
  const [groupNote, setGroupNote] = useState('');

  // ── UI state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Special Categories definitions ─────────────────────────────────────
  const SPECIAL_CATEGORIES = [
    {
      id: 'unlimited',
      label: 'Unlimited Time',
      icon: '♾️',
      tagline: 'Play until close — no timer',
      color: '#f59e0b',
      gradient: 'linear-gradient(135deg, #d97706, #f59e0b)',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.35)',
    },
    {
      id: 'standard_pass',
      label: 'Standard Pass',
      icon: '🎫',
      tagline: 'Full‑day standard access',
      color: '#34d399',
      gradient: 'linear-gradient(135deg, #059669, #34d399)',
      bg: 'rgba(52,211,153,0.12)',
      border: 'rgba(52,211,153,0.35)',
    },
    {
      id: 'premium_pass',
      label: 'Premium Pass',
      icon: '👑',
      tagline: 'Full‑day premium access',
      color: '#a78bfa',
      gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
      bg: 'rgba(167,139,250,0.12)',
      border: 'rgba(167,139,250,0.35)',
    },
  ];

  const endOfDay = () => {
    const d = new Date();
    d.setHours(22, 0, 0, 0); // 10 PM closing time – adjust as needed
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d;
  };

  const effectiveHours = customHourMode ? (parseFloat(customHourInput) || 0) : hours;
  const totalMins = (checkInMode === 'standard' && specialCategory) ? 0 : (effectiveHours * 60 + bonusMins + fineTune);
  const exitTime = (checkInMode === 'standard' && specialCategory) ? endOfDay() : new Date(checkInTime.getTime() + totalMins * 60000);
  const exitLabel = exitTime.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });

  const selectedCat = (checkInMode === 'standard' && specialCategory)
    ? SPECIAL_CATEGORIES.find(c => c.id === specialCategory)
    : null;
  // Time edit modal
  const [showTimeEditModal, setShowTimeEditModal] = useState(false);
  const [tempCheckInTime, setTempCheckInTime] = useState<Date>(checkInTime);
  const [tempExitTime, setTempExitTime] = useState<Date>(exitTime);
  const [tempHours, setTempHours] = useState(hours);
  const [tempBonusMins, setTempBonusMins] = useState(bonusMins);
  const [tempFineTune, setTempFineTune] = useState(fineTune);
  // ── Handlers ────────────────────────────────────────────────────────────
  const handleKidCountChange = (newCount: number) => {
    setKidCount(newCount);
    setKidDescs(prev => {
      if (newCount > prev.length) {
        const emptyDesc: KidDesc = { tops: [], bottoms: [], colors: [], gender: 'other', isAdult: false };
        return [...prev, ...Array(newCount - prev.length).fill(emptyDesc)];
      }
      return prev.slice(0, newCount);
    });
    setActiveKid(prev => Math.min(prev, newCount - 1));
  };

  const updateKidDesc = (index: number, desc: KidDesc) => {
    setKidDescs(prev => prev.map((d, i) => i === index ? desc : d));
  };

  useEffect(() => {
    // Reset time edit state when mode changes
    setShowPinModalForTime(false);
    setShowTimeEditModal(false);
  }, [checkInMode]);

  const handleSubmit = async () => {
    if (checkInMode === 'package' && selectedPackage === 'other' && !customPackageName.trim()) {
      setError('Please enter a package name.'); return;
    }
    setSaving(true); setError('');

    const checkInTimeISO = checkInTime.toISOString();
    const first = kidDescs[0] ?? { tops: [], bottoms: [], colors: [] };

    let packageType: string | null = null;
    let groupNoteValue: string | null = null;
    let topWear = '';
    let bottomWear = '';
    let colors = '';
    let kidDescsJson: string | null = null;

    if (checkInMode === 'standard') {
      if (specialCategory) {
        packageType = specialCategory;
      }
      topWear = first.tops.join(',');
      bottomWear = first.bottoms.join(',');
      colors = first.colors.join(',');
      kidDescsJson = kidCount > 1 ? JSON.stringify(kidDescs) : null;
    } else { // package mode
      packageType = selectedPackage === 'other' ? customPackageName.trim() : selectedPackage;
      groupNoteValue = groupNote.trim() || null;
      // No per‑kid descriptions for packages
    }

    const payload: any = {
      kid_count: kidCount,
      check_in_time: checkInTimeISO,
      duration_hours: (checkInMode === 'standard' && specialCategory) ? 0 : effectiveHours,
      bonus_minutes: (checkInMode === 'standard' && specialCategory) ? 0 : (bonusMins + fineTune),
      exit_time: exitTime.toISOString(),
      actual_exit_time: null,
      status: 'active',
      package_type: packageType,
      group_note: groupNoteValue,
      top_wear: topWear,
      bottom_wear: bottomWear,
      colors: colors,
      kid_descs: kidDescsJson,
    };

    const { error: err } = await supabase.from('jumper_sessions').insert(payload);
    setSaving(false);
    if (err) { setError('Could not save. Try again.'); return; }
    onDone();
  };

  // ── Styles ──────────────────────────────────────────────────────────────
  const secLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
  };
  const card: React.CSSProperties = {
    background: '#1d1f28', borderRadius: 24, padding: '22px 20px', marginBottom: 16,
  };
  const kidColors = ['#7B61FF', '#00C853', '#f59e0b', '#ef4444', '#3b82f6',
    '#ec4899', '#06b6d4', '#8b5cf6', '#10b981', '#f97316'];

  return (
    <div style={{ minHeight: '100vh', background: '#0c0e16', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        .kid-tab { transition: all 0.15s; }
        .kid-tab:hover { opacity: 0.85; }
        .special-card { transition: all 0.18s; }
        .special-card:active { transform: scale(0.97); }
        @keyframes fadeSlide { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        .fade-slide { animation: fadeSlide 0.22s ease; }
      `}</style>

      {/* Sticky header with mode switcher */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(12,14,22,0.96)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '14px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {/* Left side: back button + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onCancel} style={{ background: '#282a32', border: 'none', borderRadius: 12, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#c9c4d8' }}>
              <ChevronLeft size={22} />
            </button>
            <div>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#e1e1ed', margin: 0 }}>Check‑in</p>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Jump Xtreme</p>
            </div>
          </div>

          {/* Exit time chip only */}
          <div style={{
            background: selectedCat ? selectedCat.bg : '#1d1f28',
            border: `1px solid ${selectedCat ? selectedCat.border : 'transparent'}`,
            borderRadius: 14, padding: '8px 14px', textAlign: 'right', transition: 'all 0.2s',
          }}>
            <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              {selectedCat ? selectedCat.label : 'Expected Exit'}
            </p>
            <p style={{ fontSize: 18, fontWeight: 800, color: selectedCat ? selectedCat.color : '#00C853', margin: 0 }}>
              {selectedCat ? '⬤ All Day' : format(exitTime, 'HH:mm')}
            </p>
          </div>
        </div>


        {/* Mode switcher tabs */}
        <div style={{ display: 'flex', background: '#0c0e16', borderRadius: 14, padding: 4, gap: 4 }}>
          {([
            { id: 'standard', label: 'Standard Check‑in', icon: '👤' },
            { id: 'package', label: 'Group Package', icon: '📦' },
          ] as const).map(m => (
            <button key={m.id} onClick={() => { setCheckInMode(m.id); setError(''); }}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700,
                background: checkInMode === m.id
                  ? (m.id === 'package' ? 'linear-gradient(135deg, #7c3aed, #6366f1)' : 'linear-gradient(135deg, #059669, #00C853)')
                  : 'transparent',
                color: checkInMode === m.id ? '#fff' : '#6b7280',
                transition: 'all 0.18s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 16px 130px', maxWidth: 480, margin: '0 auto' }}>



        {/* ── SECTION 1: COUNT (both modes) ── */}
        <p style={secLabel}>
          {checkInMode === 'package' ? 'Group Size' : 'Quantity'} ·{' '}
          <span style={{ color: '#c9c4d8' }}>
            {checkInMode === 'package' ? 'Total clients in package' : 'Clients in Group'}
          </span>
        </p>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#e1e1ed', margin: '0 0 2px' }}>
                {checkInMode === 'package' ? 'Group Size' : 'Number of Clients'}
              </p>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                {checkInMode === 'package' ? 'Enter total count (max 1000)' : 'Select total count'}
              </p>
            </div>

            {checkInMode === 'package' ? (
              // ----- Package mode: numeric input with +/- buttons and direct typing -----
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setKidCount(prev => Math.max(1, prev - 1))}
                  disabled={kidCount <= 1}
                  style={{
                    width: 48, height: 48, borderRadius: 16, border: 'none',
                    background: kidCount <= 1 ? '#1a1d26' : '#282a32',
                    color: kidCount <= 1 ? '#3a3d4a' : '#c9c4d8',
                    fontSize: 28, fontWeight: 300, cursor: kidCount <= 1 ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >−</button>

                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={kidCount}
                  onChange={(e) => {
                    let val = parseInt(e.target.value, 10);
                    if (isNaN(val)) val = 1;
                    val = Math.min(1000, Math.max(1, val));
                    setKidCount(val);
                    // Also update kid descriptions if needed
                    handleKidCountChange(val);
                  }}
                  style={{
                    width: 100, padding: '12px 8px', borderRadius: 16,
                    background: '#0c0e16', border: '1px solid rgba(99,102,241,0.4)',
                    color: '#e1e1ed', fontSize: 28, fontWeight: 800, textAlign: 'center',
                    outline: 'none', fontFamily: 'Inter, sans-serif',
                  }}
                />

                <button
                  onClick={() => setKidCount(prev => Math.min(1000, prev + 1))}
                  disabled={kidCount >= 1000}
                  style={{
                    width: 48, height: 48, borderRadius: 16, border: 'none',
                    background: kidCount >= 1000 ? '#1a1d26' : 'linear-gradient(135deg, #917eff 0%, #7B61FF 100%)',
                    color: '#fff', fontSize: 28, fontWeight: 300,
                    cursor: kidCount >= 1000 ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: kidCount >= 1000 ? 0.4 : 1,
                  }}
                >+</button>
              </div>
            ) : (
              // ----- Standard mode: keep the existing Stepper -----
              <Stepper
                large
                value={kidCount}
                onDec={() => handleKidCountChange(Math.max(1, kidCount - 1))}
                onInc={() => handleKidCountChange(Math.min(30, kidCount + 1))}
              />
            )}
          </div>
        </div>

        {/* ── STANDARD MODE: Special Categories + Duration + Per‑kid descs ── */}
        {checkInMode === 'standard' && (
          <>
            {/* Special Categories toggle */}
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => { setShowSpecial(p => !p); if (showSpecial) setSpecialCategory(null); }}
                style={{
                  width: '100%', padding: '13px 18px', borderRadius: 16, border: 'none', cursor: 'pointer',
                  background: showSpecial ? 'rgba(245,158,11,0.1)' : '#1d1f28',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'all 0.18s',
                  outline: showSpecial ? '1.5px solid rgba(245,158,11,0.4)' : '1.5px solid transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⭐</span>
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: showSpecial ? '#fbbf24' : '#e1e1ed', margin: 0 }}>Special Categories</p>
                    <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                      {selectedCat ? `${selectedCat.icon} ${selectedCat.label} selected` : 'Unlimited, Standard & Premium passes'}
                    </p>
                  </div>
                </div>
                <div style={{
                  width: 44, height: 24, borderRadius: 12, position: 'relative', flexShrink: 0,
                  background: showSpecial ? '#f59e0b' : '#282a32',
                  transition: 'background 0.2s',
                }}>
                  <div style={{ position: 'absolute', top: 3, left: showSpecial ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                </div>
              </button>

              {showSpecial && (
                <div className="fade-slide" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {SPECIAL_CATEGORIES.map(cat => {
                    const isSelected = specialCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        className="special-card"
                        onClick={() => setSpecialCategory(isSelected ? null : cat.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '16px 18px', borderRadius: 18, border: 'none', cursor: 'pointer',
                          background: isSelected ? cat.bg : '#1a1c25',
                          outline: isSelected ? `2px solid ${cat.color}` : '2px solid rgba(255,255,255,0.05)',
                          outlineOffset: 0, textAlign: 'left', width: '100%',
                        }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: 16, flexShrink: 0,
                          background: isSelected ? cat.gradient : '#282a32',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 24, transition: 'all 0.18s',
                          boxShadow: isSelected ? `0 4px 16px ${cat.color}44` : 'none',
                        }}>{cat.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 15, fontWeight: 800, color: isSelected ? cat.color : '#e1e1ed', margin: '0 0 3px', transition: 'color 0.15s' }}>{cat.label}</p>
                          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{cat.tagline}</p>
                        </div>
                        <div style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, background: isSelected ? `${cat.color}22` : '#282a32', border: `1px solid ${isSelected ? cat.border : 'transparent'}`, fontSize: 10, fontWeight: 700, color: isSelected ? cat.color : '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>All Day</div>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `2px solid ${isSelected ? cat.color : 'rgba(255,255,255,0.15)'}`, background: isSelected ? cat.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                          {isSelected && <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Duration controls – hidden when a special category is active */}
            {!specialCategory && (
              <>
                <p style={{ ...secLabel, marginTop: 8 }}>Duration</p>
                <div style={card}>

                  {/* ── Session Times (PIN‑gated via modal) ── */}
                  <div style={{ marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#e1e1ed', margin: '0 0 2px' }}>⏱️ Edit Session Times</p>
                        <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                          Check‑in: {format(checkInTime, 'HH:mm')} · Exit: {format(exitTime, 'HH:mm')}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowPinModalForTime(true)}
                        style={{ background: '#282a32', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: '#818cf8', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Edit size={14} /> Edit Times
                      </button>
                    </div>
                    {checkInTime.getTime() < (new Date().getTime() - 60000) && (
                      <p style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>
                        ⚠️ Back‑dated · check‑in {Math.round((Date.now() - checkInTime.getTime()) / 60000)}m ago
                      </p>
                    )}
                  </div>

                  {/* Standard hours row + custom hours toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div>
                      <p style={{ fontSize: 18, fontWeight: 800, color: '#e1e1ed', margin: '0 0 2px' }}>Standard Hours</p>
                      <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Base playtime</p>
                    </div>
                    {customHourMode ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number" min="0.5" max="24" step="0.5"
                          value={customHourInput}
                          onChange={e => setCustomHourInput(e.target.value)}
                          placeholder="e.g. 1.5"
                          autoFocus
                          style={{
                            width: 80, padding: '10px 12px', borderRadius: 12,
                            background: '#0c0e16', border: '1px solid rgba(99,102,241,0.4)',
                            color: '#e1e1ed', fontSize: 20, fontWeight: 800,
                            outline: 'none', textAlign: 'center',
                          }}
                        />
                        <span style={{ fontSize: 14, color: '#6b7280' }}>hrs</span>
                        <button onClick={() => { setCustomHourMode(false); setCustomHourInput(''); }}
                          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18, padding: '4px', lineHeight: 1 }}>✕</button>
                      </div>
                    ) : (
                      <Stepper large value={hours} onDec={() => setHours(v => Math.max(1, v - 1))} onInc={() => setHours(v => Math.min(12, v + 1))} />
                    )}
                  </div>

                  <button
                    onClick={() => { setCustomHourMode(p => !p); setCustomHourInput(String(hours)); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: customHourMode ? '#6b7280' : '#6366f1',
                      padding: '0 0 16px', fontWeight: 600, display: 'block',
                    }}>
                    {customHourMode ? '← Use standard stepper' : '✏ Enter custom hours (e.g. 1.5h, 2.5h)'}
                  </button>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginBottom: 16 }} />

                  {/* Bonus chips */}
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Bonus Time</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    {[0, 10, 20, 30, 40].map(m => (
                      <button key={m} onClick={() => setBonusMins(bonusMins === m ? 0 : m)}
                        style={{
                          padding: '9px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
                          fontSize: 14, fontWeight: 700,
                          background: bonusMins === m ? 'linear-gradient(135deg, #917eff 0%, #7B61FF 100%)' : '#282a32',
                          color: bonusMins === m ? '#fff' : '#c9c4d8',
                          transition: 'all 0.12s',
                          transform: bonusMins === m ? 'scale(1.05)' : 'scale(1)',
                        }}>
                        {m === 0 ? 'None' : `+${m}m`}
                      </button>
                    ))}
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginBottom: 16 }} />

                  {/* Fine‑tune */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#e1e1ed', margin: '0 0 2px' }}>Fine‑tune</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Adjust for early arrivals · wristband sync</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        onClick={() => setFineTune(v => Math.max(-10, v - 1))}
                        disabled={fineTune <= -10}
                        style={{
                          width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: fineTune <= -10 ? '#1a1c25' : '#282a32',
                          color: fineTune <= -10 ? '#3a3d4a' : '#ef4444',
                          fontSize: 20, fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}>−</button>
                      <div style={{ minWidth: 52, textAlign: 'center' }}>
                        <span style={{
                          fontSize: 20, fontWeight: 800, fontFamily: 'Inter, sans-serif',
                          color: fineTune === 0 ? '#4b5563' : fineTune > 0 ? '#34d399' : '#f87171',
                        }}>
                          {fineTune === 0 ? '±0' : fineTune > 0 ? `+${fineTune}m` : `${fineTune}m`}
                        </span>
                      </div>
                      <button
                        onClick={() => setFineTune(v => Math.min(10, v + 1))}
                        disabled={fineTune >= 10}
                        style={{
                          width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: fineTune >= 10 ? '#1a1c25' : 'linear-gradient(135deg, #059669, #00C853)',
                          color: fineTune >= 10 ? '#3a3d4a' : '#fff',
                          fontSize: 20, fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}>+</button>
                    </div>
                  </div>
                  {fineTune !== 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button onClick={() => setFineTune(0)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#6b7280', cursor: 'pointer', fontWeight: 600 }}>Reset fine‑tune</button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Per‑kid description panel (always shown in Standard mode) */}
            <>
              <p style={{ ...secLabel, marginTop: 8 }}>
                Identification ·{' '}
                <span style={{ color: '#c9c4d8' }}>
                  {kidCount === 1 ? 'Quick Description' : `Describe Each Client (${kidCount} total)`}
                </span>
              </p>

              {kidCount > 1 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
                  {kidDescs.map((desc, i) => {
                    const isActive = i === activeKid;
                    const accent = kidColors[i % kidColors.length];
                    const hasDesc = desc.colors.length > 0 || desc.tops.length > 0 || desc.bottoms.length > 0;
                    return (
                      <button key={i} className="kid-tab" onClick={() => setActiveKid(i)}
                        style={{
                          flexShrink: 0, padding: '10px 16px', borderRadius: 14, border: 'none',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                          background: isActive ? '#1d1f28' : '#0c0e16',
                          outline: isActive ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
                          outlineOffset: 0, transition: 'all 0.15s',
                        }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{i + 1}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? '#e1e1ed' : '#6b7280' }}>Kid {i + 1}</span>
                        {desc.gender && desc.gender !== 'other' && (
                          <span style={{ fontSize: 12, color: desc.gender === 'male' ? '#60a5fa' : '#f472b6', fontWeight: 700 }}>
                            {desc.gender === 'male' ? '♂' : '♀'}
                          </span>
                        )}
                        {desc.isAdult !== undefined && (
                          <span style={{ fontSize: 11 }}>{desc.isAdult ? '👤' : '🧒'}</span>
                        )}
                        {hasDesc && !isActive && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#00C853', marginLeft: 2 }} />}
                        {desc.colors.length > 0 && (
                          <div style={{ display: 'flex', gap: 3 }}>
                            {desc.colors.slice(0, 3).map(cid => {
                              const c = COLOR_OPTIONS.find(x => x.id === cid);
                              return c ? <div key={cid} style={{ width: 10, height: 10, borderRadius: '50%', background: c.hex, outline: '1px solid rgba(255,255,255,0.15)' }} /> : null;
                            })}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ background: '#1d1f28', borderRadius: 24, padding: '4px', marginBottom: 16 }}>
                <KidDescPanel
                  key={activeKid}
                  kidIndex={activeKid}
                  kidCount={kidCount}
                  desc={kidDescs[activeKid] ?? { tops: [], bottoms: [], colors: [] }}
                  onChange={desc => updateKidDesc(activeKid, desc)}
                />
              </div>

              {kidCount > 1 && activeKid < kidCount - 1 && (
                <button onClick={() => setActiveKid(activeKid + 1)}
                  style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: '#1d1f28', color: '#7B61FF', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16, transition: 'all 0.12s' }}>
                  Next → Kid {activeKid + 2}
                </button>
              )}

              {kidCount > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
                  {kidDescs.map((desc, i) => {
                    const hasDesc = desc.colors.length > 0 || desc.tops.length > 0 || desc.bottoms.length > 0;
                    const accent = kidColors[i % kidColors.length];
                    return (
                      <div key={i} style={{ width: i === activeKid ? 24 : 8, height: 8, borderRadius: 4, background: hasDesc ? accent : i === activeKid ? '#7B61FF' : '#282a32', transition: 'all 0.2s' }} />
                    );
                  })}
                </div>
              )}
            </>
          </>
        )}

        {/* ── GROUP PACKAGE MODE: Simple duration + Package selector + note ── */}
        {checkInMode === 'package' && (
          <>
            <p style={{ ...secLabel, marginTop: 8 }}>Duration</p>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
                <div>
                  <p style={{ fontSize: 18, fontWeight: 800, color: '#e1e1ed', margin: '0 0 2px' }}>Standard Hours</p>
                  <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Base playtime</p>
                </div>
                <Stepper large value={hours} onDec={() => setHours(v => Math.max(1, v - 1))} onInc={() => setHours(v => Math.min(8, v + 1))} />
              </div>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Bonus Time</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[0, 10, 20, 30, 40].map(m => (
                  <button key={m} onClick={() => setBonusMins(bonusMins === m ? 0 : m)}
                    style={{
                      padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
                      fontSize: 15, fontWeight: 700,
                      background: bonusMins === m ? 'linear-gradient(135deg, #917eff 0%, #7B61FF 100%)' : '#282a32',
                      color: bonusMins === m ? '#fff' : '#c9c4d8',
                      transition: 'all 0.12s',
                      transform: bonusMins === m ? 'scale(1.05)' : 'scale(1)',
                    }}>
                    {m === 0 ? 'None' : `+${m}m`}
                  </button>
                ))}
              </div>
            </div>

            <p style={{ ...secLabel, marginTop: 8 }}>Package Type</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {PACKAGE_OPTIONS.map(pkg => (
                <button key={pkg.id} onClick={() => setSelectedPackage(pkg.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                    borderRadius: 16, border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: selectedPackage === pkg.id ? `rgba(${pkg.color === '#f472b6' ? '244,114,182' : pkg.color === '#60a5fa' ? '96,165,250' : pkg.color === '#34d399' ? '52,211,153' : '167,139,250'},0.12)` : '#1d1f28',
                    outline: selectedPackage === pkg.id ? `2px solid ${pkg.color}` : '2px solid transparent',
                    outlineOffset: 0, transition: 'all 0.15s',
                  }}>
                  <span style={{ fontSize: 28, flexShrink: 0 }}>{pkg.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: selectedPackage === pkg.id ? pkg.color : '#e1e1ed', margin: '0 0 2px' }}>{pkg.label}</p>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{pkg.desc}</p>
                  </div>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${selectedPackage === pkg.id ? pkg.color : 'rgba(255,255,255,0.15)'}`, background: selectedPackage === pkg.id ? pkg.color : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selectedPackage === pkg.id && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                </button>
              ))}
            </div>

            {selectedPackage === 'other' && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ ...secLabel, marginBottom: 8 }}>Package Name</p>
                <input
                  type="text"
                  value={customPackageName}
                  onChange={e => setCustomPackageName(e.target.value)}
                  placeholder="Enter custom package name…"
                  style={{ background: '#1d1f28', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 16px', color: '#e1e1ed', fontSize: 15, width: '100%', outline: 'none' }}
                  autoFocus
                />
              </div>
            )}

            <p style={{ ...secLabel, marginTop: 8 }}>Group Note <span style={{ textTransform: 'none', fontSize: 10, color: '#4b5563', fontWeight: 400 }}>(optional)</span></p>
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={groupNote}
                onChange={e => setGroupNote(e.target.value)}
                placeholder="any relevant group information"
                rows={3}
                style={{ background: '#1d1f28', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', color: '#e1e1ed', fontSize: 14, width: '100%', outline: 'none', resize: 'none', lineHeight: 1.6 }}
              />
            </div>
          </>
        )}

        {/* Summary preview (common for both modes) */}
        <div style={{
          borderRadius: 20, padding: '16px 18px', marginBottom: 16,
          background: selectedCat ? selectedCat.bg : '#1d1f28',
          border: `1px solid ${selectedCat ? selectedCat.border : 'transparent'}`,
          display: 'flex', gap: 16, alignItems: 'center', transition: 'all 0.2s',
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
              {selectedCat ? selectedCat.label : 'Estimated End'}
            </p>
            {selectedCat ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 32 }}>{selectedCat.icon}</span>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: selectedCat.color, margin: 0, lineHeight: 1 }}>All Day</p>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '3px 0 0' }}>Until close · {exitLabel}</p>
                </div>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 28, fontWeight: 800, color: '#00C853', margin: 0, lineHeight: 1 }}>{exitLabel}</p>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                  {checkInMode === 'standard' && !specialCategory && (
                    <>
                      {customHourMode ? `${customHourInput || 0}h custom` : `${hours}h`}
                      {bonusMins > 0 && ` +${bonusMins}m`}
                      {fineTune !== 0 && <span style={{ color: fineTune > 0 ? '#34d399' : '#f87171' }}> {fineTune > 0 ? '+' : ''}{fineTune}m</span>}
                    </>
                  )}
                  {checkInMode === 'package' && `${hours}h${bonusMins > 0 ? ` +${bonusMins}m` : ''}`}
                  {' '}· {kidCount} client{kidCount !== 1 ? 's' : ''}
                  {checkInMode === 'package' && selectedPackage && (
                    <span style={{ marginLeft: 6, color: '#a78bfa' }}>
                      · {PACKAGE_OPTIONS.find(p => p.id === selectedPackage)?.icon}{' '}
                      {selectedPackage === 'other' ? (customPackageName || 'Custom') : PACKAGE_OPTIONS.find(p => p.id === selectedPackage)?.label}
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Check‑in</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: checkInTime.getTime() < (Date.now() - 60000) ? '#f59e0b' : '#e1e1ed', margin: 0 }}>
              {checkInTime.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </p>
            {checkInTime.getTime() < (Date.now() - 60000) && (
              <p style={{ fontSize: 10, color: '#f59e0b', margin: '2px 0 0' }}>back‑dated</p>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.12)', borderRadius: 12, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#ef4444" />
            <span style={{ fontSize: 14, color: '#ef4444' }}>{error}</span>
          </div>
        )}
      </div>

      {/* PIN modal for editing check‑in / exit times */}
      {showPinModalForTime && (
        <PinAuthModal
          title="Authorise Time Edit"
          subtitle="Supervisors and owners can change check‑in and exit times."
          actionLabel="Verify"
          onSuccess={(userName, role) => {
            if (role === 'supervisor' || role === 'owner') {
              setTempCheckInTime(checkInTime);
              setTempExitTime(exitTime);
              setTempHours(hours);
              setTempBonusMins(bonusMins);
              setTempFineTune(fineTune);
              setShowTimeEditModal(true);
              setShowPinModalForTime(false);
            } else {
              alert('Only supervisors or owners can edit times.');
              setShowPinModalForTime(false);
            }
          }}
          onCancel={() => setShowPinModalForTime(false)}
        />
      )}

      {showTimeEditModal && (
        <TimeEditModal
          checkInTime={checkInTime}
          exitTime={exitTime}
          hours={hours}
          bonusMins={bonusMins}
          fineTune={fineTune}
          onSave={(newCheckIn, newExit, newHours, newBonus, newFine) => {
            setCheckInTime(newCheckIn);
            setHours(newHours);
            setBonusMins(newBonus);
            setFineTune(newFine);
            setShowTimeEditModal(false);
          }}
          onClose={() => setShowTimeEditModal(false)}
        />
      )}

      {/* Fixed CTA */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '16px 16px 24px', background: 'linear-gradient(to top, #0c0e16 60%, transparent)', zIndex: 50 }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <button onClick={handleSubmit} disabled={saving}
            style={{
              width: '100%', padding: '20px', border: 'none', borderRadius: 20, cursor: saving ? 'not-allowed' : 'pointer',
              background: saving ? '#282a32'
                : checkInMode === 'package'
                  ? 'linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)'
                  : (selectedCat ? selectedCat.gradient : 'linear-gradient(135deg, #3ce36a 0%, #00C853 100%)'),
              color: saving ? '#6b7280' : '#fff',
              fontSize: 17, fontWeight: 800, letterSpacing: '0.04em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.15s',
              boxShadow: saving ? 'none' : (selectedCat ? `0 6px 24px ${selectedCat.color}44` : '0 6px 24px rgba(0,200,83,0.3)'),
            }}
            onMouseDown={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)'; }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          >
            {saving ? 'Saving…' : checkInMode === 'package' ? (
              <><Package size={20} /> CONFIRM PACKAGE · {kidCount} Client{kidCount !== 1 ? 's' : ''}</>
            ) : selectedCat ? (
              <>{selectedCat.icon} {selectedCat.label.toUpperCase()} · {kidCount} Client{kidCount !== 1 ? 's' : ''}</>
            ) : (
              <><CheckCircle size={22} /> CONFIRM CHECK‑IN · {kidCount} Client{kidCount !== 1 ? 's' : ''}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
// ─── Session card ─────────────────────────────────────────────────────────────
function SessionCard({ session, onExit, onEdit, onAddTime, onDelete }: {
  session: JumperSession;
  onExit: (id: number) => void;
  onEdit?: (id: number) => void;
  onAddTime?: (session: JumperSession) => void;
  onDelete?: (session: JumperSession) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = session.status === 'active';
  const { urgent, overdue } = isActive ? timeUntilExit(session.exit_time) : { urgent: false, overdue: false };

  // Parse per-kid descriptions if available
  const kidDescs: KidDesc[] = useMemo(() => {
    if (session.kid_descs) {
      try { return JSON.parse(session.kid_descs) as KidDesc[]; } catch { }
    }
    return [{
      tops: session.top_wear ? session.top_wear.split(',').filter(Boolean) : [],
      bottoms: session.bottom_wear ? session.bottom_wear.split(',').filter(Boolean) : [],
      colors: session.colors ? session.colors.split(',').filter(Boolean) : [],
    }];
  }, [session]);

  // Package styling dictionary covering all possible DB package types
  const packageStyle = useMemo(() => {
    if (!session.package_type) return null;
    const styles: Record<string, { bg: string; border: string; bannerBg: string; text: string; icon: string; label: string }> = {
      birthday: { bg: 'rgba(244,114,182,0.05)', border: 'rgba(244,114,182,0.25)', bannerBg: 'linear-gradient(90deg, rgba(244,114,182,0.15) 0%, rgba(244,114,182,0.05) 100%)', text: '#f472b6', icon: '🎂', label: 'Birthday Package' },
      school: { bg: 'rgba(96,165,250,0.05)', border: 'rgba(96,165,250,0.25)', bannerBg: 'linear-gradient(90deg, rgba(96,165,250,0.15) 0%, rgba(96,165,250,0.05) 100%)', text: '#60a5fa', icon: '🎓', label: 'School Group' },
      team_building: { bg: 'rgba(52,211,153,0.05)', border: 'rgba(52,211,153,0.25)', bannerBg: 'linear-gradient(90deg, rgba(52,211,153,0.15) 0%, rgba(52,211,153,0.05) 100%)', text: '#34d399', icon: '🤝', label: 'Team Building' },
      unlimited: { bg: 'rgba(245,158,11,0.05)', border: 'rgba(245,158,11,0.25)', bannerBg: 'linear-gradient(90deg, rgba(245,158,11,0.15) 0%, rgba(245,158,11,0.05) 100%)', text: '#f59e0b', icon: '♾️', label: 'Unlimited Time' },
      standard_pass: { bg: 'rgba(52,211,153,0.05)', border: 'rgba(52,211,153,0.25)', bannerBg: 'linear-gradient(90deg, rgba(52,211,153,0.15) 0%, rgba(52,211,153,0.05) 100%)', text: '#34d399', icon: '🎫', label: 'Standard Pass' },
      premium_pass: { bg: 'rgba(167,139,250,0.05)', border: 'rgba(167,139,250,0.25)', bannerBg: 'linear-gradient(90deg, rgba(167,139,250,0.15) 0%, rgba(167,139,250,0.05) 100%)', text: '#a78bfa', icon: '👑', label: 'Premium Pass' },
      all_day: { bg: 'rgba(251,191,36,0.05)', border: 'rgba(251,191,36,0.25)', bannerBg: 'linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.05) 100%)', text: '#fbbf24', icon: '☀️', label: 'All Day Pass' },
    };
    return styles[session.package_type] || { bg: 'rgba(167,139,250,0.05)', border: 'rgba(167,139,250,0.25)', bannerBg: 'linear-gradient(90deg, rgba(167,139,250,0.15) 0%, rgba(167,139,250,0.05) 100%)', text: '#a78bfa', icon: '📦', label: session.package_type };
  }, [session.package_type]);

  const defaultAccentColor = !isActive ? '#6b7280' : overdue ? '#ef4444' : urgent ? '#f59e0b' : '#00C853';
  const defaultBorderColor = !isActive ? 'rgba(255,255,255,0.05)' : overdue ? 'rgba(239,68,68,0.35)' : urgent ? 'rgba(245,158,11,0.3)' : 'rgba(0,200,83,0.2)';

  const kidAccents = ['#7B61FF', '#00C853', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#06b6d4', '#8b5cf6', '#10b981', '#f97316'];
  const hasAnyDesc = kidDescs.some(d => d.colors.length > 0 || d.tops.length > 0 || d.bottoms.length > 0);

  return (
    <div style={{
      background: packageStyle?.bg || '#1d1f28',
      borderRadius: 18,
      border: `1px solid ${packageStyle?.border || defaultBorderColor}`,
      overflow: 'hidden', transition: 'border-color 0.3s',
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* Package type banner */}
      {packageStyle && (
        <div style={{
          padding: '7px 16px',
          background: packageStyle.bannerBg,
          borderBottom: `1px solid ${packageStyle.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{packageStyle.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: packageStyle.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {packageStyle.label}
            </span>
            {session.group_note && (
              <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {session.group_note}
              </span>
            )}
          </div>
          <div>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: `${packageStyle.text}20`, color: packageStyle.text,
              border: `1px solid ${packageStyle.text}40`,
            }}>
              {(session.package_type === 'all_day' || session.package_type === 'unlimited') && isActive ? '⬤ All Day' : isActive ? 'Active' : 'Exited'}
            </span>
          </div>
        </div>
      )}

      {/* Main row */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: 'rgba(123,97,255,0.2)', borderRadius: 10, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 15 }}>🧒</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#c9bfff' }}>×{session.kid_count}</span>
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e1e1ed' }}>{fmtTime(session.check_in_time)}</span>
              <span style={{ fontSize: 13, color: '#6b7280', margin: '0 6px' }}>→</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: defaultAccentColor }}>{fmtTime(session.exit_time)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Show status pill if there is NO package banner handling it above */}
            {!packageStyle && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: `${defaultAccentColor}1a`, color: defaultAccentColor,
                textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
              }}>
                {!isActive ? 'Exited' : overdue ? '⚠ Overdue' : urgent ? 'Leaving soon' : 'Jumping'}
              </span>
            )}

            {/* Add time button (Active for BOTH Active and Exited) */}
            {onAddTime && (
              <button
                onClick={() => onAddTime(session)}
                title={isActive ? "Extend session time" : "Reactivate and extend time"}
                style={{
                  background: isActive ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.12)',
                  border: `1px solid ${isActive ? 'rgba(99,102,241,0.25)' : 'rgba(16,185,129,0.25)'}`,
                  borderRadius: 8, width: 28, height: 28, cursor: 'pointer',
                  color: isActive ? '#818cf8' : '#34d399',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'rgba(99,102,241,0.25)' : 'rgba(16,185,129,0.25)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.12)'; }}
              >
                <TimerReset size={13} />
              </button>
            )}

            {/* Edit description button */}
            {onEdit && (
              <button
                onClick={() => onEdit(session.id)}
                title="Edit description"
                style={{
                  background: '#282a32', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer',
                  color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e1e1ed'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6b7280'; }}
              >
                <Edit size={14} />
              </button>
            )}

            {/* Expand toggle when multi-kid */}
            {session.kid_count > 1 && hasAnyDesc && (
              <button onClick={() => setExpanded(p => !p)}
                style={{ background: '#282a32', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}

            {/* Delete button */}
            {onDelete && (
              <button
                onClick={() => onDelete(session)}
                title="Delete session"
                style={{
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 8, width: 28, height: 28, cursor: 'pointer',
                  color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.18)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Timer + duration */}
        {isActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <LiveTimer exitTime={session.exit_time} status={session.status} />
            <span style={{ fontSize: 12, color: '#4a4d5e' }}>·</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {session.duration_hours}h{session.bonus_minutes > 0 ? ` +${session.bonus_minutes}m` : ''}
            </span>
          </div>
        )}

        {/* Row 3: Compact description summary */}
        {hasAnyDesc && (
          session.kid_count === 1 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {kidDescs[0].gender && kidDescs[0].gender !== 'other' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: kidDescs[0].gender === 'male' ? 'rgba(59,130,246,0.18)' : 'rgba(236,72,153,0.18)',
                  color: kidDescs[0].gender === 'male' ? '#60a5fa' : '#f472b6',
                  border: `1px solid ${kidDescs[0].gender === 'male' ? 'rgba(59,130,246,0.3)' : 'rgba(236,72,153,0.3)'}`,
                  letterSpacing: '0.04em', whiteSpace: 'nowrap',
                }}>
                  {kidDescs[0].gender === 'male' ? '♂ Male' : '♀ Female'}
                </span>
              )}
              {kidDescs[0].isAdult !== undefined && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: kidDescs[0].isAdult ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.13)',
                  color: kidDescs[0].isAdult ? '#fbbf24' : '#34d399',
                  border: `1px solid ${kidDescs[0].isAdult ? 'rgba(245,158,11,0.28)' : 'rgba(16,185,129,0.25)'}`,
                  letterSpacing: '0.04em', whiteSpace: 'nowrap',
                }}>
                  {kidDescs[0].isAdult ? '👤 Adult' : '🧒 Kid'}
                </span>
              )}
              {kidDescs[0].colors.map(cid => {
                const c = COLOR_OPTIONS.find(x => x.id === cid);
                return c ? <div key={cid} style={{ width: 16, height: 16, borderRadius: '50%', background: c.hex, outline: '1.5px solid rgba(255,255,255,0.12)', outlineOffset: 1, flexShrink: 0 }} title={c.label} /> : null;
              })}
              {[...kidDescs[0].tops, ...kidDescs[0].bottoms].length > 0 && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {[
                    ...kidDescs[0].tops.map(id => TOP_WEAR_OPTIONS.find(o => o.id === id)?.label),
                    ...kidDescs[0].bottoms.map(id => BOTTOM_WEAR_OPTIONS.find(o => o.id === id)?.label),
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {kidDescs.map((desc, i) => {
                const accent = kidAccents[i % kidAccents.length];
                const hasKidDesc = desc.colors.length > 0 || desc.tops.length > 0 || desc.bottoms.length > 0;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#0c0e16', borderRadius: 10, padding: '5px 8px' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{i + 1}</span>
                    </div>
                    {desc.gender && desc.gender !== 'other' && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: desc.gender === 'male' ? '#60a5fa' : '#f472b6' }}>
                        {desc.gender === 'male' ? '♂' : '♀'}
                      </span>
                    )}
                    {desc.isAdult !== undefined && (
                      <span style={{ fontSize: 10, color: desc.isAdult ? '#fbbf24' : '#34d399' }}>
                        {desc.isAdult ? '👤' : '🧒'}
                      </span>
                    )}
                    {hasKidDesc ? (
                      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                        {desc.colors.slice(0, 2).map(cid => {
                          const c = COLOR_OPTIONS.find(x => x.id === cid);
                          return c ? <div key={cid} style={{ width: 12, height: 12, borderRadius: '50%', background: c.hex, outline: '1px solid rgba(255,255,255,0.15)' }} /> : null;
                        })}
                        {(desc.tops[0] || desc.bottoms[0]) && (
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 2 }}>
                            {TOP_WEAR_OPTIONS.find(o => o.id === desc.tops[0])?.icon || BOTTOM_WEAR_OPTIONS.find(o => o.id === desc.bottoms[0])?.icon}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#4a4d5e' }}>—</span>
                    )}
                  </div>
                );
              })}
              <span style={{ fontSize: 11, color: '#4a4d5e' }}>{expanded ? '▲ hide' : '▼ details'}</span>
            </div>
          )
        )}
      </div>

      {/* Expanded per-kid detail */}
      {session.kid_count > 1 && expanded && hasAnyDesc && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, background: '#161820' }}>
          {kidDescs.map((desc, i) => {
            const accent = kidAccents[i % kidAccents.length];
            const clothing = [
              ...desc.tops.map(id => TOP_WEAR_OPTIONS.find(o => o.id === id)?.label),
              ...desc.bottoms.map(id => BOTTOM_WEAR_OPTIONS.find(o => o.id === id)?.label),
            ].filter(Boolean);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{i + 1}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {desc.gender && desc.gender !== 'other' && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: desc.gender === 'male' ? 'rgba(59,130,246,0.18)' : 'rgba(236,72,153,0.18)',
                        color: desc.gender === 'male' ? '#60a5fa' : '#f472b6',
                        border: `1px solid ${desc.gender === 'male' ? 'rgba(59,130,246,0.3)' : 'rgba(236,72,153,0.3)'}`,
                        letterSpacing: '0.04em',
                      }}>
                        {desc.gender === 'male' ? '♂ Male' : '♀ Female'}
                      </span>
                    )}
                    {desc.isAdult !== undefined && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: desc.isAdult ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.13)',
                        color: desc.isAdult ? '#fbbf24' : '#34d399',
                        border: `1px solid ${desc.isAdult ? 'rgba(245,158,11,0.28)' : 'rgba(16,185,129,0.25)'}`,
                        letterSpacing: '0.04em',
                      }}>
                        {desc.isAdult ? '👤 Adult' : '🧒 Kid'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {desc.colors.length > 0 ? desc.colors.map(cid => {
                      const c = COLOR_OPTIONS.find(x => x.id === cid);
                      return c ? <div key={cid} style={{ width: 18, height: 18, borderRadius: '50%', background: c.hex, outline: '1.5px solid rgba(255,255,255,0.12)', outlineOffset: 1, flexShrink: 0 }} title={c.label} /> : null;
                    }) : <span style={{ fontSize: 12, color: '#4a4d5e' }}>No colors</span>}
                    {clothing.length > 0 && <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>{clothing.join(' · ')}</span>}
                    {clothing.length === 0 && desc.colors.length === 0 && !desc.gender && desc.isAdult === undefined && (
                      <span style={{ fontSize: 12, color: '#4a4d5e', fontStyle: 'italic' }}>No description added</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Exit button */}
      {isActive && (
        <div style={{ padding: '0 16px 14px' }}>
          <button onClick={() => onExit(session.id)}
            style={{
              width: '100%', padding: '11px', background: 'transparent',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12,
              color: '#ef4444', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)'; }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          >
            <LogOut size={15} /> Mark as Exited
          </button>
        </div>
      )}
    </div>
  );
}

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
        const kidDescStr = s.kid_descs ? s.kid_descs.toLowerCase() : '';
        const topWear = s.top_wear.toLowerCase();
        const bottomWear = s.bottom_wear.toLowerCase();
        const colors = s.colors.toLowerCase();
        return kidDescStr.includes(q) || topWear.includes(q) || bottomWear.includes(q) || colors.includes(q);
      }
      return true;
    });
  }, [allSessions, rangeStart, rangeEnd, statusFilter, search]);

  // Chart data
  const chartData = useMemo(() => {
    if (period === 'today' || period === 'custom') {
      // Hourly breakdown for single day
      return Array.from({ length: 14 }, (_, i) => {
        const hour = i + 7; // 7am – 8pm
        const count = filtered.filter(s => parseISO(s.check_in_time).getHours() === hour).length;
        return { label: `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'pm' : 'am'}`, groups: count };
      });
    }
    const days = period === 'week' ? 7 : 30;
    return Array.from({ length: days }, (_, i) => {
      const day = subDays(rangeEnd, days - 1 - i);
      const ds = startOfDay(day), de = endOfDay(day);
      const count = allSessions.filter(s => {
        const t = parseISO(s.check_in_time);
        return t >= ds && t <= de;
      }).length;
      return { label: format(day, days === 7 ? 'EEE' : 'dd'), groups: count };
    });
  }, [filtered, allSessions, period, rangeStart, rangeEnd]);

  const totalGroups = filtered.length;
  const totalKids = filtered.reduce((sum, s) => sum + s.kid_count, 0);
  const avgKids = totalGroups > 0 ? (totalKids / totalGroups).toFixed(1) : 0;

  const exportCSV = () => {
    const headers = ['Check-in Time', 'Exit Time', 'Kids', 'Duration', 'Status', 'Description'];
    const rows = filtered.map(s => {
      const descStr = s.kid_descs ? s.kid_descs : `${s.top_wear || ''} ${s.bottom_wear || ''} ${s.colors || ''}`.trim();
      return [
        fmtTime(s.check_in_time),
        fmtTime(s.exit_time),
        s.kid_count,
        `${s.duration_hours}h${s.bonus_minutes > 0 ? ` +${s.bonus_minutes}m` : ''}`,
        s.status,
        descStr,
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jumpzone-records-${period === 'custom' ? customDate : period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inpStyle: React.CSSProperties = {
    background: '#1c1f29', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, padding: '10px 14px', color: '#f0f2f8', fontSize: 14,
    outline: 'none', width: '100%',
  };
  const getReadableDescription = (session: JumperSession): string => {
    // If we have per‑kid descriptions (JSON)
    if (session.kid_descs) {
      try {
        const descs: KidDesc[] = JSON.parse(session.kid_descs);
        if (descs.length === 1) {
          const d = descs[0];
          const colors = d.colors.map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean);
          const tops = d.tops.map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean);
          const bottoms = d.bottoms.map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean);
          const clothing = [...tops, ...bottoms];
          return [...colors, ...clothing].join(', ') || 'No description';
        } else {
          return descs.map((d, i) => {
            const gender = d.gender === 'male' ? '♂' : d.gender === 'female' ? '♀' : '';
            const age = d.isAdult ? 'Adult' : 'Kid';
            const colors = d.colors.map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean);
            const tops = d.tops.map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean);
            const bottoms = d.bottoms.map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean);
            const clothing = [...tops, ...bottoms];
            const parts = [gender, age, ...colors, ...clothing].filter(Boolean);
            const desc = parts.length > 0 ? parts.join(', ') : 'No description';
            return `Kid ${i + 1}: ${desc}`;
          }).join('  ·  ');
        }
      } catch {
        return 'Invalid description data';
      }
    }
    // Fallback for single kid (old flat fields)
    const colors = session.colors?.split(',').map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean) ?? [];
    const tops = session.top_wear?.split(',').map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean) ?? [];
    const bottoms = session.bottom_wear?.split(',').map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean) ?? [];
    const clothing = [...tops, ...bottoms];
    return [...colors, ...clothing].join(', ') || 'No description';
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
            style={{ ...inpStyle, width: 'auto', padding: '7px 12px', fontSize: 13, cursor: 'pointer' }} />
        )}
        <button onClick={exportCSV}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1c1f29', color: '#9ca3af', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {[
          { label: 'Total Groups', value: String(totalGroups), color: '#6366f1' },
          { label: 'Total Kids', value: String(totalKids), color: '#10b981' },
          { label: 'Avg Group Size', value: avgKids, color: '#f59e0b' },
        ].map(c => (
          <div key={c.label} style={{ background: '#151820', borderRadius: 12, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{c.label}</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Mini bar chart */}
      {chartData.some(d => d.groups > 0) && (
        <div style={{ background: '#151820', borderRadius: 14, padding: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {period === 'today' || period === 'custom' ? 'Groups by Hour' : 'Groups by Day'}
          </p>
          <div style={{ height: 100 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={period === 'month' ? 8 : 14}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={{ background: '#1c1f29', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f2f8', fontSize: 12 }} />
                <Bar dataKey="groups" fill="#6366f1" radius={[3, 3, 0, 0]} />
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
            placeholder="Search clothing description, colors, etc."
            style={{ ...inpStyle, paddingLeft: 36 }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }}>
            <Filter size={14} />
          </span>
        </div>
        {(['all', 'active', 'exited'] as const).map(sf => (
          <button key={sf} onClick={() => setStatusFilter(sf)}
            style={{
              padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: statusFilter === sf ? (sf === 'active' ? 'rgba(16,185,129,0.15)' : sf === 'exited' ? 'rgba(107,114,128,0.15)' : '#1c1f29') : '#151820',
              color: statusFilter === sf ? (sf === 'active' ? '#10b981' : sf === 'exited' ? '#9ca3af' : '#fff') : '#6b7280',
              border: statusFilter === sf ? `1px solid ${sf === 'active' ? 'rgba(16,185,129,0.3)' : sf === 'exited' ? 'rgba(107,114,128,0.3)' : 'rgba(99,102,241,0.4)'}` : '1px solid transparent',
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 580 }}>
              <thead>
                <tr style={{ background: '#1c1f29' }}>
                  {['Time In', 'Exit By', 'Kids', 'Duration', 'Status', 'Description'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const isActive = s.status === 'active';
                  const descStr = s.kid_descs ? s.kid_descs : `${s.top_wear || ''} ${s.bottom_wear || ''} ${s.colors || ''}`.trim();
                  return (
                    <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                        <div>{fmtTime(s.check_in_time)}</div>
                        <div style={{ fontSize: 11, color: '#4b5563' }}>{format(parseISO(s.check_in_time), 'MMM d')}</div>
                      </td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{fmtTime(s.exit_time)}</td>
                      <td style={{ padding: '11px 14px', fontWeight: 600, color: '#e1e1ed' }}>{s.kid_count}</td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af' }}>{s.duration_hours}h{s.bonus_minutes > 0 ? ` +${s.bonus_minutes}m` : ''}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                          background: !isActive ? 'rgba(107,114,128,0.15)' : 'rgba(0,200,83,0.15)',
                          color: !isActive ? '#6b7280' : '#10b981',
                        }}>{isActive ? 'Active' : 'Exited'}</span>
                      </td>
                      <td style={{ padding: '11px 14px', color: '#9ca3af', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getReadableDescription(s)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#1c1f29', borderTop: '2px solid rgba(255,255,255,0.08)' }}>
                  <td colSpan={2} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Total · {filtered.length} group{filtered.length !== 1 ? 's' : ''}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#10b981', fontWeight: 800 }}>{totalKids}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const getAlertDescription = (session: JumperSession): string => {
  if (session.kid_descs) {
    try {
      const descs: KidDesc[] = JSON.parse(session.kid_descs);
      if (descs.length === 1) {
        const d = descs[0];
        const colors = d.colors.map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean);
        const tops = d.tops.map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean);
        const bottoms = d.bottoms.map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean);
        const clothing = [...tops, ...bottoms];
        const genderLabel = d.gender === 'male' ? 'Male' : d.gender === 'female' ? 'Female' : '';
        const ageLabel = d.isAdult ? 'Adult' : 'Kid';
        const parts = [genderLabel, ageLabel, ...colors, ...clothing].filter(Boolean);
        return parts.join(', ');
      } else {
        return descs.map((d, i) => {
          const gender = d.gender === 'male' ? '♂' : d.gender === 'female' ? '♀' : '';
          const age = d.isAdult ? 'Adult' : 'Kid';
          const colors = d.colors.map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean);
          const tops = d.tops.map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean);
          const bottoms = d.bottoms.map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean);
          const clothing = [...tops, ...bottoms];
          const parts = [gender, age, ...colors, ...clothing].filter(Boolean);
          const desc = parts.length > 0 ? parts.join(', ') : 'No description';
          return `Kid ${i + 1}: ${desc}`;
        }).join('  ·  ');
      }
    } catch { return ''; }
  }
  const colors = session.colors?.split(',').map(c => COLOR_OPTIONS.find(opt => opt.id === c)?.label).filter(Boolean) ?? [];
  const tops = session.top_wear?.split(',').map(t => TOP_WEAR_OPTIONS.find(opt => opt.id === t)?.label).filter(Boolean) ?? [];
  const bottoms = session.bottom_wear?.split(',').map(b => BOTTOM_WEAR_OPTIONS.find(opt => opt.id === b)?.label).filter(Boolean) ?? [];
  const clothing = [...tops, ...bottoms];
  return [...colors, ...clothing].join(', ');
};

function EditKidModal({ session, onClose, onSaved }: {
  session: JumperSession;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kidDescs, setKidDescs] = useState<KidDesc[]>(() => {
    if (session.kid_descs) {
      try { return JSON.parse(session.kid_descs); } catch { }
    }
    return [{
      tops: session.top_wear?.split(',').filter(Boolean) || [],
      bottoms: session.bottom_wear?.split(',').filter(Boolean) || [],
      colors: session.colors?.split(',').filter(Boolean) || [],
      gender: 'other',
      isAdult: false,
    }];
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const first = kidDescs[0] ?? { tops: [], bottoms: [], colors: [] };
    const { error } = await supabase.from('jumper_sessions').update({
      kid_descs: kidDescs.length > 1 ? JSON.stringify(kidDescs) : null,
      top_wear: first.tops.join(','),
      bottom_wear: first.bottoms.join(','),
      colors: first.colors.join(','),
    }).eq('id', session.id);
    setSaving(false);
    if (!error) {
      onSaved();
      onClose();
    } else {
      alert('Failed to update description');
    }
  };

  const updateKidDesc = (idx: number, desc: KidDesc) => {
    setKidDescs(prev => prev.map((d, i) => i === idx ? desc : d));
  };

  const kidColors = ['#7B61FF', '#00C853', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#06b6d4', '#8b5cf6', '#10b981', '#f97316'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1d1f28', borderRadius: 24, maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#e1e1ed', marginBottom: 16 }}>Edit Descriptions</h2>
        {kidDescs.map((desc, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: kidColors[i % kidColors.length], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{i + 1}</span>
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#e1e1ed' }}>Kid {i + 1}</span>
            </div>
            <KidDescPanel kidIndex={i} kidCount={kidDescs.length} desc={desc} onChange={(d) => updateKidDesc(i, d)} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#282a32', color: '#c9c4d8', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#7B61FF', color: '#fff', cursor: 'pointer' }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Trampoline App ───────────────────────────────────────────────────────
function TrampolineApp({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<'home' | 'checkin' | 'history'>('home');
  const [sessions, setSessions] = useState<JumperSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const [alertShown, setAlertShown] = useState<Set<number>>(new Set());
  const tickRef = useRef(0);
  const [mainTab, setMainTab] = useState<'live' | 'records'>('live');
  const [currentTime, setCurrentTime] = useState('');
  const playAlertSound = useRef<((type: 'urgent' | 'overdue') => void) | null>(null);
  const [editingSession, setEditingSession] = useState<JumperSession | null>(null);
  const [addTimeSession, setAddTimeSession] = useState<JumperSession | null>(null);
  const [deletingSession, setDeletingSession] = useState<JumperSession | null>(null);
  const [liveSearch, setLiveSearch] = useState('');
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [clothingFilter, setClothingFilter] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string[]>([]);   // 'male' | 'female'
  const [ageFilter, setAgeFilter] = useState<string[]>([]);         // 'adult' | 'kid'
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    // Create a simple beep using Web Audio
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    playAlertSound.current = (type: 'urgent' | 'overdue') => {
      const freq = type === 'urgent' ? 880 : 440;
      const duration = 0.3;
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.frequency.value = freq;
      gain.gain.value = 0.2;
      oscillator.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
      oscillator.stop(audioCtx.currentTime + duration);
      // Resume if suspended (browser autoplay policy)
      if (audioCtx.state === 'suspended') audioCtx.resume();
    };
  }, []);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const scrollToSession = (id: number) => {
    const el = cardRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Temporary highlight
      el.style.transition = 'box-shadow 0.2s';
      el.style.boxShadow = '0 0 0 2px #7B61FF';
      setTimeout(() => {
        el.style.boxShadow = '';
      }, 1500);
    }
  };

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
        if (playAlertSound.current) playAlertSound.current(overdue ? 'overdue' : 'urgent');
      }

    });
  }, [sessions, alertShown]);

  const handleExit = async (id: number) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      const exitTime = new Date(session.exit_time);
      const now = new Date();
      const minutesEarly = Math.floor((exitTime.getTime() - now.getTime()) / 60000);
      if (minutesEarly > 30) {
        const confirmEarly = window.confirm(`This group still has ${minutesEarly} minutes left. Are you sure you want to exit them early?`);
        if (!confirmEarly) return;
      }
    }
    await supabase.from('jumper_sessions').update({
      status: 'exited',
      actual_exit_time: new Date().toISOString(),
    }).eq('id', id);
    fetchSessions();
  };

  const handleDeleteSession = async (id: number) => {
    await supabase.from('jumper_sessions').delete().eq('id', id);
    fetchSessions();
    setDeletingSession(null);
  };
  const active = sessions.filter(s => s.status === 'active');
  const overdueSessions = active.filter(s => timeUntilExit(s.exit_time).overdue);
  const urgentSessions = active.filter(s => { const { urgent, overdue } = timeUntilExit(s.exit_time); return urgent && !overdue; });
  const todayKids = sessions
    .filter(s => new Date(s.check_in_time).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.kid_count, 0);



  const displayed = useMemo(() => {
    const base = tab === 'active' ? active : sessions.filter(s =>
      new Date(s.check_in_time).toDateString() === new Date().toDateString()
    );
    let filtered = base;

    // Color and clothing filters
    if (colorFilter.length > 0 || clothingFilter.length > 0) {
      filtered = filtered.filter(s => {
        let matches = false;
        if (s.kid_descs) {
          try {
            const descs = JSON.parse(s.kid_descs);
            for (const d of descs) {
              if (colorFilter.length && colorFilter.some(c => d.colors.includes(c))) matches = true;
              if (clothingFilter.length && clothingFilter.some(c => d.tops.includes(c) || d.bottoms.includes(c))) matches = true;
              if (matches) break;
            }
          } catch { return false; }
        } else {
          const flatColors = s.colors?.split(',') || [];
          const flatTops = s.top_wear?.split(',') || [];
          const flatBottoms = s.bottom_wear?.split(',') || [];
          if (colorFilter.length && colorFilter.some(c => flatColors.includes(c))) matches = true;
          if (clothingFilter.length && clothingFilter.some(c => flatTops.includes(c) || flatBottoms.includes(c))) matches = true;
        }
        return matches;
      });
    }

    // Gender filter
    if (genderFilter.length > 0) {
      filtered = filtered.filter(s => {
        if (s.kid_descs) {
          try {
            const descs: KidDesc[] = JSON.parse(s.kid_descs);
            return descs.some(d => d.gender && genderFilter.includes(d.gender));
          } catch { return false; }
        }
        return false;
      });
    }

    // Age filter (adult / kid)
    if (ageFilter.length > 0) {
      filtered = filtered.filter(s => {
        if (s.kid_descs) {
          try {
            const descs: KidDesc[] = JSON.parse(s.kid_descs);
            return descs.some(d => {
              if (ageFilter.includes('adult') && d.isAdult === true) return true;
              if (ageFilter.includes('kid') && d.isAdult !== true) return true;
              return false;
            });
          } catch { return false; }
        }
        return false;
      });
    }

    return filtered;
  }, [tab, active, sessions, liveSearch, colorFilter, clothingFilter, genderFilter, ageFilter]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Tab switcher */}
            <div style={{ display: 'flex', background: '#1c1f29', borderRadius: 10, padding: 3, gap: 2 }}>
              {(['live', 'records'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    background: mainTab === t ? '#6366f1' : 'transparent',
                    color: mainTab === t ? '#fff' : '#6b7280',
                    transition: 'all 0.15s', whiteSpace: 'nowrap'
                  }}>
                  {t === 'live' ? 'Live' : 'Records'}
                </button>
              ))}
            </div>


          </div>
        </div>
      </div>

      {mainTab === 'records' ? (
        <TrampolineRecords allSessions={sessions} />
      ) : (
        <div style={{ padding: '0 10px' }}>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10, marginTop: 10 }}>
            {[
              { label: 'Groups Jumping', value: String(active.length), color: '#00C853' },
              { label: 'Jumping now', value: String(active.reduce((s, x) => s + x.kid_count, 0)), color: '#7B61FF' },
              { label: 'Clients today', value: String(todayKids), color: '#f59e0b' },
            ].map(c => (
              <div key={c.label} style={{ background: '#151820', borderRadius: 14, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                <p style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{c.label}</p>
                <p style={{ fontSize: c.label.includes('revenue') ? 17 : 23, fontWeight: 800, color: c.color, fontFamily: ' sans-serif', lineHeight: 1 }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Alert badges (only show on live tab) */}
          {mainTab === 'live' && (
            <>
              {overdueSessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => scrollToSession(s.id)}
                  style={{ cursor: 'pointer', marginBottom: 10, padding: '12px 16px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown 0.3s ease' }}
                >
                  <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', margin: '0 0 2px' }}>
                      Group of {s.kid_count} is overdue!
                    </p>
                    <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 2px' }}>
                      Was supposed to exit by {fmtTime(s.exit_time)} · checked in {fmtTime(s.check_in_time)}
                    </p>
                    {getAlertDescription(s) && (
                      <p style={{ fontSize: 12, color: '#fca5a5', margin: 0, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getAlertDescription(s)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {urgentSessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => scrollToSession(s.id)}
                  style={{ cursor: 'pointer', marginBottom: 10, padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <Clock size={18} color="#f59e0b" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b', margin: '0 0 2px' }}>
                      Group of {s.kid_count} leaving soon
                    </p>
                    <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 2px' }}>
                      Exit by {fmtTime(s.exit_time)} · checked in {fmtTime(s.check_in_time)}
                    </p>
                    {getAlertDescription(s) && (
                      <p style={{ fontSize: 12, color: '#fcd34d', margin: 0, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getAlertDescription(s)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}


          {/* Tab filter (Active/All Today) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            {/* Tabs on the left */}
            <div style={{ display: 'flex', gap: 10 }}>
              {(['active', 'all'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === t ? '#6366f1' : '#151820', color: tab === t ? '#fff' : '#6b7280', transition: 'all 0.15s' }}>
                  {t === 'active' ? `Active (${active.length})` : 'All Today'}
                </button>
              ))}
            </div>

            {/* Live clock on the right */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#1c1f29', padding: '6px 14px', borderRadius: 20,
              border: '1px solid rgba(36, 179, 45)',
            }}>
              <Clock size={18} color="#24B32D" />
              <span style={{
                fontSize: 16, fontWeight: 700, color: '#24B32D',
                fontFamily: 'monospace', letterSpacing: '1px',
              }}>
                {currentTime}
              </span>
            </div>
          </div>

          {/* Filter chips */}
          <div style={{ marginTop: 8, marginBottom: 12, paddingLeft: 10, paddingRight: 10 }}>
            {/* Active filters (removable tags) */}
            {(colorFilter.length > 0 || clothingFilter.length > 0 || genderFilter.length > 0 || ageFilter.length > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {genderFilter.map(g => (
                    <button key={g} onClick={() => setGenderFilter(prev => prev.filter(x => x !== g))}
                      style={{ padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, background: g === 'male' ? 'rgba(59,130,246,0.22)' : 'rgba(236,72,153,0.22)', color: g === 'male' ? '#60a5fa' : '#f472b6', border: `1px solid ${g === 'male' ? 'rgba(59,130,246,0.4)' : 'rgba(236,72,153,0.4)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {g === 'male' ? '♂ Male' : '♀ Female'} ✕
                    </button>
                  ))}
                  {ageFilter.map(a => (
                    <button key={a} onClick={() => setAgeFilter(prev => prev.filter(x => x !== a))}
                      style={{ padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, background: a === 'adult' ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.15)', color: a === 'adult' ? '#fbbf24' : '#34d399', border: `1px solid ${a === 'adult' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.28)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {a === 'adult' ? '👤 Adult' : '🧒 Kid'} ✕
                    </button>
                  ))}
                  {colorFilter.map(cid => {
                    const c = COLOR_OPTIONS.find(opt => opt.id === cid);
                    return c ? (
                      <button key={cid} onClick={() => setColorFilter(prev => prev.filter(x => x !== cid))}
                        style={{ padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, background: c.hex, color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.label} ✕
                      </button>
                    ) : null;
                  })}
                  {clothingFilter.map(cid => {
                    const opt = [...TOP_WEAR_OPTIONS, ...BOTTOM_WEAR_OPTIONS].find(o => o.id === cid);
                    return opt ? (
                      <button key={cid} onClick={() => setClothingFilter(prev => prev.filter(x => x !== cid))}
                        style={{ padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600, background: '#7B61FF', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {opt.icon} {opt.label} ✕
                      </button>
                    ) : null;
                  })}
                </div>
                <button onClick={() => { setColorFilter([]); setClothingFilter([]); setGenderFilter([]); setAgeFilter([]); }}
                  style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0, marginLeft: 8 }}>
                  Clear all
                </button>
              </div>
            )}



            {/* Filter chip container with background */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              padding: '12px 16px',
              marginTop: 8,
            }}>
              {/* Quick filter chips — Gender & Age row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, minWidth: 60 }}>Filter By: </span>
                {([{ id: 'male', label: '♂ Male', bg: 'rgba(59,130,246,0.18)', activeBg: 'rgba(59,130,246,0.3)', color: '#60a5fa', border: 'rgba(59,130,246,0.4)' }, { id: 'female', label: '♀ Female', bg: 'rgba(236,72,153,0.18)', activeBg: 'rgba(236,72,153,0.3)', color: '#f472b6', border: 'rgba(236,72,153,0.4)' }]).map(g => (
                  <button key={g.id} onClick={() => setGenderFilter(prev => prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                    style={{
                      padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
                      background: genderFilter.includes(g.id) ? g.activeBg : '#1c1f29',
                      color: genderFilter.includes(g.id) ? g.color : '#6b7280',
                      border: genderFilter.includes(g.id) ? `1px solid ${g.border}` : '1px solid transparent',
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}>
                    {g.label}
                  </button>
                ))}
                <span style={{ color: '#2e3140', fontSize: 13, marginLeft: 4 }}>|</span>

                {([{ id: 'kid', label: '🧒 Kid', activeColor: '#34d399', activeBg: 'rgba(16,185,129,0.18)', activeBorder: 'rgba(16,185,129,0.3)' }, { id: 'adult', label: '👤 Adult', activeColor: '#fbbf24', activeBg: 'rgba(245,158,11,0.18)', activeBorder: 'rgba(245,158,11,0.3)' }]).map(a => (
                  <button key={a.id} onClick={() => setAgeFilter(prev => prev.includes(a.id) ? prev.filter(x => x !== a.id) : [...prev, a.id])}
                    style={{
                      padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
                      background: ageFilter.includes(a.id) ? a.activeBg : '#1c1f29',
                      color: ageFilter.includes(a.id) ? a.activeColor : '#6b7280',
                      border: ageFilter.includes(a.id) ? `1px solid ${a.activeBorder}` : '1px solid transparent',
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}>
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Quick filter chips — Colors & Clothing row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>

                {COLOR_OPTIONS.slice(0, 8).map(c => (
                  <button key={c.id} onClick={() => setColorFilter(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                    style={{
                      padding: '5px 11px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                      background: colorFilter.includes(c.id) ? c.hex : '#1c1f29',
                      color: colorFilter.includes(c.id) ? '#fff' : '#9ca3af',
                      border: 'none', cursor: 'pointer', transition: 'all 0.12s',
                    }}>
                    {c.label}
                  </button>
                ))}
                <span style={{ color: '#2e3140', fontSize: 13 }}>|</span>
                {[...TOP_WEAR_OPTIONS, ...BOTTOM_WEAR_OPTIONS].slice(0, 6).map(opt => (
                  <button key={opt.id} onClick={() => setClothingFilter(prev => prev.includes(opt.id) ? prev.filter(x => x !== opt.id) : [...prev, opt.id])}
                    style={{
                      padding: '5px 11px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                      background: clothingFilter.includes(opt.id) ? '#7B61FF' : '#1c1f29',
                      color: clothingFilter.includes(opt.id) ? '#fff' : '#9ca3af',
                      border: 'none', cursor: 'pointer', transition: 'all 0.12s',
                    }}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {liveSearch && (
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 8, paddingLeft: 10 }}>
              {displayed.length} result{displayed.length !== 1 ? 's' : ''} for <span style={{ color: '#a5b4fc' }}>"{liveSearch}"</span>
            </p>
          )}
          {(colorFilter.length > 0 || clothingFilter.length > 0 || genderFilter.length > 0 || ageFilter.length > 0) && !liveSearch && (
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 8, paddingLeft: 10 }}>
              {displayed.length} session{displayed.length !== 1 ? 's' : ''} match selected filters
            </p>
          )}

          {/* Sessions list */}
          {loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '40px 0' }}>Loading…</p>
          ) : displayed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
              <Users size={40} color="#374151" style={{ margin: '0 auto 16px' }} />
              <p style={{ fontSize: 16, fontWeight: 600, color: '#4b5563', marginBottom: 8 }}>
                {tab === 'active' ? 'No one jumping right now' : 'No sessions today yet'}
              </p>
              <p style={{ fontSize: 14 }}>Tap the button below to check in a child</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 10, paddingRight: 10, paddingBottom: 100 }}>
              {displayed.map(s => (
                <div
                  key={s.id}
                  ref={el => {
                    if (el) cardRefs.current.set(s.id, el);
                    else cardRefs.current.delete(s.id);
                  }}
                >
                  <SessionCard
                    session={s}
                    onExit={handleExit}
                    onEdit={(id) => setEditingSession(sessions.find(x => x.id === id) || null)}
                    onAddTime={(s) => setAddTimeSession(s)}
                    onDelete={(s) => setDeletingSession(s)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Big check-in button — fixed at bottom */}
      {mainTab === 'live' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '16px 20px', background: 'linear-gradient(to top, #0d0f14 70%, transparent)', zIndex: 40 }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <button onClick={() => setView('checkin')}
              style={{ width: '100%', padding: '18px', background: '#6366f1', border: 'none', borderRadius: 16, color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 20px rgba(99,102,241,0.4)', transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#4f46e5'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#6366f1'; }}
            >
              <UserPlus size={20} /> Check In a Client
            </button>
          </div>
        </div>
      )}

      {editingSession && (
        <EditKidModal
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={() => { fetchSessions(); setEditingSession(null); }}
        />
      )}

      {addTimeSession && (
        <AddTimeModal
          session={addTimeSession}
          onClose={() => setAddTimeSession(null)}
          onSaved={() => { fetchSessions(); setAddTimeSession(null); }}
        />
      )}

      {/* PIN-gated delete confirmation */}
      {deletingSession && (
        <PinAuthModal
          title="Authorise Session Deletion"
          subtitle={`This will permanently delete the session for ${deletingSession.kid_count} client${deletingSession.kid_count !== 1 ? 's' : ''} checked in at ${fmtTime(deletingSession.check_in_time)}. This cannot be undone.`}
          actionLabel="Delete"
          onSuccess={() => handleDeleteSession(deletingSession.id)}
          onCancel={() => setDeletingSession(null)}
        />
      )}
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
        .dark-scrollbar::-webkit-scrollbar {
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
              <span>For Help Contact  <span style={{ color: 'var(--accent)', fontWeight: 500 }}></span></span>
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
                charlesmacharia4564@gmail.com
              </a>
              <span style={{ opacity: 0.4 }}>|</span>

              <span > +254 769 640 918</span>
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