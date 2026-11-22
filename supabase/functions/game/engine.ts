// Silnik gry „Ostatnia wola”: czyste funkcje na stanie gry (bez sieci i bazy).
import {
  ATTRS, CATEGORIES, CHARACTERS, INTRO, ROLES, ROOMS, SERVANTS,
  roleDistribution,
} from './data.ts';
import type { Category, Character, RoleId } from './data.ts';

export type Phase = 'lobby' | 'prolog' | 'night' | 'morning' | 'discussion' | 'accusation' | 'verdict' | 'dawn' | 'end';
export type Status = 'active' | 'dead' | 'arrested';

export interface Note { hour: number; text: string; kind: 'clue' | 'info' }

export interface Player {
  id: string;
  token: string;
  name: string;
  joinedAt: number;
  characterId: string | null;
  role: RoleId | null;
  status: Status;
  ready: boolean;
  points: number;
  stats: { tasks: number; correctVotes: number; votesReceived: number };
  heirlooms: string[];
  notes: Note[];
  lastProtected: string | null;
  jesterWin?: boolean;
}

export interface NightChoice { room?: string; target?: string; watch?: string; task?: 'ok' | 'fail'; frame?: string }
export interface Npc { id: string; name: string; alive: boolean; room?: string }
export interface PublicClue { hour: number; text: string; fake: boolean; source: 'scena' | 'duchy' }
export interface Settings { mode: '30' | '60'; death: boolean; calm: boolean }

export interface HourLog {
  hour: number;
  rooms: Record<string, string>;
  executorId?: string;
  victim?: { name: string; room: string; playerId?: string };
  failed?: 'lekarz' | 'tlok';
  theft?: { room: string; thiefId: string };
  arrestedId?: string;
}

export interface Result {
  winner: 'rodzina' | 'zabojcy';
  reason: string;
  dawnTargetId?: string;
  neutralWinners: string[];
  titles: { title: string; playerId: string; why: string }[];
}

export interface Game {
  code: string;
  createdAt: number;
  phase: Phase;
  hour: number;
  hours: number;
  endsAt: number | null;
  settings: Settings;
  touched: { mode: boolean; death: boolean };
  hostId: string | null;
  players: Player[];
  npcs: Npc[];
  night: Record<string, NightChoice>;
  publicClues: PublicClue[];
  morning: { lines: string[]; clues: string[] } | null;
  votes: Record<string, string>;
  verdict: { text: string } | null;
  pendingWinner: 'rodzina' | null;
  ghostProgress: number;
  heirlooms: Record<string, boolean>;
  log: HourLog[];
  result: Result | null;
}

export interface Ctx { now: number; rng: () => number; makeId: () => string }
export interface ActResult { error?: string; joined?: { id: string; token: string } }

export type Action =
  | { type: 'join'; name: string }
  | { type: 'settings'; mode?: '30' | '60'; death?: boolean; calm?: boolean }
  | { type: 'start' }
  | { type: 'ready' }
  | { type: 'night'; room?: string; target?: string; watch?: string }
  | { type: 'task'; success: boolean; frame?: string }
  | { type: 'vote'; target: string }
  | { type: 'tick' }
  | { type: 'skip' }
  | { type: 'restart' };

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 3;

const BASE: Record<'30' | '60', Record<string, number>> = {
  '30': { prolog: 90, night: 100, morning: 25, discussion: 150, accusation: 45, verdict: 10, dawn: 90 },
  '60': { prolog: 90, night: 130, morning: 30, discussion: 240, accusation: 50, verdict: 10, dawn: 100 },
};
const CALM_PHASES = ['prolog', 'night', 'discussion', 'accusation', 'dawn'];

// ---------- helpers ----------
function pick<T>(arr: T[], rng: () => number): T { return arr[Math.floor(rng() * arr.length)]; }
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n === 1) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
export function charById(id: string | null): Character | undefined { return CHARACTERS.find((c) => c.id === id); }
function roomById(id: string | undefined) { return ROOMS.find((r) => r.id === id); }
function attrOf(c: Character, cat: Category) { return ATTRS[cat].find((v) => v.id === c[cat])!; }
function charName(p: Player): string { const c = charById(p.characterId); return c ? c.name : p.name; }
function who(p: Player): string { return `${charName(p)} (${p.name})`; }

export function hourLabel(g: Game, hour: number): string {
  const h = (((4 - g.hours + hour - 1) % 24) + 24) % 24;
  return (h < 10 ? '0' : '') + h + ':00';
}

function duration(g: Game, phase: string): number {
  const base = BASE[g.settings.mode][phase] ?? 30;
  const mult = g.settings.calm && CALM_PHASES.includes(phase) ? 1.5 : 1;
  return Math.round(base * mult * 1000);
}

