# Ostatnia wola

Imprezowa gra detektywistyczna dla 3–12 osób: wspólny ekran (TV, laptop, tablet) pokazuje narrację, tablicę dowodów i wyniki, a gracze dołączają telefonami przez kod QR i dostają tajne role, postacie, zadania i poszlaki.

**Graj:** https://ruperciacho.github.io/ostatnia-wola/ — otwórz na wspólnym ekranie, telefony skanują kod QR.

## Jak to działa

- `index.html` — cała strona (ekran i telefon), budowana z `src/` przez `build.py`, serwowana przez GitHub Pages.
- `supabase/functions/game/` — Edge Function `game` z silnikiem gry (`engine.ts`), scenariuszem (`data.ts`) i obsługą zapytań (`index.ts`). Stan gry trzyma tabela `games`; klienci nie mają do niej dostępu, każdy dostaje od funkcji tylko swój widok.
- Realtime Broadcast (`ow:KOD`) tylko powiadamia o zmianie wersji; sekrety nigdy nie idą kanałem.

## Rozwój

```
npm install          # biblioteki wklejane do strony
npm run build        # buduje index.html
npm test             # tysiące symulowanych partii + sprawdzenie, że widoki nie zdradzają sekretów
npm run mock         # lokalna atrapa funkcji na porcie 8790 (ten sam silnik)
```

Wdrożenie funkcji: `supabase functions deploy game --no-verify-jwt` (funkcja sama sprawdza tokeny graczy).
