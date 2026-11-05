-- REST Arena. Run once in Supabase SQL Editor, as the database owner.
-- Question/answer content is deliberately absent from this public migration.
begin;

create schema if not exists arena_private;
revoke all on schema arena_private from public, anon, authenticated;

create table arena_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table arena_private.questions (
  position integer primary key check (position between 0 and 99),
  payload jsonb not null
);

create table public.arena_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  host_id uuid not null references auth.users(id),
  phase text not null default 'lobby' check (phase in ('lobby','question','reveal','scoreboard','finished')),
  question_index integer not null default -1,
  question_public jsonb,
  seconds integer not null default 30 check (seconds in (20,30,45,60)),
  started_at timestamptz,
  deadline timestamptz,
  answered_count integer not null default 0,
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.arena_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  nickname text not null check (char_length(nickname) between 2 and 20),
  avatar_id integer not null check (avatar_id between 0 and 59),
  score integer not null default 0,
  correct integer not null default 0,
  streak integer not null default 0,
  last_earned integer not null default 0,
  joined_at timestamptz not null default clock_timestamp(),
  unique (room_id, user_id)
);
create unique index arena_nickname_unique on public.arena_players(room_id, lower(nickname));
create table arena_private.answers (
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  question_index integer not null,
  user_id uuid not null references auth.users(id),
  value jsonb not null,
  submitted_at timestamptz not null,
  elapsed integer not null,
  correct boolean,
  earned integer,
  speed_bonus integer,
  streak_bonus integer,
  primary key (room_id, question_index, user_id)
);

alter table public.arena_rooms enable row level security;
alter table public.arena_players enable row level security;
alter table arena_private.admins enable row level security;
alter table arena_private.questions enable row level security;
alter table arena_private.answers enable row level security;
revoke all on public.arena_rooms, public.arena_players from anon, authenticated;
grant select on public.arena_rooms, public.arena_players to authenticated;

-- This helper avoids recursive RLS policies; it exposes only a membership boolean.
create function public.arena_is_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.arena_rooms r where r.id = target and r.host_id = auth.uid())
    or exists(select 1 from public.arena_players p where p.room_id = target and p.user_id = auth.uid());
$$;
revoke all on function public.arena_is_member(uuid) from public, anon;
grant execute on function public.arena_is_member(uuid) to authenticated;
create policy arena_rooms_read on public.arena_rooms for select to authenticated
  using (public.arena_is_member(id));
create policy arena_players_read on public.arena_players for select to authenticated
  using (public.arena_is_member(room_id));

