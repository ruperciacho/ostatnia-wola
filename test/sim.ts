// Symulacje pełnych partii: node test/sim.ts
import { advance, applyAction, createGame, nightDone, playerView, publicView } from '../supabase/functions/game/engine.ts';
import type { Ctx, Game } from '../supabase/functions/game/engine.ts';
import { CHARACTERS } from '../supabase/functions/game/data.ts';

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(cond: unknown, msg: string) {
  if (!cond) { failures++; if (failures < 30) console.error('FAIL:', msg); }
}

const SECRET_WORDS = ['zabojca', 'Zabójca', 'token', 'secret', 'Twoi wspólnicy', 'frame'];

function assertNoLeak(g: Game, now: number, label: string) {
  if (g.phase === 'end') return;
  // Zestaw ról tej gry (setup) jest jawny z założenia; reszta widoku nie może zdradzać ról
  const { setup, ...rest } = publicView(g, now) as Record<string, unknown>;
  check(g.players.length < 3 || !!setup, `${label}: setup visible`);
  const pub = JSON.stringify(rest);
  for (const w of SECRET_WORDS) check(!pub.includes(w), `${label}: public view leaks "${w}" in phase ${g.phase}`);
  for (const p of g.players) check(!pub.includes(p.token), `${label}: public view leaks token`);
  for (const c of CHARACTERS) check(!pub.includes(c.secret), `${label}: public view leaks character secret`);
  // widok gracza nie może zawierać cudzych tokenów ani cudzych sekretów postaci
  for (const p of g.players) {
    const pv = JSON.stringify(playerView(g, p.id, now));
    for (const o of g.players) if (o.id !== p.id) check(!pv.includes(o.token), `${label}: player view leaks foreign token`);
    for (const c of CHARACTERS) if (c.id !== p.characterId) check(!pv.includes(c.secret), `${label}: player view leaks foreign secret`);
  }
}

