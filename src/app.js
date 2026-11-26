(function () {
  'use strict';

  var SUPABASE_URL = 'https://cbdpajxjdqyhjaqqqbak.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_tHealYjK7umS5-hJR6xPiw_sOciMW4u';
  var FN_URL = SUPABASE_URL + '/functions/v1/game';

  var params = new URLSearchParams(location.search);
  var slot = (params.get('s') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  var PHASE_LABEL = {
    lobby: 'Lobby', rules: 'Zasady', prolog: 'Kolacja', night: 'Noc', morning: 'Poranek', discussion: 'Narada',
    accusation: 'Oskarżenie', verdict: 'Werdykt', dawn: 'Świt', end: 'Koniec'
  };
  var ROOMS = [
    { id: 'biblioteka', name: 'Biblioteka' }, { id: 'kuchnia', name: 'Kuchnia' }, { id: 'gabinet', name: 'Gabinet' },
    { id: 'piwnica', name: 'Piwnica' }, { id: 'oranzeria', name: 'Oranżeria' }, { id: 'strych', name: 'Strych' }
  ];

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function storageKey(k) { return 'ow:' + k + (slot ? ':' + slot : ''); }
  function sGet(k) { try { return localStorage.getItem(storageKey(k)); } catch (e) { return null; } }
  function sSet(k, v) { try { localStorage.setItem(storageKey(k), v); } catch (e) { /* ignore */ } }
  function sDel(k) { try { localStorage.removeItem(storageKey(k)); } catch (e) { /* ignore */ } }
  function cleanCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast visible';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
  }
  function rosterName(p) { return p.character ? p.character.name + ' (' + p.name + ')' : p.name; }
  function statusChip(p) {
    if (p.status === 'dead') return '<span class="chip dead">duch</span>';
    if (p.status === 'arrested') return '<span class="chip arrested">areszt</span>';
    return '';
  }
  function charCard(c, extra) {
    if (!c) return '';
    var attrs = c.attrs.map(function (a) { return '<span>' + esc(a.label) + '</span>'; }).join('');
    return '<div class="panel card-char"><h3>' + esc(c.name) + '</h3>' + (extra || '') +
      '<div class="muted" style="font-size:.8em">' + esc(c.who) + '</div><div class="attrs">' + attrs + '</div></div>';
  }
  function clueList(clues) {
    if (!clues.length) return '<p class="muted">Na razie brak poszlak.</p>';
    return clues.slice().reverse().map(function (c) {
      return '<div class="clue' + (c.source === 'duchy' ? ' ghosts' : '') + '"><div class="when">' + esc(c.clock) + '</div>' + esc(c.text) + '</div>';
    }).join('');
  }

  // ---------- server ----------
  var offset = 0;
  var bestRtt = 1e9;
  function serverNow() { return Date.now() + offset; }

  // Każde zapytanie ma limit czasu: zawieszone zapytanie (np. po zablokowaniu ekranu telefonu)
  // nie może zatrzymać dalszego odświeżania. To była przyczyna znikających przycisków.
  var CALL_TIMEOUT = 9000;
  function call(body) {
    var t0 = Date.now();
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, CALL_TIMEOUT);
    var req = fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json();
    });
    // Zapas, gdyby przeglądarka nie obsługiwała przerywania zapytań
    var guard = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, CALL_TIMEOUT + 1000); });
    return Promise.race([req, guard]).then(function (j) {
      clearTimeout(timer);
      var t1 = Date.now();
      var rtt = t1 - t0;
      bestRtt = Math.min(bestRtt * 1.15, 1e9);
      if (j && j.view && j.view.serverNow && rtt <= bestRtt) {
        bestRtt = rtt;
        offset = j.view.serverNow - (t0 + t1) / 2;
      }
      return j;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  var G = {
    code: null, token: null, view: null, version: 0, isScreen: false,
    channel: null, refreshing: false, refreshStarted: 0, pending: false, lastUpdate: 0, rtStatus: '', onView: function () {}
  };

  function applyResponse(j) {
    if (!j) return;
    if (j.view && (typeof j.version !== 'number' || j.version >= G.version)) {
      if (typeof j.version === 'number') G.version = j.version;
      G.view = j.view;
      G.lastUpdate = Date.now();
      G.onView(j.view);
    }
    if (j.error) toast(j.error);
  }

  function refresh(force) {
    if (!G.code) return;
    // Odświeżanie, które trwa podejrzanie długo, uznajemy za zawieszone
    if (G.refreshing && !force && Date.now() - G.refreshStarted < CALL_TIMEOUT + 2000) { G.pending = true; return; }
    G.refreshing = true;
    G.refreshStarted = Date.now();
    var tok = G.token || null;
    call({ op: 'view', code: G.code, token: tok || undefined }).then(function (j) {
      // Odpowiedź na zapytanie wysłane jeszcze przed dołączeniem (bez tokenu) jest nieaktualna:
      // nie może cofnąć telefonu do formularza „Jak masz na imię?”
      if ((G.token || null) !== tok) return;
      if (j && j.badToken && !G.isScreen) {
        G.token = null;
        sDel('token:' + G.code);
      }
      if (j && j.notFound) { G.onNotFound && G.onNotFound(); return; }
      applyResponse({ version: j.version, view: j.view });
    }).catch(function () {
      G.rtStatus = 'brak połączenia';
    }).then(function () {
      G.refreshing = false;
      if (G.pending) { G.pending = false; refresh(); }
    });
  }

  function act(action) {
    return call({ op: 'act', code: G.code, token: G.token || undefined, action: action }).then(function (j) {
      applyResponse(j);
      // Błąd serwera: odrysuj telefon od nowa, żeby przyciski znowu działały
      if (j && j.error && action.type !== 'task') rerenderPhone();
      return j;
    }).catch(function (e) {
      toast('Brak połączenia z serwerem. Spróbuj jeszcze raz.');
      if (action.type !== 'task') { rerenderPhone(); refresh(true); }
      throw e;
    });
  }

  function rerenderPhone() {
    if (G.isScreen || !G.view) return;
    setTimeout(function () { phoneKey = ''; phoneSig = ''; renderPhone(G.view); }, 30);
  }

  // Po powrocie do karty (np. odblokowaniu telefonu): świeży stan i ponowne połączenie Realtime
  function wakeUp() {
    if (!G.code) return;
    refresh(true);
    if (G.rtStatus !== 'połączono') subscribe();
  }

  function subscribe() {
    if (G.channel) client.removeChannel(G.channel);
    G.channel = client.channel('ow:' + G.code, { config: { broadcast: { self: false } } });
    G.channel.on('broadcast', { event: 'update' }, function (msg) {
      var v = msg.payload && msg.payload.v;
      if (!v || v > G.version) refresh();
    });
    G.channel.subscribe(function (status) {
      G.rtStatus = status === 'SUBSCRIBED' ? 'połączono' : 'łączenie…';
      if (status === 'SUBSCRIBED') refresh();
    });
  }

  // Zapasowe odświeżanie, gdy coś umknie
  setInterval(function () {
    if (G.code && Date.now() - G.lastUpdate > 5000) refresh();
  }, 2500);

  // Koniec fazy: ekran lub host zgłasza „tick”, serwer sprawdza czas
  var ticking = false;
  setInterval(function () {
    var v = G.view;
    if (!v || !v.endsAt || ticking || !G.code) return;
    var late = serverNow() - v.endsAt;
    var mayTick = G.isScreen || (v.me && v.me.isHost) || late > 4000;
    if (late > 250 && mayTick) {
      ticking = true;
      act({ type: 'tick' }).catch(function () {}).then(function () {
        setTimeout(function () { ticking = false; }, 1200);
      });
    }
  }, 400);

  // Liczniki
  setInterval(function () {
    var v = G.view;
    var els = document.querySelectorAll('.js-timer');
    for (var i = 0; i < els.length; i++) {
      if (!v || !v.endsAt) { els[i].textContent = ''; continue; }
      var left = v.endsAt - serverNow();
      els[i].textContent = fmtTime(left);
      els[i].className = 'timer js-timer' + (left < 10000 ? ' urgent' : '');
    }
  }, 200);

  // ---------- audio (ekran) ----------
  var audio = null;
  var SEQ = [220, 261.63, 329.63, 261.63, 196, 246.94, 293.66, 246.94];
  function initAudio() {
    if (audio) return audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    audio = { ctx: ctx, master: master, timer: null, step: 0, nextTime: 0, drones: [] };
    return audio;
  }
  function tone(freq, start, dur, type, vol) {
    if (!audio) return;
    var o = audio.ctx.createOscillator();
    var g = audio.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(audio.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }
  function startMusic() {
    if (!audio || audio.timer) return !!audio;
    if (audio.ctx.resume) audio.ctx.resume();
    [55, 82.41].forEach(function (f) {
      var o = audio.ctx.createOscillator();
      var g = audio.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(audio.master);
      o.start();
      audio.drones.push(o);
    });
    audio.nextTime = audio.ctx.currentTime + 0.1;
    audio.timer = setInterval(function () {
      while (audio.nextTime < audio.ctx.currentTime + 0.3) {
        tone(SEQ[audio.step % SEQ.length], audio.nextTime, 0.45, 'triangle', 0.35);
        if (audio.step % 8 === 0) tone(110, audio.nextTime, 1.6, 'sine', 0.3);
        audio.step++;
        audio.nextTime += 0.42;
      }
    }, 100);
    return true;
  }
  function stopMusic() {
    if (!audio || !audio.timer) return;
    clearInterval(audio.timer);
    audio.timer = null;
    audio.drones.forEach(function (o) { try { o.stop(); } catch (e) { /* ignore */ } });
    audio.drones = [];
  }
  function gong() {
    if (!audio) return;
    var t = audio.ctx.currentTime + 0.02;
    tone(98, t, 2.5, 'sine', 0.8);
    tone(196, t, 2, 'sine', 0.35);
    tone(293.66, t, 1.5, 'sine', 0.2);
  }

  // =====================================================================
  // EKRAN WSPÓLNY
  // =====================================================================
  var lastScreenPhase = '';

  function startScreen() {
    G.isScreen = true;
    G.onView = renderScreen;
    G.onNotFound = createRoom;
    document.body.className = 'mode-screen';
    $('screen').hidden = false;

    function startClick() {
      initAudio();
      startMusic();
      $('start-overlay').hidden = true;
    }
    $('btn-start').addEventListener('click', startClick);
    document.addEventListener('keydown', function (e) {
      if (!$('start-overlay').hidden && (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23)) {
        e.preventDefault();
        startClick();
      }
    });
    $('btn-start').focus();
    $('btn-music').addEventListener('click', function () {
      if (!audio) initAudio();
      if (audio && audio.timer) stopMusic(); else startMusic();
    });
    $('btn-new-room').addEventListener('click', function () {
      if (G.view && G.view.phase !== 'lobby' && G.view.phase !== 'end' && !confirmNewRoom()) return;
      createRoom();
    });

    var saved = sGet('screen');
    if (saved) {
      G.code = saved;
      subscribe();
      refresh();
    } else {
      createRoom();
    }
    setInterval(function () { $('s-status').textContent = 'Pokój ' + (G.code || '…') + ' · Realtime: ' + (G.rtStatus || '…'); }, 1000);
  }

  var newRoomArmed = 0;
  function confirmNewRoom() {
    // Bez okien dialogowych (blokują przeglądarki TV): drugie kliknięcie w 4 s potwierdza.
    if (Date.now() - newRoomArmed < 4000) return true;
    newRoomArmed = Date.now();
    toast('Gra trwa. Kliknij „Nowy pokój” jeszcze raz, żeby ją porzucić.');
    return false;
  }

  function createRoom() {
    call({ op: 'create' }).then(function (j) {
      if (!j || !j.code) { toast('Nie udało się utworzyć pokoju.'); return; }
      G.code = j.code;
      G.version = 0;
      sSet('screen', j.code);
      subscribe();
      applyResponse(j);
    }).catch(function () { toast('Brak połączenia z serwerem.'); });
  }

  function renderScreen(v) {
    if (v.phase !== lastScreenPhase) {
      if (v.phase === 'morning' || v.phase === 'verdict' || v.phase === 'end') gong();
      lastScreenPhase = v.phase;
    }
    var label = PHASE_LABEL[v.phase] || '';
    if (v.clock && v.phase !== 'end') label += ' · godzina ' + v.clock;
    $('s-label').textContent = label;
    $('btn-new-room').hidden = !(v.phase === 'lobby' || v.phase === 'end');

    var inGame = v.phase !== 'lobby' && v.phase !== 'end';
    $('screen').classList.toggle('is-end', v.phase === 'end');
    $('s-players').classList.toggle('compact', v.players.length > 7);
    $('s-players').innerHTML = v.players.map(function (p) {
      var right = statusChip(p);
      if (inGame && p.waiting) right += '<span class="chip wait">czeka</span>';
      else if (inGame && p.status === 'active') right += '<span class="chip ready">✓</span>';
      if (p.id === v.hostId && v.phase === 'lobby') right = '<span class="chip">host</span>';
      return '<li><span class="nm">' + esc(p.name) + (p.character ? '<span class="sub">' + esc(p.character.name) + '</span>' : '') + '</span><span class="chips">' + right + '</span></li>';
    }).join('') || '<li class="muted">Nikt jeszcze nie dołączył.</li>';
    renderManor(v, inGame);

    var m = $('s-main');
    var html = '';
    var joinUrl = location.origin + location.pathname + '?p=' + v.code;

    if (v.phase === 'lobby') {
      var n = v.players.length;
      var settings = 'Tryb: ' + (v.settings.mode === '30' ? 'ok. 30 min (4 rundy)' : 'ok. 1 h (6 rund)') +
        ' · śmierć graczy: ' + (v.settings.death ? 'włączona' : 'wyłączona') +
        ' · tempo: ' + (v.settings.calm ? 'spokojne' : 'normalne');
      html = '<div class="lobby-grid"><div id="qr"></div><div class="stack">' +
        '<p class="muted">Zeskanuj kod telefonem albo wejdź na</p><p class="big-text">' + esc(joinUrl.replace(/^https?:\/\//, '')) + '</p>' +
        '<div class="room-code">' + esc(v.code) + '</div>' +
        '<p class="big-text">' + (n < 3 ? 'Potrzeba co najmniej 3 graczy (jest ' + n + ').' : 'Graczy: ' + n + '. Host startuje grę z telefonu.') + '</p>' +
        (v.setup ? '<p>W tej grze: ' + esc(roleCountsText(v.setup)) + '</p>' : '') +
        '<p class="muted">' + esc(settings) + '</p><p class="muted">Po starcie wszyscy zobaczą zasady i role tej gry.</p></div></div>';
      m.innerHTML = html;
      if (window.qrcode) {
        var qr = window.qrcode(0, 'M');
        qr.addData(joinUrl);
        qr.make();
        $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      }
      return;
    }

    if (v.phase === 'rules') {
      html = v.setup ? rulesTv(v) : '';
    } else if (v.phase === 'prolog') {
      html = '<div class="stack"><div class="stack big-text">' + v.intro.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' +
        '<p class="muted">Gotowi: ' + waitLine(v) + '. Sprawdźcie na telefonach swoje role i kliknijcie „Gotowe”.</p>' +
        '<div class="mini-gallery wide">' + v.players.map(miniCard).join('') + '</div></div>';
    } else if (v.phase === 'night') {
      html = '<div class="stack center" style="padding-top:6vh"><h2 class="huge gold">Gasną światła</h2>' +
        '<p class="big-text">Godzina ' + esc(v.clock) + '. Wybierzcie na telefonach pokój i zagrajcie w mini-grę.<br>Nie zaglądajcie sobie w ekrany.</p>' +
        '<p class="huge">' + v.night.done + ' / ' + v.night.total + '</p><p class="muted">skończyło noc</p></div>';
    } else if (v.phase === 'morning') {
      html = '<div class="stack">' + (v.morning ? v.morning.lines.map(function (l, i) { return '<p class="' + (i === 0 ? 'muted' : 'big-text') + '">' + esc(l) + '</p>'; }).join('') : '') +
        (v.morning && v.morning.clues.length ? '<h2 class="gold" style="margin-top:.6em">Nowe poszlaki</h2>' + v.morning.clues.map(function (c) { return '<div class="clue big-text">' + esc(c) + '</div>'; }).join('') : '') +
        '<p class="muted">Przeczytali: ' + waitLine(v) + '. Kliknijcie „Przeczytane” na telefonach.</p></div>';
    } else if (v.phase === 'discussion') {
      html = board(v, 'Narada. Porównajcie poszlaki i alibi, część może być podrzucona. Gotowi do głosowania: ' + waitLine(v) + '.');
    } else if (v.phase === 'accusation') {
      html = board(v, 'Oskarżenie! Głosujcie na telefonach. Głosy: ' + waitLine(v) +
        (v.voting.lastHour ? '. Kogut pieje: tym razem trzeba kogoś wskazać.' : '.'));
    } else if (v.phase === 'verdict') {
      var vd = v.verdict || { text: '', lines: [] };
      html = '<div class="stack"><h2 class="huge gold">Werdykt</h2>' +
        (vd.lines || []).map(function (l) { return '<p class="big-text">' + esc(l) + '</p>'; }).join('') +
        '<p class="big-text"><b>' + esc(vd.text) + '</b></p>' +
        '<div class="verdict-tv"><div class="panel stack"><h2 class="gold">Kto na kogo głosował</h2>' + votesHtml(lastVote(v, 'accusation')) + '</div>' +
        '<div class="panel stack"><h2 class="gold">Co dalej</h2><p>Zabójca zostaje w areszcie do końca. Niewinny wychodzi po godzinie, a każdy, kto na niego głosował, traci 1 punkt (zabójca i złodziej dostają +1 za machlojkę).</p></div></div>' +
        '<p class="muted">Kliknijcie „Dalej” na telefonach: ' + waitLine(v) + '</p></div>';
    } else if (v.phase === 'dawn') {
      html = board(v, 'Świt. Ostateczne oskarżenie: głosują wszyscy, także aresztowani i duchy. Głosy: ' + waitLine(v) + '.');
    } else if (v.phase === 'end' && v.result) {
      html = endScreen(v);
    }
    m.innerHTML = html;
  }

  // Panel pod listą graczy: ofiary nocy i stan dworu
  function renderManor(v, inGame) {
    var box = $('s-manor');
    box.hidden = !inGame || v.phase === 'prolog' || v.phase === 'rules';
    if (box.hidden) return;
    var dead = v.npcs.filter(function (n) { return !n.alive; }).map(function (n) { return '<span>' + esc(n.name) + '</span>'; });
    v.players.forEach(function (p) { if (p.status === 'dead') dead.push('<span>' + esc(p.character ? p.character.name : p.name) + ' <span class="muted">(' + esc(p.name) + ')</span></span>'); });
    box.innerHTML = '<h2 class="gold">Ofiary</h2>' + (dead.length ? '<p class="victims">' + dead.join('') + '</p>' : '<p class="muted small">Na razie nikt.</p>') +
      '<p class="muted small">Pamiątek we dworze: ' + v.heirloomsLeft + '/6 · tablica duchów: ' + v.ghostProgress + '/3</p>';
  }

  function waitLine(v) {
    var done = v.actCount - v.waitingCount;
    return done + '/' + v.actCount;
  }

  function miniCard(p) {
    var c = p.character;
    if (!c) return '';
    return '<div class="panel mini"><div class="row" style="justify-content:space-between"><span class="gold">' + esc(c.name) + '</span>' + statusChip(p) + '</div>' +
      '<div class="muted">' + esc(p.name) + '</div><div class="attrs">' + c.attrs.map(function (a) { return '<span>' + esc(a.label) + '</span>'; }).join('') + '</div></div>';
  }

  var BOARD_MAX = 6;
  function board(v, headline) {
    var gallery = v.players.map(miniCard).join('');
    var clues = v.publicClues.length > BOARD_MAX ? v.publicClues.slice(-BOARD_MAX) : v.publicClues;
    return '<div class="stack"><p class="headline">' + esc(headline) + '</p><div class="board">' +
      '<div class="panel stack board-clues"><h2 class="gold">Tablica dowodów</h2><div class="clue-rows">' + clueRows(clues) + '</div>' +
      (v.publicClues.length > BOARD_MAX ? '<p class="muted small">Starsze poszlaki: telefon, zakładka Notes.</p>' : '') + '</div>' +
      '<div class="mini-gallery' + (v.players.length > 8 ? ' tight' : '') + '">' + gallery + '</div></div></div>';
  }

  // Zwięzłe wiersze dowodów na ekran TV: godzina w kolumnie, tekst w jednej linii
  function clueRows(clues) {
    if (!clues.length) return '<p class="muted">Na razie brak poszlak.</p>';
    return clues.slice().reverse().map(function (c) {
      return '<div class="clue-row' + (c.source === 'duchy' ? ' ghosts' : '') + '"><span class="when">' + esc(c.clock) + '</span><span>' + esc(c.text) + '</span></div>';
    }).join('');
  }

  function endScreen(v) {
    var r = v.result;
    var winner = r.winner === 'rodzina' ? 'Wygrywa Rodzina!' : 'Wygrywają Zabójcy!';
    var rank = '<table class="rank"><tr><th>Gracz</th><th>Postać</th><th>Rola</th><th>Pkt</th></tr>' + r.ranking.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.character) + '</td><td>' + esc(p.role) +
        (p.status !== 'active' ? ' <span class="chip ' + (p.status === 'dead' ? 'dead' : 'arrested') + '">' + (p.status === 'dead' ? 'duch' : 'areszt') + '</span>' : '') +
        '</td><td>' + p.points + '</td></tr>';
    }).join('') + '</table>';
    var titles = r.titles.map(function (t) { return '<p><span class="gold">' + esc(t.title) + ':</span> ' + esc(t.who) + ' <span class="muted">(' + esc(t.why) + ')</span></p>'; }).join('');
    var neutral = r.neutralWinners.length ? '<p>Wygrywają też: ' + esc(r.neutralWinners.join(', ')) + '</p>' : '';
    // Przy wielu graczach pomijamy listę „kto był w którym pokoju”, żeby wszystko zmieściło się na ekranie
    var withRooms = r.ranking.length <= 6;
    var recon = r.reconstruction.map(function (h) {
      return '<p><b>' + esc(h.clock) + '</b> · ' + (h.victim ? 'ofiara: ' + esc(h.victim) + ', ' : '') +
        (h.executor ? 'sprawca: ' + esc(h.executor) : 'bez zamachu') +
        (h.failed ? ' (zamach nieudany: ' + (h.failed === 'lekarz' ? 'lekarz' : 'tłok') + ')' : '') +
        (h.theft ? ' · ' + esc(h.theft) : '') + (h.arrested ? ' · areszt: ' + esc(h.arrested) : '') +
        (withRooms ? '<br>' + esc(h.rooms.join(' · ')) : '') + '</p>';
    }).join('');
    return '<div class="stack end-wrap"><div class="row end-head"><h2 class="huge gold">' + winner + '</h2><p class="big-text">' + esc(r.reason) + '</p></div>' + neutral +
      '<div class="end-grid"><div class="panel">' + rank + '</div>' +
      '<div class="panel stack"><h2 class="gold">Tytuły</h2>' + (titles || '<p class="muted">Brak.</p>') + '<p class="muted small">Host może zacząć nową grę z telefonu.</p></div>' +
      '<div class="panel recon stack"><h2 class="gold">Rekonstrukcja nocy</h2>' + recon + '</div></div></div>';
  }

  // =====================================================================
  // TELEFON
  // =====================================================================
  var phoneKey = '';
  var phoneSig = '';
  var phonePhase = '';
  var currentGame = null;

  function startPhone(code) {
    var reloadReported = false;
    document.body.className = 'mode-phone';
    $('phone').hidden = false;
    G.code = code;
    G.token = sGet('token:' + code);
    G.onView = function (v) {
      renderPhone(v);
      if (!reloadReported && v.me) {
        reloadReported = true;
        if (v.phase !== 'lobby' && v.phase !== 'end') report('page-load', null);
      }
    };
    G.onNotFound = function () {
      $('p-now').innerHTML = '<div class="panel">Nie ma pokoju ' + esc(code) + '. Sprawdź kod na ekranie gry.</div>';
    };
    var tabs = $('p-tabs').querySelectorAll('button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { showTab(this.getAttribute('data-tab')); });
    }
    subscribe();
    refresh();
    requestWakeLock();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { requestWakeLock(); wakeUp(); }
    });
    window.addEventListener('focus', wakeUp);
    window.addEventListener('online', wakeUp);
  }

  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* ignore */ });
  }

  function showTab(id) {
    ['p-now', 'p-notes', 'p-char'].forEach(function (t) { $(t).hidden = t !== id; });
    var tabs = $('p-tabs').querySelectorAll('button');
    for (var i = 0; i < tabs.length; i++) tabs[i].className = tabs[i].getAttribute('data-tab') === id ? 'on' : '';
  }

  function nightStep(v) {
    var n = v.me && v.me.night;
    if (!n) return 'none';
    var c = n.choice;
    if (n.needsRoom) {
      if (!c.room || (n.targetKind && !c.target) || (n.needsWatch && !c.watch)) return 'choose';
    }
    if (n.follows && !c.target) return 'choose';
    if (!c.task) return 'task';
    return 'wait';
  }

  // Zgłoszenia problemów z telefonów trafiają do logów funkcji `game` (najwyżej 8 na otwarcie strony)
  var reportsLeft = 8;
  function report(kind, detail) {
    if (reportsLeft <= 0 || !G.code) return;
    reportsLeft--;
    var v = G.view;
    var info = {
      kind: kind, code: G.code, name: v && v.me ? v.me.name : null, phase: v ? v.phase : null, hour: v ? v.hour : null,
      version: G.version, shown: $('p-now') ? $('p-now').getAttribute('data-key') : null, rt: G.rtStatus,
      sinceView: G.lastUpdate ? Date.now() - G.lastUpdate : null, ua: navigator.userAgent, detail: detail
    };
    try { call({ op: 'log', code: G.code, log: info }).catch(function () {}); } catch (e) { /* ignore */ }
  }

  // Klucz ekranu: zmienia się, gdy telefon musi pokazać coś nowego (faza, godzina, krok nocy, „gotowe”)
  function phoneKeyFor(v) {
    var key = v.phase + ':' + v.hour;
    if (v.phase === 'night') key += ':' + nightStep(v);
    if (v.phase === 'prolog' || v.phase === 'rules') key += ':' + v.me.ready;
    return key;
  }

  // Błąd przy rysowaniu nie może zostawić starego ekranu na stałe: następna aktualizacja rysuje od nowa
  function renderPhone(v) {
    try {
      renderPhoneInner(v);
    } catch (e) {
      phoneSig = '';
      phoneKey = '';
      report('render-error', String(e && e.stack || e).slice(0, 600));
    }
  }

  // Strażnik: jeśli ekran telefonu nie pasuje do stanu gry dłużej niż 3 s, rysujemy go od nowa
  var staleSince = 0;
  setInterval(function () {
    if (G.isScreen || !G.view || !G.view.me || !$('p-now')) return;
    var want = phoneKeyFor(G.view);
    var shown = $('p-now').getAttribute('data-key');
    if (shown === want) { staleSince = 0; return; }
    if (!staleSince) { staleSince = Date.now(); return; }
    if (Date.now() - staleSince < 3000) return;
    staleSince = 0;
    report('stale-screen', { want: want, shown: shown });
    phoneKey = '';
    phoneSig = '';
    renderPhone(G.view);
  }, 1500);

  function renderPhoneInner(v) {
    var me = v.me;
    $('p-label').textContent = PHASE_LABEL[v.phase] + (v.clock && v.phase !== 'end' ? ' ' + v.clock : '');
    $('p-sub').textContent = 'Pokój ' + v.code + (me ? ' · ' + me.name + (me.isHost ? ' (host)' : '') : '');
    $('p-tabs').hidden = !me || v.phase === 'lobby';
    if (!me && v.phase === 'lobby') { phoneKey = 'join'; if ($('p-now').getAttribute('data-key') !== 'join') renderJoin(v); return; }
    if (!me) { setNow('notjoined', '<div class="panel">Gra w pokoju ' + esc(v.code) + ' już trwa. Dołączyć można tylko w lobby, przed startem.</div>'); return; }

    // Nic się nie zmieniło (np. zapasowe odświeżanie): nie przerysowujemy, żeby nie gubić stuknięć
    var sig = JSON.stringify(v, function (k, val) { return k === 'serverNow' ? undefined : val; });
    if (sig === phoneSig) return;
    phoneSig = sig;

    renderNotes(v);
    renderChar(v);
    if (v.phase !== phonePhase) { phonePhase = v.phase; showTab('p-now'); }
    $('p-hint').textContent = phoneHint(v);

    var key = phoneKeyFor(v);
    var dynamic = ['lobby', 'morning', 'discussion', 'accusation', 'verdict', 'dawn', 'end'].indexOf(v.phase) >= 0;
    if (!dynamic && key === phoneKey) {
      if (v.phase === 'night') updateNightWait(v);
      return;
    }
    if (key !== phoneKey && currentGame) { currentGame.stop(); currentGame = null; }
    phoneKey = key;

    if (v.phase === 'lobby') renderLobby(v);
    else if (v.phase === 'rules') renderRules(v);
    else if (v.phase === 'prolog') renderProlog(v);
    else if (v.phase === 'night') renderNight(v);
    else if (v.phase === 'morning') renderMorning(v);
    else if (v.phase === 'discussion') renderDiscussion(v);
    else if (v.phase === 'accusation' || v.phase === 'dawn') renderVote(v);
    else if (v.phase === 'verdict') renderVerdict(v);
    else if (v.phase === 'end') renderEnd(v);
  }

  function setNow(key, html) {
    var n = $('p-now');
    n.setAttribute('data-key', key);
    n.innerHTML = html;
    return n;
  }

  function hostBar(v) {
    if (!v.me || !v.me.isHost || v.phase === 'lobby' || v.phase === 'end') return '';
    return '<button class="secondary" data-act="skip" style="font-size:.8em">Host: pomiń tę fazę</button>';
  }
  function bindSkip(root) {
    var b = root.querySelector('[data-act="skip"]');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'skip' }).catch(function () {}); });
  }

  function renderJoin(v) {
    var root = setNow('join', '<form id="join-form" class="stack"><p>Dołączasz do pokoju <b>' + esc(v.code) + '</b>.</p>' +
      '<label class="muted" for="name-input">Jak masz na imię?</label>' +
      '<input id="name-input" maxlength="16" autocomplete="nickname" placeholder="np. Ania">' +
      '<button class="big-btn" type="submit">Dołącz</button></form>');
    var input = root.querySelector('#name-input');
    input.value = sGet('name') || '';
    root.querySelector('#join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = input.value.trim().slice(0, 16);
      if (!name) { toast('Wpisz imię.'); return; }
      sSet('name', name);
      var btn = this.querySelector('button');
      btn.disabled = true;
      call({ op: 'act', code: G.code, action: { type: 'join', name: name } }).then(function (j) {
        if (j.joined) {
          G.token = j.joined.token;
          sSet('token:' + G.code, G.token);
          phoneKey = '';
          phoneSig = '';
          applyResponse(j);
          refresh();
        } else {
          btn.disabled = false;
          toast(j.error || 'Nie udało się dołączyć.');
        }
      }).catch(function () { btn.disabled = false; toast('Brak połączenia z serwerem.'); });
    });
  }

  function renderLobby(v) {
    var me = v.me;
    var n = v.players.length;
    var html = '<div class="panel stack"><h2 class="gold">Czekamy na start</h2><p>Graczy: ' + n + '</p><div class="row">' +
      v.players.map(function (p) { return '<span class="chip">' + esc(p.name) + '</span>'; }).join('') + '</div></div>';
    if (me.isHost) {
      var s = v.settings;
      html += '<div class="panel stack"><h2 class="gold">Ustawienia (host)</h2>' +
        '<p class="muted">Długość</p><div class="grid2">' +
        '<button data-set="mode" data-val="30" class="' + (s.mode === '30' ? 'chosen' : 'secondary') + '">ok. 30 min (4 rundy)</button>' +
        '<button data-set="mode" data-val="60" class="' + (s.mode === '60' ? 'chosen' : 'secondary') + '">ok. 1 h (6 rund)</button></div>' +
        '<p class="muted">Śmierć graczy' + (n < 5 ? ' (od 5 graczy)' : '') + '</p><div class="grid2">' +
        '<button data-set="death" data-val="0" class="' + (!s.death ? 'chosen' : 'secondary') + '">Wyłączona</button>' +
        '<button data-set="death" data-val="1" class="' + (s.death ? 'chosen' : 'secondary') + '"' + (n < 5 ? ' disabled' : '') + '>Włączona</button></div>' +
        '<p class="muted">Tempo nocy (spokojne: 3 min zamiast 2 i łatwiejsze mini-gry)</p><div class="grid2">' +
        '<button data-set="calm" data-val="0" class="' + (!s.calm ? 'chosen' : 'secondary') + '">Normalne</button>' +
        '<button data-set="calm" data-val="1" class="' + (s.calm ? 'chosen' : 'secondary') + '">Spokojne</button></div>' +
        '<button id="btn-go" class="big-btn"' + (n < 3 ? ' disabled' : '') + '>' + (n < 3 ? 'Potrzeba 3 graczy' : 'Start gry') + '</button></div>';
    } else {
      html += '<p class="muted">Host ustawia grę i ją startuje. Wszystko inne zobaczysz na ekranie gry.</p>';
    }
    var root = setNow(phoneKey, html);
    var setBtns = root.querySelectorAll('[data-set]');
    for (var i = 0; i < setBtns.length; i++) {
      setBtns[i].addEventListener('click', function () {
        var k = this.getAttribute('data-set');
        var val = this.getAttribute('data-val');
        var a = { type: 'settings' };
        if (k === 'mode') a.mode = val; else a[k] = val === '1';
        act(a).catch(function () {});
      });
    }
    var go = root.querySelector('#btn-go');
    if (go) go.addEventListener('click', function () { go.disabled = true; act({ type: 'start' }).catch(function () { go.disabled = false; }); });
  }

  function roleBlock(me) {
    if (!me.role) return '';
    var r = me.role;
    var faction = r.faction === 'rodzina' ? 'Rodzina' : r.faction === 'zabojcy' ? 'Zabójcy' : 'Neutralni';
    return '<h2 class="gold" style="font-size:1.6em">' + esc(r.name) + '</h2><p class="muted">Frakcja: ' + faction + '</p>' +
      '<p><b>Co robisz:</b> ' + esc(r.does) + '</p><p><b>Jak wygrywasz:</b> ' + esc(r.wins) + '</p>';
  }
  function revealCard(inner) {
    return '<div class="reveal"><p class="hint">Przytrzymaj palec, żeby zobaczyć rolę i sekret.<br><span class="muted">Zasłoń ekran przed innymi.</span></p><div class="hidden-part stack">' + inner + '</div></div>';
  }
  function bindReveal(root) {
    var cards = root.querySelectorAll('.reveal');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        function open(e) { e.preventDefault(); card.className = 'reveal open'; }
        function close() { card.className = 'reveal'; }
        card.addEventListener('pointerdown', open);
        card.addEventListener('pointerup', close);
        card.addEventListener('pointerleave', close);
        card.addEventListener('pointercancel', close);
        card.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      })(cards[i]);
    }
  }
  function secretBlock(me) {
    var c = me.character;
    if (!c) return '';
    var info = me.notes.filter(function (n) { return n.clock === 'Kolacja'; }).map(function (n) { return '<p>' + esc(n.text) + '</p>'; }).join('');
    return '<p><b>Twoja postać:</b> ' + esc(c.name) + '</p><p><b>Sekret:</b> ' + esc(c.secret) + '</p>' + info;
  }

  function renderProlog(v) {
    var me = v.me;
    var html = '<p>Kolacja we dworze Wolańskich. Poznaj swoją rolę, a potem kliknij „Gotowe”.</p>' +
      revealCard(roleBlock(me) + secretBlock(me)) + charCard(me.character, '<div class="muted">Tak widzą cię inni</div>') +
      (me.ready ? '<p class="muted center">Czekamy na pozostałych…</p>' : '<button id="btn-ready" class="big-btn">Gotowe</button>') + hostBar(v);
    var root = setNow(phoneKey, html);
    bindReveal(root);
    bindSkip(root);
    var b = root.querySelector('#btn-ready');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'ready' }).catch(function () { b.disabled = false; }); });
  }

  function renderChar(v) {
    var me = v.me;
    var log = (me.pointsLog || []).slice().reverse().map(function (e) {
      return '<div><span class="' + (e.pts < 0 ? 'minus' : 'plus') + '">' + (e.pts > 0 ? '+' : '') + e.pts + '</span><span>' + esc(e.why) + (e.clock ? ' <span class="muted">· ' + esc(e.clock) + '</span>' : '') + '</span></div>';
    }).join('');
    var html = revealCard(roleBlock(me) + secretBlock(me)) + charCard(me.character, '<div class="muted">Tak widzą cię inni</div>') +
      '<div class="panel stack"><h2 class="gold">Twoje punkty: ' + me.points + '</h2>' +
      (me.role && me.role.id === 'zlodziej' ? '<p class="muted">Pamiątki: ' + me.heirlooms + '/3</p>' : '') +
      (log ? '<div class="pts-log">' + log + '</div>' : '<p class="muted">Na razie zero. Punkty dostajesz za udane mini-gry, trafne głosy i wygraną. Tracisz za głos na niewinną osobę.</p>') + '</div>';
    var root = $('p-char');
    root.innerHTML = html;
    bindReveal(root);
  }

  function renderNotes(v) {
    var me = v.me;
    var notes = me.notes.slice().reverse().map(function (n) {
      return '<div class="note' + (n.kind === 'info' ? ' info' : '') + '"><div class="when">' + esc(n.clock) + '</div>' + esc(n.text) + '</div>';
    }).join('') || '<p class="muted">Na razie pusto. Poszlaki dostajesz za udane mini-gry, jako świadek ataku albo dzięki roli.</p>';
    $('p-notes').innerHTML = '<h2 class="gold">Twoje poszlaki</h2><p class="muted" style="font-size:.85em">Tylko dla ciebie. Sam decydujesz, czy i komu je zdradzisz.</p>' + notes +
      '<h2 class="gold" style="margin-top:.5em">Tablica dowodów</h2>' + clueList(v.publicClues) +
      '<h2 class="gold" style="margin-top:.5em">Postacie przy stole</h2>' +
      v.players.map(function (p) { return charCard(p.character, '<div class="row"><span class="muted">' + esc(p.name) + '</span>' + statusChip(p) + '</div>'); }).join('') +
      ((v.voteHistory || []).length ? '<h2 class="gold" style="margin-top:.5em">Głosowania</h2>' + v.voteHistory.slice().reverse().map(function (h) {
        return '<div class="panel stack"><div class="muted">' + esc(h.clock) + ' · ' + (h.kind === 'dawn' ? 'świt' : 'oskarżenie') + (h.arrested ? ' · areszt: ' + esc(h.arrested) : '') + '</div>' + votesHtml(h) + '</div>';
      }).join('') : '') +
      (v.setup ? '<h2 class="gold" style="margin-top:.5em">Zasady</h2>' + rulesPanel(v.setup) : '');
  }

  // ---------- zasady gry (ekran przed startem i telefon) ----------
  var ROLE_SHORT = {
    zabojca: 'co noc wybiera ofiarę, idzie za nią do jej pokoju i podrzuca fałszywe tropy',
    zlodziej: 'kradnie pamiątki, gdy jest w pokoju z najwyżej 1 osobą',
    blazen: 'wygrywa, jeśli trafi do aresztu',
    detektyw: 'dostaje podwójne poszlaki za mini-gry',
    kamerdyner: 'widzi, kto był w obserwowanym pokoju',
    lekarz: 'co noc chroni jedną osobę przed zabójcą',
    krewny: 'gra w mini-gry, zbiera poszlaki i szuka zabójcy'
  };
  function hasRole(setup, id) { return setup.roles.some(function (r) { return r.id === id; }); }
  function roleCountsText(setup) {
    return setup.roles.map(function (r) { return r.count + '× ' + r.name; }).join(', ');
  }
  function nightMin(setup) { var m = setup.nightSeconds / 60; return (m % 1 ? m.toFixed(1).replace('.', ',') : m) + ' min'; }

  // Treść zasad; short = wersja na TV
  function rulesData(setup, short) {
    var thief = hasRole(setup, 'zlodziej');
    var hour = [
      'Noc (' + nightMin(setup) + '): na telefonie wybierasz pokój i grasz w mini-grę. Udana mini-gra: +1 punkt i poszlaka. ' +
        (short ? 'Rezygnacja albo koniec czasu: nic.' : 'Jeśli zrezygnujesz albo nie zdążysz, nic nie dostajesz, a pokój wylosuje się sam.'),
      'Poranek: co się stało w nocy i nowe poszlaki. Kliknij „Przeczytane”.',
      'Narada: rozmawiacie przy stole. Kto chce przejść do głosowania, klika „Chcę głosować”.',
      'Oskarżenie: głosujecie na telefonach. Ponad połowa głosów = areszt.',
      'Werdykt: wszyscy widzą, kto na kogo głosował. Kliknij „Dalej”.'
    ];
    var jail = [
      'Zabójca w areszcie zostaje tam do końca. Każdy inny wychodzi po godzinie.',
      'Głos na osobę, która niesłusznie trafiła do aresztu: −1 punkt. Zabójca i złodziej dostają za to +1 (machlojka).',
      'W areszcie grasz w mini-gry, ale nie wybierasz pokoju i głosujesz dopiero o świcie.'
    ];
    if (thief) jail.push('Złapany złodziej oddaje łupy, a głosujący na niego dostają +1.');
    jail.push(setup.death
      ? 'Ofiara zabójcy zostaje duchem: gra w mini-gry i głosuje o świcie.' + (hasRole(setup, 'lekarz') ? ' Lekarz może ją uratować.' : '')
      : 'Zabójcy polują na służbę i gości spoza stołu, więc nikt z graczy nie ginie.');
    jail.push('Co 3 mini-gry ' + (setup.death ? 'duchów i ' : '') + 'aresztantów odsłaniają prawdziwą poszlakę. Część poszlak na tablicy podrzuca zabójca.');
    var group = 'W grupie bezpieczniej: ' + [
      setup.death ? 'przy 3 lub więcej innych osobach w pokoju zamach się nie udaje' : null,
      thief ? 'złodziej nic nie ukradnie, gdy jest z nim więcej niż 1 osoba' : null,
      'świadkowie ataku widzą cechę sprawcy',
      hasRole(setup, 'kamerdyner') ? 'kamerdyner wie, kto naprawdę był w pokoju' : null
    ].filter(Boolean).join(', ') + '. Ale zabójca też może iść z wami.';
    var talk = [
      'Gadajcie cały czas, także w nocy: umawiajcie się, pytajcie o alibi, oskarżajcie.',
      'Wybór pokoju widzi tylko twój telefon, więc każdy może skłamać, gdzie był.',
      'Telefonu nikomu nie pokazujecie. Liczy się tylko to, co mówicie.',
      group
    ];
    var points = [
      '+1 udana mini-gra',
      '+2 głos na zabójcę, który trafił do aresztu (także o świcie)',
      '−1 głos na niewinną osobę, która trafiła do aresztu',
      '+1 machlojka dla zabójcy i złodzieja za taki głos',
      thief ? '+2 kradzież (złodziej) · +1 złapanie złodzieja' : null,
      '+5 wygrana twojej strony' + (thief || hasRole(setup, 'blazen') ? ' (złodziej: 3 pamiątki, błazen: areszt)' : ''),
      '+2 przetrwanie do końca (zabójca: jeśli go nie złapano)'
    ].filter(Boolean);
    return { hour: hour, jail: jail, talk: talk, points: points };
  }

  function rulesTv(v) {
    var st = v.setup;
    var d = rulesData(st, true);
    var li = function (t) { return '<li>' + esc(t) + '</li>'; };
    var roles = st.roles.map(function (r) {
      return '<li class="role-line"><b>' + r.count + '× ' + esc(r.name) + '</b>: ' + esc(ROLE_SHORT[r.id] || r.does) + '</li>';
    }).join('');
    return '<div class="stack"><p class="headline">Zasady tej gry. Przeczytajcie je też na telefonach i kliknijcie „Rozumiem”: ' + waitLine(v) + '</p>' +
      '<div class="rules-tv">' +
      '<div class="panel stack"><h2 class="gold">Role w tej grze</h2><ul>' + roles + '</ul>' +
      '<p class="muted">Rodzina wygrywa, gdy złapie wszystkich zabójców. Zabójcy, gdy o świcie choć jeden jest na wolności.</p></div>' +
      '<div class="panel stack"><h2 class="gold">Jedna godzina (' + st.hours + ' godzin do świtu)</h2><ol>' + d.hour.map(li).join('') + '</ol>' +
      '<p class="muted">O świcie ostatnie głosowanie: głosują wszyscy, także aresztanci' + (st.death ? ' i duchy' : '') + '.</p></div>' +
      '<div class="panel stack"><h2 class="gold">Areszt i rozmowy</h2><ul>' + d.jail.slice(0, 2).map(li).join('') + '</ul>' +
      '<p class="slogan">„Gadajcie, umawiajcie się, kłamcie. Telefonu nikomu nie pokazujecie. W grupie bezpieczniej, ale nie wiecie, kto w niej jest.”</p>' +
      '<p class="muted">Punktację i swoje punkty każdy widzi na telefonie.</p></div>' +
      '</div></div>';
  }

  function rulesPanel(st) {
    var d = rulesData(st, false);
    var li = function (t) { return '<li>' + esc(t) + '</li>'; };
    return '<div class="panel stack rules"><p>W tej grze: ' + esc(roleCountsText(st)) + '.</p>' +
      '<h3>Jedna godzina</h3><ol>' + d.hour.map(li).join('') + '</ol><h3>Areszt</h3><ul>' + d.jail.map(li).join('') + '</ul>' +
      '<h3>Rozmowy</h3><ul>' + d.talk.map(li).join('') + '</ul><h3>Punkty</h3><ul>' + d.points.map(li).join('') + '</ul></div>';
  }

  function renderRules(v) {
    var me = v.me;
    var st = v.setup;
    var d = rulesData(st, false);
    var li = function (t) { return '<li>' + esc(t) + '</li>'; };
    var roles = st.roles.map(function (r) {
      return '<li class="role-line"><b>' + r.count + '× ' + esc(r.name) + '</b>: ' + esc(r.does) + ' ' + esc(r.wins) + '</li>';
    }).join('');
    var html = '<div class="panel stack rules"><h2 class="gold">Zasady tej gry</h2>' +
      '<p>Graczy: ' + st.players + '. Godzin do świtu: ' + st.hours + '. Swoją rolę poznasz zaraz po tym ekranie.</p>' +
      '<h3>Role w tej grze</h3><ul>' + roles + '</ul>' +
      '<h3>Jedna godzina gry</h3><ol>' + d.hour.map(li).join('') + '</ol>' +
      '<p>Po ' + st.hours + ' godzinach przychodzi świt: ostatnie głosowanie, w którym głosują wszyscy. Jeśli wskażecie zabójcę, wygrywa rodzina.</p>' +
      '<h3>Areszt, duchy, poszlaki</h3><ul>' + d.jail.map(li).join('') + '</ul>' +
      '<h3>Rozmowy</h3><ul>' + d.talk.map(li).join('') + '</ul>' +
      '<h3>Punkty</h3><ul>' + d.points.map(li).join('') + '</ul>' +
      '<p class="muted">Swoje punkty z opisem, za co są, widzisz w zakładce Postać. Zasady są też w zakładce Notes.</p></div>' +
      (me.ready ? '<p class="muted center">Czekamy na pozostałych… (' + waitLine(v) + ')</p>' : '<button id="btn-ready" class="big-btn">Rozumiem</button>') + hostBar(v);
    var root = setNow(phoneKey, html);
    bindSkip(root);
    bindReady(root);
  }

  // Jedna linijka „co teraz i co, jeśli tego nie zrobisz” nad treścią fazy
  function phoneHint(v) {
    var me = v.me;
    if (!me) return '';
    var schemer = me.role && (me.role.id === 'zabojca' || me.role.id === 'zlodziej');
    switch (v.phase) {
      case 'rules': return 'Przeczytaj zasady do końca i kliknij „Rozumiem” na dole.';
      case 'prolog': return 'Przytrzymaj kartę, żeby zobaczyć rolę i sekret. Nikomu nie pokazuj telefonu. Potem „Gotowe”.';
      case 'night': {
        var step = nightStep(v);
        if (me.status !== 'active') return 'Grasz tylko w mini-grę. Co 3 udane mini-gry duchów i aresztantów odsłaniają poszlakę na tablicy.';
        if (step === 'choose' && me.night && me.night.follows) return 'Wybierz ofiarę. Pójdziesz tam, gdzie ona spędza noc, i tam zagrasz w mini-grę.';
        if (step === 'choose') {
          var extra = me.role && me.role.id === 'lekarz' ? ' Wybierz, kogo chronisz.' : me.role && me.role.id === 'kamerdyner' ? ' Wybierz, który pokój obserwujesz.' : '';
          return 'Wybierz pokój, w którym zagrasz w mini-grę.' + extra + ' Jeśli nie zdążysz do końca nocy, pokój wylosuje się sam.';
        }
        if (step === 'task' && me.role && me.role.id === 'zabojca') return 'Udana mini-gra: +1 punkt i możesz podrzucić fałszywy trop. „Rezygnuję” albo koniec czasu: nic nie dostajesz.';
        if (step === 'task') return 'Udana mini-gra: +1 punkt i poszlaka. „Rezygnuję” albo koniec czasu: nic nie dostajesz.';
        return 'Czekamy, aż wszyscy skończą noc. Możecie rozmawiać.';
      }
      case 'morning': return 'Przeczytaj, co się stało, i swoje nowe poszlaki (są też w zakładce Notes). Potem „Przeczytane”.';
      case 'discussion':
        if (me.status === 'arrested') return 'W areszcie możesz mówić, ale nie głosujesz. Jeśli nie jesteś zabójcą, wyjdziesz po godzinie.';
        if (me.status === 'dead') return 'Jako duch możesz mówić, ale głosujesz dopiero o świcie.';
        return 'Rozmawiajcie: mówcie prawdę albo kłamcie. Kiedy chcesz przejść do głosowania, kliknij „Chcę głosować”.';
      case 'accusation':
        if (me.status !== 'active') return 'Teraz nie głosujesz. Głosujesz o świcie.';
        return 'Ponad połowa głosów = areszt. Głosy będą jawne. Głos na niewinną osobę, która trafi do aresztu: ' + (schemer ? '+1 dla ciebie (machlojka).' : '−1 punkt.');
      case 'verdict': return 'Zobacz, kto na kogo głosował, i kliknij „Dalej”.';
      case 'dawn': return 'Ostatnie głosowanie. Wskażcie zabójcę, a wygra rodzina. Głos na zabójcę: +2, na niewinną osobę: ' + (schemer ? '+1 dla ciebie (machlojka).' : '−1.');
      default: return '';
    }
  }

  // Jawne głosy: kto na kogo
  function votesHtml(vote) {
    if (!vote) return '';
    var rows = vote.rows.map(function (r) {
      return '<div class="vrow' + (vote.arrested === r.target ? ' arrested' : '') + '"><b>' + esc(r.target) + ' (' + r.voters.length + ')</b><span>' + esc(r.voters.join(', ')) + '</span></div>';
    }).join('');
    if (vote.none.length) rows += '<div class="vrow"><b>Nikogo (' + vote.none.length + ')</b><span>' + esc(vote.none.join(', ')) + '</span></div>';
    return '<div class="votes">' + (rows || '<p class="muted">Nikt nie zagłosował.</p>') + '</div>';
  }
  function lastVote(v, kind) {
    var h = v.voteHistory || [];
    for (var i = h.length - 1; i >= 0; i--) if (h[i].kind === kind && h[i].clock === v.clock) return h[i];
    return null;
  }

  // ---------- noc ----------
  function renderNight(v) {
    var me = v.me;
    var n = me.night;
    var step = nightStep(v);
    if (step === 'choose') return renderNightChoose(v);
    if (step === 'task') return renderNightTask(v);
    var room = n.choice.room ? roomName(n.choice.room) : null;
    setNow(phoneKey, '<div class="panel stack center"><h2 class="gold">Noc mija…</h2>' +
      (room ? '<p>Spędzasz noc: <b>' + esc(room) + '</b></p>' : n.follows ? '<p>Idziesz za: <b>' + esc(targetLabel(n)) + '</b></p>' : '') +
      '<p class="muted">' + (n.choice.task === 'ok' ? 'Mini-gra udana.' : 'Mini-gra nieudana.') + ' Czekamy na pozostałych.</p>' +
      '<p id="night-progress" class="muted"></p></div>' + hostBar(v));
    bindSkip($('p-now'));
    updateNightWait(v);
  }
  function updateNightWait(v) {
    var el = $('night-progress');
    if (el && v.night) el.textContent = 'Skończyło: ' + v.night.done + '/' + v.night.total;
  }
  function roomName(id) {
    for (var i = 0; i < ROOMS.length; i++) if (ROOMS[i].id === id) return ROOMS[i].name;
    return id;
  }

  function renderNightChoose(v) {
    var n = v.me.night;
    var sel = { room: n.choice.room, target: n.choice.target, watch: n.choice.watch };
    var html = '<div class="stack"><h2 class="gold">Noc, godzina ' + esc(v.clock) + '</h2>';
    if (!n.follows) {
      html += '<p class="muted">Gdzie spędzasz noc? W tym pokoju zagrasz w mini-grę.</p><div class="grid2" data-group="room">' +
        ROOMS.map(function (r) { return '<button class="secondary" data-val="' + r.id + '">' + esc(r.name) + '</button>'; }).join('') + '</div>';
    }
    if (n.needsWatch) {
      html += '<p class="muted">Który pokój obserwujesz? Rano dowiesz się, kto tam był.</p><div class="grid2" data-group="watch">' +
        ROOMS.map(function (r) { return '<button class="secondary" data-val="' + r.id + '">' + esc(r.name) + '</button>'; }).join('') + '</div>';
    }
    if (n.targetKind) {
      var ask = n.targetKind !== 'kill' ? 'Kogo chronisz tej nocy?'
        : n.follows && v.settings && v.settings.death ? 'Kogo dziś atakujesz? Pokój, do którego pójdziesz, poznasz rano.'
        : 'Kogo dziś atakujesz? W nawiasie pokój, w którym ta osoba spędza noc.';
      html += '<p class="muted">' + ask + '</p><div class="choice-list" data-group="target">' +
        n.targets.map(function (t) { return '<button class="secondary" data-val="' + esc(t.id) + '">' + esc(t.label) + '</button>'; }).join('') + '</div>';
    }
    html += '<button id="btn-night-go" class="big-btn" disabled>Dalej: mini-gra</button></div>';
    var root = setNow(phoneKey, html + hostBar(v));
    bindSkip(root);
    function refreshSel() {
      ['room', 'watch', 'target'].forEach(function (g) {
        var box = root.querySelector('[data-group="' + g + '"]');
        if (!box) return;
        var bs = box.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute('data-val') === sel[g] ? 'chosen' : 'secondary';
      });
      var ok = (n.follows || !!sel.room) && (!n.needsWatch || !!sel.watch) && (!n.targetKind || !!sel.target);
      root.querySelector('#btn-night-go').disabled = !ok;
    }
    var groups = root.querySelectorAll('[data-group]');
    for (var i = 0; i < groups.length; i++) {
      (function (box) {
        box.addEventListener('click', function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          sel[box.getAttribute('data-group')] = b.getAttribute('data-val');
          refreshSel();
        });
      })(groups[i]);
    }
    refreshSel();
    root.querySelector('#btn-night-go').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      var a = { type: 'night' };
      if (!n.follows) a.room = sel.room;
      if (n.needsWatch) a.watch = sel.watch;
      if (n.targetKind) a.target = sel.target;
      act(a).then(function (j) { if (j && j.error) btn.disabled = false; }).catch(function () { btn.disabled = false; });
    });
  }

  // Motyw mini-gry: pokój, w którym gracz spędza noc (duch, aresztant i zabójca idący za ofiarą mają własne)
  function themeFor(v) {
    var me = v.me;
    if (me.status === 'dead') return 'duch';
    if (me.status === 'arrested') return 'areszt';
    var room = me.night && me.night.choice.room;
    if (room && THEMES[room]) return room;
    return me.night && me.night.follows ? 'cien' : 'biblioteka';
  }
  function targetLabel(n) {
    for (var i = 0; i < n.targets.length; i++) if (n.targets[i].id === n.choice.target) return n.targets[i].label;
    return '';
  }

  function renderNightTask(v) {
    var me = v.me;
    var n = me.night;
    var ghost = me.status !== 'active';
    var theme = themeFor(v);
    var head = ghost ? (me.status === 'dead' ? 'Mini-gra ducha' : 'Mini-gra w areszcie')
      : theme === 'cien' ? 'Skradasz się za: ' + esc(targetLabel(n)) : 'Mini-gra: ' + esc(roomName(theme));
    var root = setNow(phoneKey, '<div class="stack"><h2 class="gold">' + head + '</h2>' +
      (theme === 'cien' ? '<p class="muted">Idziesz korytarzami tam, gdzie ofiara spędza noc. Pokój poznasz rano.</p>' : '') +
      (ghost ? '<p class="muted">' + (me.status === 'dead' ? 'Jako duch pomagasz z zaświatów' : 'Z aresztu też pomagasz') + ': co 3 udane mini-gry duchów i aresztantów odsłaniają poszlakę.</p>' : '') +
      '<div id="game"></div></div>' + hostBar(v));
    bindSkip(root);
    var calm = !!(v.settings && v.settings.calm);
    currentGame = runMiniGame($('game'), pickGame(v), calm, theme, function (success) {
      currentGame = null;
      if (success && n.frameTargets && n.frameTargets.length) return chooseFrame(v, n.frameTargets);
      sendTask(success);
    });
  }

  function chooseFrame(v, targets) {
    var root = setNow(phoneKey, '<div class="stack"><h2 class="gold">Mini-gra udana</h2>' +
      '<p>Komu podrzucasz fałszywy trop? Rano na tablicy pojawi się jedna z cech tej osoby.</p><div class="choice-list">' +
      targets.map(function (t) { return '<button class="secondary" data-val="' + esc(t.id) + '">' + esc(t.label) + '</button>'; }).join('') +
      '<button class="secondary" data-val="">Nikomu</button></div></div>');
    root.querySelector('.choice-list').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var bs = this.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].disabled = true;
      sendTask(true, b.getAttribute('data-val') || undefined);
    });
  }

  function sendTask(success, frame) {
    act({ type: 'task', success: success, frame: frame }).catch(function () {
      setTimeout(function () { sendTask(success, frame); }, 1500);
    });
  }

  // ---------- motywy mini-gier ----------
  // Każdy pokój ma własną wersję każdej z 12 mini-gier, więc tytuł i przedmioty zawsze pasują
  // do miejsca, w którym gracz spędza noc. Osobne motywy: duch, areszt i zabójca, który skrada się za ofiarą.
  var THEMES = {
    biblioteka: {
      order: { t: 'Ułóż tomy na półce', h: 'Stukaj w tytuły w kolejności alfabetycznej (od A do Z).', sets: [
        ['Atlas', 'Baśnie', 'Czarodziej', 'Dziennik', 'Elementarz'], ['Fraszki', 'Gramatyka', 'Herbarz', 'Kroniki', 'Legendy'],
        ['Mapy', 'Nuty', 'Opowieści', 'Poezje', 'Rymy'], ['Malarstwo', 'Opery', 'Teatr', 'Wiersze', 'Zagadki']] },
      years: { t: 'Pierwsze wydania', h: 'Stukaj w daty wydania od najdawniejszej do najnowszej.' },
      timing: ['Złap spadający tom', 'Zatrzymaj drabinę na kółkach', 'Zdmuchnij świecę przy regale'],
      sequence: { t: 'Sygnatury książek', pool: ['A-12', 'B-7', 'C-31', 'D-4', 'E-19', 'F-23', 'G-8', 'H-15'] },
      math: ['Numeracja stron', 'Kara za przetrzymane książki'],
      simon: 'Kolorowe zakładki',
      odd: [['📕', '📗'], ['📚', '📖'], ['🦉', '🐦'], ['🕯️', '🔥'], ['✒️', '🖋️'], ['📜', '📃']],
      count: { items: [{ e: '📕', n: 'czerwonych książek' }, { e: '🦉', n: 'sów' }, { e: '🕯️', n: 'świec' }, { e: '🔖', n: 'zakładek' }], fill: ['📗', '📘', '📙', '📜', '🕸️', '✒️'] },
      pairs: ['📕', '📜', '🦉', '🕯️', '✒️', '🔖', '📚', '🕰️'],
      find: { items: [{ e: '🔖', t: 'Znajdź wszystkie zakładki' }, { e: '🐛', t: 'Wyłap mole książkowe' }, { e: '🔑', t: 'Znajdź klucze do tajnego przejścia' }], fill: ['📕', '📗', '📘', '📙', '📚', '📜', '🕸️'] },
      pattern: { t: 'Wzór na grzbietach książek', sets: [['📕', '📗', '📘'], ['📙', '📕', '📚'], ['🦉', '🕯️', '📜']] },
      catch: { t: 'Złap mola książkowego', e: '🐛', h: 'Stukaj w mola, zanim się schowa.' }
    },
    kuchnia: {
      order: { t: 'Ułóż słoiki z przyprawami', h: 'Stukaj w nazwy przypraw od A do Z.', sets: [
        ['Anyż', 'Bazylia', 'Cynamon', 'Imbir', 'Kminek'], ['Lubczyk', 'Majeranek', 'Oregano', 'Pieprz', 'Tymianek'],
        ['Estragon', 'Gałka', 'Kurkuma', 'Rozmaryn', 'Szałwia'], ['Chrzan', 'Goździki', 'Jałowiec', 'Mięta', 'Wanilia']] },
      years: { t: 'Zeszyty z przepisami', h: 'Stukaj w daty na okładkach od najdawniejszej do najnowszej.' },
      timing: ['Posól rosół', 'Przewróć naleśnik', 'Wyjmij sernik z pieca'],
      sequence: { t: 'Kolejność składników', pool: ['mąka', 'jajka', 'cukier', 'masło', 'mleko', 'drożdże', 'sól', 'miód'] },
      math: ['Przelicz przepis', 'Ile pierogów na stypę?'],
      simon: 'Dzwonki dla służby',
      odd: [['🍰', '🧁'], ['🥄', '🍴'], ['🍳', '🥞'], ['🍪', '🍩'], ['🥚', '🍳'], ['🍅', '🍎']],
      count: { items: [{ e: '🍪', n: 'ciastek' }, { e: '🥚', n: 'jajek' }, { e: '🍅', n: 'pomidorów' }, { e: '🐭', n: 'myszy' }], fill: ['🍞', '🥄', '🍴', '🧀', '🍯', '🥛'] },
      pairs: ['🍰', '🍪', '🥚', '🧀', '🍯', '🍅', '🥄', '🍞'],
      find: { items: [{ e: '🍬', t: 'Znajdź schowane cukierki' }, { e: '🥄', t: 'Znajdź srebrne łyżeczki' }, { e: '🧀', t: 'Znajdź kawałki sera' }], fill: ['🍞', '🍴', '🍳', '🥛', '🍯', '🥕', '🍅'] },
      pattern: { t: 'Wzór na obrusie', sets: [['🍰', '☕', '🍪'], ['🍅', '🥕', '🥚'], ['🍞', '🧀', '🍯']] },
      catch: { t: 'Przegoń mysz ze spiżarni', e: '🐭', h: 'Stukaj w mysz, zanim ucieknie.' }
    },
    gabinet: {
      order: { t: 'Ułóż teczki w szafie', h: 'Stukaj w napisy na teczkach od A do Z.', sets: [
        ['Akta', 'Bilanse', 'Faktury', 'Rachunki', 'Umowy'], ['Długi', 'Hipoteki', 'Kredyty', 'Pożyczki', 'Weksle'],
        ['Darowizna', 'Majątek', 'Notariusz', 'Spadek', 'Testament'], ['Akcje', 'Dywidendy', 'Lokaty', 'Obligacje', 'Udziały']] },
      years: { t: 'Stare umowy Henryka', h: 'Stukaj w daty umów od najdawniejszej do najnowszej.' },
      timing: ['Nakręć zegar', 'Złap wahadło', 'Przybij pieczątkę'],
      sequence: { t: 'Szyfr do sejfu', pool: ['12', '17', '23', '31', '38', '44', '56', '61'] },
      math: ['Sejf w gabinecie', 'Rachunki Henryka'],
      simon: 'Lampki na biurku',
      odd: [['🔑', '🗝️'], ['✒️', '🖋️'], ['📁', '📂'], ['🕰️', '⏰'], ['💼', '👜'], ['📎', '🖇️']],
      count: { items: [{ e: '🔑', n: 'kluczy' }, { e: '📎', n: 'spinaczy' }, { e: '✉️', n: 'kopert' }, { e: '🕰️', n: 'zegarów' }], fill: ['📁', '📂', '💼', '✒️', '📜', '🎩'] },
      pairs: ['🔑', '📁', '✒️', '💼', '🕰️', '📎', '✉️', '🎩'],
      find: { items: [{ e: '🔑', t: 'Znajdź wszystkie klucze' }, { e: '✉️', t: 'Znajdź listy od notariusza' }, { e: '💰', t: 'Znajdź ukryte oszczędności' }], fill: ['📁', '📂', '💼', '✒️', '📜', '📎', '🎩'] },
      pattern: { t: 'Wzór na tapecie', sets: [['🎩', '🔑', '📜'], ['🟥', '🟦', '🟩'], ['🕰️', '✒️', '💼']] },
      catch: { t: 'Pacnij komara nad biurkiem', e: '🦟', h: 'Stukaj w komara, zanim odleci.' }
    },
    piwnica: {
      order: { t: 'Ułóż słoiki na półkach', h: 'Stukaj w etykiety od A do Z.', sets: [
        ['Agrest', 'Buraki', 'Czereśnie', 'Dżem', 'Ogórki'], ['Fasola', 'Grzyby', 'Kapusta', 'Papryka', 'Śliwki'],
        ['Jabłka', 'Leczo', 'Maliny', 'Powidła', 'Wiśnie'], ['Aronia', 'Kompot', 'Miód', 'Rydze', 'Smalec']] },
      years: { t: 'Roczniki win', h: 'Stukaj w roczniki od najstarszego do najmłodszego.' },
      timing: ['Odkręć kurek beczki', 'Zakręć cieknący kran', 'Złap spadającą butelkę'],
      sequence: { t: 'Roczniki w piwnicy', pool: ['1921', '1934', '1956', '1968', '1975', '1987', '1999', '2003'] },
      math: ['Inwentarz win', 'Kłódka na drzwiach do lochu'],
      simon: 'Zawory w kotłowni',
      odd: [['🍷', '🍸'], ['🍾', '🍷'], ['🥔', '🥚'], ['🐭', '🐀'], ['🕯️', '🔥'], ['🍄', '🌰']],
      count: { items: [{ e: '🍾', n: 'butelek' }, { e: '🥔', n: 'ziemniaków' }, { e: '🐭', n: 'myszy' }, { e: '🕸️', n: 'pajęczyn' }], fill: ['📦', '🍷', '🥕', '🧀', '🛢️', '🍄'] },
      pairs: ['🍷', '🍾', '🥔', '🐀', '🕯️', '🧀', '🍄', '🥕'],
      find: { items: [{ e: '🐭', t: 'Złap wszystkie myszy' }, { e: '🍾', t: 'Znajdź butelki z 1921 roku' }, { e: '🕯️', t: 'Znajdź zapasowe świece' }], fill: ['📦', '🥔', '🥕', '🕸️', '🛢️', '🍷', '🧀'] },
      pattern: { t: 'Ułóż butelki według wzoru', sets: [['🍷', '🍾', '🥂'], ['🥔', '🥕', '🍄'], ['🟥', '🟦', '🟩']] },
      catch: { t: 'Złap szczura Bolka', e: '🐀', h: 'Stukaj w Bolka, zanim ucieknie.' }
    },
    oranzeria: {
      order: { t: 'Ułóż etykiety na doniczkach', h: 'Stukaj w nazwy roślin od A do Z.', sets: [
        ['Aloes', 'Begonia', 'Fikus', 'Kaktus', 'Storczyk'], ['Bluszcz', 'Dalia', 'Hortensja', 'Lilia', 'Palma'],
        ['Azalia', 'Geranium', 'Jaśmin', 'Mirt', 'Róża'], ['Cytryna', 'Fiołek', 'Lawenda', 'Orchidea', 'Tulipan']] },
      years: { t: 'Kiedy posadzono drzewa?', h: 'Stukaj w daty od najdawniejszej do najnowszej.' },
      timing: ['Podlej storczyk', 'Przytnij różę', 'Złap spadającą cytrynę'],
      sequence: { t: 'Kolejność podlewania', pool: ['róża', 'fikus', 'palma', 'kaktus', 'lilia', 'mięta', 'bluszcz', 'storczyk'] },
      math: ['Ile nasion do doniczek?', 'Rachunek za nawóz'],
      simon: 'Kwiaty otwierają się po kolei',
      odd: [['🌹', '🌷'], ['🌸', '🌺'], ['🌻', '🌼'], ['🌵', '🌴'], ['🐝', '🐞'], ['🍀', '🌿']],
      count: { items: [{ e: '🌷', n: 'tulipanów' }, { e: '🐌', n: 'ślimaków' }, { e: '🐞', n: 'biedronek' }, { e: '🌵', n: 'kaktusów' }], fill: ['🌿', '🍃', '🌱', '🌸', '🍀', '💧'] },
      pairs: ['🌹', '🌷', '🌻', '🌵', '🐝', '🐞', '🍀', '🐌'],
      find: { items: [{ e: '🐌', t: 'Zbierz ślimaki z liści' }, { e: '🐞', t: 'Znajdź wszystkie biedronki' }, { e: '🐛', t: 'Zdejmij gąsienice z róż' }], fill: ['🌿', '🍃', '🌱', '🌸', '🌼', '🍀', '🌺'] },
      pattern: { t: 'Rabatka według wzoru', sets: [['🌹', '🌼', '🌷'], ['🌵', '🌴', '🌿'], ['🐝', '🦋', '🐞']] },
      catch: { t: 'Złap motyla', e: '🦋', h: 'Stukaj w motyla, zanim odfrunie.' }
    },
    strych: {
      order: { t: 'Ułóż listy od ciotek', h: 'Stukaj w imiona ciotek od A do Z.', sets: [
        ['Adela', 'Bronisława', 'Celina', 'Danuta', 'Eugenia'], ['Felicja', 'Genowefa', 'Halina', 'Irena', 'Janina'],
        ['Krystyna', 'Leokadia', 'Marianna', 'Natalia', 'Otylia'], ['Paulina', 'Regina', 'Stefania', 'Teodora', 'Wanda']] },
      years: { t: 'Portrety przodków', h: 'Stukaj w daty pod portretami od najdawniejszej do najnowszej.' },
      timing: ['Zdmuchnij świecę', 'Złap spadający kapelusz', 'Zatrzymaj konika na biegunach'],
      sequence: { t: 'Szyfr z pamiętnika', pool: ['AB', 'KO', 'MU', 'TE', 'RI', 'ZA', 'LO', 'PE'] },
      math: ['Kłódka na kufrze', 'Rachunki w starym kalendarzu'],
      simon: 'Kolorowe szybki w okienku',
      odd: [['🕯️', '🔥'], ['🎩', '👒'], ['🕰️', '⏰'], ['🧸', '🐻'], ['🧳', '💼'], ['📷', '📹']],
      count: { items: [{ e: '🦇', n: 'nietoperzy' }, { e: '🕸️', n: 'pajęczyn' }, { e: '🧸', n: 'misiów' }, { e: '🕯️', n: 'świec' }], fill: ['📦', '🧦', '🎩', '🧳', '🎈', '🕰️'] },
      pairs: ['🧸', '🎩', '🕰️', '🦇', '🧳', '📷', '🕯️', '🎻'],
      find: { items: [{ e: '🧦', t: 'Znajdź skarpety od Henryka' }, { e: '🧸', t: 'Znajdź zaginione misie' }, { e: '📷', t: 'Znajdź stare aparaty' }], fill: ['📦', '🧳', '🎩', '🕸️', '🎈', '🕰️', '📚'] },
      pattern: { t: 'Wzór na starej kołdrze', sets: [['🟥', '🟦', '🟩'], ['🎩', '🧸', '🕯️'], ['🦇', '🕸️', '🌙']] },
      catch: { t: 'Złap ducha na strychu', e: '👻', h: 'Stukaj w ducha, zanim zniknie.' }
    },
    duch: {
      order: { t: 'Lista obecności duchów', h: 'Stukaj w imiona duchów od A do Z.', sets: [
        ['Albin', 'Bogumił', 'Czesław', 'Dobromir', 'Eustachy'], ['Florian', 'Gerwazy', 'Hieronim', 'Ignacy', 'Kunegunda'],
        ['Leon', 'Medard', 'Nikodem', 'Onufry', 'Protazy'], ['Rozalia', 'Scholastyka', 'Tekla', 'Urszula', 'Zenobia']] },
      years: { t: 'Rocznice straszenia', h: 'Stukaj w daty od najdawniejszej do najnowszej.' },
      timing: ['Zastukaj w ścianę o północy', 'Przesuń filiżankę podczas seansu', 'Zgaś świecę lodowatym oddechem'],
      sequence: { t: 'Szyfr stukania w ścianę', pool: ['stuk', 'puk', 'skrzyp', 'szur', 'bum', 'tup', 'dzyń', 'chlup'] },
      math: ['Rachunki z zaświatów', 'Ile lat już straszysz?'],
      simon: 'Seans spirytystyczny',
      odd: [['👻', '🎃'], ['💀', '☠️'], ['🕯️', '🔥'], ['🦇', '🐦'], ['🌙', '⭐'], ['🔮', '⚪']],
      count: { items: [{ e: '👻', n: 'duchów' }, { e: '💀', n: 'czaszek' }, { e: '🕯️', n: 'świec' }, { e: '🦇', n: 'nietoperzy' }], fill: ['🌙', '⭐', '🕸️', '🔮', '🎃', '☁️'] },
      pairs: ['👻', '💀', '🎃', '🕯️', '🦇', '🔮', '🌙', '🕸️'],
      find: { items: [{ e: '🔮', t: 'Znajdź kryształowe kule' }, { e: '🕯️', t: 'Znajdź wszystkie świece' }, { e: '🗝️', t: 'Znajdź klucze do krypty' }], fill: ['👻', '💀', '🎃', '🦇', '🌙', '🕸️', '☁️'] },
      pattern: { t: 'Wzór w kryształowej kuli', sets: [['👻', '🦇', '🕸️'], ['💀', '🎃', '🕯️'], ['🌙', '⭐', '☁️']] },
      catch: { t: 'Postrasz domowników', e: '😱', h: 'Stukaj w przestraszoną minę, zanim się schowa.' }
    },
    areszt: {
      order: { t: 'Ułóż zarzuty w aktach', h: 'Stukaj w zarzuty od A do Z.', sets: [
        ['Bigamia', 'Defraudacja', 'Fałszerstwo', 'Kradzież', 'Oszustwo'], ['Hazard', 'Kłusownictwo', 'Paserstwo', 'Szantaż', 'Włamanie'],
        ['Chuligaństwo', 'Dezercja', 'Łapówka', 'Plotkarstwo', 'Wandalizm']] },
      years: { t: 'Stare wyroki', h: 'Stukaj w daty wyroków od najdawniejszej do najnowszej.' },
      timing: ['Przemknij obok strażnika', 'Złap rzucony klucz', 'Odsuń zasuwę'],
      sequence: { t: 'Numery cel', pool: ['3', '7', '12', '15', '21', '28', '33', '40'] },
      math: ['Ile dni do wyjścia?', 'Policz kraty'],
      simon: 'Sygnały do sąsiedniej celi',
      odd: [['🔒', '🔓'], ['🔑', '🗝️'], ['🍞', '🥖'], ['🥄', '🍴'], ['🎲', '🃏'], ['🧦', '👟']],
      count: { items: [{ e: '🔒', n: 'kłódek' }, { e: '🍞', n: 'bochenków chleba' }, { e: '🥄', n: 'łyżek' }, { e: '🐭', n: 'myszy' }], fill: ['🧦', '📰', '🃏', '🎲', '🥖', '🕸️'] },
      pairs: ['🔒', '🔑', '🍞', '🥄', '🃏', '🎲', '📰', '🧦'],
      find: { items: [{ e: '🔑', t: 'Znajdź zgubione klucze strażnika' }, { e: '🥄', t: 'Znajdź łyżki do kopania tunelu' }, { e: '📰', t: 'Zbierz gazety z wolności' }], fill: ['🧦', '🃏', '🎲', '🍞', '🕸️', '🔒', '🥖'] },
      pattern: { t: 'Wzór wydrapany na ścianie', sets: [['🔒', '🔑', '🚪'], ['🍞', '🥄', '☕'], ['🃏', '🎲', '📰']] },
      catch: { t: 'Złap pająka w celi', e: '🕷️', h: 'Stukaj w pająka, zanim ucieknie.' }
    },
    cien: {
      order: { t: 'Klucze do drzwi na korytarzu', h: 'Stukaj w napisy na kluczach od A do Z.', sets: [
        ['Alkowa', 'Buduar', 'Garderoba', 'Pralnia', 'Spiżarnia'], ['Hol', 'Kaplica', 'Łazienka', 'Sień', 'Weranda'],
        ['Antresola', 'Galeria', 'Korytarz', 'Taras', 'Wieżyczka']] },
      years: { t: 'Portrety w korytarzu', h: 'Stukaj w daty pod portretami od najdawniejszej do najnowszej.' },
      timing: ['Przejdź po skrzypiącej desce', 'Przemknij, gdy zegar wybija godzinę', 'Schowaj się za zasłoną'],
      sequence: { t: 'Skrzypiące deski', pool: ['1', '4', '7', '9', '12', '15', '18', '22'] },
      math: ['Policz kroki do drzwi', 'Ile minut do świtu?'],
      simon: 'Lampy w korytarzu',
      odd: [['🕯️', '🔥'], ['🚪', '🖼️'], ['🕰️', '⏰'], ['🐈', '🐕'], ['🌙', '⭐'], ['👣', '👟']],
      count: { items: [{ e: '🚪', n: 'drzwi' }, { e: '🕯️', n: 'świec' }, { e: '🖼️', n: 'obrazów' }, { e: '🐈', n: 'kotów' }], fill: ['🕰️', '🌙', '👣', '🕸️', '🧹', '🎩'] },
      pairs: ['🚪', '🕯️', '🖼️', '🐈', '🕰️', '👣', '🌙', '🧹'],
      find: { items: [{ e: '👣', t: 'Zatrzyj swoje ślady' }, { e: '🕯️', t: 'Znajdź świece do zgaszenia' }, { e: '🔑', t: 'Znajdź klucze do pokoi' }], fill: ['🚪', '🖼️', '🕰️', '🌙', '🕸️', '🧹', '🎩'] },
      pattern: { t: 'Wzór na chodniku w korytarzu', sets: [['🟥', '🟦', '🟩'], ['🚪', '🕯️', '🖼️'], ['🌙', '⭐', '☁️']] },
      catch: { t: 'Przegoń kota z korytarza', e: '🐈', h: 'Stukaj w kota, zanim zamiauczy.' }
    }
  };

  // ---------- mini-gry ----------
  // Pula 12 mini-gier. Gra jest losowana dla gracza i godziny (stała po odświeżeniu strony),
  // więc w tym samym pokoju co noc trafia się coś innego. Treść (tytuł, przedmioty) bierze się z motywu pokoju.
  var GAMES = ['books', 'years', 'timing', 'sequence', 'math', 'simon', 'odd', 'count', 'pairs', 'find', 'pattern', 'ghost'];

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pickGame(v) {
    var base = hashStr(v.code + ':' + (v.me ? v.me.id : ''));
    return GAMES[(base + v.hour * 7) % GAMES.length];
  }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pickOne(a) { return a[rnd(a.length)]; }

  function runMiniGame(box, kind, calm, themeId, done) {
    var T = THEMES[themeId] || THEMES.biblioteka;
    // Mini-gra trwa do końca nocy (noc ma limit 2 min, w spokojnym tempie 3 min)
    var deadline = G.view && G.view.endsAt ? G.view.endsAt - 1500 : serverNow() + 120000;
    var finished = false;
    var timers = [];
    var raf = null;
    function finish(ok) {
      if (finished) return;
      finished = true;
      stop();
      box.innerHTML = '<div class="game-box center"><h2 class="' + (ok ? 'gold' : 'muted') + '">' + (ok ? 'Udało się!' : 'Nie tym razem.') + '</h2><p class="muted">Zapisuję…</p></div>';
      done(ok);
    }
    function stop() {
      timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
      if (raf) cancelAnimationFrame(raf);
    }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    box.innerHTML = '<div class="game-box"><div class="row" style="justify-content:space-between"><span id="g-title"></span><span id="g-time" class="timer"></span></div>' +
      '<p id="g-help" class="muted"></p><div id="g-area" class="stack" data-game="' + kind + '" data-theme="' + themeId + '"></div><button id="g-quit" class="secondary">Rezygnuję</button></div>';
    box.querySelector('#g-quit').addEventListener('click', function () { finish(false); });
    timers.push(setInterval(function () {
      var left = deadline - serverNow();
      var t = box.querySelector('#g-time');
      if (t) t.textContent = fmtTime(left);
      if (left <= 0) finish(false);
    }, 250));
    var title = box.querySelector('#g-title');
    var help = box.querySelector('#g-help');
    var area = box.querySelector('#g-area');
    function progress(n, of) { return '<p class="center muted">Dobrze: ' + n + '/' + of + '</p>'; }
    function flashWrong(b) {
      if (!b) return;
      b.classList.add('wrong');
      later(function () { b.classList.remove('wrong'); }, 450);
    }
    // Siatka przycisków z emoji; onTap(index, button)
    function grid(cells, cols, onTap) {
      area.innerHTML = '<div class="game-grid" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
        cells.map(function (c, i) { return '<button class="cell" data-i="' + i + '">' + c + '</button>'; }).join('') + '</div>';
      area.querySelector('.game-grid').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || b.disabled) return;
        onTap(Number(b.getAttribute('data-i')), b);
      });
    }

    var G_ = {
      // 1. Tomy w kolejności alfabetycznej
      books: function () {
        var items = pickOne(T.order.sets).slice().sort(function (a, b) { return a.localeCompare(b, 'pl'); });
        title.textContent = T.order.t;
        help.textContent = T.order.h;
        orderGame(items);
      },
      // 2. Daty od najdawniejszej
      years: function () {
        var ys = [];
        while (ys.length < 5) { var y = 1700 + rnd(290); if (ys.every(function (x) { return Math.abs(x - y) > 4; })) ys.push(y); }
        ys.sort(function (a, b) { return a - b; });
        title.textContent = T.years.t;
        help.textContent = T.years.h;
        orderGame(ys.map(String));
      },
      // 3. Refleks: znacznik w zielonym polu
      timing: function () {
        title.textContent = pickOne(T.timing);
        help.textContent = 'Stuknij „Teraz!”, gdy znacznik jest w zielonym polu. Potrzebne 3 trafienia.';
        var zoneW = calm ? 30 : 22;
        var speed = calm ? 0.55 : 0.8;
        var hits = 0;
        var zoneX = 0;
        area.innerHTML = '<div class="bar"><div class="zone"></div><div class="marker"></div></div><div class="hits center">○○○</div><button class="big-btn" id="g-now">Teraz!</button>';
        var zone = area.querySelector('.zone');
        var marker = area.querySelector('.marker');
        var hitsEl = area.querySelector('.hits');
        function placeZone() {
          zoneX = 5 + Math.random() * (90 - zoneW);
          zone.style.left = zoneX + '%';
          zone.style.width = zoneW + '%';
          area.setAttribute('data-zone', zoneX + ',' + zoneW);
        }
        placeZone();
        var t0 = performance.now();
        var pos = 0;
        function frame(t) {
          pos = (Math.sin((t - t0) / 1000 * Math.PI * speed) + 1) / 2 * 100;
          marker.style.left = pos + '%';
          marker.setAttribute('data-pos', pos.toFixed(1));
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        area.querySelector('#g-now').addEventListener('click', function () {
          if (pos >= zoneX && pos <= zoneX + zoneW) {
            hits++;
            hitsEl.textContent = '●●●'.slice(0, hits) + '○○○'.slice(hits);
            if (hits >= 3) { finish(true); return; }
            placeZone();
          } else {
            hitsEl.style.color = 'var(--bad)';
            later(function () { hitsEl.style.color = ''; }, 300);
          }
        });
      },
      // 4. Zapamiętaj kolejność
      sequence: function () {
        var th = T.sequence;
        title.textContent = th.t;
        var seq = shuffle(th.pool).slice(0, calm ? 3 : 4);
        var showMs = calm ? 6000 : 4000;
        var at = 0;
        function show() {
          help.textContent = 'Zapamiętaj kolejność:';
          area.innerHTML = '<p class="center seq-show">' + seq.join(' · ') + '</p>';
          later(ask, showMs);
        }
        function ask() {
          at = 0;
          help.textContent = 'Stukaj w tej samej kolejności.';
          var opts = shuffle(seq.concat(shuffle(th.pool.filter(function (y) { return seq.indexOf(y) < 0; })).slice(0, 2)));
          area.innerHTML = '<div class="game-items">' + opts.map(function (y) { return '<button class="secondary" data-v="' + y + '">' + y + '</button>'; }).join('') + '</div>';
          area.querySelector('.game-items').addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b || b.disabled) return;
            if (b.getAttribute('data-v') === seq[at]) {
              b.className = 'done'; b.disabled = true; at++;
              if (at === seq.length) finish(true);
            } else {
              help.textContent = 'Pomyłka. Pokażę jeszcze raz.';
              later(show, 700);
            }
          });
        }
        show();
      },
      // 5. Rachunki do sejfu
      math: function () {
        title.textContent = pickOne(T.math);
        help.textContent = 'Policz i wybierz wynik. Potrzebne 3 dobre odpowiedzi.';
        var good = 0;
        function q() {
          var a = 2 + rnd(8), b = 2 + rnd(8), kind = rnd(3), ans, text;
          if (kind === 0) { ans = a + b; text = a + ' + ' + b; }
          else if (kind === 1) { ans = a * 2; text = 'dwa razy ' + a; }
          else { var big = a + b; ans = big - b; text = big + ' − ' + b; }
          var opts = [ans];
          while (opts.length < 4) { var o = ans + rnd(7) - 3; if (o > 0 && opts.indexOf(o) < 0) opts.push(o); }
          area.innerHTML = '<p class="center q-big">' + text + ' = ?</p>' + progress(good, 3) + '<div class="game-items">' +
            shuffle(opts).map(function (o) { return '<button class="secondary" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>';
          area.querySelector('.game-items').addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (!btn) return;
            if (Number(btn.getAttribute('data-v')) === ans) { good++; if (good >= 3) { finish(true); return; } }
            else flashWrong(btn);
            later(q, 350);
          });
        }
        q();
      },
      // 6. Kolorowe dzwonki: powtórz sekwencję
      simon: function () {
        title.textContent = T.simon;
        var colors = ['red', 'blue', 'green', 'gold'];
        var seq = [];
        for (var i = 0; i < (calm ? 3 : 4); i++) seq.push(rnd(4));
        var at = 0;
        var flashMs = calm ? 800 : 600;
        area.innerHTML = '<div class="simon">' + colors.map(function (c, i) { return '<button class="pad ' + c + '" data-i="' + i + '" disabled></button>'; }).join('') + '</div>';
        var pads = area.querySelectorAll('.pad');
        function setEnabled(on) { for (var i = 0; i < pads.length; i++) pads[i].disabled = !on; }
        function play() {
          help.textContent = 'Patrz, w jakiej kolejności zaświecą się pola…';
          setEnabled(false);
          at = 0;
          seq.forEach(function (c, k) {
            later(function () { pads[c].classList.add('lit'); }, 500 + k * (flashMs + 200));
            later(function () { pads[c].classList.remove('lit'); }, 500 + k * (flashMs + 200) + flashMs);
          });
          later(function () { help.textContent = 'Twoja kolej: stukaj w tej samej kolejności.'; setEnabled(true); }, 500 + seq.length * (flashMs + 200));
        }
        area.setAttribute('data-seq', seq.join(''));
        area.querySelector('.simon').addEventListener('click', function (e) {
          var b = e.target.closest('button');
          if (!b || b.disabled) return;
          var i = Number(b.getAttribute('data-i'));
          b.classList.add('lit');
          later(function () { b.classList.remove('lit'); }, 200);
          if (i === seq[at]) { at++; if (at === seq.length) finish(true); }
          else { help.textContent = 'Pomyłka. Patrz jeszcze raz.'; later(play, 600); setEnabled(false); }
        });
        play();
      },
      // 7. Znajdź inny przedmiot
      odd: function () {
        title.textContent = 'Coś tu nie pasuje';
        help.textContent = 'Znajdź jeden przedmiot inny niż reszta. Trzy razy.';
        var pairs = T.odd;
        var good = 0;
        var size = calm ? 3 : 4;
        function round() {
          var pr = pickOne(pairs);
          var n = size * size;
          var oddAt = rnd(n);
          var cells = [];
          for (var i = 0; i < n; i++) cells.push(i === oddAt ? pr[1] : pr[0]);
          grid(cells, size, function (i, b) {
            if (i === oddAt) { good++; if (good >= 3) finish(true); else round(); }
            else flashWrong(b);
          });
          area.insertAdjacentHTML('beforeend', progress(good, 3));
        }
        round();
      },
      // 8. Policz przedmioty
      count: function () {
        title.textContent = 'Inwentaryzacja';
        var targets = T.count.items;
        var fillers = T.count.fill;
        var good = 0;
        function q() {
          var t = pickOne(targets);
          var total = calm ? 9 : 12;
          var k = 2 + rnd(calm ? 4 : 6);
          var cells = [];
          for (var i = 0; i < total; i++) cells.push(i < k ? t.e : pickOne(fillers));
          cells = shuffle(cells);
          var opts = [k];
          while (opts.length < 4) { var o = k + rnd(5) - 2; if (o > 0 && opts.indexOf(o) < 0) opts.push(o); }
          area.innerHTML = '<p class="center">Ile jest ' + t.n + ' ' + t.e + '?</p><div class="game-grid static" style="grid-template-columns:repeat(' + (calm ? 3 : 4) + ',1fr)">' +
            cells.map(function (c) { return '<span class="cell">' + c + '</span>'; }).join('') + '</div>' + progress(good, 3) +
            '<div class="game-items">' + shuffle(opts).map(function (o) { return '<button class="secondary" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>';
          area.setAttribute('data-target', t.e);
          area.querySelector('.game-items').addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b) return;
            if (Number(b.getAttribute('data-v')) === k) { good++; if (good >= 3) { finish(true); return; } }
            else flashWrong(b);
            later(q, 350);
          });
        }
        help.textContent = 'Policz wskazane przedmioty. Potrzebne 3 dobre odpowiedzi.';
        q();
      },
      // 9. Pary kart
      pairs: function () {
        title.textContent = 'Znajdź pary';
        help.textContent = 'Odkrywaj po dwie karty i znajdź wszystkie pary.';
        var pool = shuffle(T.pairs.slice()).slice(0, calm ? 3 : 4);
        var deck = shuffle(pool.concat(pool));
        var open = [];
        var matched = 0;
        var lock = false;
        grid(deck.map(function () { return '❔'; }), 4, function (i, b) {
          if (lock || b.classList.contains('done') || open.indexOf(i) >= 0) return;
          b.textContent = deck[i];
          open.push(i);
          if (open.length < 2) return;
          var cells = area.querySelectorAll('.cell');
          var a = open[0], c = open[1];
          if (deck[a] === deck[c]) {
            cells[a].classList.add('done'); cells[c].classList.add('done');
            cells[a].disabled = true; cells[c].disabled = true;
            open = [];
            matched++;
            if (matched === pool.length) later(function () { finish(true); }, 300);
          } else {
            lock = true;
            later(function () { cells[a].textContent = '❔'; cells[c].textContent = '❔'; open = []; lock = false; }, 700);
          }
        });
      },
      // 10. Znajdź wszystkie wskazane przedmioty
      find: function () {
        var targets = T.find.items;
        var fillers = T.find.fill;
        var tg = pickOne(targets);
        title.textContent = tg.t;
        var n = calm ? 12 : 16;
        var k = calm ? 4 : 5;
        var cells = [];
        for (var i = 0; i < n; i++) cells.push(i < k ? tg.e : pickOne(fillers));
        cells = shuffle(cells);
        var left = k;
        help.textContent = 'Stukaj tylko w ' + tg.e + '. Zostało: ' + left + '.';
        area.setAttribute('data-target', tg.e);
        grid(cells, 4, function (i, b) {
          if (cells[i] === tg.e) {
            b.classList.add('done'); b.disabled = true; left--;
            help.textContent = 'Stukaj tylko w ' + tg.e + '. Zostało: ' + left + '.';
            if (left === 0) finish(true);
          } else flashWrong(b);
        });
      },
      // 11. Co będzie następne we wzorze
      pattern: function () {
        title.textContent = T.pattern.t;
        help.textContent = 'Co powinno być w miejscu znaku zapytania? Potrzebne 3 dobre odpowiedzi.';
        var sets = T.pattern.sets;
        var shapes = [[0, 1], [0, 0, 1], [0, 1, 2], [0, 1, 1], [0, 1, 2, 1]];
        var good = 0;
        function q() {
          var s = pickOne(sets);
          var sh = pickOne(shapes);
          var len = sh.length * 2 + rnd(sh.length);
          var seq = [];
          for (var i = 0; i < len; i++) seq.push(s[sh[i % sh.length]]);
          var ans = s[sh[len % sh.length]];
          area.innerHTML = '<p class="center seq-show">' + seq.join(' ') + ' ❓</p>' + progress(good, 3) + '<div class="game-items">' +
            shuffle(s.slice()).map(function (o) { return '<button class="secondary emoji-btn" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>';
          area.querySelector('.game-items').addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b) return;
            if (b.getAttribute('data-v') === ans) { good++; if (good >= 3) { finish(true); return; } }
            else flashWrong(b);
            later(q, 350);
          });
        }
        q();
      },
      // 12. Złap, zanim zniknie (duch, mysz, motyl… zależnie od pokoju)
      ghost: function () {
        var C = T.catch;
        title.textContent = C.t;
        var need = calm ? 4 : 5;
        var stay = calm ? 1400 : 950;
        var hits = 0;
        var at = -1;
        help.textContent = C.h + ' Trafienia: 0/' + need + '.';
        grid(['', '', '', '', '', '', '', '', ''], 3, function (i, b) {
          if (i !== at) return;
          hits++;
          b.textContent = '✨';
          at = -1;
          help.textContent = C.h + ' Trafienia: ' + hits + '/' + need + '.';
          if (hits >= need) finish(true);
        });
        var cells = area.querySelectorAll('.cell');
        function move() {
          for (var i = 0; i < cells.length; i++) cells[i].textContent = '';
          var next = rnd(9);
          if (next === at) next = (next + 1 + rnd(8)) % 9;
          at = next;
          cells[at].textContent = C.e;
          later(move, stay);
        }
        later(move, 400);
      }
    };

    // Wspólna gra „stukaj w kolejności”
    function orderGame(items) {
      var next = 0;
      area.innerHTML = '<div class="game-items">' + shuffle(items).map(function (it) { return '<button class="secondary" data-v="' + esc(it) + '">' + esc(it) + '</button>'; }).join('') + '</div>';
      area.querySelector('.game-items').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.getAttribute('data-v') === items[next]) {
          b.className = 'done'; b.disabled = true; next++;
          if (next === items.length) finish(true);
        } else flashWrong(b);
      });
      area.setAttribute('data-order', items.join('|'));
    }

    (G_[kind] || G_.timing)();
    return { stop: stop };
  }

  // ---------- pozostałe fazy ----------
  function renderMorning(v) {
    var me = v.me;
    var mine = me.notes.filter(function (n) { return n.clock === v.clock; });
    var html = '<div class="panel stack"><h2 class="gold">Poranek ' + esc(v.clock) + '</h2>' +
      (v.morning ? v.morning.lines.slice(1).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') : '') + '</div>' +
      '<div class="stack"><h2 class="gold">Twoje nowe poszlaki</h2>' +
      (mine.length ? mine.map(function (n) { return '<div class="note' + (n.kind === 'info' ? ' info' : '') + '">' + esc(n.text) + '</div>'; }).join('') : '<p class="muted">Tej nocy nic nowego.</p>') + '</div>' +
      (me.ready ? '<p class="muted center">Czekamy na pozostałych…</p>' : '<button id="btn-ready" class="big-btn">Przeczytane</button>') + hostBar(v);
    var root = setNow(phoneKey, html);
    bindSkip(root);
    var b = root.querySelector('#btn-ready');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'ready' }).catch(function () { b.disabled = false; }); });
  }

  function renderVerdict(v) {
    var me = v.me;
    var vd = v.verdict || { text: '', lines: [] };
    var html = '<div class="panel stack"><h2 class="gold">Werdykt</h2>' +
      (vd.lines || []).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') +
      '<p class="big-text" style="font-size:1.2em">' + esc(vd.text) + '</p></div>' +
      '<div class="panel stack"><h2 class="gold">Kto na kogo głosował</h2>' + votesHtml(lastVote(v, 'accusation')) + '</div>' +
      (me.ready ? '<p class="muted center">Czekamy na pozostałych…</p>' : '<button id="btn-ready" class="big-btn">Dalej</button>') + hostBar(v);
    var root = setNow(phoneKey, html);
    bindSkip(root);
    bindReady(root);
  }

  function bindReady(root) {
    var b = root.querySelector('#btn-ready');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'ready' }).catch(function () { b.disabled = false; }); });
  }

  function renderDiscussion(v) {
    var me = v.me;
    var active = me.status === 'active';
    var html = '<div class="panel stack"><h2 class="gold">Narada</h2><p>Rozmawiajcie przy stole. Twoje poszlaki są w zakładce <b>Notes</b>.</p>' +
      '<p class="muted">Pamiętaj: część poszlak na tablicy może być podrzucona przez zabójcę.</p></div>' +
      (active ? (me.ready ? '<p class="muted center">Czekamy na resztę… (' + waitLine(v) + ')</p>' : '<button id="btn-ready" class="big-btn">Chcę głosować</button>')
        : '<p class="muted">' + (me.status === 'dead' ? 'Jako duch' : 'W areszcie') + ' możesz mówić, ale głosujesz dopiero o świcie.</p>') + hostBar(v);
    var root = setNow(phoneKey, html);
    bindSkip(root);
    var b = root.querySelector('#btn-ready');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'ready' }).catch(function () { b.disabled = false; }); });
  }

  function renderVote(v) {
    var me = v.me;
    var dawn = v.phase === 'dawn';
    var head = dawn
      ? '<h2 class="gold">Świt: ostateczne oskarżenie</h2><p>Kto jest zabójcą? Głosują wszyscy. Osoba z największą liczbą głosów zostanie zatrzymana.</p>'
      : '<h2 class="gold">Oskarżenie</h2><p>Kogo zamykamy w areszcie? Potrzeba ponad połowy głosów.</p>';
    if (!me.canVote) {
      setNow(phoneKey, '<div class="panel stack">' + head + '<p class="muted">' + (me.status === 'active' ? 'Nie ma na kogo głosować.' : 'Głosujesz dopiero o świcie.') + '</p></div>' + hostBar(v));
      bindSkip($('p-now'));
      return;
    }
    var opts = me.voteTargets.slice();
    if (!dawn && !(v.voting && v.voting.lastHour)) opts.push({ id: 'none', label: 'Nikogo nie oskarżam' });
    var html = '<div class="panel stack">' + head + '<div class="choice-list">' +
      opts.map(function (t) { return '<button class="' + (me.vote === t.id ? 'chosen' : 'secondary') + '" data-val="' + esc(t.id) + '">' + esc(t.label) + '</button>'; }).join('') +
      '</div><p class="muted">' + (me.vote ? 'Głos oddany. Możesz go zmienić, dopóki nie zagłosują wszyscy.' : 'Wybierz osobę.') +
      (v.voting ? ' Głosy: ' + v.voting.voted + '/' + v.voting.eligible : '') + '</p></div>' + hostBar(v);
    var root = setNow(phoneKey, html);
    bindSkip(root);
    root.querySelector('.choice-list').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      act({ type: 'vote', target: b.getAttribute('data-val') }).catch(function () {});
    });
  }

  function renderEnd(v) {
    var me = v.me;
    var r = v.result;
    if (!r) return;
    var mineRank = null;
    for (var i = 0; i < r.ranking.length; i++) if (r.ranking[i].name === me.name) mineRank = { pos: i + 1, row: r.ranking[i] };
    var myFaction = me.role ? me.role.faction : '';
    var won = (myFaction === 'rodzina' && r.winner === 'rodzina') || (myFaction === 'zabojcy' && r.winner === 'zabojcy') ||
      r.neutralWinners.some(function (n) { return n && n.indexOf('(' + me.name + ')') >= 0; });
    var html = '<div class="panel stack center"><h2 class="gold" style="font-size:1.6em">' + (r.winner === 'rodzina' ? 'Wygrywa Rodzina' : 'Wygrywają Zabójcy') + '</h2>' +
      '<p>' + esc(r.reason) + '</p><p style="font-size:1.3em">' + (won ? (me.character && me.character.f ? 'Wygrałaś!' : 'Wygrałeś!') : 'Tym razem przegrana.') + '</p>' +
      '<p class="muted">Twoja rola: ' + esc(me.role ? me.role.name : '') + ' · punkty: ' + me.points + (mineRank ? ' · miejsce ' + mineRank.pos + '/' + r.ranking.length : '') + '</p></div>' +
      '<div class="panel stack">' + r.titles.map(function (t) { return '<p><span class="gold">' + esc(t.title) + ':</span> ' + esc(t.who) + '</p>'; }).join('') + '</div>' +
      (me.isHost ? '<button id="btn-restart" class="big-btn">Nowa gra z tymi samymi graczami</button>' : '<p class="muted center">Pełne wyniki i rekonstrukcja są na ekranie gry.</p>');
    var root = setNow(phoneKey, html);
    var b = root.querySelector('#btn-restart');
    if (b) b.addEventListener('click', function () { b.disabled = true; act({ type: 'restart' }).catch(function () { b.disabled = false; }); });
  }

  // =====================================================================
  // TELEFON BEZ KODU
  // =====================================================================
  function startLanding() {
    document.body.className = 'mode-landing';
    $('landing').hidden = false;
    $('code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = cleanCode($('code-input').value);
      if (code.length !== 4) { toast('Kod ma 4 litery.'); return; }
      location.href = location.origin + location.pathname + '?p=' + code;
    });
    $('btn-be-screen').addEventListener('click', function () {
      location.href = location.origin + location.pathname + '?ekran=1';
    });
  }

  // ---------- routing ----------
  // Tryb testowy mini-gier: ?dev=1 (używany tylko przez testy automatyczne)
  if (params.get('dev') === '1') {
    window.__owDev = { GAMES: GAMES, THEMES: Object.keys(THEMES), run: function (box, kind, calm, done, theme) { return runMiniGame(box, kind, calm, theme || 'biblioteka', done); } };
    return;
  }
  var playCode = cleanCode(params.get('p'));
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var isNarrow = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (playCode.length === 4) startPhone(playCode);
  else if (params.get('ekran') || !(isTouch && isNarrow)) startScreen();
  else startLanding();
})();