create function arena_private.correct_answer(q jsonb, value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if q->>'type' <> 'request' then return value = q->'answer'; end if;
  if jsonb_typeof(value) <> 'object' then return false; end if;
  if upper(trim(value->>'method')) is distinct from q#>>'{request,method}'
     or regexp_replace(trim(value->>'path'), '/+$', '') is distinct from q#>>'{request,path}' then return false; end if;
  if not (q->'request' ? 'body') then return coalesce(trim(value->>'body'),'') = ''; end if;
  return (value->>'body')::jsonb = q#>'{request,body}';
exception when others then return false;
end;
$$;

create function arena_private.close_question(target uuid) returns void
language plpgsql set search_path = '' as $$
declare
  r public.arena_rooms;
  p public.arena_players;
  a arena_private.answers;
  q jsonb;
  right_answer boolean;
  new_streak integer;
  speed integer;
  bonus integer;
  points integer;
begin
  select * into r from public.arena_rooms where id = target for update;
  if r.phase <> 'question' then return; end if;
  select payload into strict q from arena_private.questions where position = r.question_index;
  for p in select * from public.arena_players where room_id = target loop
    select * into a from arena_private.answers where room_id = target and question_index = r.question_index and user_id = p.user_id;
    right_answer := coalesce(arena_private.correct_answer(q, a.value), false);
    new_streak := case when right_answer then p.streak + 1 else 0 end;
    speed := case when right_answer then round(500 * greatest(0, 1 - a.elapsed / (extract(epoch from (r.deadline-r.started_at))*1000)))::integer else 0 end;
    bonus := case when right_answer and new_streak >= 3 then 250 else 0 end;
    points := case when right_answer then (q->>'points')::integer + speed + bonus when a.user_id is not null then 100 else 0 end;
    update public.arena_players set score = score + points, correct = correct + right_answer::integer,
      streak = new_streak, last_earned = points where id = p.id;
    update arena_private.answers set correct = right_answer, earned = points, speed_bonus = speed, streak_bonus = bonus
      where room_id = target and question_index = r.question_index and user_id = p.user_id;
  end loop;
  update public.arena_rooms set phase = 'reveal', question_public = q, revision = revision + 1 where id = target;
end;
$$;

create function arena_private.snapshot(target uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  r public.arena_rooms;
  a arena_private.answers;
  me public.arena_players;
  people jsonb;
  own jsonb := null;
begin
  select * into strict r from public.arena_rooms where id = target;
  select * into me from public.arena_players where room_id = target and user_id = auth.uid();
  select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
    'id',p.id, 'nickname',p.nickname, 'avatarId',p.avatar_id,'score',p.score,'correct',p.correct,
    'streak',p.streak,'lastEarned',p.last_earned,'joinedAt',floor(extract(epoch from p.joined_at)*1000))), '{}')
    into people from public.arena_players p where p.room_id = target;
  select * into a from arena_private.answers where room_id = target and question_index = r.question_index and user_id = auth.uid();
  if a.user_id is not null then
    own := jsonb_build_object('value',a.value,'submitted',true);
    if r.phase <> 'question' then
      own := own || jsonb_build_object('correct',a.correct,'earned',a.earned,'speedBonus',a.speed_bonus,'streakBonus',a.streak_bonus);
    end if;
  end if;
  return jsonb_build_object('serverNow',floor(extract(epoch from clock_timestamp())*1000),
    'session',jsonb_build_object('role',case when r.host_id = auth.uid() then 'admin' else 'guest' end,
      'code',r.code,'roomId',r.id,'playerId',me.id),
    'room',jsonb_build_object('id',r.id,'code',r.code,'phase',r.phase,'questionIndex',r.question_index,
      'questionCount',(select count(*) from arena_private.questions),'seconds',r.seconds,'revision',r.revision,
      'currentQuestion',r.question_public,'startedAt',floor(extract(epoch from r.started_at)*1000),
      'deadline',floor(extract(epoch from r.deadline)*1000),'players',people,'answer',own,'answeredCount',r.answered_count));
end;
$$;

