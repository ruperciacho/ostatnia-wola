// Silnik gry „Ostatnia wola”: czyste funkcje na stanie gry (bez sieci i bazy).
import {
  ATTRS, CATEGORIES, CHARACTERS, ROLES, ROOMS, SERVANTS, introFor,
  roleDistribution,
} from './data.ts';
import type { Category, Character, RoleId } from './data.ts';

export type Phase = 'lobby' | 'rules' | 'prolog' | 'night' | 'morning' | 'discussion' | 'accusation' | 'verdict' | 'dawn' | 'end';
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
  /** Za co gracz dostał lub stracił punkty (widzi to na telefonie). */
  pointsLog: PointEntry[];
  stats: { tasks: number; correctVotes: number; votesReceived: number };
  heirlooms: string[];
  notes: Note[];
  lastProtected: string | null;
  jesterWin?: boolean;
}

export interface PointEntry { hour: number; pts: number; why: string }
export interface VoteRecord { hour: number; kind: 'accusation' | 'dawn'; votes: Record<string, string>; arrestedId?: string }
export interface Jail { playerId: string; hour: number; voters: string[] }

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
  verdict: { text: string; lines: string[] } | null;
  /** Osoba zamknięta w ostatnim głosowaniu; rozliczenie przy głosowaniu następnego dnia. */
  jail: Jail | null;
  voteLog: VoteRecord[];
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

// Limit czasu ma tylko noc (wybór pokoju i zadanie). Pozostałe fazy kończą się,
// gdy wszyscy potwierdzą przyciskiem albo host pominie fazę.
const NIGHT_SECONDS = 120;
const CALM_MULT = 1.5;

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
/** Forma męska albo żeńska według płci postaci gracza (np. „zginąłeś” / „zginęłaś”). */
function gf(p: Player, m: string, f: string): string { return charById(p.characterId)?.f ? f : m; }
function npcFemale(id: string): boolean {
  const s = SERVANTS.find((x) => x.id === id);
  if (s) return s.f;
  return !!charById(id)?.f;
}

// Gra trwa kilka dni (g.hour to numer dnia). Każdy dzień zaczyna się nocą, testament jest o świcie po ostatnim dniu.
export function hourLabel(_g: Game, day: number): string {
  return `Dzień ${day}`;
}
function nightLabel(day: number): string {
  return `Noc ${day}`;
}
/** Ile dni zostało do odczytania testamentu, licząc od poranka tego dnia. */
function countdown(g: Game, day: number): string {
  const left = g.hours - day + 1;
  if (left <= 1) return `Dzień ${day}, ostatni. Testament jutro o świcie.`;
  return `Dzień ${day}. Do odczytania testamentu ${left <= 4 ? 'zostały' : 'zostało'} ${left} dni.`;
}

function duration(g: Game, phase: Phase): number | null {
  if (phase !== 'night') return null;
  return Math.round(NIGHT_SECONDS * (g.settings.calm ? CALM_MULT : 1) * 1000);
}

const active = (g: Game) => g.players.filter((p) => p.status === 'active');
const freeKillers = (g: Game) => active(g).filter((p) => p.role === 'zabojca');
const player = (g: Game, id: string | undefined) => g.players.find((p) => p.id === id);
const hasVoteTarget = (g: Game, p: Player) => active(g).some((a) => a.id !== p.id);
const deathAllowed = (g: Game) => g.players.length >= 5;

function note(p: Player, hour: number, text: string, kind: Note['kind'] = 'clue') { p.notes.push({ hour, text, kind }); }
function addPoints(p: Player, hour: number, pts: number, why: string) {
  p.points += pts;
  (p.pointsLog || (p.pointsLog = [])).push({ hour, pts, why });
}
const isSchemer = (p: Player) => p.role === 'zabojca' || p.role === 'zlodziej';

