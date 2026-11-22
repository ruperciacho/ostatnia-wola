(function () {
  'use strict';

  var SUPABASE_URL = 'https://cbdpajxjdqyhjaqqqbak.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_tHealYjK7umS5-hJR6xPiw_sOciMW4u';
  var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var STATE_INTERVAL_MS = 4000;
  var TIMER_MS = 60000;

  var params = new URLSearchParams(location.search);
  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }

  var storageOk = (function () {
    try { localStorage.setItem('ow-test', '1'); localStorage.removeItem('ow-test'); return true; } catch (e) { return false; }
  })();
  function storageGet(k) { if (!storageOk) return null; try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { if (!storageOk) return; try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function randomCode() {
    var out = '';
    for (var i = 0; i < 4; i++) out += LETTERS.charAt(Math.floor(Math.random() * LETTERS.length));
    return out;
  }

  function randomId() {
    return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function cleanCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function channelName(code) { return 'ow-test:' + code; }

  function statusLabel(status) {
    if (status === 'SUBSCRIBED') return 'połączono';
    if (status === 'TIMED_OUT') return 'przekroczony czas połączenia';
    if (status === 'CHANNEL_ERROR') return 'błąd kanału';
    if (status === 'CLOSED') return 'rozłączono';
    return 'łączenie…';
  }

  function setStatus(node, status) {
    node.textContent = 'Realtime: ' + statusLabel(status);
    node.className = 'chip ' + (status === 'SUBSCRIBED' ? 'ok' : 'warn');
  }

  function joinUrlFor(code) {
    return location.origin + location.pathname + '?p=' + code;
  }

  function baseDiagnostics() {
    var d = document.documentElement;
    return [
      ['WebSocket', 'WebSocket' in window],
      ['Web Audio', !!(window.AudioContext || window.webkitAudioContext)],
      ['Pełny ekran', !!(d.requestFullscreen || d.webkitRequestFullscreen)],
      ['Wake Lock', 'wakeLock' in navigator],
      ['Wibracje', 'vibrate' in navigator],
      ['localStorage', storageOk],
      ['Ekran', screen.width + '×' + screen.height + ', okno ' + window.innerWidth + '×' + window.innerHeight]
    ];
  }

  function renderDiag(container, extra) {
    container.innerHTML = '';
    var rows = baseDiagnostics().concat(extra || []);
    rows.forEach(function (row) {
      var li = el('li');
      li.appendChild(el('span', 'diag-key', row[0]));
      var val = row[1];
      var ok = row.length > 2 ? row[2] : val !== false;
      var text = val === true ? 'tak' : val === false ? 'nie' : String(val);
      li.appendChild(el('span', 'diag-val ' + (ok ? 'good' : 'bad'), text));
      container.appendChild(li);
    });
    var ua = el('li', 'ua');
    ua.textContent = navigator.userAgent;
    container.appendChild(ua);
  }

  // ---------- audio (screen only) ----------
  var audio = null;
  var SEQ = [220, 261.63, 329.63, 261.63, 196, 246.94, 293.66, 246.94];

  function initAudio() {
    if (audio) return audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0.18;
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
    if (!audio) return false;
    if (audio.timer) return true;
    if (audio.ctx.resume) audio.ctx.resume();
    [55, 82.41].forEach(function (f) {
      var o = audio.ctx.createOscillator();
      var g = audio.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.value = 0.07;
      o.connect(g);
      g.connect(audio.master);
      o.start();
      audio.drones.push(o);
    });
    audio.nextTime = audio.ctx.currentTime + 0.1;
    audio.timer = setInterval(function () {
      while (audio.nextTime < audio.ctx.currentTime + 0.3) {
        tone(SEQ[audio.step % SEQ.length], audio.nextTime, 0.45, 'triangle', 0.22);
        if (audio.step % 8 === 0) tone(110, audio.nextTime, 1.6, 'sine', 0.18);
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
    tone(98, t, 2.5, 'sine', 0.5);
    tone(196, t, 2, 'sine', 0.2);
    tone(293.66, t, 1.5, 'sine', 0.1);
  }

  function blip() {
    if (!audio) return;
    var t = audio.ctx.currentTime + 0.02;
    tone(880, t, 0.15, 'square', 0.06);
    tone(1320, t + 0.12, 0.15, 'square', 0.05);
  }

  // ---------- screen ----------
  function startScreen() {
    document.body.className = 'mode-screen';
    show('screen');

    var saved = null;
    try { saved = JSON.parse(storageGet('ow-screen') || 'null'); } catch (e) { saved = null; }
    var code = saved && saved.code && (Date.now() - saved.at < 12 * 3600 * 1000) ? saved.code : randomCode();
    storageSet('ow-screen', JSON.stringify({ code: code, at: Date.now() }));

    var joinUrl = joinUrlFor(code);
    $('room-code').textContent = code;
    $('join-url').textContent = joinUrl.replace(/^https?:\/\//, '');

    if (window.qrcode) {
      var qr = window.qrcode(0, 'M');
      qr.addData(joinUrl);
      qr.make();
      $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } else {
      $('qr').textContent = 'Brak biblioteki QR';
    }

    var players = {};
    var subscribed = false;
    var timerEnd = null;
    var timerDone = false;
    var musicOn = false;
    var lastStatus = 'CONNECTING';

    var ch = client.channel(channelName(code), {
      config: { broadcast: { self: false }, presence: { key: 'screen' } }
    });

    function renderPlayers() {
      var list = $('players');
      list.innerHTML = '';
      var ids = Object.keys(players);
      $('player-count').textContent = String(ids.length);
      if (!ids.length) {
        list.appendChild(el('li', 'empty', 'Zeskanuj kod QR telefonem, żeby dołączyć.'));
        return;
      }
      ids.forEach(function (id) {
        var p = players[id];
        var li = el('li', 'player' + (p.waveUntil && p.waveUntil > Date.now() ? ' waving' : ''));
        li.appendChild(el('span', 'player-name', p.name));
        var rttText = typeof p.rtt === 'number' ? p.rtt + ' ms' : '…';
        var cls = typeof p.rtt !== 'number' ? '' : p.rtt < 250 ? 'good' : p.rtt < 600 ? 'mid' : 'bad';
        li.appendChild(el('span', 'player-rtt ' + cls, rttText));
        list.appendChild(li);
      });
    }

    function refreshDiag() {
      renderDiag($('screen-diag'), [
        ['Kod pokoju', code],
        ['Dźwięk', audio ? (audio.ctx.state === 'running' ? 'gra' : audio.ctx.state) : 'czeka na Start', !audio || audio.ctx.state === 'running'],
        ['Realtime', statusLabel(lastStatus), lastStatus === 'SUBSCRIBED']
      ]);
    }

    function sendState() {
      if (!subscribed) return;
      ch.send({
        type: 'broadcast',
        event: 'state',
        payload: {
          t: Date.now(),
          timerRemaining: timerEnd ? Math.max(0, timerEnd - Date.now()) : null,
          music: musicOn
        }
      });
    }

    function startTimer() {
      timerEnd = Date.now() + TIMER_MS;
      timerDone = false;
      $('timer-label').textContent = 'Noc trwa';
      sendState();
    }

    function toast(text) {
      var t = $('toast');
      t.textContent = text;
      t.className = 'toast visible';
      clearTimeout(toast._h);
      toast._h = setTimeout(function () { t.className = 'toast'; }, 2500);
    }

    ch.on('presence', { event: 'sync' }, function () {
      var state = ch.presenceState();
      var next = {};
      Object.keys(state).forEach(function (key) {
        var metas = state[key];
        var meta = metas && metas[0];
        if (!meta || meta.role !== 'player') return;
        var prev = players[key] || {};
        next[key] = { name: meta.name || 'Gracz', rtt: prev.rtt, waveUntil: prev.waveUntil };
      });
      players = next;
      renderPlayers();
    });

    ch.on('broadcast', { event: 'pong' }, function (msg) {
      var p = msg.payload || {};
      if (players[p.id]) {
        players[p.id].rtt = Date.now() - p.t;
        renderPlayers();
      }
    });

    ch.on('broadcast', { event: 'wave' }, function (msg) {
      var p = msg.payload || {};
      if (players[p.id]) players[p.id].waveUntil = Date.now() + 2500;
      toast((p.name || 'Ktoś') + ' macha do ekranu!');
      blip();
      renderPlayers();
      setTimeout(renderPlayers, 2600);
    });

    ch.subscribe(function (status) {
      lastStatus = status;
      subscribed = status === 'SUBSCRIBED';
      setStatus($('screen-status'), status);
      if (subscribed) {
        ch.track({ role: 'screen', at: Date.now() });
        sendState();
      }
      refreshDiag();
    });

    setInterval(sendState, STATE_INTERVAL_MS);

    setInterval(function () {
      var tEl = $('timer');
      if (!timerEnd) { tEl.textContent = '–:––'; return; }
      var left = timerEnd - Date.now();
      tEl.textContent = fmtTime(left);
      tEl.className = 'timer' + (left <= 10000 && left > 0 ? ' urgent' : '');
      if (left <= 0 && !timerDone) {
        timerDone = true;
        $('timer-label').textContent = 'Koniec czasu';
        gong();
        sendState();
      }
    }, 200);

    $('btn-start').addEventListener('click', function () {
      initAudio();
      musicOn = startMusic();
      hide('start-overlay');
      $('btn-music').textContent = musicOn ? 'Muzyka: wył.' : 'Muzyka niedostępna';
      startTimer();
      refreshDiag();
      setTimeout(refreshDiag, 800);
      $('btn-timer').focus();
    });

    $('btn-music').addEventListener('click', function () {
      if (!audio) initAudio();
      if (musicOn) { stopMusic(); musicOn = false; } else { musicOn = startMusic(); }
      this.textContent = musicOn ? 'Muzyka: wył.' : 'Muzyka: wł.';
      refreshDiag();
      sendState();
    });

    $('btn-timer').addEventListener('click', startTimer);

    $('btn-fullscreen').addEventListener('click', function () {
      var d = document.documentElement;
      var req = d.requestFullscreen || d.webkitRequestFullscreen;
      if (req) req.call(d);
    });

    $('btn-new-room').addEventListener('click', function () {
      storageSet('ow-screen', '');
      location.reload();
    });

    renderPlayers();
    refreshDiag();
    $('btn-start').focus();
  }

  // ---------- phone ----------
  function startPhone(code) {
    document.body.className = 'mode-phone';
    show('phone');
    $('phone-code').textContent = code;

    var id = storageGet('ow-player-id');
    if (!id) { id = randomId(); storageSet('ow-player-id', id); }
    var name = storageGet('ow-player-name') || '';
    $('name-input').value = name;

    var ch = null;
    var joined = false;
    var wakeLock = null;
    var wakeStatus = 'wyłączony';
    var lastSignal = 0;
    var timerEndLocal = null;
    var timerFired = false;
    var lastStatus = 'CONNECTING';
    var screenPresent = false;

    function refreshDiag() {
      renderDiag($('phone-diag'), [
        ['Wake Lock (ekran nie gaśnie)', wakeStatus, wakeStatus === 'aktywny' || wakeStatus === 'wyłączony'],
        ['Ekran gry w pokoju', screenPresent],
        ['Realtime', statusLabel(lastStatus), lastStatus === 'SUBSCRIBED']
      ]);
    }

    function requestWakeLock() {
      if (!('wakeLock' in navigator)) { wakeStatus = 'niedostępny'; refreshDiag(); return; }
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        wakeStatus = 'aktywny';
        lock.addEventListener('release', function () { wakeStatus = 'zwolniony'; refreshDiag(); });
        refreshDiag();
      }).catch(function (e) {
        wakeStatus = 'błąd: ' + (e && e.name ? e.name : 'nieznany');
        refreshDiag();
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && joined && (!wakeLock || wakeLock.released)) requestWakeLock();
    });

    function connect() {
      joined = true;
      hide('join-form');
      show('phone-game');
      $('player-name').textContent = name;
      ch = client.channel(channelName(code), {
        config: { broadcast: { self: false }, presence: { key: id } }
      });

      ch.on('broadcast', { event: 'state' }, function (msg) {
        var p = msg.payload || {};
        lastSignal = Date.now();
        if (typeof p.timerRemaining === 'number') {
          timerEndLocal = Date.now() + p.timerRemaining;
          if (p.timerRemaining > 0) timerFired = false;
        } else {
          timerEndLocal = null;
        }
        ch.send({ type: 'broadcast', event: 'pong', payload: { id: id, t: p.t } });
      });

      ch.on('presence', { event: 'sync' }, function () {
        screenPresent = !!ch.presenceState().screen;
        refreshDiag();
      });

      ch.subscribe(function (status) {
        lastStatus = status;
        setStatus($('phone-status'), status);
        if (status === 'SUBSCRIBED') ch.track({ role: 'player', name: name });
        refreshDiag();
      });
    }

    $('join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      name = ($('name-input').value || '').trim().slice(0, 16) || 'Gracz';
      storageSet('ow-player-name', name);
      storageSet('ow-player-code', code);
      requestWakeLock();
      connect();
    });

    $('btn-wave').addEventListener('click', function () {
      if (!ch) return;
      ch.send({ type: 'broadcast', event: 'wave', payload: { id: id, name: name } });
      if (navigator.vibrate) navigator.vibrate(40);
      var b = this;
      b.disabled = true;
      setTimeout(function () { b.disabled = false; }, 1500);
    });

    setInterval(function () {
      if (!joined) return;
      var tEl = $('phone-timer');
      if (timerEndLocal) {
        var left = timerEndLocal - Date.now();
        tEl.textContent = fmtTime(left);
        if (left <= 0 && !timerFired) {
          timerFired = true;
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      } else {
        tEl.textContent = '–:––';
      }
      var ago = lastSignal ? Math.round((Date.now() - lastSignal) / 1000) : null;
      var sig = $('signal');
      if (ago === null) { sig.textContent = 'Czekam na sygnał z ekranu gry…'; sig.className = 'signal warn'; }
      else if (ago <= STATE_INTERVAL_MS / 1000 + 3) { sig.textContent = 'Sygnał z ekranu: ' + ago + ' s temu'; sig.className = 'signal ok'; }
      else { sig.textContent = 'Brak sygnału z ekranu od ' + ago + ' s'; sig.className = 'signal warn'; }
    }, 500);

    refreshDiag();

    if (name && storageGet('ow-player-code') === code) {
      $('rejoin-note').hidden = false;
      connect();
    } else {
      $('name-input').focus();
    }
  }

  // ---------- landing (phone without code) ----------
  function startLanding() {
    document.body.className = 'mode-landing';
    show('landing');
    $('code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = cleanCode($('code-input').value);
      if (code.length !== 4) { $('code-error').hidden = false; return; }
      location.href = joinUrlFor(code);
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
