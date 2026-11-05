-- ArtyQuest v2. Upgrade existing installations; preserves identities, rooms and scores.
-- Actual question payloads are supplied privately, outside this repository.
begin;
alter table public.arena_rooms add column if not exists game_version integer not null default 1;
alter table public.arena_rooms add column if not exists transition_at timestamptz;
alter table public.arena_rooms drop constraint if exists arena_rooms_phase_check;
alter table public.arena_rooms add constraint arena_rooms_phase_check check (phase in ('lobby','countdown','question','reveal','scoreboard','finished'));
alter table arena_private.questions add column if not exists version integer not null default 1;
alter table arena_private.questions drop constraint if exists questions_pkey;
alter table arena_private.questions add primary key(version,position);

create or replace function arena_private.correct_answer(q jsonb, value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare i integer;
begin
  if q->>'type' in ('quiz','order') then return value = q->'answer'; end if;
  if q->>'type'='code' then
    if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> jsonb_array_length(q->'answer') then return false; end if;
    for i in 0..jsonb_array_length(value)-1 loop
      if jsonb_typeof(value->i) <> 'string' or lower(regexp_replace(trim(value->>i),'\s+','','g')) is distinct from lower(regexp_replace(trim(q#>>array['answer',i::text]),'\s+','','g')) then return false; end if;
    end loop;
    return true;
  end if;
  if q->>'type' <> 'request' or jsonb_typeof(value) <> 'object' then return false; end if;
  if upper(trim(value->>'method')) is distinct from q#>>'{request,method}'
     or regexp_replace(trim(value->>'path'), '/+$', '') is distinct from q#>>'{request,path}' then return false; end if;
  if not (q->'request' ? 'body') then return coalesce(trim(value->>'body'),'') = ''; end if;
  return (value->>'body')::jsonb = q#>'{request,body}';
exception when others then return false;
end;
$$;

create or replace function arena_private.validate_answer(q jsonb, v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if q->>'type'='quiz' then
    if v is null or jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' or v::text::integer >= jsonb_array_length(q->'options') then raise exception 'Selecciona una respuesta.'; end if;
  elsif q->>'type'='request' then
    if v is null or jsonb_typeof(v) <> 'object' or coalesce(v->>'method','') not in ('GET','POST','PUT','PATCH','DELETE') then raise exception 'Selecciona un método HTTP.'; end if;
    if jsonb_typeof(v->'path') is distinct from 'string' or left(trim(v->>'path'),1) <> '/' or char_length(v->>'path') > 200 then raise exception 'Escribe una ruta que empiece con /.'; end if;
    if jsonb_typeof(v->'body') is distinct from 'string' or char_length(v->>'body') > 4000 then raise exception 'Revisa el cuerpo de la petición.'; end if;
    if q->'request' ? 'body' then
      begin perform (v->>'body')::jsonb; exception when others then raise exception 'Revisa el JSON: usa comillas dobles y valores válidos.'; end;
    end if;
  elsif q->>'type'='order' then
    if v is null or jsonb_typeof(v) <> 'array' then raise exception 'Ordena todos los pasos.'; end if;
    if jsonb_array_length(v) <> jsonb_array_length(q->'items') or exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e)<>'string') then raise exception 'Ordena todos los pasos.'; end if;
    if (select count(distinct e) from jsonb_array_elements_text(v) e) <> jsonb_array_length(v)
       or exists(select 1 from jsonb_array_elements_text(v) e where not exists(select 1 from jsonb_array_elements(q->'items') item where item->>'id'=e)) then raise exception 'La secuencia contiene pasos inválidos o repetidos.'; end if;
  elsif q->>'type'='code' then
    if v is null or jsonb_typeof(v) <> 'array' then raise exception 'Completa todos los espacios.'; end if;
    if jsonb_array_length(v) <> jsonb_array_length(q->'blanks') or exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e)<>'string' or char_length(e#>>'{}')>80 or trim(e#>>'{}')='') then raise exception 'Completa todos los espacios (máximo 80 caracteres).'; end if;
  else raise exception 'Tipo de reto no disponible.';
  end if;
end;
$$;

create or replace function arena_private.close_question(target uuid) returns void
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
  select payload into strict q from arena_private.questions where position = r.question_index and version = r.game_version;
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
  update public.arena_rooms set phase = 'reveal', transition_at = null, question_public = q, revision = revision + 1 where id = target;
end;
$$;

create or replace function arena_private.open_question(target uuid, idx integer, beginning timestamptz) returns void
language plpgsql set search_path = '' as $$
declare r public.arena_rooms; q jsonb; safe jsonb; shuffled jsonb;
begin
  select * into strict r from public.arena_rooms where id=target for update;
  select question.payload into q from arena_private.questions question where version=r.game_version and position=idx;
  if q is null then
    update public.arena_rooms set phase='finished',transition_at=null,revision=revision+1 where id=target;
    return;
  end if;
  safe:=(q-'answer'-'request'-'explanation'-'solution') || jsonb_build_object('requiresBody',coalesce(q->'request' ? 'body',false));
  if q->>'type'='order' then
    select jsonb_agg(item order by random()) into shuffled from jsonb_array_elements(q->'items') item;
    -- Avoid revealing the solution by accidentally presenting the correct sequence.
    if (select jsonb_agg(item->'id') from jsonb_array_elements(shuffled) item) = q->'answer' then
      select jsonb_agg(item order by n desc) into shuffled from jsonb_array_elements(shuffled) with ordinality as x(item,n);
    end if;
    safe:=jsonb_set(safe,'{items}',shuffled);
  end if;
  update public.arena_rooms set phase='question',question_index=idx,answered_count=0,question_public=safe,
    started_at=beginning,deadline=beginning+make_interval(secs=>r.seconds*case when q->>'type'='quiz' then 1 else 2 end),transition_at=null,revision=revision+1 where id=target;
end;
$$;

create or replace function arena_private.advance(target uuid) returns void
language plpgsql set search_path = '' as $$
declare r public.arena_rooms;
begin
  select * into strict r from public.arena_rooms where id=target for update;
  if r.phase in ('countdown','scoreboard') and r.transition_at is not null and clock_timestamp() >= r.transition_at then
    perform arena_private.open_question(target,case when r.phase='countdown' then 0 else r.question_index+1 end,r.transition_at);
    select * into r from public.arena_rooms where id=target;
  end if;
  if r.phase='question' and clock_timestamp() >= r.deadline then perform arena_private.close_question(target); end if;
end;
$$;

create or replace function arena_private.snapshot(target uuid) returns jsonb
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
      'flowVersion',2,'gameVersion',r.game_version,'transitionAt',floor(extract(epoch from r.transition_at)*1000),'questionCount',(select count(*) from arena_private.questions where version=r.game_version),'seconds',r.seconds,'revision',r.revision,
      'currentQuestion',r.question_public,'startedAt',floor(extract(epoch from r.started_at)*1000),
      'deadline',floor(extract(epoch from r.deadline)*1000),'players',people,'answer',own,'answeredCount',r.answered_count));
end;
$$;

create or replace function public.arena_command(action text, payload jsonb default '{}') returns jsonb
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
      if (select count(*) from arena_private.questions where version=case when arena_command.payload->>'flowVersion'='2' then 2 else 1 end) = 0 then raise exception 'Falta cargar las preguntas del juego.'; end if;
      if (select count(*) from public.arena_rooms where host_id = uid and created_at > now()-interval '24 hours') >= 20 then raise exception 'Límite de salas alcanzado por hoy.'; end if;
      seconds_value := coalesce((payload->>'seconds')::integer,30);
      if seconds_value not in (20,30,45,60) then raise exception 'Selecciona un tiempo válido.'; end if;
      loop
        code_value := (100000 + floor(random()*900000)::integer)::text;
        begin
          insert into public.arena_rooms(code,host_id,seconds,game_version) values(code_value,uid,seconds_value,case when payload->>'flowVersion'='2' then 2 else 1 end) returning * into r;
          exit;
        exception when unique_violation then
          attempts := attempts+1;
          if attempts > 10 then raise exception 'No se pudo generar el código. Inténtalo de nuevo.'; end if;
        end;
      end loop;
    end if;
    if r.game_version=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
    return arena_private.snapshot(r.id);
  end if;

  if action = 'join' then
    code_value := trim(payload->>'code');
    if code_value is null or code_value !~ '^[0-9]{6}$' then raise exception 'Escribe un código de seis dígitos.'; end if;
    select * into r from public.arena_rooms where code = code_value for update;
    if not found then raise exception 'No encontramos esa sala. Revisa el código.'; end if;
    if r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
    if r.game_version=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
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
  if r.game_version=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
  moment := clock_timestamp();
  perform arena_private.advance(target);
  select * into r from public.arena_rooms where id=target;

  if action = 'state' then return arena_private.snapshot(target); end if;
  if action = 'answer' then
    if r.host_id = uid then raise exception 'Entra como invitado para responder.'; end if;
    -- Return the committed reveal after expiry; raising here would roll it back.
    if r.phase <> 'question' then return arena_private.snapshot(target); end if;
    if exists(select 1 from arena_private.answers where room_id=target and question_index=r.question_index and user_id=uid) then raise exception 'Ya enviaste tu respuesta.'; end if;
    select question.payload into strict q from arena_private.questions question where position=r.question_index and version=r.game_version;
    if r.game_version=2 and (jsonb_typeof(payload->'questionIndex') is distinct from 'number' or (payload->>'questionIndex')::integer <> r.question_index) then return arena_private.snapshot(target); end if;
    v := payload->'value';
    perform arena_private.validate_answer(q,v);
    insert into arena_private.answers(room_id,question_index,user_id,value,submitted_at,elapsed)
      values(target,r.question_index,uid,v,moment,greatest(0,floor(extract(epoch from (moment-r.started_at))*1000)::integer));
    update public.arena_rooms set answered_count=answered_count+1,revision=revision+1 where id=target;
    if r.game_version=2 and (select answered_count from public.arena_rooms where id=target) >= (select count(*) from public.arena_players where room_id=target) then
      perform arena_private.close_question(target);
    end if;
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
    -- Compatibility with a host tab opened before this upgrade.
    if r.phase <> 'reveal' then raise exception 'Espera a que termine el reto.'; end if;
    if r.game_version=1 then update public.arena_rooms set phase='scoreboard',revision=revision+1 where id=target; end if;
    return arena_private.snapshot(target);
  elsif action = 'start' then
    if r.phase='countdown' then return arena_private.snapshot(target); end if;
    if r.phase <> 'lobby' or not exists(select 1 from public.arena_players where room_id=target) then raise exception 'Espera a que entre al menos un jugador.'; end if;
    if payload->>'flowVersion' is distinct from '2' then
      perform arena_private.open_question(target,0,moment);
      return arena_private.snapshot(target);
    end if;
    if not exists(select 1 from arena_private.questions where version=2) then raise exception 'Falta cargar los retos de ArtyQuest.'; end if;
    update public.arena_rooms set phase='countdown',game_version=2,question_index=-1,question_public=null,
      started_at=null,deadline=null,transition_at=moment+interval '5 seconds',revision=revision+1 where id=target;
  elsif action = 'next' then
    if r.game_version=1 and payload->>'flowVersion' is distinct from '2' then
      if r.phase <> 'scoreboard' then raise exception 'Muestra la tabla de puntos antes de continuar.'; end if;
      perform arena_private.open_question(target,r.question_index+1,moment);
      return arena_private.snapshot(target);
    end if;
    if payload ? 'questionIndex' and (payload->>'questionIndex')::integer <> r.question_index then return arena_private.snapshot(target); end if;
    if r.phase='scoreboard' and r.transition_at is not null then return arena_private.snapshot(target); end if;
    if r.phase='question' then perform arena_private.close_question(target);
    elsif r.phase not in ('reveal','scoreboard') then raise exception 'No se puede avanzar en este momento.'; end if;
    update public.arena_rooms set phase='scoreboard',transition_at=moment+interval '5 seconds',revision=revision+1 where id=target;
  elsif action = 'restart' then
    if r.phase <> 'finished' then raise exception 'Termina la partida antes de reiniciar.'; end if;
    delete from arena_private.answers where room_id=target;
    update public.arena_players set score=0,correct=0,streak=0,last_earned=0 where room_id=target;
    update public.arena_rooms set phase='lobby',game_version=case when payload->>'flowVersion'='2' then 2 else game_version end,transition_at=null,question_index=-1,question_public=null,started_at=null,deadline=null,answered_count=0,revision=revision+1 where id=target;
  else raise exception 'Acción desconocida.';
  end if;
  return arena_private.snapshot(target);
end;
$$;

create or replace function public.arena_version() returns integer language sql immutable set search_path='' as $$ select 2 $$;
revoke all on function public.arena_version() from public;
grant execute on function public.arena_version() to anon, authenticated;
revoke all on all functions in schema arena_private from public,anon,authenticated;
revoke all on function public.arena_command(text,jsonb) from public,anon;
grant execute on function public.arena_command(text,jsonb) to authenticated;
commit;
