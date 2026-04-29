// =============================================================================
// app/api/send-push/route.ts
// =============================================================================
// API route that receives a push payload from the client and forwards it
// to all stored subscriptions using the web-push library.
//
// Install:  npm install web-push
//           npm install --save-dev @types/web-push
//
// .env.local (server-side — never expose to client):
//   VAPID_EMAIL=mailto:you@yourcompany.com
//   VAPID_PUBLIC_KEY=BEl62i...   (same as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY=...
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...  (service role key — can bypass RLS)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

// ── Initialise web-push with VAPID keys ───────────────────────────────────────
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@xtremezone.co.ke';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ── Supabase admin client (bypasses RLS to read all subscriptions) ────────────
const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── POST /api/send-push ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const payload = await req.json();

        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
            console.warn('[send-push] VAPID keys not configured — skipping push');
            return NextResponse.json({ ok: false, error: 'VAPID keys not configured' }, { status: 200 });
        }

        // 1. Fetch all push subscriptions from Supabase
        const { data: subscriptions, error } = await adminSupabase
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth');

        if (error) {
            console.error('[send-push] DB error:', error.message);
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        if (!subscriptions || subscriptions.length === 0) {
            return NextResponse.json({ ok: true, sent: 0, message: 'No subscriptions' });
        }

        // 2. Send to all subscriptions in parallel
        const notificationPayload = JSON.stringify({
            title: payload.title,
            body: payload.body,
            type: payload.type,       // 'urgent' | 'overdue'
            tag: payload.tag,
            sessionId: payload.sessionId,
            url: payload.url || '/',
        });

        const results = await Promise.allSettled(
            subscriptions.map(sub =>
                webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth },
                    },
                    notificationPayload
                ).catch(async err => {
                    // 410 Gone = subscription expired — clean it up
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        console.log('[send-push] Removing expired subscription:', sub.endpoint.slice(0, 40));
                        await adminSupabase
                            .from('push_subscriptions')
                            .delete()
                            .eq('endpoint', sub.endpoint);
                    }
                    throw err;
                })
            )
        );

        const sent = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`[send-push] Sent: ${sent}, Failed: ${failed}`);
        return NextResponse.json({ ok: true, sent, failed });

    } catch (err: any) {
        console.error('[send-push] Unexpected error:', err.message);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}

// ── GET /api/send-push — health check ────────────────────────────────────────
export async function GET() {
    return NextResponse.json({
        ok: true,
        vapid: !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY,
        message: 'Push notification endpoint ready',
    });
}