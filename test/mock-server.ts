// Lokalna atrapa Edge Function (ten sam silnik, stan w pamięci): node test/mock-server.ts
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { applyAction, createGame, playerView, publicView } from '../supabase/functions/game/engine.ts';
import type { Game } from '../supabase/functions/game/engine.ts';

const games = new Map<string, { state: Game; version: number }>();
const makeId = () => randomUUID().replace(/-/g, '').slice(0, 12);
const viewFor = (g: Game, token: string | undefined, now: number) => {
  const p = token ? g.players.find((x) => x.token === token) : undefined;
  return p ? playerView(g, p.id, now) : publicView(g, now);
};

http.createServer((req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(200, headers); res.end('ok'); return; }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (body: unknown, status = 200) => { res.writeHead(status, headers); res.end(JSON.stringify(body)); };
    const body = JSON.parse(raw || '{}');
    const now = Date.now();
    if (body.op === 'log') { console.log('CLIENT', JSON.stringify(body.log)); return send({ ok: true }); }
    if (body.op === 'create') {
      const code = 'TEST';
      const g = createGame(code, now);
      games.set(code, { state: g, version: 1 });
      return send({ code, version: 1, view: publicView(g, now) });
    }
    const row = games.get(String(body.code || '').toUpperCase());
    if (!row) return send({ error: 'Nie ma takiego pokoju', notFound: true }, 404);
    if (body.op === 'view') return send({ version: row.version, view: viewFor(row.state, body.token, now) });
    if (body.op === 'act') {
      const g = row.state;
      const me = body.token ? g.players.find((x) => x.token === body.token) : undefined;
      if (!me && body.action.type !== 'join' && body.action.type !== 'tick') return send({ error: 'Nie jesteś w tej grze', badToken: true }, 403);
      const before = JSON.stringify(g);
      const r = applyAction(g, me ? me.id : null, body.action, { now, rng: Math.random, makeId });
      const token = r.joined ? r.joined.token : body.token;
      if (r.error) { row.state = JSON.parse(before); return send({ error: r.error, version: row.version, view: viewFor(row.state, token, now) }); }
      if (JSON.stringify(g) !== before) row.version += 1;
      return send({ version: row.version, view: viewFor(g, token, now), joined: r.joined });
    }
    send({ error: 'Nieznana operacja' }, 400);
  });
}).listen(8790, () => console.log('mock on 8790'));
