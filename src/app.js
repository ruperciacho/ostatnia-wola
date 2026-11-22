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
    lobby: 'Lobby', prolog: 'Kolacja', night: 'Noc', morning: 'Poranek', discussion: 'Narada',
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

  function call(body) {
    var t0 = Date.now();
    return fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json();
    }).then(function (j) {
      var t1 = Date.now();
      var rtt = t1 - t0;
      bestRtt = Math.min(bestRtt * 1.15, 1e9);
      if (j && j.view && j.view.serverNow && rtt <= bestRtt) {
        bestRtt = rtt;
        offset = j.view.serverNow - (t0 + t1) / 2;
      }
      return j;
    });
  }

  var G = {
    code: null, token: null, view: null, version: 0, isScreen: false,
    channel: null, refreshing: false, pending: false, lastUpdate: 0, rtStatus: '', onView: function () {}
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

  function refresh() {
    if (!G.code) return;
    if (G.refreshing) { G.pending = true; return; }
    G.refreshing = true;
    call({ op: 'view', code: G.code, token: G.token || undefined }).then(function (j) {
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
      return j;
    }).catch(function (e) {
      toast('Brak połączenia z serwerem. Spróbuj jeszcze raz.');
      throw e;
    });
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

    $('s-players').innerHTML = v.players.map(function (p) {
      var right = statusChip(p);
      if (!right && p.ready && ['prolog', 'morning', 'discussion'].indexOf(v.phase) >= 0) right = '<span class="chip ready">gotowy</span>';
      if (!right && p.id === v.hostId && v.phase === 'lobby') right = '<span class="chip">host</span>';
      return '<li><span>' + esc(p.name) + (p.character ? '<div class="sub">' + esc(p.character.name) + '</div>' : '') + '</span>' + right + '</li>';
    }).join('') || '<li class="muted">Nikt jeszcze nie dołączył.</li>';

    var m = $('s-main');
    var html = '';
    var joinUrl = location.origin + location.pathname + '?p=' + v.code;

    if (v.phase === 'lobby') {
      var n = v.players.length;
      var settings = 'Tryb: ' + (v.settings.mode === '30' ? '30 minut' : '1 godzina') +
        ' · śmierć graczy: ' + (v.settings.death ? 'włączona' : 'wyłączona') +
        ' · tempo: ' + (v.settings.calm ? 'spokojne' : 'normalne');
      html = '<div class="lobby-grid"><div id="qr"></div><div class="stack">' +
        '<p class="muted">Zeskanuj kod telefonem albo wejdź na</p><p class="big-text">' + esc(joinUrl.replace(/^https?:\/\//, '')) + '</p>' +
        '<div class="room-code">' + esc(v.code) + '</div>' +
        '<p class="big-text">' + (n < 3 ? 'Potrzeba co najmniej 3 graczy (jest ' + n + ').' : 'Graczy: ' + n + '. Host startuje grę z telefonu.') + '</p>' +
        '<p class="muted">' + esc(settings) + '</p></div></div>';
      m.innerHTML = html;
      if (window.qrcode) {
        var qr = window.qrcode(0, 'M');
        qr.addData(joinUrl);
        qr.make();
        $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      }
      return;
    }

    if (v.phase === 'prolog') {
      html = '<div class="stack"><div class="stack big-text">' + v.intro.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' +
        '<p class="muted">Gotowi: ' + v.readyCount + '/' + v.players.length + '. Sprawdźcie na telefonach swoje role i postacie.</p>' +
        '<div class="mini-gallery wide">' + v.players.map(miniCard).join('') + '</div></div>';
    } else if (v.phase === 'night') {
      html = '<div class="stack center" style="padding-top:6vh"><h2 class="huge gold">Gasną światła</h2>' +
        '<p class="big-text">Godzina ' + esc(v.clock) + '. Wybierzcie na telefonach pokój i zróbcie zadanie.<br>Nie zaglądajcie sobie w ekrany.</p>' +
        '<p class="huge">' + v.night.done + ' / ' + v.night.total + '</p><p class="muted">skończyło noc</p></div>';
    } else if (v.phase === 'morning') {
      html = '<div class="stack">' + (v.morning ? v.morning.lines.map(function (l, i) { return '<p class="' + (i === 0 ? 'muted' : 'big-text') + '">' + esc(l) + '</p>'; }).join('') : '') +
        (v.morning && v.morning.clues.length ? '<h2 class="gold" style="margin-top:.6em">Nowe poszlaki</h2>' + v.morning.clues.map(function (c) { return '<div class="clue big-text">' + esc(c) + '</div>'; }).join('') : '') +
        '<p class="muted">Gotowi: ' + v.readyCount + '/' + v.players.length + '</p></div>';
    } else if (v.phase === 'discussion') {
      html = board(v, 'Narada. Porównajcie poszlaki i alibi. Jedna poszlaka na noc może być podrzucona.');
    } else if (v.phase === 'accusation') {
      html = board(v, 'Oskarżenie! Głosujcie na telefonach. Głosy: ' + v.voting.voted + '/' + v.voting.eligible +
        (v.voting.lastHour ? '. Kogut pieje: tym razem trzeba kogoś wskazać.' : '.'));
    } else if (v.phase === 'verdict') {
      html = '<div class="stack center" style="padding-top:8vh"><h2 class="huge gold">Werdykt</h2><p class="huge">' + esc(v.verdict ? v.verdict.text : '') + '</p></div>';
    } else if (v.phase === 'dawn') {
      html = board(v, 'Świt. Ostateczne oskarżenie: głosują wszyscy, także aresztowani i duchy. Głosy: ' + v.voting.voted + '/' + v.voting.eligible + '.');
    } else if (v.phase === 'end' && v.result) {
      html = endScreen(v);
    }
    m.innerHTML = html;
  }

  function miniCard(p) {
    var c = p.character;
    if (!c) return '';
    return '<div class="panel mini"><div class="row" style="justify-content:space-between"><span class="gold">' + esc(c.name) + '</span>' + statusChip(p) + '</div>' +
      '<div class="muted">' + esc(p.name) + '</div><div class="attrs">' + c.attrs.map(function (a) { return '<span>' + esc(a.label) + '</span>'; }).join('') + '</div></div>';
  }

  function board(v, headline) {
    var gallery = v.players.map(miniCard).join('');
    var clues = v.publicClues.length > 8 ? v.publicClues.slice(-8) : v.publicClues;
    var dead = v.npcs.filter(function (n) { return !n.alive; }).map(function (n) { return n.name; });
    return '<div class="stack"><p class="big-text">' + esc(headline) + '</p><div class="board">' +
      '<div class="panel stack"><h2 class="gold">Tablica dowodów</h2>' + clueList(clues) +
      (v.publicClues.length > 8 ? '<p class="muted" style="font-size:.8em">Starsze poszlaki są w telefonach, w zakładce Notes.</p>' : '') +
      '<p class="muted" style="font-size:.8em">Ofiary wśród służby i gości: ' + esc(dead.length ? dead.join(', ') : 'brak') +
      ' · pamiątek we dworze: ' + v.heirloomsLeft + '/6 · tablica duchów: ' + v.ghostProgress + '/3</p></div>' +
      '<div class="mini-gallery">' + gallery + '</div></div></div>';
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
    var recon = r.reconstruction.map(function (h) {
      return '<p><b>' + esc(h.clock) + '</b> · ' + (h.victim ? 'ofiara: ' + esc(h.victim) + ', ' : '') +
        (h.executor ? 'sprawca: ' + esc(h.executor) : 'bez zamachu') +
        (h.failed ? ' (nieudany: ' + (h.failed === 'lekarz' ? 'lekarz' : 'tłok') + ')' : '') +
        (h.theft ? ' · ' + esc(h.theft) : '') + (h.arrested ? ' · areszt: ' + esc(h.arrested) : '') +
        '<br>' + esc(h.rooms.join(' · ')) + '</p>';
    }).join('');
    return '<div class="stack"><h2 class="huge gold">' + winner + '</h2><p class="big-text">' + esc(r.reason) + '</p>' + neutral +
      '<div class="board"><div class="panel">' + rank + '</div><div class="panel stack">' + titles + '</div></div>' +
      '<div class="panel recon"><h2 class="gold" style="font-size:1.3em;margin-bottom:.4em">Rekonstrukcja nocy</h2><div class="recon-cols">' + recon + '</div></div>' +
      '<p class="muted">Host może zacząć nową grę z telefonu.</p></div>';
  }

  // =====================================================================
  // TELEFON
  // =====================================================================
  var phoneKey = '';
  var phonePhase = '';
  var currentGame = null;

  function startPhone(code) {
    document.body.className = 'mode-phone';
    $('phone').hidden = false;
    G.code = code;
    G.token = sGet('token:' + code);
    G.onView = renderPhone;
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
      if (document.visibilityState === 'visible') { requestWakeLock(); refresh(); }
    });
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
    if (!c.task) return 'task';
    return 'wait';
  }

  function renderPhone(v) {
    var me = v.me;
    $('p-label').textContent = PHASE_LABEL[v.phase] + (v.clock && v.phase !== 'end' ? ' ' + v.clock : '');
    $('p-sub').textContent = 'Pokój ' + v.code + (me ? ' · ' + me.name + (me.isHost ? ' (host)' : '') : '');
    $('p-tabs').hidden = !me || v.phase === 'lobby';
    if (!me && v.phase === 'lobby') { phoneKey = 'join'; if ($('p-now').getAttribute('data-key') !== 'join') renderJoin(v); return; }
    if (!me) { setNow('notjoined', '<div class="panel">Gra w pokoju ' + esc(v.code) + ' już trwa. Dołączyć można tylko w lobby, przed startem.</div>'); return; }

    renderNotes(v);
    renderChar(v);
    if (v.phase !== phonePhase) { phonePhase = v.phase; showTab('p-now'); }

    var key = v.phase + ':' + v.hour;
    if (v.phase === 'night') key += ':' + nightStep(v);
    if (v.phase === 'prolog') key += ':' + me.ready;
    var dynamic = ['lobby', 'morning', 'discussion', 'accusation', 'verdict', 'dawn', 'end'].indexOf(v.phase) >= 0;
    if (!dynamic && key === phoneKey) {
      if (v.phase === 'night') updateNightWait(v);
      return;
    }
    if (key !== phoneKey && currentGame) { currentGame.stop(); currentGame = null; }
    phoneKey = key;

    if (v.phase === 'lobby') renderLobby(v);
    else if (v.phase === 'prolog') renderProlog(v);
    else if (v.phase === 'night') renderNight(v);
    else if (v.phase === 'morning') renderMorning(v);
    else if (v.phase === 'discussion') renderDiscussion(v);
    else if (v.phase === 'accusation' || v.phase === 'dawn') renderVote(v);
    else if (v.phase === 'verdict') setNow(key, '<div class="panel stack"><h2 class="gold">Werdykt</h2><p class="big-text" style="font-size:1.2em">' + esc(v.verdict ? v.verdict.text : '') + '</p></div>');
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
        '<button data-set="mode" data-val="30" class="' + (s.mode === '30' ? 'chosen' : 'secondary') + '">30 minut</button>' +
        '<button data-set="mode" data-val="60" class="' + (s.mode === '60' ? 'chosen' : 'secondary') + '">1 godzina</button></div>' +
        '<p class="muted">Śmierć graczy' + (n < 5 ? ' (od 5 graczy)' : '') + '</p><div class="grid2">' +
        '<button data-set="death" data-val="0" class="' + (!s.death ? 'chosen' : 'secondary') + '">Wyłączona</button>' +
        '<button data-set="death" data-val="1" class="' + (s.death ? 'chosen' : 'secondary') + '"' + (n < 5 ? ' disabled' : '') + '>Włączona</button></div>' +
        '<p class="muted">Tempo (spokojne = więcej czasu na czytanie i zadania)</p><div class="grid2">' +
        '<button data-set="calm" data-val="0" class="' + (!s.calm ? 'chosen' : 'secondary') + '">Normalne</button>' +
        '<button data-set="calm" data-val="1" class="' + (s.calm ? 'chosen' : 'secondary') + '">Spokojne</button></div>' +
        '<button id="btn-go" class="big-btn"' + (n < 3 ? ' disabled' : '') + '>' + (n < 3 ? 'Potrzeba 3 graczy' : 'Start gry') + '</button></div>';
    } else {
      html += '<p class="muted">Host ustawia grę i ją startuje. Wszystko inne zobaczysz na ekranie gry.</p>';
    }
    var root = setNow('lobby', html);
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
    var html = revealCard(roleBlock(me) + secretBlock(me)) + charCard(me.character, '<div class="muted">Tak widzą cię inni</div>') +
      '<p class="muted">Punkty: ' + me.points + (me.role && me.role.id === 'zlodziej' ? ' · pamiątki: ' + me.heirlooms + '/3' : '') + '</p>';
    var root = $('p-char');
    root.innerHTML = html;
    bindReveal(root);
  }

  function renderNotes(v) {
    var me = v.me;
    var notes = me.notes.slice().reverse().map(function (n) {
      return '<div class="note' + (n.kind === 'info' ? ' info' : '') + '"><div class="when">' + esc(n.clock) + '</div>' + esc(n.text) + '</div>';
    }).join('') || '<p class="muted">Pusto. Poszlaki dostaniesz za zadania, jako świadek albo dzięki roli.</p>';
    $('p-notes').innerHTML = '<h2 class="gold">Twoje poszlaki</h2><p class="muted" style="font-size:.85em">Tylko dla ciebie. Sam decydujesz, czy i komu je zdradzisz.</p>' + notes +
      '<h2 class="gold" style="margin-top:.5em">Tablica dowodów</h2>' + clueList(v.publicClues) +
      '<h2 class="gold" style="margin-top:.5em">Postacie przy stole</h2>' +
      v.players.map(function (p) { return charCard(p.character, '<div class="row"><span class="muted">' + esc(p.name) + '</span>' + statusChip(p) + '</div>'); }).join('');
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
      (room ? '<p>Spędzasz noc: <b>' + esc(room) + '</b></p>' : '') +
      '<p class="muted">Zadanie ' + (n.choice.task === 'ok' ? 'wykonane.' : 'nieudane.') + ' Czekamy na pozostałych.</p>' +
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
    var html = '<div class="stack"><h2 class="gold">Noc, godzina ' + esc(v.clock) + '</h2>' +
      '<p class="muted">Gdzie spędzasz noc? W tym pokoju zrobisz też zadanie.</p><div class="grid2" data-group="room">' +
      ROOMS.map(function (r) { return '<button class="secondary" data-val="' + r.id + '">' + esc(r.name) + '</button>'; }).join('') + '</div>';
    if (n.needsWatch) {
      html += '<p class="muted">Który pokój obserwujesz? Rano dowiesz się, kto tam był.</p><div class="grid2" data-group="watch">' +
        ROOMS.map(function (r) { return '<button class="secondary" data-val="' + r.id + '">' + esc(r.name) + '</button>'; }).join('') + '</div>';
    }
    if (n.targetKind) {
      html += '<p class="muted">' + (n.targetKind === 'kill' ? 'Kogo dziś?' : 'Kogo chronisz tej nocy?') + '</p><div class="choice-list" data-group="target">' +
        n.targets.map(function (t) { return '<button class="secondary" data-val="' + esc(t.id) + '">' + esc(t.label) + '</button>'; }).join('') + '</div>';
    }
    html += '<button id="btn-night-go" class="big-btn" disabled>Dalej: zadanie</button></div>';
    var root = setNow(phoneKey, html + hostBar(v));
    bindSkip(root);
    function refreshSel() {
      ['room', 'watch', 'target'].forEach(function (g) {
        var box = root.querySelector('[data-group="' + g + '"]');
        if (!box) return;
        var bs = box.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute('data-val') === sel[g] ? 'chosen' : 'secondary';
      });
      var ok = !!sel.room && (!n.needsWatch || !!sel.watch) && (!n.targetKind || !!sel.target);
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
      var a = { type: 'night', room: sel.room };
      if (n.needsWatch) a.watch = sel.watch;
      if (n.targetKind) a.target = sel.target;
      act(a).then(function (j) { if (j && j.error) btn.disabled = false; }).catch(function () { btn.disabled = false; });
    });
  }

  function renderNightTask(v) {
    var me = v.me;
    var n = me.night;
    var ghost = me.status !== 'active';
    var roomId = ghost ? 'ghost' : n.choice.room;
    var root = setNow(phoneKey, '<div class="stack"><h2 class="gold">' + (ghost ? 'Zadanie ducha' : 'Zadanie: ' + esc(roomName(roomId))) + '</h2>' +
      (ghost ? '<p class="muted">Jako ' + (me.status === 'dead' ? 'duch' : 'aresztant') + ' pomagasz z zaświatów: co 3 wspólne zadania odsłaniają poszlakę.</p>' : '') +
      '<div id="game"></div></div>' + hostBar(v));
    bindSkip(root);
    var calm = !!(v.settings && v.settings.calm);
    currentGame = runMiniGame($('game'), roomId, calm, function (success) {
      currentGame = null;
      if (success && n.frameTargets && n.frameTargets.length) return chooseFrame(v, n.frameTargets);
      sendTask(success);
    });
  }

  function chooseFrame(v, targets) {
    var root = setNow(phoneKey, '<div class="stack"><h2 class="gold">Zadanie wykonane</h2>' +
      '<p>Komu podrzucasz fałszywy trop? Rano na tablicy pojawi się jedna z jego cech.</p><div class="choice-list">' +
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

  // ---------- mini-gry ----------
  var GAME_FOR_ROOM = {
    biblioteka: 'books', kuchnia: 'salt', gabinet: 'safe', piwnica: 'wine', oranzeria: 'water', strych: 'portraits', ghost: 'candle'
  };

  function runMiniGame(box, roomId, calm, done) {
    var kind = GAME_FOR_ROOM[roomId] || 'candle';
    var limit = (calm ? 70 : 45) * 1000;
    var started = Date.now();
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
    box.innerHTML = '<div class="game-box"><div class="row" style="justify-content:space-between"><span id="g-title"></span><span id="g-time" class="timer"></span></div>' +
      '<p id="g-help" class="muted"></p><div id="g-area" class="stack"></div><button id="g-quit" class="secondary">Rezygnuję</button></div>';
    box.querySelector('#g-quit').addEventListener('click', function () { finish(false); });
    timers.push(setInterval(function () {
      var left = limit - (Date.now() - started);
      var t = box.querySelector('#g-time');
      if (t) t.textContent = fmtTime(left);
      if (left <= 0) finish(false);
    }, 250));
    var title = box.querySelector('#g-title');
    var help = box.querySelector('#g-help');
    var area = box.querySelector('#g-area');

    if (kind === 'books' || kind === 'portraits') {
      var items = kind === 'books'
        ? ['Abecadło', 'Bajki', 'Cukiernia', 'Dżemy', 'Encyklopedia']
        : ['1802', '1849', '1888', '1923', '1961'];
      title.textContent = kind === 'books' ? 'Ułóż tomy na półce' : 'Portrety przodków';
      help.textContent = kind === 'books' ? 'Stukaj w tomy w kolejności alfabetycznej.' : 'Stukaj w portrety od najstarszego (najwcześniejszy rok).';
      var next = 0;
      area.innerHTML = '<div class="game-items">' + shuffle(items).map(function (it) { return '<button class="secondary" data-v="' + esc(it) + '">' + esc(it) + '</button>'; }).join('') + '</div>';
      area.querySelector('.game-items').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.getAttribute('data-v') === items[next]) {
          b.className = 'done';
          b.disabled = true;
          next++;
          if (next === items.length) finish(true);
        } else {
          b.className = 'wrong';
          setTimeout(function () { if (!b.disabled) b.className = 'secondary'; }, 500);
        }
      });
    } else if (kind === 'salt' || kind === 'water' || kind === 'candle') {
      title.textContent = kind === 'salt' ? 'Posól rosół' : kind === 'water' ? 'Podlej storczyk' : 'Zdmuchnij świecę';
      help.textContent = 'Stuknij „Teraz!”, gdy znacznik jest w zielonym polu. Trzy trafienia.';
      var zoneW = calm ? 30 : 22;
      var speed = calm ? 0.55 : 0.8;
      var hits = 0;
      var zoneX = 0;
      area.innerHTML = '<div class="bar"><div class="zone"></div><div class="marker"></div></div><div class="hits center">○○○</div><button class="big-btn">Teraz!</button>';
      var zone = area.querySelector('.zone');
      var marker = area.querySelector('.marker');
      var hitsEl = area.querySelector('.hits');
      function placeZone() {
        zoneX = 5 + Math.random() * (90 - zoneW);
        zone.style.left = zoneX + '%';
        zone.style.width = zoneW + '%';
      }
      placeZone();
      var t0 = performance.now();
      var pos = 0;
      function frame(t) {
        pos = (Math.sin((t - t0) / 1000 * Math.PI * speed) + 1) / 2 * 100;
        marker.style.left = pos + '%';
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      area.querySelector('button').addEventListener('click', function () {
        if (pos >= zoneX && pos <= zoneX + zoneW) {
          hits++;
          hitsEl.textContent = '●●●'.slice(0, hits) + '○○○'.slice(hits);
          if (hits >= 3) { finish(true); return; }
          placeZone();
        } else {
          hitsEl.style.color = 'var(--bad)';
          setTimeout(function () { hitsEl.style.color = ''; }, 300);
        }
      });
    } else if (kind === 'wine') {
      title.textContent = 'Roczniki w piwnicy';
      var pool = ['1921', '1934', '1956', '1968', '1975', '1987', '1999', '2003'];
      var seq = shuffle(pool).slice(0, 4);
      var showMs = calm ? 6000 : 4000;
      var pos2 = 0;
      function showSeq() {
        help.textContent = 'Zapamiętaj kolejność butelek:';
        area.innerHTML = '<p class="center" style="font-size:1.6em;letter-spacing:.1em">' + seq.join(' · ') + '</p>';
        timers.push(setTimeout(askSeq, showMs));
      }
      function askSeq() {
        pos2 = 0;
        help.textContent = 'Stukaj w roczniki w tej samej kolejności.';
        var opts = shuffle(seq.concat(shuffle(pool.filter(function (y) { return seq.indexOf(y) < 0; })).slice(0, 2)));
        area.innerHTML = '<div class="game-items">' + opts.map(function (y) { return '<button class="secondary" data-v="' + y + '">' + y + '</button>'; }).join('') + '</div>';
        area.querySelector('.game-items').addEventListener('click', function (e) {
          var b = e.target.closest('button');
          if (!b || b.disabled) return;
          if (b.getAttribute('data-v') === seq[pos2]) {
            b.className = 'done';
            b.disabled = true;
            pos2++;
            if (pos2 === seq.length) finish(true);
          } else {
            help.textContent = 'Pomyłka. Pokażę jeszcze raz.';
            timers.push(setTimeout(showSeq, 700));
          }
        });
      }
      showSeq();
    } else if (kind === 'safe') {
      title.textContent = 'Sejf w gabinecie';
      help.textContent = 'Policz cyfry szyfru. Potrzebne 3 dobre odpowiedzi.';
      var good = 0;
      function question() {
        var a = 2 + Math.floor(Math.random() * 8);
        var b = 2 + Math.floor(Math.random() * 8);
        var plus = Math.random() < 0.6;
        var ans = plus ? a + b : a * 2;
        var text = plus ? a + ' + ' + b : 'dwa razy ' + a;
        var opts = [ans];
        while (opts.length < 4) {
          var o = ans + Math.floor(Math.random() * 7) - 3;
          if (o > 0 && opts.indexOf(o) < 0) opts.push(o);
        }
        area.innerHTML = '<p class="center" style="font-size:1.5em">' + text + ' = ?</p><p class="center muted">Dobre: ' + good + '/3</p><div class="game-items">' +
          shuffle(opts).map(function (o) { return '<button class="secondary" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>';
        area.querySelector('.game-items').addEventListener('click', function (e) {
          var btn = e.target.closest('button');
          if (!btn) return;
          if (Number(btn.getAttribute('data-v')) === ans) {
            good++;
            if (good >= 3) { finish(true); return; }
          } else {
            btn.className = 'wrong';
          }
          timers.push(setTimeout(question, 350));
        });
      }
      question();
    }
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

  function renderDiscussion(v) {
    var me = v.me;
    var active = me.status === 'active';
    var html = '<div class="panel stack"><h2 class="gold">Narada</h2><p>Rozmawiajcie przy stole. Twoje poszlaki są w zakładce <b>Notes</b>.</p>' +
      '<p class="muted">Pamiętaj: część poszlak na tablicy może być podrzucona przez zabójcę.</p></div>' +
      (active ? (me.ready ? '<p class="muted center">Gotowy do głosowania. Czekamy na resztę… (' + v.readyCount + ')</p>' : '<button id="btn-ready" class="big-btn">Gotowy do głosowania</button>')
        : '<p class="muted">Jako ' + (me.status === 'dead' ? 'duch' : 'aresztant') + ' możesz mówić, ale nie głosujesz aż do świtu.</p>') + hostBar(v);
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
      '</div><p class="muted">' + (me.vote ? 'Głos oddany. Możesz go zmienić do końca czasu.' : 'Wybierz osobę.') +
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
      '<p>' + esc(r.reason) + '</p><p style="font-size:1.3em">' + (won ? 'Wygrałeś!' : 'Tym razem przegrana.') + '</p>' +
      '<p class="muted">Byłeś: ' + esc(me.role ? me.role.name : '') + ' · punkty: ' + me.points + (mineRank ? ' · miejsce ' + mineRank.pos + '/' + r.ranking.length : '') + '</p></div>' +
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
  var playCode = cleanCode(params.get('p'));
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var isNarrow = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (playCode.length === 4) startPhone(playCode);
  else if (params.get('ekran') || !(isTouch && isNarrow)) startScreen();
  else startLanding();
})();
