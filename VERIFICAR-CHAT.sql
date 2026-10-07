-- ============================================================================
--  VERIFICAR-CHAT.sql · pruebas de permisos del chat (OPCIONAL, sin rastro)
--  Ejecutar DESPUÉS de CHAT-TALLER.sql, entero, en el SQL Editor.
--
--  Crea 3 usuarios ficticios (montador A, montador B, taller/almacén), 2
--  pedidos y un chat, y se hace pasar por cada uno (role authenticated +
--  claims JWT), igual que hace la API. TODO va dentro de una transacción que
--  termina en ROLLBACK: no queda nada en la base de datos.
--
--  Resultado esperado: una lista de NOTICE "OK: ..." y ningún "FALLO".
--  Si algo falla, el script se detiene con el mensaje "FALLO: ...".
--
--  NOTA: abre el chat con un INSERT directo. Tras el PASO 3 de
--  CHAT-TALLER-ABRE.sql (INSERT revocado; los chats se abren con la RPC
--  abrir_chat_pedido) este script falla en el primer paso a propósito: usa
--  entonces la prueba del PASO 2 de CHAT-TALLER-ABRE.sql.
-- ============================================================================
begin;

-- ── Datos de prueba (como postgres) ─────────────────────────────────────────
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'prueba-a@chat.local', '{"nombre":"Prueba A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'prueba-b@chat.local', '{"nombre":"Prueba B"}', now(), now()),
  ('00000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'prueba-t@chat.local', '{"nombre":"Prueba Taller"}', now(), now());
-- (handle_new_user ya les crea el perfil como montador)
update public.profiles set role = 'almacen' where id = '00000000-0000-4000-8000-0000000000c3';

insert into public.pedidos (id, user_uid, fecha, montador, cantidad, estado) values
  (9900000000001, '00000000-0000-4000-8000-0000000000a1', '01/01/2026, 10:00', 'Prueba A', 1, 'Pendiente'),
  (9900000000002, '00000000-0000-4000-8000-0000000000b2', '01/01/2026, 10:00', 'Prueba B', 1, 'Pendiente');

set local role authenticated;

-- ── Montador A ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$
declare ok boolean; v_rol text; n int;
begin
  -- Abre chat de SU pedido.
  insert into public.chats (id, pedido_id, montador_uid)
  values ('11111111-1111-4111-8111-111111111111', 9900000000001, '00000000-0000-4000-8000-0000000000a1');
  raise notice 'OK: A abre chat de su pedido';

  -- No puede abrir chat del pedido de B.
  ok := false;
  begin
    insert into public.chats (pedido_id, montador_uid) values (9900000000002, '00000000-0000-4000-8000-0000000000a1');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A abrió chat en el pedido de B'; end if;
  raise notice 'OK: A no puede abrir chat en pedido ajeno';

  -- Escribe; aunque diga ser taller, la BD le pone rol montador.
  insert into public.chat_mensajes (chat_id, autor_rol, texto, autor_uid)
  values ('11111111-1111-4111-8111-111111111111', 'taller', 'Hola taller', '00000000-0000-4000-8000-0000000000c3')
  returning autor_rol into v_rol;
  if v_rol <> 'montador' then raise exception 'FALLO: autor_rol suplantado (%)', v_rol; end if;
  raise notice 'OK: autor_rol forzado a montador';

  -- Imagen fuera de la carpeta de su chat: rechazada.
  ok := false;
  begin
    insert into public.chat_mensajes (chat_id, autor_rol, imagen_path)
    values ('11111111-1111-4111-8111-111111111111', 'montador', 'otra-carpeta/x.jpg');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: imagen_path fuera de la carpeta del chat'; end if;
  raise notice 'OK: imagen_path restringido a <chat_id>/';

  -- No puede editar ni borrar mensajes, ni borrar el chat, ni usar la RPC.
  ok := false; begin update public.chat_mensajes set texto = 'x'; exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A pudo hacer UPDATE en mensajes'; end if;
  ok := false; begin delete from public.chat_mensajes; exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A pudo hacer DELETE en mensajes'; end if;
  ok := false; begin delete from public.chats; exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A pudo hacer DELETE en chats'; end if;
  ok := false; begin update public.chats set leido_taller_el = now(); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A pudo hacer UPDATE en chats'; end if;
  ok := false; begin perform public.eliminar_chat('11111111-1111-4111-8111-111111111111'); exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A pudo cerrar el chat con la RPC'; end if;
  raise notice 'OK: A no edita/borra mensajes ni chats (error de permisos)';

  -- Storage: sube en la carpeta de su chat, no en otra.
  insert into storage.objects (bucket_id, name) values ('chat-imagenes', '11111111-1111-4111-8111-111111111111/a.jpg');
  ok := false;
  begin insert into storage.objects (bucket_id, name) values ('chat-imagenes', '22222222-2222-4222-8222-222222222222/a.jpg');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: A subió imagen a una carpeta que no es suya'; end if;
  raise notice 'OK: Storage de A restringido a su chat';

  perform public.marcar_chat_leido('11111111-1111-4111-8111-111111111111');
  raise notice 'OK: A marca su chat como leído';
end $$;

-- ── Montador B ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);

