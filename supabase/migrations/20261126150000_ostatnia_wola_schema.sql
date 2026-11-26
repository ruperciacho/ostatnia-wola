-- Gra „Ostatnia wola” dostaje własny schemat we wspólnej bazie MojeDoDomu (jak ptcg i pofo).
-- Tabela przechodzi razem z danymi, indeksami i RLS. Schemat nie jest wystawiony przez API:
-- dostęp ma tylko Edge Function game przez bezpośrednie połączenie z bazą.
create schema if not exists ostatnia_wola;
comment on schema ostatnia_wola is 'Gra Ostatnia wola. Dostęp wyłącznie przez Edge Function game (bezpośrednie połączenie z bazą).';

alter table public.games set schema ostatnia_wola;
revoke all on table ostatnia_wola.games from anon, authenticated;
comment on table ostatnia_wola.games is 'Stan gry Ostatnia wola. Dostęp wyłącznie przez Edge Function game; klienci nie czytają tabeli.';