const active = (g: Game) => g.players.filter((p) => p.status === 'active');
const freeKillers = (g: Game) => active(g).filter((p) => p.role === 'zabojca');
const player = (g: Game, id: string | undefined) => g.players.find((p) => p.id === id);
const hasVoteTarget = (g: Game, p: Player) => active(g).some((a) => a.id !== p.id);
const deathAllowed = (g: Game) => g.players.length >= 5;

function note(p: Player, hour: number, text: string, kind: Note['kind'] = 'clue') { p.notes.push({ hour, text, kind }); }

// ---------- creation ----------
export function createGame(code: string, now: number): Game {
  return {
    code, createdAt: now, phase: 'lobby', hour: 0, hours: 4, endsAt: null,
    settings: { mode: '30', death: false, calm: false },
    touched: { mode: false, death: false },
    hostId: null, players: [], npcs: [], night: {}, publicClues: [], morning: null,
    votes: {}, verdict: null, pendingWinner: null, ghostProgress: 0, heirlooms: {}, log: [], result: null,
  };
}

function applyDefaults(g: Game) {
  const n = g.players.length;
  if (!g.touched.mode) g.settings.mode = n >= 8 ? '60' : '30';
  if (!g.touched.death) g.settings.death = n >= 8;
  if (!deathAllowed(g)) g.settings.death = false;
}

