# Ostatnia wola

Imprezowa gra detektywistyczna: wspólny ekran (TV, laptop, tablet) pokazuje narrację i dowody, a gracze dołączają telefonami przez kod QR i dostają tajne role oraz zadania.

## Etap 1: test sprzętu

`index.html` to strona testowa, która sprawdza, czy ekran i telefony dadzą radę:

- **Ekran:** kod pokoju, kod QR, lista graczy z pingiem, przycisk Start (odblokowuje dźwięk), muzyka, licznik 60 s, diagnostyka przeglądarki.
- **Telefon** (`?p=KOD`): dołączanie z imieniem, licznik zsynchronizowany z ekranem, przycisk „Pomachaj do ekranu”, Wake Lock, powrót do pokoju po odświeżeniu.

Komunikacja idzie przez Supabase Realtime (Broadcast + Presence) w projekcie `ostatnia-wola`.

## Budowanie

```
npm install
npm run build
```

`build.py` wkleja bibliotekę Supabase, generator QR i `src/app.js` do szablonu `src/template.html` i zapisuje jeden samodzielny plik `index.html` (serwowany przez GitHub Pages).
