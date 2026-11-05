-- Presence uses authenticated identities, never IP addresses. No actual questions here.
begin;
alter table public.arena_rooms add column if not exists closed_at timestamptz;
alter table public.arena_rooms add column if not exists close_reason text;
alter table public.arena_rooms add column if not exists end_at timestamptz;
alter table public.arena_rooms drop constraint if exists arena_rooms_phase_check;
alter table public.arena_rooms add constraint arena_rooms_phase_check check(phase in ('lobby','countdown','question','reveal','scoreboard','finished','closed'));
alter table public.arena_players add column if not exists connected boolean not null default true;
drop index if exists public.arena_nickname_unique;
create unique index arena_nickname_unique on public.arena_players(room_id,lower(nickname)) where connected;
create table if not exists arena_private.presence(
 room_id uuid not null references public.arena_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id),connection_id uuid not null,
 last_seen timestamptz not null default clock_timestamp(),background boolean not null default false,
 depart_at timestamptz,removed boolean not null default false,primary key(room_id,user_id)
);
revoke all on arena_private.presence from public,anon,authenticated;

create or replace function public.arena_is_member(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.arena_rooms r where r.id=target and r.host_id=auth.uid())
 or exists(select 1 from public.arena_players p where p.room_id=target and p.user_id=auth.uid()
   and not exists(select 1 from arena_private.presence s where s.room_id=target and s.user_id=auth.uid() and s.removed));
$$;

