-- Mobile challenge bank and 80 illustrated avatars. Existing games keep their bank.
begin;
alter table public.arena_players drop constraint if exists arena_players_avatar_id_check;
alter table public.arena_players add constraint arena_players_avatar_id_check check (avatar_id between 0 and 79);
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
  requested_version integer := case when payload->>'bankVersion'='3' then 3 when payload->>'flowVersion'='2' then 2 else 1 end;
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
    return arena_private.snapshot(r.id);
  end if;

  if action = 'join' then
    code_value := trim(payload->>'code');
    if code_value is null or code_value !~ '^[0-9]{6}$' then raise exception 'Escribe un código de seis dígitos.'; end if;
    select * into r from public.arena_rooms where code = code_value for update;
    if not found then raise exception 'No encontramos esa sala. Revisa el código.'; end if;
    if r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
    if r.game_version>=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
    if r.host_id = uid then raise exception 'Abre otra pestaña para entrar como invitado.'; end if;
    if exists(select 1 from public.arena_players where room_id = r.id and user_id = uid) then return arena_private.snapshot(r.id); end if;
    if r.phase <> 'lobby' then raise exception 'La partida ya empezó. Espera la próxima.'; end if;
    if (select count(*) from public.arena_players where room_id = r.id) >= 50 then raise exception 'La sala está llena (50 jugadores).'; end if;
    nickname_value := trim(normalize(payload->>'nickname', NFC));
    if nickname_value is null or char_length(nickname_value) not between 2 and 20 or nickname_value ~ '[[:cntrl:]]' then raise exception 'Usa un nombre de 2 a 20 caracteres.'; end if;
    if jsonb_typeof(payload->'avatarId') is distinct from 'number' or (payload->>'avatarId') !~ '^[0-9]+$' or (payload->>'avatarId')::integer not between 0 and 79 then raise exception 'Selecciona un avatar válido.'; end if;
    if exists(select 1 from public.arena_players where room_id = r.id and lower(nickname) = lower(nickname_value)) then raise exception 'Ese nombre ya está en la sala. Prueba otro.'; end if;
    insert into public.arena_players(room_id,user_id,nickname,avatar_id) values(r.id,uid,nickname_value,(payload->>'avatarId')::integer);
    update public.arena_rooms set revision=revision+1 where id=r.id;
    return arena_private.snapshot(r.id);
  end if;

  target := (payload->>'roomId')::uuid;
  select * into r from public.arena_rooms where id = target for update;
  if not found or r.created_at < now()-interval '24 hours' then raise exception 'Esta sala ya no está disponible.'; end if;
  if not public.arena_is_member(target) then raise exception 'Ya no formas parte de esta sala.'; end if;
  if r.game_version>=2 and payload->>'flowVersion' is distinct from '2' then raise exception 'Esta sala usa ArtyQuest. Abre la web nueva o recarga la página.'; end if;
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
    if r.game_version>=2 and (jsonb_typeof(payload->'questionIndex') is distinct from 'number' or (payload->>'questionIndex')::integer <> r.question_index) then return arena_private.snapshot(target); end if;
    v := payload->'value';
    perform arena_private.validate_answer(q,v);
    insert into arena_private.answers(room_id,question_index,user_id,value,submitted_at,elapsed)
      values(target,r.question_index,uid,v,moment,greatest(0,floor(extract(epoch from (moment-r.started_at))*1000)::integer));
    update public.arena_rooms set answered_count=answered_count+1,revision=revision+1 where id=target;
    if r.game_version>=2 and (select answered_count from public.arena_rooms where id=target) >= (select count(*) from public.arena_players where room_id=target) then
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
    if r.phase <> 'finished' then raise exception 'Termina la partida antes de reiniciar.'; end if;
    delete from arena_private.answers where room_id=target;
    update public.arena_players set score=0,correct=0,streak=0,last_earned=0 where room_id=target;
    update public.arena_rooms set phase='lobby',game_version=case when payload->>'flowVersion'='2' then requested_version else game_version end,transition_at=null,question_index=-1,question_public=null,started_at=null,deadline=null,answered_count=0,revision=revision+1 where id=target;
  else raise exception 'Acción desconocida.';
  end if;
  return arena_private.snapshot(target);
end;
$$;

create or replace function public.arena_version() returns integer language sql immutable set search_path='' as $$ select 3 $$;
commit;