function cleanName(raw: string): string {
  return String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

// ---------- phases ----------
function setPhase(g: Game, phase: Phase, ctx: Ctx) {
  g.phase = phase;
  g.endsAt = phase === 'lobby' || phase === 'end' ? null : ctx.now + duration(g, phase);
  for (const p of g.players) p.ready = false;
  if (phase === 'night') {
    g.night = {};
    for (const n of g.npcs) if (n.alive) n.room = pick(ROOMS, ctx.rng).id;
  }
  if (phase === 'accusation' || phase === 'dawn') g.votes = {};
}

function needsTarget(g: Game, p: Player): boolean {
  if (p.status !== 'active') return false;
  if (p.role === 'zabojca') return killTargets(g).length > 0;
  if (p.role === 'lekarz') return g.settings.death;
  return false;
}

export function nightDone(g: Game, p: Player): boolean {
  const c = g.night[p.id] || {};
  if (p.status !== 'active') return !!c.task;
  if (!c.room || !c.task) return false;
  if (needsTarget(g, p) && !c.target) return false;
  if (p.role === 'kamerdyner' && !c.watch) return false;
  return true;
}

function phaseComplete(g: Game): boolean {
  switch (g.phase) {
    case 'prolog':
    case 'morning':
      return g.players.every((p) => p.ready);
    case 'night':
      return g.players.every((p) => nightDone(g, p));
    case 'discussion':
      return active(g).every((p) => p.ready);
    case 'accusation':
      return active(g).length <= 1 || active(g).every((p) => !!g.votes[p.id]);
    case 'dawn':
      return g.players.filter((p) => hasVoteTarget(g, p)).every((p) => !!g.votes[p.id]);
    default:
      return false;
  }
}

function killTargets(g: Game): { id: string; label: string }[] {
  if (g.settings.death) {
    return active(g).filter((p) => p.role !== 'zabojca').map((p) => ({ id: p.id, label: who(p) }));
  }
  return g.npcs.filter((n) => n.alive).map((n) => ({ id: n.id, label: `${n.name} (${roomById(n.room)?.name ?? '?'})` }));
}

function nextPhase(g: Game, ctx: Ctx) {
  switch (g.phase) {
    case 'prolog':
      g.hour = 1;
      setPhase(g, 'night', ctx);
      return;
    case 'night':
      resolveNight(g, ctx);
      setPhase(g, 'morning', ctx);
      return;
    case 'morning': {
      if (g.settings.death) {
        const killers = freeKillers(g).length;
        const others = active(g).length - killers;
        if (killers > 0 && killers >= others) {
          finish(g, 'zabojcy', 'Przy stole zostało tylu zabójców, ilu pozostałych gości.', ctx);
          return;
        }
      }
      setPhase(g, 'discussion', ctx);
      return;
    }
    case 'discussion':
      setPhase(g, 'accusation', ctx);
      return;
    case 'accusation':
      resolveAccusation(g);
      setPhase(g, 'verdict', ctx);
      return;
    case 'verdict':
      if (g.pendingWinner === 'rodzina') {
        finish(g, 'rodzina', 'Ostatni zabójca trafił do aresztu przed świtem.', ctx);
        return;
      }
      if (g.hour < g.hours) {
        g.hour += 1;
        setPhase(g, 'night', ctx);
      } else {
        setPhase(g, 'dawn', ctx);
      }
      return;
    case 'dawn':
      resolveDawn(g, ctx);
      return;
  }
}

export function advance(g: Game, ctx: Ctx, force = false): boolean {
  let changed = false;
  for (let i = 0; i < 3; i++) {
    if (g.phase === 'lobby' || g.phase === 'end') break;
    const due = g.endsAt !== null && ctx.now >= g.endsAt;
    if (!(force && i === 0) && !due && !phaseComplete(g)) break;
    nextPhase(g, ctx);
    changed = true;
  }
  return changed;
}

// ---------- setup ----------
function startGame(g: Game, ctx: Ctx) {
  const n = g.players.length;
  if (!deathAllowed(g)) g.settings.death = false;
  g.hours = g.settings.mode === '30' ? 4 : 6;
  const chars = shuffle(CHARACTERS, ctx.rng).slice(0, n);
  const roles = shuffle(roleDistribution(n, g.settings.death), ctx.rng);
  g.players.forEach((p, i) => {
    p.characterId = chars[i].id;
    p.role = roles[i];
    p.status = 'active';
    p.points = 0;
    p.stats = { tasks: 0, correctVotes: 0, votesReceived: 0 };
    p.heirlooms = [];
    p.notes = [];
    p.lastProtected = null;
    p.jesterWin = false;
  });
  const used = new Set(chars.map((c) => c.id));
  g.npcs = [
    ...SERVANTS.map((s) => ({ id: s.id, name: s.name, alive: true })),
    ...CHARACTERS.filter((c) => !used.has(c.id)).map((c) => ({ id: c.id, name: c.name, alive: true })),
  ];
  g.heirlooms = Object.fromEntries(ROOMS.map((r) => [r.id, true]));
  g.publicClues = [];
  g.log = [];
  g.morning = null;
  g.verdict = null;
  g.pendingWinner = null;
  g.ghostProgress = 0;
  g.result = null;
  g.hour = 0;
  const killers = g.players.filter((p) => p.role === 'zabojca');
  for (const k of killers) {
    const others = killers.filter((x) => x.id !== k.id).map(who);
    if (others.length) note(k, 0, `Twoi wspólnicy: ${others.join(', ')}.`, 'info');
  }
  setPhase(g, 'prolog', ctx);
}

// ---------- night resolution ----------
function fragment(subject: Character, label: string, cats: Category[], rng: () => number): string[] {
  return cats.map((cat) => {
    const options = ATTRS[cat].filter((v) => v.id !== subject[cat]);
    return `${label} ${pick(options, rng).not}.`;
  });
}

function resolveNight(g: Game, ctx: Ctx) {
  const { rng } = ctx;
  const hour = g.hour;
  const clock = hourLabel(g, hour);
  const act = active(g);
  const roomOf: Record<string, string> = {};
  for (const p of act) {
    const c = g.night[p.id] || (g.night[p.id] = {});
    if (!c.room) c.room = pick(ROOMS, rng).id;
    roomOf[p.id] = c.room;
  }

  // Zamach
  const killers = act.filter((p) => p.role === 'zabojca');
  const valid = new Set(killTargets(g).map((t) => t.id));
  const subs = killers
    .map((k) => ({ k, t: g.night[k.id]?.target }))
    .filter((s): s is { k: Player; t: string } => !!s.t && valid.has(s.t));
  let executor: Player | null = null;
  let targetId: string | null = null;
  if (subs.length) {
    const chosen = pick(subs, rng);
    targetId = chosen.t;
    executor = pick(subs.filter((s) => s.t === targetId), rng).k;
  } else if (killers.length && valid.size) {
    targetId = pick([...valid], rng);
    executor = pick(killers, rng);
  }

  const lines: string[] = [`Godzina ${clock}.`];
  const logEntry: HourLog = { hour, rooms: { ...roomOf } };
  let attackRoom: string | null = null;
  let attacked = false;

  if (executor && targetId) {
    logEntry.executorId = executor.id;
    if (g.settings.death) {
      const victim = player(g, targetId)!;
      attackRoom = roomOf[victim.id];
      const room = roomById(attackRoom)!;
      const others = act.filter((p) => p.id !== victim.id && p.id !== executor!.id && roomOf[p.id] === attackRoom).length;
      const medic = act.find((p) => p.role === 'lekarz' && g.night[p.id]?.target === victim.id);
      attacked = true;
      if (medic) {
        logEntry.failed = 'lekarz';
        lines.push('Ktoś próbował w nocy zabić, ale lekarz był szybszy.');
        const seen = attrOf(charById(executor.characterId)!, pick(CATEGORIES, rng)).seen;
        note(victim, hour, `Ktoś cię zaatakował, ale lekarz zdążył. Zapamiętałeś: ${seen}.`);
      } else if (others >= 3) {
        logEntry.failed = 'tlok';
        lines.push(`Ktoś próbował zabić ${room.loc}, ale było tam zbyt tłoczno.`);
      } else {
        victim.status = 'dead';
        logEntry.victim = { name: who(victim), room: attackRoom, playerId: victim.id };
        lines.push(`${cap(room.loc)} znaleziono: ${who(victim)}.`);
        lines.push(room.death);
        note(victim, hour, 'Zginąłeś. Dalej grasz jako duch: rób zadania, a duchy odsłonią poszlaki.', 'info');
      }
    } else {
      const npc = g.npcs.find((n) => n.id === targetId)!;
      attackRoom = npc.room || pick(ROOMS, rng).id;
      const room = roomById(attackRoom)!;
      npc.alive = false;
      attacked = true;
      logEntry.victim = { name: npc.name, room: attackRoom };
      lines.push(`${cap(room.loc)} znaleziono: ${npc.name}.`);
      lines.push(room.death);
    }
  }

  // Kto był gdzie (sprawca liczy się w pokoju ofiary)
  const presence: Record<string, string[]> = {};
  for (const r of ROOMS) presence[r.id] = [];
  for (const p of act) {
    const r = executor && p.id === executor.id && attackRoom ? attackRoom : roomOf[p.id];
    presence[r].push(p.id);
  }

  const newClues: PublicClue[] = [];
  if (executor && attacked && attackRoom) {
    const exChar = charById(executor.characterId)!;
    if (logEntry.failed !== 'lekarz') {
      const victimPid = logEntry.victim?.playerId;
      for (const pid of presence[attackRoom]) {
        if (pid === executor.id || pid === victimPid) continue;
        const w = player(g, pid)!;
        if (w.role === 'zabojca') continue;
        const seen = attrOf(exChar, pick(CATEGORIES, rng)).seen;
        note(w, hour, `Byłeś ${roomById(attackRoom)!.loc}, gdy doszło do ataku. W ciemności zauważyłeś: ${seen}.`);
      }
    }
    newClues.push({ hour, text: attrOf(exChar, pick(CATEGORIES, rng)).clue, fake: false, source: 'scena' });
  }

  // Fałszywe tropy zabójców
  const texts = new Set(newClues.map((c) => c.text));
  for (const k of killers) {
    const c = g.night[k.id];
    const framed = player(g, c?.frame);
    if (c?.task === 'ok' && framed && framed.role !== 'zabojca') {
      const text = attrOf(charById(framed.characterId)!, pick(CATEGORIES, rng)).clue;
      if (!texts.has(text)) { texts.add(text); newClues.push({ hour, text, fake: true, source: 'scena' }); }
    }
  }
  if (g.players.length <= 4 && attacked && !newClues.some((c) => c.fake)) {
    const innocents = g.players.filter((p) => p.role !== 'zabojca');
    for (let tries = 0; tries < 6 && innocents.length; tries++) {
      const text = attrOf(charById(pick(innocents, rng).characterId)!, pick(CATEGORIES, rng)).clue;
      if (!texts.has(text)) { texts.add(text); newClues.push({ hour, text, fake: true, source: 'scena' }); break; }
    }
  }

  // Złodziej
  for (const t of act.filter((p) => p.role === 'zlodziej')) {
    const r = roomOf[t.id];
    const room = roomById(r)!;
    const others = presence[r].filter((id) => id !== t.id).length;
    if (!g.heirlooms[r]) {
      note(t, hour, `${cap(room.loc)} nie ma już nic do ukradzenia.`, 'info');
    } else if (others > 1) {
      note(t, hour, `${cap(room.loc)} było za dużo ludzi, nic nie ukradłeś.`, 'info');
    } else {
      g.heirlooms[r] = false;
      t.heirlooms.push(r);
      t.points += 2;
      logEntry.theft = { room: r, thiefId: t.id };
      lines.push(`${cap(room.from)} coś zniknęło: ${room.heirloom}.`);
      note(t, hour, `Udało się: ${room.heirloom}. Masz już ${t.heirlooms.length}/3 pamiątek.`, 'info');
    }
  }

  // Kamerdyner
  for (const k of act.filter((p) => p.role === 'kamerdyner')) {
    const c = g.night[k.id];
    const w = c.watch && roomById(c.watch) ? c.watch : pick(ROOMS, rng).id;
    const names = presence[w].filter((id) => id !== k.id).map((id) => who(player(g, id)!));
    note(k, hour, `Obserwowałeś: ${roomById(w)!.name}. ${names.length ? 'Byli tam: ' + names.join(', ') + '.' : 'Nikogo tam nie było.'}`);
  }

  // Lekarz: zapamiętaj ostatnio chronioną osobę
  for (const m of act.filter((p) => p.role === 'lekarz')) m.lastProtected = g.night[m.id]?.target ?? null;

  // Zadania: punkty i fragmenty poszlak
  const fk = freeKillers(g);
  let ghostDone = 0;
  for (const p of g.players) {
    const c = g.night[p.id];
    if (c?.task !== 'ok') continue;
    p.stats.tasks += 1;
    p.points += 1;
    if (p.status !== 'active') { ghostDone += 1; continue; }
    if (p.role === 'zabojca') continue;
    const subject = executor && attacked ? executor : fk.length ? pick(fk, rng) : null;
    if (!subject) continue;
    const label = executor && attacked ? 'Sprawca tej nocy' : fk.length > 1 ? 'Jeden z zabójców' : 'Zabójca';
    const cats = shuffle(CATEGORIES, rng).slice(0, p.role === 'detektyw' ? 2 : 1);
    for (const text of fragment(charById(subject.characterId)!, label, cats, rng)) note(p, hour, `Z zadania: ${text}`);
  }

  // Tablica duchów i aresztantów
  g.ghostProgress += ghostDone;
  while (g.ghostProgress >= 3 && fk.length) {
    g.ghostProgress -= 3;
    const k = pick(fk, rng);
    const seen = attrOf(charById(k.characterId)!, pick(CATEGORIES, rng)).seen;
    newClues.push({ hour, text: `Duchy i aresztanci szepczą: jeden z zabójców na wolności ma ${seen}.`, fake: false, source: 'duchy' });
  }

  if (!attacked) lines.push('Noc minęła spokojnie. Zbyt spokojnie.');
  const shuffled = shuffle(newClues, rng);
  g.publicClues.push(...shuffled);
  g.morning = { lines, clues: shuffled.map((c) => c.text) };
  g.log.push(logEntry);
}

// ---------- accusation & dawn ----------
function tally(g: Game, voters: Player[]) {
  const counts: Record<string, number> = {};
  let cast = 0;
  for (const v of voters) {
    const t = g.votes[v.id];
    if (!t) continue;
    cast += 1;
    if (t !== 'none') counts[t] = (counts[t] || 0) + 1;
  }
  let top = 0;
  let leaders: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > top) { top = n; leaders = [id]; } else if (n === top) leaders.push(id);
  }
  return { counts, cast, top, leaders };
}

