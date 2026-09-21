-- SpeakTime — 1차 스키마
-- board 앱과 같은 프로젝트를 공유하므로 speak_ 접두사로 격리한다.
-- (별도 스키마는 PostgREST 노출 설정이 따로 필요해 접두사 방식을 택함)

create table if not exists public.speak_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  scenario_id  text not null,
  created_at   timestamptz not null default now(),
  -- 이 앱의 북극성 지표: 실제로 입 밖에 낸 시간
  speaking_ms  integer not null default 0 check (speaking_ms >= 0),
  -- 채움말 + 1.5초 이상 멈춤
  hesitations  integer not null default 0 check (hesitations >= 0),
  -- 한국어 구조대 호출 횟수
  rescues      integer not null default 0 check (rescues >= 0),
  -- [{ role: 'ai'|'you', text, ms }]
  turns        jsonb not null default '[]'::jsonb,
  report       jsonb
);

create table if not exists public.speak_chunks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  en           text not null,
  ko           text not null,
  origin       text not null check (origin in ('scenario', 'rescue', 'feedback')),
  scenario_id  text,
  session_id   uuid references public.speak_sessions(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- 간격 반복은 '요일'이 아니라 '세션 카운트' 기준.
  -- 주 3~4회만 해도 스케줄이 무너지지 않는다. 0 -> 다음 세션, 1 -> 3세션 후, 2 -> 7세션 후 ...
  interval_step   smallint not null default 0,
  due_at_session  integer  not null default 1,
  last_result     text check (last_result in ('got_it', 'shaky', 'blank'))
);

create unique index if not exists speak_chunks_user_en_uniq
  on public.speak_chunks (user_id, lower(en));
create index if not exists speak_sessions_user_created
  on public.speak_sessions (user_id, created_at desc);
create index if not exists speak_chunks_user_due
  on public.speak_chunks (user_id, due_at_session);

alter table public.speak_sessions enable row level security;
alter table public.speak_chunks   enable row level security;

drop policy if exists speak_sessions_own on public.speak_sessions;
create policy speak_sessions_own on public.speak_sessions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists speak_chunks_own on public.speak_chunks;
create policy speak_chunks_own on public.speak_chunks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
