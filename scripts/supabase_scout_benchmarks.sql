create table if not exists public.scout_benchmarks (
  category varchar(50) primary key,
  avg_castle_move numeric(4,2),
  queen_trade_m20_rate numeric(4,2),
  aggression_m15_avg numeric(4,2),
  avg_game_length numeric(5,2),
  opposite_castle_rate numeric(4,2),
  -- New columns for Cluster-Aware Style Markers
  eval_volatility_avg numeric(6,2),
  book_match_avg numeric(4,2),
  long_game_rate numeric(4,2)
);

-- Add new columns if they don't exist (for existing tables)
alter table public.scout_benchmarks add column if not exists eval_volatility_avg numeric(6,2);
alter table public.scout_benchmarks add column if not exists book_match_avg numeric(4,2);
alter table public.scout_benchmarks add column if not exists long_game_rate numeric(4,2);

insert into public.scout_benchmarks (
  category,
  avg_castle_move,
  queen_trade_m20_rate,
  aggression_m15_avg,
  avg_game_length,
  opposite_castle_rate,
  eval_volatility_avg,
  book_match_avg,
  long_game_rate
)
values
  ('Open', 7.50, 0.12, 1.80, 35.0, 0.15, 110.0, 0.45, 0.25),
  ('Semi-Open', 9.20, 0.18, 2.40, 38.0, 0.25, 100.0, 0.42, 0.30),
  ('Closed', 10.80, 0.22, 1.40, 42.0, 0.10, 75.0, 0.35, 0.45),
  ('Indian', 8.50, 0.15, 1.60, 39.0, 0.15, 95.0, 0.40, 0.35),
  ('Flank', 10.20, 0.10, 1.20, 36.0, 0.05, 85.0, 0.38, 0.28)
on conflict (category) do update
set
  avg_castle_move = excluded.avg_castle_move,
  queen_trade_m20_rate = excluded.queen_trade_m20_rate,
  aggression_m15_avg = excluded.aggression_m15_avg,
  avg_game_length = excluded.avg_game_length,
  opposite_castle_rate = excluded.opposite_castle_rate,
  eval_volatility_avg = excluded.eval_volatility_avg,
  book_match_avg = excluded.book_match_avg,
  long_game_rate = excluded.long_game_rate;