function resolveAccusation(g: Game) {
  const voters = active(g);
  const { counts, cast, top, leaders } = tally(g, voters);
  for (const [id, n] of Object.entries(counts)) { const p = player(g, id); if (p) p.stats.votesReceived += n; }
  const entry = g.log.find((l) => l.hour === g.hour);
  if (top > 0 && leaders.length === 1 && top > cast / 2) {
    const target = player(g, leaders[0])!;
    target.status = 'arrested';
    if (entry) entry.arrestedId = target.id;
    note(target, g.hour, 'Trafiłeś do aresztu. Dalej robisz zadania i głosujesz o świcie.', 'info');
    if (target.role === 'blazen') target.jesterWin = true;
    if (target.role === 'zabojca') {
      for (const v of voters) if (g.votes[v.id] === target.id) { v.stats.correctVotes += 1; v.points += 2; }
    }
    if (freeKillers(g).length === 0) {
      g.pendingWinner = 'rodzina';
      g.verdict = { text: `${who(target)} trafia do aresztu. To był ostatni zabójca na wolności!` };
    } else {
      g.verdict = { text: `${who(target)} trafia do aresztu. Kim był naprawdę, okaże się o świcie.` };
    }
  } else {
    g.verdict = { text: leaders.length > 1 && top > 0 ? 'Remis w głosowaniu. Nikt nie trafia do aresztu.' : 'Nikt nie trafia do aresztu.' };
  }
}