function simulate(seed: number, n: number, death: boolean, mode: '30' | '60', style: 'random' | 'idle' | 'smart') {
  const rng = mulberry32(seed);
  let now = 1_000_000;
  let idc = 0;
  const ctx = (): Ctx => ({ now, rng, makeId: () => 'id' + (idc++).toString(36) + Math.floor(rng() * 1e6).toString(36) });
  const g = createGame('TEST', now);
  for (let i = 0; i < n; i++) {
    const r = applyAction(g, null, { type: 'join', name: 'Gracz' + i }, ctx());
    check(r.joined, 'join returns token');
  }
  const host = g.players[0].id;
  const settingsRes = applyAction(g, host, { type: 'settings', mode, death }, ctx());
  if (n >= 5 || !death) check(settingsRes.error === undefined, 'settings: ' + settingsRes.error);
  else check(!!settingsRes.error && g.settings.death === false, 'death blocked below 5 players');
  const startRes = applyAction(g, host, { type: 'start' }, ctx());
  check(!startRes.error, 'start ok: ' + startRes.error);
  check(g.phase === 'rules', 'rules screen after start');
  check(g.players.filter((p) => p.role === 'zabojca').length >= 1, 'has killer');

  let steps = 0;
  const label = `seed=${seed} n=${n} death=${death} mode=${mode} style=${style}`;
  while (g.phase !== 'end' && steps < 500) {
    steps++;
    assertNoLeak(g, now, label);
    check(g.phase === 'night' ? g.endsAt !== null : g.endsAt === null, `${label}: timer only at night (phase=${g.phase})`);
    if (style === 'idle') {
      // Nikt nic nie robi: noc mija sama, resztę pomija host
      if (g.endsAt !== null) { now = g.endsAt + 1; advance(g, ctx()); }
      else applyAction(g, host, { type: 'skip' }, ctx());
      continue;
    }
    const phase = g.phase;
    for (const p of g.players) {
      if (rng() < 0.08) continue; // ktoś się zagapił
      const view = playerView(g, p.id, now).me!;
      if (phase === 'rules' || phase === 'prolog' || phase === 'morning' || phase === 'discussion' || phase === 'verdict') {
        applyAction(g, p.id, { type: 'ready' }, ctx());
      } else if (phase === 'night' && view.night) {
        const nv = view.night;
        check(!(p.role === 'zabojca' && nv.targetKind === 'kill') || (nv.follows && !nv.needsRoom), `${label}: killer follows target instead of picking a room`);
        // Klient zabójcy mógłby wysłać pokój: serwer go ignoruje
        if (nv.follows) applyAction(g, p.id, { type: 'night', room: 'piwnica' }, ctx());
        if (nv.needsRoom && !nv.choice.room) applyAction(g, p.id, { type: 'night', room: ['biblioteka', 'kuchnia', 'gabinet', 'piwnica', 'oranzeria', 'strych'][Math.floor(rng() * 6)] }, ctx());
        if (g.phase !== 'night') break;
        if (nv.needsWatch) applyAction(g, p.id, { type: 'night', watch: 'kuchnia' }, ctx());
        if (g.phase !== 'night') break;
        if (nv.targetKind && nv.targets.length) {
          const t = nv.targets[Math.floor(rng() * nv.targets.length)];
          const r = applyAction(g, p.id, { type: 'night', target: t.id }, ctx());
          check(!r.error || r.error.includes('dwie noce'), `${label}: night target error ${r.error}`);
        }
        if (g.phase !== 'night') break;
        const frame = nv.frameTargets.length ? nv.frameTargets[Math.floor(rng() * nv.frameTargets.length)].id : undefined;
        applyAction(g, p.id, { type: 'task', success: rng() < 0.75, frame }, ctx());
      } else if ((phase === 'accusation' || phase === 'dawn') && view.canVote) {
        let target = 'none';
        if (style === 'smart') {
          // „mądra” rodzina głosuje na zabójcę z prawdopodobieństwem 0.6
          const killer = g.players.find((k) => k.role === 'zabojca' && k.status === 'active' && k.id !== p.id);
          if (killer && rng() < 0.6) target = killer.id;
        }
        if (target === 'none' && view.voteTargets.length && (phase === 'dawn' || g.hour === g.hours || rng() < 0.6)) {
          target = view.voteTargets[Math.floor(rng() * view.voteTargets.length)].id;
        }
        const r = applyAction(g, p.id, { type: 'vote', target }, ctx());
        check(!r.error, `${label}: vote error ${r.error} phase=${phase}`);
      }
      if (g.phase !== phase) break;
    }
    if (g.phase === phase) {
      // Ktoś się zagapił: noc kończy czas, w innych fazach host pomija
      if (g.endsAt !== null) { now = g.endsAt + 1; advance(g, ctx()); }
      else applyAction(g, host, { type: 'skip' }, ctx());
    }
  }
  check(g.phase === 'end', `${label}: game ended (phase=${g.phase}, steps=${steps})`);
  check(!!g.result, `${label}: result set`);
  const pub = publicView(g, now);
  check(pub.result && pub.result.ranking.length === n, `${label}: ranking complete`);
  check(g.hour <= g.hours, `${label}: hour within limit`);
  // Każdy zamach ma sprawcę, który jest zabójcą
  for (const l of g.log) if (l.executorId) check(g.players.find((p) => p.id === l.executorId)?.role === 'zabojca', `${label}: executor is killer`);
  // Zabójca jest w tym samym pokoju co ofiara, a zabójca z celem nie wybiera pokoju sam
  for (const l of g.log) if (l.executorId && l.victim) check(l.rooms[l.executorId] === l.victim.room, `${label}: executor in victim's room (hour ${l.hour})`);
  for (const l of g.log) if (l.executorId && l.victim?.playerId) check(l.rooms[l.victim.playerId] === l.victim.room, `${label}: victim room matches log`);
  // Punkty zgadzają się z listą powodów
  for (const p of g.players) check(p.points === p.pointsLog.reduce((a, e) => a + e.pts, 0), `${label}: points match log`);
  // Niewinny siedzi w areszcie najwyżej do głosowania następnego dnia: na koniec w areszcie tylko zabójcy albo zamknięci w ostatnim dniu
  for (const p of g.players) {
    if (p.status !== 'arrested' || p.role === 'zabojca') continue;
    check(g.voteLog.some((r) => r.kind === 'accusation' && r.arrestedId === p.id && r.hour >= g.hour - 1), `${label}: innocent released after an hour`);
  }
  check(g.jail === null, `${label}: jail settled at the end`);
  // Martwi gracze tylko przy włączonej śmierci
  if (!death || n < 5) check(!g.players.some((p) => p.status === 'dead'), `${label}: nobody dies with death off`);
  return g;
}

const stats: Record<string, { rodzina: number; zabojcy: number; hours: number; games: number }> = {};
let seed = 1;
for (const style of ['random', 'idle', 'smart'] as const) {
  for (let n = 3; n <= 12; n++) {
    for (const death of [false, true]) {
      for (const mode of ['30', '60'] as const) {
        for (let k = 0; k < 40; k++) {
          const g = simulate(seed++, n, death, mode, style);
          const key = `${style} n=${String(n).padStart(2)} death=${death ? 'wł ' : 'wył'} ${mode}min`;
          const s = (stats[key] ||= { rodzina: 0, zabojcy: 0, hours: 0, games: 0 });
          s.games++;
          s.hours += g.hour;
          if (g.result?.winner === 'rodzina') s.rodzina++; else s.zabojcy++;
        }
      }
    }
  }
}

// Kilka linii statystyk dla stylu „smart” (rodzina celnie głosuje częściej niż losowo)
for (const [k, s] of Object.entries(stats)) {
  if (!k.startsWith('smart') || !k.includes('30min')) continue;
  console.log(`${k}: rodzina ${Math.round((100 * s.rodzina) / s.games)}%, śr. dni ${(s.hours / s.games).toFixed(1)}`);
}
console.log(failures ? `\n${failures} FAILURES` : '\nOK: wszystkie symulacje przeszły');
process.exit(failures ? 1 : 0);