create or replace function arena_private.fold_json_text(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(value)='string' then return to_jsonb(lower(trim(value#>>'{}'))); end if;
 if jsonb_typeof(value)='object' then select jsonb_object_agg(key,arena_private.fold_json_text(val)) into result from jsonb_each(value) as x(key,val); return coalesce(result,'{}'); end if;
 if jsonb_typeof(value)='array' then select jsonb_agg(arena_private.fold_json_text(val) order by n) into result from jsonb_array_elements(value) with ordinality as x(val,n); return coalesce(result,'[]'); end if;
 return value;
end;
$$;
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
  if coalesce((q->>'acceptAnyTitle')::boolean,false) then
    if jsonb_typeof((value->>'body')::jsonb->'titulo') is distinct from 'string' or char_length(trim((value->>'body')::jsonb->>'titulo')) not between 1 and 100 then return false; end if;
    return arena_private.fold_json_text(((value->>'body')::jsonb)-'titulo')=arena_private.fold_json_text((q#>'{request,body}')-'titulo');
  end if;
  return arena_private.fold_json_text((value->>'body')::jsonb)=arena_private.fold_json_text(q#>'{request,body}');
exception when others then return false;
end;
$$;
create or replace function arena_private.validate_answer(q jsonb, v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if q->>'type'='quiz' then
    if v is null or jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' or v::text::integer >= jsonb_array_length(q->'options') then raise exception 'Selecciona una respuesta.'; end if;
  elsif q->>'type'='request' then
    if v is null or jsonb_typeof(v) <> 'object' or upper(trim(coalesce(v->>'method',''))) not in ('GET','POST','PUT','PATCH','DELETE') then raise exception 'Selecciona un método HTTP.'; end if;
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

create or replace function arena_private.end_room(target uuid,reason text) returns void
language plpgsql set search_path='' as $$
begin
 update public.arena_rooms set phase='closed',closed_at=clock_timestamp(),close_reason=reason,question_public=null,deadline=null,transition_at=null,end_at=null,revision=revision+1 where id=target and phase<>'closed';
 update public.arena_players set connected=false where room_id=target and connected;
end;
$$;

create or replace function arena_private.closed_state(target uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('room',null,'closed',true,'reason',coalesce(close_reason,'La sala terminó.')) from public.arena_rooms where id=target;
$$;

create or replace function arena_private.presence_deadline(target uuid) returns bigint
language sql stable set search_path='' as $$
 select floor(extract(epoch from min(deadline))*1000)::bigint from (
   select least(last_seen+case when background then interval '150 seconds' else interval '75 seconds' end,coalesce(depart_at,'infinity'::timestamptz)) as deadline from arena_private.presence s where s.room_id=target and not s.removed
     and (s.user_id=(select host_id from public.arena_rooms where id=target) or exists(select 1 from public.arena_players p where p.room_id=target and p.user_id=s.user_id and p.connected))
   union all select end_at from public.arena_rooms where id=target and end_at is not null
 ) deadlines;
$$;

create or replace function arena_private.attach_presence(target uuid,data jsonb) returns void
language plpgsql set search_path='' as $$
declare uid uuid:=auth.uid(); was_offline boolean;
begin
 if data->>'connectionId' is null then raise exception 'Recarga ArtyQuest para conectar tu pestaña.'; end if;
 if exists(select 1 from arena_private.presence where room_id=target and user_id=uid and removed) then raise exception 'Ya no formas parte de esta sala.'; end if;
 insert into arena_private.presence(room_id,user_id,connection_id,background) values(target,uid,(data->>'connectionId')::uuid,coalesce((data->>'background')::boolean,false))
 on conflict(room_id,user_id) do update set connection_id=excluded.connection_id,last_seen=clock_timestamp(),depart_at=null,background=excluded.background;
 update public.arena_players set connected=true where room_id=target and user_id=uid and not connected;
 if found then update public.arena_rooms set revision=revision+1 where id=target; end if;
end;
$$;

create or replace function arena_private.sweep_presence(target uuid) returns void
language plpgsql set search_path='' as $$
declare r public.arena_rooms; changed boolean;
begin
 select * into strict r from public.arena_rooms where id=target for update;
 if r.game_version<4 or r.phase='closed' then return; end if;
 if r.end_at is not null and clock_timestamp()>=r.end_at then perform arena_private.end_room(target,'La partida terminó.'); return; end if;
 if exists(select 1 from arena_private.presence where room_id=target and user_id=r.host_id and
   (removed or clock_timestamp()>=least(last_seen+case when background then interval '150 seconds' else interval '75 seconds' end,coalesce(depart_at,'infinity'::timestamptz)))) then
   perform arena_private.end_room(target,'El anfitrión se desconectó.'); return;
 end if;
 update public.arena_players p set connected=false where p.room_id=target and p.connected and exists(
   select 1 from arena_private.presence s where s.room_id=target and s.user_id=p.user_id and
    (s.removed or clock_timestamp()>=least(s.last_seen+case when s.background then interval '150 seconds' else interval '75 seconds' end,coalesce(s.depart_at,'infinity'::timestamptz)))
 );
 changed:=found;
 if changed then update public.arena_rooms set revision=revision+1 where id=target; end if;
 if r.phase='question' and exists(select 1 from public.arena_players where room_id=target and connected) and
  (select count(*) from arena_private.answers a join public.arena_players p on p.room_id=a.room_id and p.user_id=a.user_id where a.room_id=target and a.question_index=r.question_index and p.connected) >= (select count(*) from public.arena_players where room_id=target and connected)
 then perform arena_private.close_question(target); end if;
end;
$$;

create or replace function arena_private.open_question(target uuid, idx integer, beginning timestamptz) returns void
language plpgsql set search_path = '' as $$
declare r public.arena_rooms; q jsonb; safe jsonb; shuffled jsonb;
begin
  select * into strict r from public.arena_rooms where id=target for update;
  select question.payload into q from arena_private.questions question where version=r.game_version and position=idx;
  if q is null then
    update public.arena_rooms set phase='finished',end_at=case when r.game_version>=4 then beginning+interval '30 seconds' else null end,transition_at=null,revision=revision+1 where id=target;
    return;
  end if;
  safe:=(q-'answer'-'request'-'explanation'-'solution'-'acceptAnyTitle') || jsonb_build_object('requiresBody',coalesce(q->'request' ? 'body',false));
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
    'connected',p.connected,'id',p.id, 'nickname',p.nickname, 'avatarId',p.avatar_id,'score',p.score,'correct',p.correct,
    'streak',p.streak,'lastEarned',p.last_earned,'joinedAt',floor(extract(epoch from p.joined_at)*1000))), '{}')
    into people from public.arena_players p where p.room_id = target and (r.game_version<4 or p.connected);
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
      'flowVersion',2,'presenceVersion',4,'presenceDeadline',arena_private.presence_deadline(target),'endAt',floor(extract(epoch from r.end_at)*1000),'gameVersion',r.game_version,'transitionAt',floor(extract(epoch from r.transition_at)*1000),'questionCount',(select count(*) from arena_private.questions where version=r.game_version),'seconds',r.seconds,'revision',r.revision,
      'currentQuestion',r.question_public,'startedAt',floor(extract(epoch from r.started_at)*1000),
      'deadline',floor(extract(epoch from r.deadline)*1000),'players',people,'answer',own,'answeredCount',case when r.game_version>=4 then (select count(*) from arena_private.answers ans join public.arena_players p on p.room_id=ans.room_id and p.user_id=ans.user_id where ans.room_id=target and ans.question_index=r.question_index and p.connected) else r.answered_count end));
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
  requested_version integer := case when payload->>'bankVersion'='4' then 4 when payload->>'bankVersion'='3' then 3 when payload->>'flowVersion'='2' then 2 else 1 end;
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
      if (select count(*) from arena_private.questions where version=requested_version) = 0 then raise exception 'Falta cargar las preguntas del juego.'; end if;
      if (select count(*) from public.arena_rooms where host_id = uid and created_at > now()-interval '24 hours') >= 20 then raise exception 'Límite de salas alcanzado por hoy.'; end if;
      seconds_value := coalesce((payload->>'seconds')::integer,30);
      if seconds_value not in (20,30,45,60) then raise exception 'Selecciona un tiempo válido.'; end if;
      loop
        code_value := (100000 + floor(random()*900000)::integer)::text;
        begin
          insert into public.arena_rooms(code,host_id,seconds,game_version) values(code_value,uid,seconds_value,requested_version) returning * into r;
          exit;
        exception when unique_violation then
          attempts := attempts+1;
          if attempts > 10 then raise exception 'No se pudo generar el código. Inténtalo de nuevo.'; end if;
        end;
      end loop;
    end if;
    if r.game_version>=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
    if r.game_version>=4 and payload->>'clientVersion' is distinct from '4' then raise exception 'Recarga ArtyQuest para entrar a esta sala.'; end if;
    if r.phase='closed' then return arena_private.closed_state(r.id); end if;
    if r.game_version>=4 then perform arena_private.attach_presence(r.id,payload); end if;
    return arena_private.snapshot(r.id);
  end if;

  if action = 'join' then
    code_value := trim(payload->>'code');
    if code_value is null or code_value !~ '^[0-9]{6}$' then raise exception 'Escribe un código de seis dígitos.'; end if;
    select * into r from public.arena_rooms where code = code_value for update;
    if not found then raise exception 'No encontramos esa sala. Revisa el código.'; end if;
    if r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
    if r.game_version>=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
    if r.game_version>=4 and payload->>'clientVersion' is distinct from '4' then raise exception 'Recarga ArtyQuest para entrar a esta sala.'; end if;
    perform arena_private.sweep_presence(r.id);
    select * into r from public.arena_rooms where id=r.id;
    if r.phase='closed' then return arena_private.closed_state(r.id); end if;
    if r.host_id = uid then raise exception 'Abre otra pestaña para entrar como invitado.'; end if;
    if exists(select 1 from public.arena_players where room_id=r.id and user_id=uid) then
      if r.game_version>=4 then perform arena_private.attach_presence(r.id,payload); end if;
      return arena_private.snapshot(r.id);
    end if;
    if r.phase <> 'lobby' then raise exception 'La partida ya empezó. Espera la próxima.'; end if;
    if (select count(*) from public.arena_players where room_id = r.id and connected) >= 50 then raise exception 'La sala está llena (50 jugadores).'; end if;
    nickname_value := trim(normalize(payload->>'nickname', NFC));
    if nickname_value is null or char_length(nickname_value) not between 2 and 20 or nickname_value ~ '[[:cntrl:]]' then raise exception 'Usa un nombre de 2 a 20 caracteres.'; end if;
    if jsonb_typeof(payload->'avatarId') is distinct from 'number' or (payload->>'avatarId') !~ '^[0-9]+$' or (payload->>'avatarId')::integer not between 0 and 79 then raise exception 'Selecciona un avatar válido.'; end if;
    if exists(select 1 from public.arena_players where room_id = r.id and lower(nickname) = lower(nickname_value) and connected) then raise exception 'Ese nombre ya está en la sala. Prueba otro.'; end if;
    insert into public.arena_players(room_id,user_id,nickname,avatar_id) values(r.id,uid,nickname_value,(payload->>'avatarId')::integer);
    if r.game_version>=4 then perform arena_private.attach_presence(r.id,payload); end if;
    update public.arena_rooms set revision=revision+1 where id=r.id;
    return arena_private.snapshot(r.id);
  end if;

  target := (payload->>'roomId')::uuid;
  select * into r from public.arena_rooms where id = target for update;
  if not found or r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
  if not public.arena_is_member(target) then raise exception 'Ya no formas parte de esta sala.'; end if;
  if r.game_version>=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
  if r.game_version>=4 and payload->>'clientVersion' is distinct from '4' then raise exception 'Recarga ArtyQuest para continuar.'; end if;
  if r.phase='closed' then return arena_private.closed_state(target); end if;
  if r.game_version>=4 and exists(select 1 from arena_private.presence where room_id=target and user_id=uid and removed) then raise exception 'Ya no formas parte de esta sala.'; end if;
  perform arena_private.sweep_presence(target);
  select * into r from public.arena_rooms where id=target;
  if r.phase='closed' then return arena_private.closed_state(target); end if;
  if action='attach' then
    if r.game_version>=4 then perform arena_private.attach_presence(target,payload); end if;
  elsif action='heartbeat' then
    update arena_private.presence set last_seen=clock_timestamp(),background=coalesce((payload->>'background')::boolean,false),depart_at=null
      where room_id=target and user_id=uid and connection_id=(payload->>'connectionId')::uuid and not removed;
  elsif action='depart' then
    update arena_private.presence set depart_at=coalesce(depart_at,clock_timestamp()+interval '15 seconds')
      where room_id=target and user_id=uid and connection_id=(payload->>'connectionId')::uuid and not removed;
    if found then update public.arena_rooms set revision=revision+1 where id=target; end if;
    return arena_private.snapshot(target);
  elsif action='close' or (action='leave' and r.host_id=uid and r.game_version>=4) then
    if r.host_id<>uid then raise exception 'Esta acción corresponde al administrador.'; end if;
    perform arena_private.end_room(target,'El anfitrión cerró la sala.');
    return arena_private.closed_state(target);
  elsif action='leave' and r.game_version>=4 then
    update public.arena_players set connected=false where room_id=target and user_id=uid;
    update arena_private.presence set removed=true where room_id=target and user_id=uid;
    update public.arena_rooms set revision=revision+1 where id=target;
    perform arena_private.sweep_presence(target);
    return jsonb_build_object('room',null,'left',true);
  end if;
  moment := clock_timestamp();
  perform arena_private.advance(target);
  select * into r from public.arena_rooms where id=target;

  if action in ('state','attach','heartbeat') then return arena_private.snapshot(target); end if;
  if action = 'answer' then
    if r.host_id = uid then raise exception 'Entra como invitado para responder.'; end if;
    -- Return the committed reveal after expiry; raising here would roll it back.
    if r.phase <> 'question' then return arena_private.snapshot(target); end if;
    if exists(select 1 from arena_private.answers where room_id=target and question_index=r.question_index and user_id=uid) then raise exception 'Ya enviaste tu respuesta.'; end if;
    select question.payload into strict q from arena_private.questions question where position=r.question_index and version=r.game_version;
    if r.game_version>=2 and (jsonb_typeof(payload->'questionIndex') is distinct from 'number' or (payload->>'questionIndex')::integer <> r.question_index) then return arena_private.snapshot(target); end if;
    v := payload->'value';
    perform arena_private.validate_answer(q,v);
    insert into arena_private.answers(room_id,question_index,user_id,value,submitted_at,elapsed)
      values(target,r.question_index,uid,v,moment,greatest(0,floor(extract(epoch from (moment-r.started_at))*1000)::integer));
    update public.arena_rooms set answered_count=answered_count+1,revision=revision+1 where id=target;
    if r.game_version>=2 and exists(select 1 from public.arena_players where room_id=target and connected) and (select count(*) from arena_private.answers a join public.arena_players p on p.room_id=a.room_id and p.user_id=a.user_id where a.room_id=target and a.question_index=r.question_index and p.connected) >= (select count(*) from public.arena_players where room_id=target and connected) then
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
    if r.phase <> 'lobby' or not exists(select 1 from public.arena_players where room_id=target and connected) then raise exception 'Espera a que entre al menos un jugador.'; end if;
    if payload->>'flowVersion' is distinct from '2' then
      perform arena_private.open_question(target,0,moment);
      return arena_private.snapshot(target);
    end if;
    if not exists(select 1 from arena_private.questions where version=requested_version) then raise exception 'Falta cargar los retos de ArtyQuest.'; end if;
    update public.arena_rooms set phase='countdown',game_version=requested_version,question_index=-1,question_public=null,
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
    if r.game_version>=4 then raise exception 'Esta partida terminó. Cierra la sala y crea una nueva.'; end if;
    if r.phase <> 'finished' then raise exception 'Termina la partida antes de reiniciar.'; end if;
    delete from arena_private.answers where room_id=target;
    update public.arena_players set score=0,correct=0,streak=0,last_earned=0 where room_id=target;
    update public.arena_rooms set phase='lobby',game_version=case when payload->>'flowVersion'='2' then requested_version else game_version end,transition_at=null,question_index=-1,question_public=null,started_at=null,deadline=null,answered_count=0,revision=revision+1 where id=target;
  else raise exception 'Acción desconocida.';
  end if;
  return arena_private.snapshot(target);
end;
$$;
create or replace function public.arena_version() returns integer language sql immutable set search_path='' as $$ select 4 $$;
revoke all on all functions in schema arena_private from public,anon,authenticated;
commit;