function resolveDawn(g: Game, ctx: Ctx) {
  const free = new Set(freeKillers(g).map((p) => p.id));
  const { counts, top, leaders } = tally(g, g.players);
  for (const [id, n] of Object.entries(counts)) { const p = player(g, id); if (p) p.stats.votesReceived += n; }
  for (const v of g.players) {
    const t = g.votes[v.id];
    if (t && free.has(t)) { v.stats.correctVotes += 1; v.points += 2; }
  }
  let dawnTargetId: string | undefined;
  if (top > 0 && leaders.length === 1) {
    dawnTargetId = leaders[0];
    const t = player(g, dawnTargetId)!;
    if (t.role === 'zabojca' && t.status === 'active') t.status = 'arrested';
  }
  const stillFree = freeKillers(g).length;
  const reason = stillFree === 0
    ? 'O świcie rodzina wskazała ostatniego zabójcę.'
    : dawnTargetId
      ? 'O świcie rodzina wskazała niewłaściwą osobę albo nie wszystkich zabójców.'
      : 'O świcie rodzina nie zgodziła się, kogo oskarżyć.';
  finish(g, stillFree === 0 ? 'rodzina' : 'zabojcy', reason, ctx, dawnTargetId);
}

function finish(g: Game, winner: 'rodzina' | 'zabojcy', reason: string, ctx: Ctx, dawnTargetId?: string) {
  const neutralWinners: string[] = [];
  for (const p of g.players) {
    const faction = p.role ? ROLES[p.role].faction : 'rodzina';
    if ((faction === 'rodzina' && winner === 'rodzina') || (faction === 'zabojcy' && winner === 'zabojcy')) p.points += 5;
    if (p.role === 'zlodziej' && p.heirlooms.length >= 3 && p.status === 'active') { p.points += 5; neutralWinners.push(p.id); }
    if (p.role === 'blazen' && p.jesterWin) { p.points += 5; neutralWinners.push(p.id); }
    if (p.status === 'active') p.points += 2;
  }
  const titles: Result['titles'] = [];
  const best = (arr: Player[], score: (p: Player) => number, min = 1) => {
    let top: Player | null = null;
    for (const p of arr) if (score(p) >= min && (!top || score(p) > score(top))) top = p;
    return top;
  };
  const sherlock = best(g.players, (p) => p.stats.correctVotes);
  if (sherlock) titles.push({ title: 'Sherlock', playerId: sherlock.id, why: plural(sherlock.stats.correctVotes, 'trafny głos', 'trafne głosy', 'trafnych głosów') });
  const worker = best(g.players, (p) => p.stats.tasks);
  if (worker) titles.push({ title: 'Dziedzic pracowitości', playerId: worker.id, why: plural(worker.stats.tasks, 'udane zadanie', 'udane zadania', 'udanych zadań') });
  const suspect = best(g.players.filter((p) => p.role !== 'zabojca'), (p) => p.stats.votesReceived);
  if (suspect) titles.push({ title: 'Najbardziej podejrzany niewinny', playerId: suspect.id, why: `${plural(suspect.stats.votesReceived, 'głos', 'głosy', 'głosów')} przeciw sobie` });
  const killers = g.players.filter((p) => p.role === 'zabojca');
  if (killers.length) {
    const stone = killers.reduce((a, b) => (b.stats.votesReceived < a.stats.votesReceived ? b : a));
    titles.push({ title: 'Kamienna twarz', playerId: stone.id, why: stone.stats.votesReceived === 0 ? 'ani jednego głosu przeciw sobie' : `tylko ${plural(stone.stats.votesReceived, 'głos', 'głosy', 'głosów')} przeciw sobie` });
  }
  g.result = { winner, reason, dawnTargetId, neutralWinners, titles };
  setPhase(g, 'end', ctx);
}