-- All writes pass through this transaction. The caller never supplies scores,
-- roles, timestamps or the correct answer. The room lock serializes submissions.
create function public.arena_command(action text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.arena_rooms;
  q jsonb;
  v jsonb;
  target uuid;
  nickname_value text;
  code_value text;
  seconds_value integer;
  moment timestamptz;
  idx integer;
  attempts integer := 0;
begin
  if uid is null then raise exception 'Tu sesión terminó. Vuelve a entrar.'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 12000 then raise exception 'Solicitud inválida.'; end if;
  if action = 'create' then
    if not exists(select 1 from arena_private.admins where user_id = uid) then raise exception 'Esta cuenta no tiene permiso de administrador.'; end if;
    code_value := trim(coalesce(payload->>'code',''));
    if code_value <> '' then
      select * into r from public.arena_rooms where code = code_value and host_id = uid for update;
      if not found then raise exception 'No se encontró una sala tuya con ese código.'; end if;
    else
      if (select count(*) from arena_private.questions) = 0 then raise exception 'Falta cargar las preguntas del juego.'; end if;
      if (select count(*) from public.arena_rooms where host_id = uid and created_at > now()-interval '24 hours') >= 20 then raise exception 'Límite de salas alcanzado por hoy.'; end if;
      seconds_value := coalesce((payload->>'seconds')::integer,30);
      if seconds_value not in (20,30,45,60) then raise exception 'Selecciona un tiempo válido.'; end if;
      loop
        code_value := (100000 + floor(random()*900000)::integer)::text;
        begin
          insert into public.arena_rooms(code,host_id,seconds) values(code_value,uid,seconds_value) returning * into r;
          exit;
        exception when unique_violation then
          attempts := attempts+1;
          if attempts > 10 then raise exception 'No se pudo generar el código. Inténtalo de nuevo.'; end if;
        end;
      end loop;
    end if;
    return arena_private.snapshot(r.id);
  end if;

  if action = 'join' then
    code_value := trim(payload->>'code');
    if code_value is null or code_value !~ '^[0-9]{6}$' then raise exception 'Escribe un código de seis dígitos.'; end if;
    select * into r from public.arena_rooms where code = code_value for update;
    if not found then raise exception 'No encontramos esa sala. Revisa el código.'; end if;
    if r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
    if r.host_id = uid then raise exception 'Abre otra pestaña para entrar como invitado.'; end if;
    if exists(select 1 from public.arena_players where room_id = r.id and user_id = uid) then return arena_private.snapshot(r.id); end if;
    if r.phase <> 'lobby' then raise exception 'La partida ya empezó. Espera la próxima.'; end if;
    if (select count(*) from public.arena_players where room_id = r.id) >= 50 then raise exception 'La sala está llena (50 jugadores).'; end if;
    nickname_value := trim(normalize(payload->>'nickname', NFC));
    if nickname_value is null or char_length(nickname_value) not between 2 and 20 or nickname_value ~ '[[:cntrl:]]' then raise exception 'Usa un nombre de 2 a 20 caracteres.'; end if;
    if jsonb_typeof(payload->'avatarId') is distinct from 'number' or (payload->>'avatarId') !~ '^[0-9]+$' or (payload->>'avatarId')::integer not between 0 and 59 then raise exception 'Selecciona un avatar válido.'; end if;
    if exists(select 1 from public.arena_players where room_id = r.id and lower(nickname) = lower(nickname_value)) then raise exception 'Ese nombre ya está en la sala. Prueba otro.'; end if;
    insert into public.arena_players(room_id,user_id,nickname,avatar_id) values(r.id,uid,nickname_value,(payload->>'avatarId')::integer);
    update public.arena_rooms set revision=revision+1 where id=r.id;
    return arena_private.snapshot(r.id);
  end if;

  target := (payload->>'roomId')::uuid;
  select * into r from public.arena_rooms where id = target for update;
  if not found or r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
  if not public.arena_is_member(target) then raise exception 'Ya no formas parte de esta sala.'; end if;
  moment := clock_timestamp();
  if r.phase = 'question' and moment >= r.deadline then
    perform arena_private.close_question(target);
    select * into r from public.arena_rooms where id=target;
  end if;

  if action = 'state' then return arena_private.snapshot(target); end if;
  if action = 'answer' then
    if r.host_id = uid then raise exception 'Entra como invitado para responder.'; end if;
    -- Return the committed reveal after expiry; raising here would roll it back.
    if r.phase <> 'question' then return arena_private.snapshot(target); end if;
    if exists(select 1 from arena_private.answers where room_id=target and question_index=r.question_index and user_id=uid) then raise exception 'Ya enviaste tu respuesta.'; end if;
    select question.payload into strict q from arena_private.questions question where position=r.question_index;
    v := payload->'value';
    if q->>'type' <> 'request' then
      if v is null or jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' or v::text::integer >= jsonb_array_length(q->'options') then raise exception 'Selecciona una respuesta.'; end if;
    else
      if v is null or jsonb_typeof(v) <> 'object' or coalesce(v->>'method','') not in ('GET','POST','PUT','PATCH','DELETE') then raise exception 'Selecciona un método HTTP.'; end if;
      if jsonb_typeof(v->'path') is distinct from 'string' or left(trim(v->>'path'),1) <> '/' or char_length(v->>'path') > 200 then raise exception 'Escribe una ruta que empiece con /.'; end if;
      if jsonb_typeof(v->'body') is distinct from 'string' or char_length(v->>'body') > 4000 then raise exception 'Revisa el cuerpo de la petición.'; end if;
      if q->'request' ? 'body' then
        begin perform (v->>'body')::jsonb; exception when others then raise exception 'Revisa el JSON: usa comillas dobles y valores válidos.'; end;
      end if;
    end if;
    insert into arena_private.answers(room_id,question_index,user_id,value,submitted_at,elapsed)
      values(target,r.question_index,uid,v,moment,greatest(0,floor(extract(epoch from (moment-r.started_at))*1000)::integer));
    update public.arena_rooms set answered_count=answered_count+1,revision=revision+1 where id=target;
    return arena_private.snapshot(target);
  end if;

  if action = 'leave' then
    if r.host_id <> uid and r.phase='lobby' then delete from public.arena_players where room_id=target and user_id=uid; end if;
    update public.arena_rooms set revision=revision+1 where id=target;
    return jsonb_build_object('room',null);
  end if;

  if r.host_id <> uid then raise exception 'Esta acción corresponde al administrador.'; end if;
  if action = 'settings' then
    seconds_value := (payload->>'seconds')::integer;
    if r.phase <> 'lobby' or seconds_value is null or seconds_value not in (20,30,45,60) then raise exception 'El tiempo solo se cambia antes de empezar.'; end if;
    update public.arena_rooms set seconds=seconds_value,revision=revision+1 where id=target;
  elsif action = 'remove' then
    if r.phase <> 'lobby' then raise exception 'Solo puedes retirar jugadores antes de empezar.'; end if;
    delete from public.arena_players where room_id=target and id=(payload->>'playerId')::uuid;
    update public.arena_rooms set revision=revision+1 where id=target;
  elsif action = 'reveal' then
    if r.phase='reveal' then return arena_private.snapshot(target); end if;
    if r.phase <> 'question' then raise exception 'No hay una pregunta abierta.'; end if;
    perform arena_private.close_question(target);
  elsif action = 'scoreboard' then
    if r.phase <> 'reveal' then raise exception 'Cierra la pregunta antes de mostrar la tabla.'; end if;
    update public.arena_rooms set phase='scoreboard',revision=revision+1 where id=target;
  elsif action in ('start','next') then
    if action='start' then
      if r.phase <> 'lobby' or not exists(select 1 from public.arena_players where room_id=target) then raise exception 'Espera a que entre al menos un jugador.'; end if;
      idx:=0;
    else
      if r.phase <> 'scoreboard' then raise exception 'Muestra la tabla de puntos antes de continuar.'; end if;
      idx:=r.question_index+1;
    end if;
    select question.payload into q from arena_private.questions question where position=idx;
    if q is null then
      update public.arena_rooms set phase='finished',revision=revision+1 where id=target;
    else
      update public.arena_rooms set phase='question',question_index=idx,answered_count=0,
        question_public=(q-'answer'-'request'-'explanation') || jsonb_build_object('requiresBody',q->'request' ? 'body'),
        started_at=moment,deadline=moment+make_interval(secs=>r.seconds*case when q->>'type'='request' then 2 else 1 end),revision=revision+1
        where id=target;
    end if;
  elsif action = 'restart' then
    if r.phase <> 'finished' then raise exception 'Termina la partida antes de reiniciar.'; end if;
    delete from arena_private.answers where room_id=target;
    update public.arena_players set score=0,correct=0,streak=0,last_earned=0 where room_id=target;
    update public.arena_rooms set phase='lobby',question_index=-1,question_public=null,started_at=null,deadline=null,answered_count=0,revision=revision+1 where id=target;
  else raise exception 'Acción desconocida.';
  end if;
  return arena_private.snapshot(target);
end;
$$;

revoke all on all tables in schema arena_private from public, anon, authenticated;
revoke all on all functions in schema arena_private from public, anon, authenticated;
revoke all on function public.arena_command(text,jsonb) from public, anon;
grant execute on function public.arena_command(text,jsonb) to authenticated;

-- Only the safe room row is broadcast; answers and the bank never enter Realtime.
alter publication supabase_realtime add table public.arena_rooms;
commit;