do $$
declare ok boolean; n int;
begin
  select count(*) into n from public.chats;
  if n <> 0 then raise exception 'FALLO: B ve % chats ajenos', n; end if;
  select count(*) into n from public.chat_mensajes;
  if n <> 0 then raise exception 'FALLO: B ve % mensajes ajenos', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'chat-imagenes';
  if n <> 0 then raise exception 'FALLO: B ve % imágenes ajenas', n; end if;
  raise notice 'OK: B no ve chats, mensajes ni imágenes de A';

  ok := false;
  begin insert into public.chat_mensajes (chat_id, autor_rol, texto) values ('11111111-1111-4111-8111-111111111111', 'montador', 'intruso');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: B escribió en el chat de A'; end if;
  ok := false;
  begin insert into storage.objects (bucket_id, name) values ('chat-imagenes', '11111111-1111-4111-8111-111111111111/b.jpg');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: B subió imagen al chat de A'; end if;
  ok := false;
  begin perform public.marcar_chat_leido('11111111-1111-4111-8111-111111111111');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLO: B marcó leído el chat de A'; end if;
  raise notice 'OK: B no puede escribir, subir ni marcar en el chat de A';
end $$;

-- ── Taller (almacén) ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);

do $$
declare v_rol text; n int; borrado boolean;
begin
  select count(*) into n from public.chats where id = '11111111-1111-4111-8111-111111111111';
  if n <> 1 then raise exception 'FALLO: el taller no ve el chat'; end if;

  insert into public.chat_mensajes (chat_id, autor_rol, texto)
  values ('11111111-1111-4111-8111-111111111111', 'montador', 'Respuesta del taller')
  returning autor_rol into v_rol;
  if v_rol <> 'taller' then raise exception 'FALLO: rol del taller = %', v_rol; end if;
  insert into storage.objects (bucket_id, name) values ('chat-imagenes', '11111111-1111-4111-8111-111111111111/t.jpg');
  perform public.marcar_chat_leido('11111111-1111-4111-8111-111111111111');
  raise notice 'OK: el taller ve, responde, adjunta y marca leído';

  borrado := public.eliminar_chat('11111111-1111-4111-8111-111111111111');
  if not borrado then raise exception 'FALLO: eliminar_chat devolvió false'; end if;
  select count(*) into n from public.chat_mensajes where chat_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FALLO: quedan % mensajes tras cerrar', n; end if;
  -- Tras cerrar, el taller sigue pudiendo listar la carpeta para barrer restos.
  select count(*) into n from storage.objects
  where bucket_id = 'chat-imagenes' and name like '11111111-1111-4111-8111-111111111111/%';
  if n = 0 then raise exception 'FALLO: el taller no puede listar restos tras cerrar'; end if;
  raise notice 'OK: el taller cierra el chat (mensajes en cascada) y puede barrer la carpeta';
end $$;

reset role;
rollback;   -- no queda nada de la prueba