// ---------- creation ----------
export function createGame(code: string, now: number): Game {
  return {
    code, createdAt: now, phase: 'lobby', hour: 0, hours: 4, endsAt: null,
    settings: { mode: '30', death: false, calm: false },
    touched: { mode: false, death: false },
    hostId: null, players: [], npcs: [], night: {}, publicClues: [], morning: null,
    votes: {}, verdict: null, jail: null, voteLog: [], pendingWinner: null, ghostProgress: 0, heirlooms: {}, log: [], result: null,
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
  const d = duration(g, phase);
  g.endsAt = d === null ? null : ctx.now + d;
  for (const p of g.players) p.ready = false;
  if (phase === 'night') {
    g.night = {};
    for (const n of g.npcs) if (n.alive) n.room = pick(ROOMS, ctx.rng).id;
  }
  if (phase === 'accusation' || phase === 'dawn') g.votes = {};
}

/** Zabójca nie wybiera pokoju: idzie za ofiarą i spędza noc tam, gdzie ona. */
export function followsTarget(g: Game, p: Player): boolean {
  return p.status === 'active' && p.role === 'zabojca' && killTargets(g).length > 0;
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
  if (!c.task) return false;
  if (!c.room && !followsTarget(g, p)) return false;
  if (needsTarget(g, p) && !c.target) return false;
  if (p.role === 'kamerdyner' && !c.watch) return false;
  return true;
}

/** Czy gra czeka w tej fazie na ruch tego gracza (niezależnie od tego, czy go już zrobił). */
function mustAct(g: Game, p: Player): boolean {
  switch (g.phase) {
    case 'rules':
    case 'prolog':
    case 'night':
    case 'morning':
    case 'verdict':
      return true;
    case 'discussion':
    case 'accusation':
      return p.status === 'active';
    case 'dawn':
      return hasVoteTarget(g, p);
    default:
      return false;
  }
}

function actDone(g: Game, p: Player): boolean {
  if (g.phase === 'night') return nightDone(g, p);
  if (g.phase === 'accusation' || g.phase === 'dawn') return !!g.votes[p.id];
  return p.ready;
}

function phaseComplete(g: Game): boolean {
  if (g.phase === 'lobby' || g.phase === 'end') return false;
  if (g.phase === 'accusation' && active(g).length <= 1) return true;
  return g.players.every((p) => !mustAct(g, p) || actDone(g, p));
}

function killTargets(g: Game): { id: string; label: string }[] {
  if (g.settings.death) {
    return active(g).filter((p) => p.role !== 'zabojca').map((p) => ({ id: p.id, label: who(p) }));
  }
  return g.npcs.filter((n) => n.alive).map((n) => ({ id: n.id, label: `${n.name} (${roomById(n.room)?.name ?? '?'})` }));
}

function nextPhase(g: Game, ctx: Ctx) {
  switch (g.phase) {
    case 'rules':
      setPhase(g, 'prolog', ctx);
      return;
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
        // Niewinni w areszcie wrócą jutro, więc liczą się jako goście przy stole
        const killers = freeKillers(g).length;
        const others = g.players.filter((p) => p.status !== 'dead' && p.role !== 'zabojca').length;
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
        finish(g, 'rodzina', 'Ostatni zabójca trafił do aresztu przed odczytaniem testamentu.', ctx);
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
    p.pointsLog = [];
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
  g.jail = null;
  g.voteLog = [];
  g.pendingWinner = null;
  g.ghostProgress = 0;
  g.result = null;
  g.hour = 0;
  const killers = g.players.filter((p) => p.role === 'zabojca');
  for (const k of killers) {
    const others = killers.filter((x) => x.id !== k.id).map(who);
    if (others.length) note(k, 0, `Twoi wspólnicy: ${others.join(', ')}.`, 'info');
  }
  // Najpierw ekran z zasadami tej gry, potem kolacja i role
  setPhase(g, 'rules', ctx);
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
  const act = active(g);
  const roomOf: Record<string, string> = {};
  const followers = act.filter((p) => followsTarget(g, p));
  for (const p of act) {
    if (followers.includes(p)) continue;
    const c = g.night[p.id] || (g.night[p.id] = {});
    if (!c.room) c.room = pick(ROOMS, rng).id;
    roomOf[p.id] = c.room;
  }
  // Zabójca spędza noc w pokoju swojego celu (bez celu: w losowym pokoju)
  for (const k of followers) {
    const c = g.night[k.id] || (g.night[k.id] = {});
    const npc = g.settings.death ? undefined : g.npcs.find((n) => n.id === c.target && n.alive);
    const r = (c.target && roomOf[c.target]) || npc?.room || c.room || pick(ROOMS, rng).id;
    c.room = r;
    roomOf[k.id] = r;
    const tp = player(g, c.target);
    const prey = tp ? who(tp) : npc?.name;
    if (prey) note(k, hour, `${gf(k, 'Poszedłeś', 'Poszłaś')} za: ${prey}. Noc ${gf(k, 'spędziłeś', 'spędziłaś')} ${roomById(r)!.loc}.`, 'info');
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

  const lines: string[] = [countdown(g, hour)];
  const logEntry: HourLog = { hour, rooms: { ...roomOf } };
  let attackRoom: string | null = null;
  let attacked = false;

  if (executor && targetId) {
    logEntry.executorId = executor.id;
    if (g.settings.death) {
      const victim = player(g, targetId)!;
      attackRoom = roomOf[victim.id];
      const room = roomById(attackRoom)!;
      const others = act.filter((p) => p.id !== victim.id && p.role !== 'zabojca' && roomOf[p.id] === attackRoom).length;
      const medic = act.find((p) => p.role === 'lekarz' && g.night[p.id]?.target === victim.id);
      attacked = true;
      if (medic) {
        logEntry.failed = 'lekarz';
        lines.push('W nocy ktoś próbował zabić, ale lekarz zdążył na czas.');
        const seen = attrOf(charById(executor.characterId)!, pick(CATEGORIES, rng)).seen;
        note(victim, hour, `Ktoś cię zaatakował, ale lekarz zdążył. ${gf(victim, 'Zapamiętałeś', 'Zapamiętałaś')}: ${seen}.`);
      } else if (others >= 3) {
        logEntry.failed = 'tlok';
        lines.push(`${cap(room.loc)} ktoś próbował zabić, ale było tam za tłoczno.`);
      } else {
        victim.status = 'dead';
        logEntry.victim = { name: who(victim), room: attackRoom, playerId: victim.id };
        lines.push(`${who(victim)} nie żyje. ${gf(victim, 'Znaleziono go', 'Znaleziono ją')} ${room.loc}.`);
        lines.push(pick(room.deaths, rng));
        note(victim, hour, `${gf(victim, 'Zginąłeś', 'Zginęłaś')}. Grasz dalej jako duch: grasz w mini-gry i głosujesz o świcie. Co 3 udane mini-gry duchów i aresztantów odsłaniają poszlakę.`, 'info');
      }
    } else {
      const npc = g.npcs.find((n) => n.id === targetId)!;
      attackRoom = npc.room || pick(ROOMS, rng).id;
      const room = roomById(attackRoom)!;
      npc.alive = false;
      attacked = true;
      logEntry.victim = { name: npc.name, room: attackRoom };
      lines.push(`${npc.name} nie żyje. ${npcFemale(npc.id) ? 'Znaleziono ją' : 'Znaleziono go'} ${room.loc}.`);
      lines.push(pick(room.deaths, rng));
    }
  }

  // Sprawca zawsze jest w pokoju ofiary (także gdy cel wylosował się sam, bo zabójca nie zdążył wybrać)
  if (executor && attackRoom && roomOf[executor.id] !== attackRoom) {
    roomOf[executor.id] = attackRoom;
    logEntry.rooms[executor.id] = attackRoom;
    (g.night[executor.id] || (g.night[executor.id] = {})).room = attackRoom;
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
        note(w, hour, `${gf(w, 'Byłeś', 'Byłaś')} ${roomById(attackRoom)!.loc}, gdy doszło do ataku. W ciemności ${gf(w, 'zauważyłeś', 'zauważyłaś')}: ${seen}.`);
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
      note(t, hour, `${cap(room.loc)} było za dużo ludzi, nic nie ${gf(t, 'ukradłeś', 'ukradłaś')}.`, 'info');
    } else {
      g.heirlooms[r] = false;
      t.heirlooms.push(r);
      addPoints(t, hour, 2, `Kradzież: ${room.heirloom}`);
      logEntry.theft = { room: r, thiefId: t.id };
      lines.push(`${cap(room.from)} zniknęła pamiątka: ${room.heirloom}.`);
      note(t, hour, `Udało się: ${room.heirloom}. Pamiątki: ${t.heirlooms.length}/3.`, 'info');
    }
  }

  // Kamerdyner
  for (const k of act.filter((p) => p.role === 'kamerdyner')) {
    const c = g.night[k.id];
    const w = c.watch && roomById(c.watch) ? c.watch : pick(ROOMS, rng).id;
    const names = presence[w].filter((id) => id !== k.id).map((id) => who(player(g, id)!));
    note(k, hour, `Obserwowany pokój: ${roomById(w)!.name}. ${names.length ? 'Byli tam: ' + names.join(', ') + '.' : 'Nikogo tam nie było.'}`);
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
    addPoints(p, hour, 1, 'Udana mini-gra');
    if (p.status !== 'active') { ghostDone += 1; continue; }
    if (p.role === 'zabojca') continue;
    const subject = executor && attacked ? executor : fk.length ? pick(fk, rng) : null;
    if (!subject) continue;
    const label = executor && attacked ? 'Sprawca tej nocy' : fk.length > 1 ? 'Jeden z zabójców' : 'Zabójca';
    const cats = shuffle(CATEGORIES, rng).slice(0, p.role === 'detektyw' ? 2 : 1);
    for (const text of fragment(charById(subject.characterId)!, label, cats, rng)) note(p, hour, `Z mini-gry: ${text}`);
  }

  // Tablica duchów i aresztantów
  g.ghostProgress += ghostDone;
  while (g.ghostProgress >= 3 && fk.length) {
    g.ghostProgress -= 3;
    const k = pick(fk, rng);
    const has = attrOf(charById(k.characterId)!, pick(CATEGORIES, rng)).has;
    newClues.push({ hour, text: `Duchy i aresztanci szepczą: jeden z zabójców na wolności ${has}.`, fake: false, source: 'duchy' });
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

/**
 * Rozliczenie aresztu przy głosowaniu następnego dnia. Zabójca zostaje; każdy inny wychodzi.
 * Głos na zabójcę: +2. Głos na niewinnego: -1, a zabójca lub złodziej dostaje za to +1 (machlojka).
 * Złapany złodziej oddaje łupy, a głosujący na niego dostają +1.
 */
function settleJail(g: Game, final: boolean): string[] {
  const j = g.jail;
  if (!j) return [];
  g.jail = null;
  const p = player(g, j.playerId);
  if (!p) return [];
  const hour = g.hour;
  const voters = j.voters.map((id) => player(g, id)).filter((v): v is Player => !!v && v.id !== p.id);
  const lines: string[] = [];
  if (p.role === 'zabojca') {
    for (const v of voters) { v.stats.correctVotes += 1; addPoints(v, hour, 2, `Trafny głos: ${who(p)} to zabójca`); }
    if (!final) lines.push(`${who(p)} zostaje w areszcie. Śledztwo potwierdziło: to zabójca! Głosujący na tę osobę dostają po 2 punkty.`);
    return lines;
  }
  const thief = p.role === 'zlodziej';
  for (const v of voters) {
    if (thief) addPoints(v, hour, 1, `Złapany złodziej: ${who(p)}`);
    else if (isSchemer(v)) addPoints(v, hour, 1, `Machlojka: w areszcie niewinna osoba, ${who(p)}`);
    else addPoints(v, hour, -1, `Głos na niewinną osobę: ${who(p)}`);
  }
  let loot = 0;
  if (thief && p.heirlooms.length) {
    loot = p.heirlooms.length;
    for (const r of p.heirlooms) g.heirlooms[r] = true;
    p.heirlooms = [];
    addPoints(p, hour, -2 * loot, `Oddane łupy: ${loot}`);
  }
  if (!final) {
    p.status = 'active';
    note(p, hour, 'Wychodzisz z aresztu i wracasz do stołu. Znowu wybierasz pokój i głosujesz.', 'info');
    lines.push(thief
      ? `${who(p)} wychodzi z aresztu. To nie zabójca, tylko złodziej: oddaje łupy (${loot}). Głosujący dostają po 1 punkcie.`
      : `${who(p)} wychodzi z aresztu: to nie zabójca. Głosujący na tę osobę tracą po 1 punkcie.`);
  }
  return lines;
}

function resolveAccusation(g: Game) {
  // Najpierw rozliczamy areszt z poprzedniego dnia
  const lines = settleJail(g, false);
  const voters = active(g);
  const { counts, cast, top, leaders } = tally(g, voters);
  for (const [id, n] of Object.entries(counts)) { const p = player(g, id); if (p) p.stats.votesReceived += n; }
  const entry = g.log.find((l) => l.hour === g.hour);
  const record: VoteRecord = { hour: g.hour, kind: 'accusation', votes: { ...g.votes } };
  g.voteLog.push(record);
  let text: string;
  if (top > 0 && leaders.length === 1 && top > cast / 2) {
    const target = player(g, leaders[0])!;
    target.status = 'arrested';
    record.arrestedId = target.id;
    if (entry) entry.arrestedId = target.id;
    g.jail = { playerId: target.id, hour: g.hour, voters: voters.filter((v) => g.votes[v.id] === target.id).map((v) => v.id) };
    const lastDay = g.hour >= g.hours;
    note(target, g.hour, `${gf(target, 'Trafiłeś', 'Trafiłaś')} do aresztu. Grasz dalej w mini-gry, ale nie wybierasz pokoju i nie głosujesz.${lastDay ? '' : ' Jeśli nie jesteś zabójcą, wyjdziesz jutro po głosowaniu.'}`, 'info');
    if (target.role === 'blazen') target.jesterWin = true;
    if (freeKillers(g).length === 0) {
      g.pendingWinner = 'rodzina';
      text = `${who(target)} trafia do aresztu. To był ostatni zabójca na wolności!`;
    } else {
      text = lastDay
        ? `${who(target)} trafia do aresztu. Jeśli to nie zabójca, głosujący stracą po 1 punkcie.`
        : `${who(target)} trafia do aresztu. Jeśli to nie zabójca, wyjdzie jutro po głosowaniu, a głosujący stracą po 1 punkcie.`;
    }
  } else {
    text = leaders.length > 1 && top > 0 ? 'Remis w głosowaniu. Nikt nie trafia do aresztu.' : 'Nikt nie trafia do aresztu.';
  }
  g.verdict = { text, lines };
}

function resolveDawn(g: Game, ctx: Ctx) {
  const free = new Set(freeKillers(g).map((p) => p.id));
  const { counts, top, leaders } = tally(g, g.players);
  for (const [id, n] of Object.entries(counts)) { const p = player(g, id); if (p) p.stats.votesReceived += n; }
  for (const v of g.players) {
    const t = g.votes[v.id];
    if (t && free.has(t)) { v.stats.correctVotes += 1; addPoints(v, g.hour, 2, `Trafny głos o świcie: ${who(player(g, t)!)}`); }
  }
  let dawnTargetId: string | undefined;
  if (top > 0 && leaders.length === 1) {
    dawnTargetId = leaders[0];
    const t = player(g, dawnTargetId)!;
    if (t.role === 'zabojca' && t.status === 'active') t.status = 'arrested';
    if (t.role !== 'zabojca') {
      // Wskazanie niewinnej osoby o świcie: kara albo machlojka
      for (const v of g.players) {
        if (g.votes[v.id] !== t.id) continue;
        if (isSchemer(v)) addPoints(v, g.hour, 1, `Machlojka: o świcie wskazano niewinną osobę, ${who(t)}`);
        else addPoints(v, g.hour, -1, `Głos o świcie na niewinną osobę: ${who(t)}`);
      }
    }
  }
  g.voteLog.push({ hour: g.hour, kind: 'dawn', votes: { ...g.votes }, arrestedId: dawnTargetId });
  const stillFree = freeKillers(g).length;
  const reason = stillFree === 0
    ? 'O świcie rodzina wskazała ostatniego zabójcę.'
    : dawnTargetId
      ? 'O świcie rodzina wskazała niewłaściwą osobę albo nie wszystkich zabójców.'
      : 'O świcie rodzina nie zgodziła się, kogo oskarżyć.';
  finish(g, stillFree === 0 ? 'rodzina' : 'zabojcy', reason, ctx, dawnTargetId);
}

function finish(g: Game, winner: 'rodzina' | 'zabojcy', reason: string, ctx: Ctx, dawnTargetId?: string) {
  settleJail(g, true);
  const neutralWinners: string[] = [];
  const h = g.hour;
  for (const p of g.players) {
    const faction = p.role ? ROLES[p.role].faction : 'rodzina';
    if (faction === 'rodzina' && winner === 'rodzina') addPoints(p, h, 5, 'Wygrana rodziny');
    if (faction === 'zabojcy' && winner === 'zabojcy') addPoints(p, h, 5, 'Wygrana zabójców');
    if (p.role === 'zlodziej' && p.heirlooms.length >= 3 && p.status === 'active') { addPoints(p, h, 5, 'Wygrana złodzieja: 3 pamiątki'); neutralWinners.push(p.id); }
    if (p.role === 'blazen' && p.jesterWin) { addPoints(p, h, 5, 'Wygrana błazna: areszt'); neutralWinners.push(p.id); }
    const caught = p.role === 'zabojca' && p.status === 'arrested';
    if (p.status !== 'dead' && !caught) addPoints(p, h, 2, 'Przetrwanie do końca');
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
  if (worker) titles.push({ title: 'Dziedzic pracowitości', playerId: worker.id, why: plural(worker.stats.tasks, 'udana mini-gra', 'udane mini-gry', 'udanych mini-gier') });
  const suspect = best(g.players.filter((p) => p.role !== 'zabojca'), (p) => p.stats.votesReceived);
  if (suspect) titles.push({ title: 'Kozioł ofiarny', playerId: suspect.id, why: `${plural(suspect.stats.votesReceived, 'głos', 'głosy', 'głosów')} przeciw sobie` });
  // Kamienna twarz tylko dla zabójcy, którego nie złapano
  const killers = g.players.filter((p) => p.role === 'zabojca' && p.status !== 'arrested');
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
        pointsLog: [], stats: { tasks: 0, correctVotes: 0, votesReceived: 0 }, heirlooms: [], notes: [], lastProtected: null,
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
      if (!['rules', 'prolog', 'morning', 'discussion', 'verdict'].includes(g.phase)) return {};
      if (!mustAct(g, me)) return {};
      me.ready = true;
      advance(g, ctx);
      return {};
    }
    case 'night': {
      if (g.phase !== 'night') return { error: 'To nie jest pora nocy.' };
      if (me.status !== 'active') return { error: 'Jako duch albo w areszcie grasz tylko w mini-grę.' };
      const c = g.night[me.id] || (g.night[me.id] = {});
      const follows = followsTarget(g, me);
      if (a.room !== undefined && !follows) {
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
        if (follows) {
          // NPC stoi w znanym pokoju; gracz wybiera pokój w tajemnicy, więc pokój zabójcy ustalamy dopiero na koniec nocy
          const npc = g.settings.death ? undefined : g.npcs.find((n) => n.id === a.target);
          if (npc?.room) c.room = npc.room;
          else delete c.room;
        }
      }
      advance(g, ctx);
      return {};
    }
    case 'task': {
      if (g.phase !== 'night') return { error: 'Mini-gry są tylko w nocy.' };
      const c = g.night[me.id] || (g.night[me.id] = {});
      if (c.task) return {};
      if (me.status === 'active') {
        if (!c.room && !followsTarget(g, me)) return { error: 'Najpierw wybierz pokój.' };
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
          if (g.hour === g.hours && hasVoteTarget(g, me)) return { error: 'Jutro testament: dziś trzeba kogoś wskazać.' };
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
      g.jail = null;
      g.voteLog = [];
      g.log = [];
      g.npcs = [];
      for (const p of g.players) {
        p.characterId = null; p.role = null; p.status = 'active'; p.ready = false; p.points = 0; p.pointsLog = [];
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
    id: c.id, name: c.name, who: c.who, f: c.f,
    attrs: CATEGORIES.map((cat) => ({ cat, label: attrOf(c, cat).label })),
  };
}

const ROLE_ORDER: RoleId[] = ['zabojca', 'zlodziej', 'blazen', 'detektyw', 'kamerdyner', 'lekarz', 'krewny'];

/** Co będzie w tej grze: role z liczbami i podstawowe ustawienia (pokazywane przed startem). */
function setupInfo(g: Game) {
  const n = g.players.length;
  if (n < MIN_PLAYERS) return null;
  const death = g.settings.death && deathAllowed(g);
  const counts: Record<string, number> = {};
  for (const r of roleDistribution(n, death)) counts[r] = (counts[r] || 0) + 1;
  return {
    players: n,
    death,
    hours: g.phase === 'lobby' ? (g.settings.mode === '30' ? 4 : 6) : g.hours,
    nightSeconds: Math.round(NIGHT_SECONDS * (g.settings.calm ? CALM_MULT : 1)),
    roles: ROLE_ORDER.filter((r) => counts[r]).map((r) => ({
      id: r, name: ROLES[r].name, count: counts[r], faction: ROLES[r].faction, does: ROLES[r].does, wins: ROLES[r].wins,
    })),
  };
}

/** Jawne głosy: kto na kogo. */
function voteView(g: Game, rec: VoteRecord) {
  const byTarget: Record<string, string[]> = {};
  const none: string[] = [];
  for (const [from, to] of Object.entries(rec.votes)) {
    const f = player(g, from);
    if (!f) continue;
    if (to === 'none') { none.push(who(f)); continue; }
    (byTarget[to] || (byTarget[to] = [])).push(who(f));
  }
  const rows = Object.entries(byTarget)
    .map(([to, voters]) => { const t = player(g, to); return { target: t ? who(t) : '?', voters }; })
    .sort((a, b) => b.voters.length - a.voters.length);
  const arrested = rec.arrestedId ? player(g, rec.arrestedId) : undefined;
  return { clock: rec.kind === 'dawn' ? 'Dzień testamentu' : hourLabel(g, rec.hour), kind: rec.kind, rows, none, arrested: arrested ? who(arrested) : null };
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
    intro: introFor(g.hours),
    players: g.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, ready: p.ready,
      waiting: mustAct(g, p) && !actDone(g, p),
      character: charPublic(charById(p.characterId)),
    })),
    npcs: g.npcs.map((n) => ({ name: n.name, alive: n.alive })),
    night: g.phase === 'night'
      ? { done: g.players.filter((p) => nightDone(g, p)).length, total: g.players.length }
      : null,
    morning: g.morning,
    publicClues: g.publicClues.map((c) => ({ hour: c.hour, clock: nightLabel(c.hour), text: c.text, source: c.source, fake: ended ? c.fake : undefined })),
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
    waitingCount: g.players.filter((p) => mustAct(g, p) && !actDone(g, p)).length,
    actCount: g.players.filter((p) => mustAct(g, p)).length,
    verdict: g.phase === 'verdict' ? g.verdict : null,
    setup: setupInfo(g),
    voteHistory: (g.voteLog || []).map((r) => voteView(g, r)),
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
      clock: nightLabel(l.hour),
      rooms: Object.entries(l.rooms).map(([pid, room]) => `${name(pid)}: ${roomById(room)?.name}`),
      executor: name(l.executorId),
      victim: l.victim ? `${l.victim.name} (${roomById(l.victim.room)?.name})` : null,
      failed: l.failed ?? null,
      theft: l.theft ? `kradzież: ${roomById(l.theft.room)?.heirloom}, sprawca: ${name(l.theft.thiefId)}` : null,
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
      needsRoom: me.status === 'active' && !followsTarget(g, me),
      follows: followsTarget(g, me),
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
      pointsLog: (me.pointsLog || []).map((e) => ({ clock: e.hour > 0 ? hourLabel(g, e.hour) : '', pts: e.pts, why: e.why })),
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
