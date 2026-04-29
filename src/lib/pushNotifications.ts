// =============================================================================
// lib/pushNotifications.ts
// =============================================================================
// Handles service worker registration, push subscription, and sending
// notifications to the Supabase Edge Function.
//
// SETUP STEPS:
//   1. Generate VAPID keys:  npx web-push generate-vapid-keys
//   2. Add to .env.local:
//        NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEl62i...
//        VAPID_PRIVATE_KEY=...  (server-side only, never expose)
//        VAPID_EMAIL=mailto:you@example.com
//   3. Create push_subscriptions table in Supabase (SQL in README)
//   4. Deploy the Edge Function (supabase/functions/send-push/index.ts)
// =============================================================================

import { supabase } from './supabase';



// ── VAPID public key from env ─────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

// ── Check if push is supported in this browser ───────────────────────────────
export function isPushSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission;
}

// ── Register the service worker ───────────────────────────────────────────────
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!isPushSupported()) {
        console.warn('[Push] Service workers not supported in this browser.');
        return null;
    }
    try {
        const reg = await navigator.serviceWorker.register('/service-worker.js', {
            scope: '/',
            updateViaCache: 'none',
        });
        console.log('[Push] Service worker registered:', reg.scope);
        return reg;
    } catch (err) {
        console.error('[Push] Service worker registration failed:', err);
        return null;
    }
}

// ── Request permission and subscribe to push ──────────────────────────────────
export async function subscribeToPush(
    deviceLabel?: string
): Promise<PushSubscription | null> {
    if (!isPushSupported()) return null;
    if (!VAPID_PUBLIC_KEY) {
        console.error('[Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.');
        return null;
    }

    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.warn('[Push] Notification permission denied.');
        return null;
    }

    // 2. Get service worker registration
    const reg = await navigator.serviceWorker.ready;

    // 3. Check for existing subscription first
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
        await saveSubscriptionToDb(existing, deviceLabel);
        return existing;
    }

    // 4. Create a new subscription
    try {
        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
        });
        await saveSubscriptionToDb(subscription, deviceLabel);
        console.log('[Push] Subscribed successfully.');
        return subscription;
    } catch (err) {
        console.error('[Push] Subscribe failed:', err);
        return null;
    }
}

// ── Unsubscribe from push ─────────────────────────────────────────────────────
export async function unsubscribeFromPush(): Promise<boolean> {
    if (!isPushSupported()) return false;
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return true;

        // Remove from DB first
        await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);

        const result = await sub.unsubscribe();
        console.log('[Push] Unsubscribed:', result);
        return result;
    } catch (err) {
        console.error('[Push] Unsubscribe failed:', err);
        return false;
    }
}

// ── Save subscription to Supabase ─────────────────────────────────────────────
async function saveSubscriptionToDb(
    sub: PushSubscription,
    deviceLabel?: string
): Promise<void> {
    const p256dh = arrayBufferToBase64(sub.getKey('p256dh'));
    const auth = arrayBufferToBase64(sub.getKey('auth'));

    const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
            {
                endpoint: sub.endpoint,
                p256dh,
                auth,
                device_label: deviceLabel || getBrowserLabel(),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'endpoint' }
        );

    if (error) {
        console.error('[Push] Failed to save subscription:', error.message);
    }
}

// ── Send a push notification via Edge Function or API route ──────────────────
export async function sendPushNotification(payload: {
    title: string;
    body: string;
    type: 'urgent' | 'overdue';
    tag: string;
    sessionId: number;
    url?: string;
}): Promise<void> {
    try {
        // Call your Next.js API route which calls the Supabase Edge Function
        const res = await fetch('/api/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, url: payload.url || '/' }),
        });
        if (!res.ok) {
            const text = await res.text();
            console.error('[Push] Send failed:', res.status, text);
        }
    } catch (err) {
        console.error('[Push] Send request failed:', err);
        // Graceful degradation — in-app alert still fires even if push fails
    }
}

// ── Also show a local notification when the tab IS open ──────────────────────
// (Useful for ensuring sound plays even when tab is visible)
export function showLocalNotification(
    title: string,
    options: NotificationOptions & { url?: string }
): void {
    if (!isPushSupported()) return;
    if (Notification.permission !== 'granted') return;

    const n = new Notification(title, {
        ...options,
        silent: false,
    });

    n.onclick = () => {
        window.focus();
        n.close();
    };
}

// ── Key conversion utilities ──────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        output[i] = rawData.charCodeAt(i);
    }
    return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function getBrowserLabel(): string {
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    return 'Browser';
}