// ---------- actions ----------
export function applyAction(g: Game, playerId: string | null, a: Action, ctx: Ctx): ActResult {
  const me = playerId ? player(g, playerId) : undefined;
  const isHost = !!me && me.id === g.hostId;

  switch (a.type) {
    case 'join': {
      if (g.phase !== 'lobby') return { error: 'Gra już trwa. Dołączyć można tylko w lobby.' };
      if (g.players.length >= MAX_PLAYERS) return { error: 'Pokój jest pełny (12 graczy).' };
      let name = cleanName(a.name) || 'Gracz';
      const base = name;
      for (let i = 2; g.players.some((p) => p.name.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, 13)} ${i}`;
      const p: Player = {
        id: ctx.makeId(), token: ctx.makeId() + ctx.makeId(), name, joinedAt: ctx.now,
        characterId: null, role: null, status: 'active', ready: false, points: 0,
        stats: { tasks: 0, correctVotes: 0, votesReceived: 0 }, heirlooms: [], notes: [], lastProtected: null,
      };
      g.players.push(p);
      if (!g.hostId) g.hostId = p.id;
      applyDefaults(g);
      return { joined: { id: p.id, token: p.token } };
    }
    case 'tick':
      advance(g, ctx);
      return {};
  }

  if (!me) return { error: 'Nie jesteś w tej grze.' };

  switch (a.type) {
    case 'settings': {
      if (!isHost) return { error: 'Ustawienia zmienia host.' };
      if (g.phase !== 'lobby') return { error: 'Ustawienia można zmienić tylko w lobby.' };
      if (a.mode === '30' || a.mode === '60') { g.settings.mode = a.mode; g.touched.mode = true; }
      if (typeof a.death === 'boolean') {
        if (a.death && !deathAllowed(g)) return { error: 'Śmierć graczy jest dostępna od 5 osób.' };
        g.settings.death = a.death; g.touched.death = true;
      }
      if (typeof a.calm === 'boolean') g.settings.calm = a.calm;
      return {};
    }
    case 'start': {
      if (!isHost) return { error: 'Grę startuje host.' };
      if (g.phase !== 'lobby') return { error: 'Gra już trwa.' };
      if (g.players.length < MIN_PLAYERS) return { error: `Potrzeba co najmniej ${MIN_PLAYERS} graczy.` };
      startGame(g, ctx);
      return {};
    }
    case 'ready': {
      if (!['prolog', 'morning', 'discussion'].includes(g.phase)) return {};
      me.ready = true;
      advance(g, ctx);
      return {};
    }
    case 'night': {
      if (g.phase !== 'night') return { error: 'To nie jest pora nocy.' };
      if (me.status !== 'active') return { error: 'Jako duch lub aresztant robisz tylko zadanie.' };
      const c = g.night[me.id] || (g.night[me.id] = {});
      if (a.room !== undefined) {
        if (!roomById(a.room)) return { error: 'Nie ma takiego pokoju.' };
        c.room = a.room;
      }
      if (a.watch !== undefined) {
        if (me.role !== 'kamerdyner' || !roomById(a.watch)) return { error: 'Nie możesz obserwować tego pokoju.' };
        c.watch = a.watch;
      }
      if (a.target !== undefined) {
        if (me.role === 'zabojca') {
          if (!killTargets(g).some((t) => t.id === a.target)) return { error: 'Nie można wybrać tej ofiary.' };
        } else if (me.role === 'lekarz' && g.settings.death) {
          const t = player(g, a.target);
          if (!t || t.status !== 'active') return { error: 'Nie można chronić tej osoby.' };
          if (a.target === me.lastProtected) return { error: 'Tej osoby nie możesz chronić dwie noce z rzędu.' };
        } else {
          return { error: 'Twoja rola nie wybiera nikogo w nocy.' };
        }
        c.target = a.target;
      }
      advance(g, ctx);
      return {};
    }
    case 'task': {
      if (g.phase !== 'night') return { error: 'Zadania robi się w nocy.' };
      const c = g.night[me.id] || (g.night[me.id] = {});
      if (c.task) return {};
      if (me.status === 'active') {
        if (!c.room) return { error: 'Najpierw wybierz pokój.' };
        if (needsTarget(g, me) && !c.target) return { error: 'Najpierw wybierz cel.' };
        if (me.role === 'kamerdyner' && !c.watch) return { error: 'Najpierw wybierz pokój do obserwacji.' };
      }
      c.task = a.success ? 'ok' : 'fail';
      if (a.success && me.role === 'zabojca' && me.status === 'active' && a.frame) {
        const f = player(g, a.frame);
        if (f && f.role !== 'zabojca') c.frame = f.id;
      }
      advance(g, ctx);
      return {};
    }
    case 'vote': {
      if (g.phase === 'accusation') {
        if (me.status !== 'active') return { error: 'Aresztanci i duchy głosują dopiero o świcie.' };
        if (a.target === 'none') {
          if (g.hour === g.hours && hasVoteTarget(g, me)) return { error: 'Kogut pieje: w ostatniej godzinie trzeba kogoś wskazać.' };
        } else {
          const t = player(g, a.target);
          if (!t || t.status !== 'active' || t.id === me.id) return { error: 'Nie można oskarżyć tej osoby.' };
        }
      } else if (g.phase === 'dawn') {
        const t = player(g, a.target);
        if (!t || t.status !== 'active' || t.id === me.id) return { error: 'Wskaż osobę, która siedzi przy stole.' };
      } else {
        return { error: 'Teraz nie ma głosowania.' };
      }
      g.votes[me.id] = a.target;
      advance(g, ctx);
      return {};
    }
    case 'skip': {
      if (!isHost) return { error: 'Fazę pomija host.' };
      advance(g, ctx, true);
      return {};
    }
    case 'restart': {
      if (!isHost) return { error: 'Nową grę zaczyna host.' };
      g.phase = 'lobby';
      g.endsAt = null;
      g.hour = 0;
      g.result = null;
      g.publicClues = [];
      g.morning = null;
      g.verdict = null;
      g.log = [];
      g.npcs = [];
      for (const p of g.players) {
        p.characterId = null; p.role = null; p.status = 'active'; p.ready = false; p.points = 0;
        p.stats = { tasks: 0, correctVotes: 0, votesReceived: 0 }; p.heirlooms = []; p.notes = []; p.lastProtected = null; p.jesterWin = false;
      }
      return {};
    }
  }
  return { error: 'Nieznana akcja.' };
}

// ---------- views ----------
function charPublic(c: Character | undefined) {
  if (!c) return null;
  return {
    id: c.id, name: c.name, who: c.who,
    attrs: CATEGORIES.map((cat) => ({ cat, label: attrOf(c, cat).label })),
  };
}

export function publicView(g: Game, now: number) {
  const ended = g.phase === 'end';
  return {
    code: g.code,
    phase: g.phase,
    hour: g.hour,
    hours: g.hours,
    clock: g.hour > 0 ? hourLabel(g, g.hour) : null,
    endsAt: g.endsAt,
    serverNow: now,
    settings: g.settings,
    hostId: g.hostId,
    intro: INTRO,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, ready: p.ready,
      character: charPublic(charById(p.characterId)),
    })),
    npcs: g.npcs.map((n) => ({ name: n.name, alive: n.alive })),
    night: g.phase === 'night'
      ? { done: g.players.filter((p) => nightDone(g, p)).length, total: g.players.length }
      : null,
    morning: g.morning,
    publicClues: g.publicClues.map((c) => ({ hour: c.hour, clock: hourLabel(g, c.hour), text: c.text, source: c.source, fake: ended ? c.fake : undefined })),
    heirloomsLeft: Object.values(g.heirlooms).filter(Boolean).length,
    ghostProgress: g.ghostProgress,
    voting: g.phase === 'accusation' || g.phase === 'dawn'
      ? {
        voted: Object.keys(g.votes).length,
        eligible: g.phase === 'accusation' ? active(g).length : g.players.filter((p) => hasVoteTarget(g, p)).length,
        lastHour: g.hour === g.hours,
      }
      : null,
    readyCount: g.players.filter((p) => p.ready).length,
    verdict: g.phase === 'verdict' ? g.verdict : null,
    result: ended && g.result ? endReveal(g) : null,
  };
}

function endReveal(g: Game) {
  const r = g.result!;
  const name = (id?: string) => { const p = player(g, id); return p ? who(p) : undefined; };
  return {
    winner: r.winner,
    reason: r.reason,
    dawnTarget: name(r.dawnTargetId),
    neutralWinners: r.neutralWinners.map((id) => name(id)),
    titles: r.titles.map((t) => ({ title: t.title, who: name(t.playerId), why: t.why })),
    ranking: g.players
      .map((p) => ({
        name: p.name, character: charName(p), role: p.role ? ROLES[p.role].name : '?',
        faction: p.role ? ROLES[p.role].faction : 'rodzina', status: p.status, points: p.points,
      }))
      .sort((a, b) => b.points - a.points),
    reconstruction: g.log.map((l) => ({
      clock: hourLabel(g, l.hour),
      rooms: Object.entries(l.rooms).map(([pid, room]) => `${name(pid)}: ${roomById(room)?.name}`),
      executor: name(l.executorId),
      victim: l.victim ? `${l.victim.name} (${roomById(l.victim.room)?.name})` : null,
      failed: l.failed ?? null,
      theft: l.theft ? `${name(l.theft.thiefId)} ukradł: ${roomById(l.theft.room)?.heirloom}` : null,
      arrested: name(l.arrestedId) ?? null,
    })),
  };
}

export function playerView(g: Game, playerId: string, now: number) {
  const view = publicView(g, now);
  const me = player(g, playerId);
  if (!me) return { ...view, me: null };
  const role = me.role ? ROLES[me.role] : null;
  const c = charById(me.characterId);
  const choice = g.night[me.id] || {};
  let night = null;
  if (g.phase === 'night') {
    let targets: { id: string; label: string }[] = [];
    let targetKind: 'kill' | 'protect' | null = null;
    if (me.status === 'active' && me.role === 'zabojca') { targets = killTargets(g); targetKind = 'kill'; }
    if (me.status === 'active' && me.role === 'lekarz' && g.settings.death) {
      targets = active(g).filter((p) => p.id !== me.lastProtected).map((p) => ({ id: p.id, label: p.id === me.id ? 'Siebie' : who(p) }));
      targetKind = 'protect';
    }
    night = {
      choice: { room: choice.room ?? null, target: choice.target ?? null, watch: choice.watch ?? null, task: choice.task ?? null },
      needsRoom: me.status === 'active',
      needsWatch: me.status === 'active' && me.role === 'kamerdyner',
      targetKind: needsTarget(g, me) ? targetKind : null,
      targets,
      frameTargets: me.role === 'zabojca' && me.status === 'active'
        ? g.players.filter((p) => p.role !== 'zabojca').map((p) => ({ id: p.id, label: who(p) }))
        : [],
      done: nightDone(g, me),
    };
  }
  const voteTargets = (g.phase === 'accusation' || g.phase === 'dawn')
    ? active(g).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, label: who(p) }))
    : [];
  return {
    ...view,
    me: {
      id: me.id,
      name: me.name,
      isHost: me.id === g.hostId,
      status: me.status,
      ready: me.ready,
      points: me.points,
      role: role ? { id: role.id, name: role.name, faction: role.faction, does: role.does, wins: role.wins } : null,
      character: c ? { ...charPublic(c), secret: c.secret } : null,
      heirlooms: me.heirlooms.length,
      notes: me.notes.map((n) => ({ clock: n.hour > 0 ? hourLabel(g, n.hour) : 'Kolacja', text: n.text, kind: n.kind })),
      night,
      vote: g.votes[me.id] ?? null,
      canVote: (g.phase === 'accusation' && me.status === 'active') || (g.phase === 'dawn' && voteTargets.length > 0),
      voteTargets,
    },
  };
}
