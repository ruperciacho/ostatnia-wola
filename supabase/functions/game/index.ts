// Edge Function `game`: jedyne wejście do gry. Klienci nie mają dostępu do tabeli games.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { applyAction, createGame, playerView, publicView } from './engine.ts';
import type { Action, Game } from './engine.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function makeId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function cleanCode(raw: unknown): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

async function load(code: string) {
  const { data, error } = await db.from('games').select('state, version').eq('code', code).maybeSingle();
  if (error) throw error;
  return data as { state: Game; version: number } | null;
}

async function broadcast(code: string, version: number) {
  try {
    const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `ow:${code}`, event: 'update', payload: { v: version }, private: false }] }),
    });
    if (!res.ok) console.error('broadcast status', res.status, await res.text());
  } catch (e) {
    console.error('broadcast failed', e);
  }
}

function viewFor(g: Game, token: string | undefined, now: number) {
  const p = token ? g.players.find((x) => x.token === token) : undefined;
  return p ? playerView(g, p.id, now) : publicView(g, now);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Tylko POST' }, 405);

  let body: { op?: string; code?: string; token?: string; action?: Action };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Niepoprawne zapytanie' }, 400);
  }

  try {
    if (body.op === 'create') {
      // Sprzątanie: gry nieruszane od 2 dni
      if (Math.random() < 0.2) {
        await db.from('games').delete().lt('updated_at', new Date(Date.now() - 2 * 86400_000).toISOString());
      }
      for (let i = 0; i < 10; i++) {
        const code = randomCode();
        const now = Date.now();
        const g = createGame(code, now);
        const { error } = await db.from('games').insert({ code, state: g, version: 1 });
        if (!error) return json({ code, version: 1, view: publicView(g, now) });
        if (error.code !== '23505') throw error;
      }
      return json({ error: 'Nie udało się utworzyć pokoju' }, 500);
    }

    const code = cleanCode(body.code);
    if (code.length !== 4) return json({ error: 'Kod pokoju ma 4 litery' }, 400);

    if (body.op === 'view') {
      const row = await load(code);
      if (!row) return json({ error: 'Nie ma takiego pokoju', notFound: true }, 404);
      const p = body.token ? row.state.players.find((x) => x.token === body.token) : undefined;
      return json({ version: row.version, view: viewFor(row.state, body.token, Date.now()), badToken: !!body.token && !p });
    }

    if (body.op === 'act') {
      const action = body.action;
      if (!action || typeof action.type !== 'string') return json({ error: 'Brak akcji' }, 400);
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = await load(code);
        if (!row) return json({ error: 'Nie ma takiego pokoju', notFound: true }, 404);
        const g = row.state;
        const before = JSON.stringify(g);
        const now = Date.now();
        const me = body.token ? g.players.find((x) => x.token === body.token) : undefined;
        if (!me && action.type !== 'join' && action.type !== 'tick') {
          return json({ error: 'Nie jesteś w tej grze', badToken: true }, 403);
        }
        const res = applyAction(g, me ? me.id : null, action, { now, rng: Math.random, makeId });
        const token = res.joined ? res.joined.token : body.token;
        if (res.error) return json({ error: res.error, version: row.version, view: viewFor(JSON.parse(before), token, now) });
        if (JSON.stringify(g) === before) return json({ version: row.version, view: viewFor(g, token, now), joined: res.joined });
        const { data: upd, error } = await db
          .from('games')
          .update({ state: g, version: row.version + 1, updated_at: new Date(now).toISOString() })
          .eq('code', code)
          .eq('version', row.version)
          .select('version');
        if (error) throw error;
        if (upd && upd.length) {
          await broadcast(code, row.version + 1);
          return json({ version: row.version + 1, view: viewFor(g, token, now), joined: res.joined });
        }
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 60));
      }
      return json({ error: 'Serwer jest zajęty, spróbuj jeszcze raz' }, 409);
    }

    return json({ error: 'Nieznana operacja' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Błąd serwera' }, 500);
  }
});
