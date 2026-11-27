# Ostatnia wola

Imprezowa gra detektywistyczna dla 3–12 osób: wspólny ekran (TV, laptop, tablet) pokazuje narrację, tablicę dowodów i wyniki, a gracze dołączają telefonami przez kod QR i dostają tajne role, postacie, zadania i poszlaki.

**Graj:** https://ruperciacho.github.io/ostatnia-wola/ — otwórz na wspólnym ekranie, telefony skanują kod QR.

## Zasady w skrócie

- Po starcie wszyscy widzą ekran zasad: role w tej grze (z liczbami), przebieg jednego dnia, areszt, rozmowy i punkty. Gra rusza, gdy każdy kliknie „Rozumiem”.
- Licznik czasu ma tylko noc (2 min, w spokojnym tempie 3 min); pozostałe fazy idą dalej po potwierdzeniu wszystkich albo po pominięciu przez hosta.
- Głosy są jawne. Zabójca w areszcie zostaje do końca, każdy inny wychodzi następnego dnia po głosowaniu, a głosujący na niewinnego tracą punkt (zabójca i złodziej dostają +1 za machlojkę).
- 12 mini-gier losowanych co noc dla każdego gracza, każda w wersji dla pokoju, w którym gracz spędza noc (osobne wersje dla duchów, aresztantów i zabójcy skradającego się za ofiarą). Po 10 opisów śmierci na pokój.
- Zabójca nie wybiera pokoju: idzie za ofiarą i spędza noc tam, gdzie ona.
- Mini-gry mają 4 poziomy trudności: spokojne tempo zaczyna od 0, normalne od 1, a im bliżej testamentu, tym wyższy poziom. Każda pomyłka zabiera serce (2–3 na grę).
- Telefon sam przerysowuje ekran, który nie pasuje do stanu gry, i zgłasza to do logów funkcji (`client` w logach).

## Jak to działa

- `index.html` — cała strona (ekran i telefon), budowana z `src/` przez `build.py`, serwowana przez GitHub Pages.
- `supabase/functions/game/` — Edge Function `game` z silnikiem gry (`engine.ts`), scenariuszem (`data.ts`) i obsługą zapytań (`index.ts`). Stan gry trzyma tabela `ostatnia_wola.games` we wspólnej bazie Supabase „MojeDoDomu” (osobny schemat, tak jak `ptcg` i `pofo`). Schemat nie jest wystawiony przez API bazy: funkcja łączy się z Postgresem bezpośrednio (`SUPABASE_DB_URL`), a klienci dostają od niej tylko swój widok gry.
- Realtime Broadcast (`ow:KOD`) tylko powiadamia o zmianie wersji; sekrety nigdy nie idą kanałem.

## Rozwój

```
npm install          # biblioteki wklejane do strony
npm run build        # buduje index.html
npm test             # tysiące symulowanych partii + sprawdzenie, że widoki nie zdradzają sekretów
npm run mock         # lokalna atrapa funkcji na porcie 8790 (ten sam silnik)
```

Wdrożenie funkcji: `supabase functions deploy game --no-verify-jwt` (funkcja sama sprawdza tokeny graczy). Zmiany w bazie: `supabase/migrations/`.
