create table if not exists public.scout_benchmarks (
  category varchar(50) primary key,
  avg_castle_move numeric(4,2),
  queen_trade_m20_rate numeric(4,2),
  pawn_push_m15_avg numeric(4,2)
);

insert into public.scout_benchmarks (category, avg_castle_move, queen_trade_m20_rate, pawn_push_m15_avg)
values
  ('Open', 7.50, 0.12, 1.80),
  ('Semi-Open', 9.20, 0.18, 2.40),
  ('Closed', 10.80, 0.22, 1.40),
  ('Indian', 8.50, 0.15, 1.60),
  ('Flank', 10.20, 0.10, 1.20)
on conflict (category) do update
set
  avg_castle_move = excluded.avg_castle_move,
  queen_trade_m20_rate = excluded.queen_trade_m20_rate,
  pawn_push_m15_avg = excluded.pawn_push_m15_avg;
