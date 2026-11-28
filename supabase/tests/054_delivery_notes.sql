-- Pruebas de la migración 054 (notas de entrega). Correr SOLO en casa-lucenzo-dev.
-- Todo va dentro de un DO que termina con un error a propósito: así se
-- deshacen los datos de prueba. El mensaje final debe ser "OK 054: ...".
-- Necesita un usuario admin activo en public.profiles (usa el primero).
DO $$
DECLARE
    v_admin uuid := (SELECT id FROM public.profiles WHERE role = 'admin' AND active ORDER BY id LIMIT 1);
    v_loc   uuid;
    v_ts    timestamptz := '2026-01-02 10:00:00-04';
    v_ts2   timestamptz := '2026-01-02 11:00:00-04';
    v_ped   uuid := gen_random_uuid();
    v_ped2  uuid := gen_random_uuid();
    n1 jsonb; n2 jsonb; n3 jsonb; n4 jsonb; v jsonb;
    v_failed boolean;
BEGIN
    IF v_admin IS NULL THEN RAISE EXCEPTION 'No hay admin en profiles'; END IF;
    v_loc := coalesce(public.get_user_location(v_admin), '00000000-0000-0000-0000-000000000001');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- Cuenta de prueba: 3 de carne, 1 de queso, un abono que no debe salir.
    INSERT INTO public.sales (uuid, product_id, name, price, timestamp, location_id, bcv_rate) VALUES
      ('t054-1', 'p1', 'Pastelito de Carne [Juan Pérez - V-12345678] (Pagado - Pago Móvil)', 2.50, v_ts, v_loc, 100),
      ('t054-2', 'p1', 'Pastelito de Carne [Juan Pérez - V-12345678] (Pagado - Pago Móvil)', 2.50, v_ts, v_loc, 100),
      ('t054-3', 'p1', 'Pastelito de Carne [Juan Pérez - V-12345678] (Pagado - Pago Móvil)', 2.50, v_ts, v_loc, 100),
      ('t054-4', 'p2', 'Pastelito de Queso [Juan Pérez - V-12345678] (Pagado - Pago Móvil)', 2.00, v_ts, v_loc, 100),
      ('t054-5', 'abono', 'Abono [Juan Pérez - V-12345678]', 5.00, v_ts, v_loc, 100);

    n1 := public.issue_delivery_note('venta', v_ts, NULL, NULL, NULL, '0412-0000000', true, 'Prueba', NULL);
    IF (n1->>'reissued')::boolean THEN RAISE EXCEPTION 'La primera no debe ser reimpresión'; END IF;
    IF (n1->>'total_usd')::numeric <> 9.50 THEN RAISE EXCEPTION 'Total esperado 9.50, salió %', n1->>'total_usd'; END IF;
    IF jsonb_array_length(n1->'items') <> 2 THEN RAISE EXCEPTION 'Esperaba 2 renglones: %', n1->'items'; END IF;
    IF n1->'items'->0->>'desc' <> 'Pastelito de Carne' OR (n1->'items'->0->>'qty')::int <> 3 THEN
        RAISE EXCEPTION 'Renglón de carne mal armado: %', n1->'items'->0; END IF;
    IF n1->>'client_name' <> 'Juan Pérez' OR n1->>'client_rif' <> 'V-12345678' THEN
        RAISE EXCEPTION 'Cliente de la etiqueta mal leído: % / %', n1->>'client_name', n1->>'client_rif'; END IF;
    IF (n1->>'total_bs')::numeric <> 950 THEN RAISE EXCEPTION 'Bs esperado 950 (tasa de la venta): %', n1->>'total_bs'; END IF;

    -- Reimpresión: mismo número.
    n2 := public.issue_delivery_note('venta', v_ts, NULL, 'Otro', NULL, NULL, false, NULL, 50);
    IF NOT (n2->>'reissued')::boolean OR n2->>'number' <> n1->>'number' THEN
        RAISE EXCEPTION 'La reimpresión dio otro número'; END IF;

    -- Venta inexistente: error y el correlativo no salta.
    v_failed := false;
    BEGIN
        PERFORM public.issue_delivery_note('venta', v_ts2, NULL, NULL, NULL, NULL, true, NULL, NULL);
    EXCEPTION WHEN no_data_found THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'Venta inexistente no dio error'; END IF;

    -- Pedido pendiente: error. Pedido confirmado: nota con dirección.
    INSERT INTO public.pedidos_online (id, customer_name, customer_phone, items, total, payment_method, status, location_id,
                                       delivery_method, delivery_address, delivery_reference)
    VALUES (v_ped, 'Ana', '0414-1111111', '[{"name":"Carne Mechada","qty":2,"price":2.44}]', 4.88, 'Pago Móvil', 'pendiente', v_loc,
            'delivery', 'Calle 5', 'Frente a la plaza'),
           (v_ped2, 'Luis', '0414-2222222', '[{"name":"Queso","qty":1,"price":2}]', 2, 'Pago Móvil', 'confirmado', v_loc,
            'delivery', 'Av. Principal', 'Casa azul');
    v_failed := false;
    BEGIN
        PERFORM public.issue_delivery_note('pedido', NULL, v_ped, NULL, NULL, NULL, true, NULL, 100);
    EXCEPTION WHEN invalid_parameter_value THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'Pedido pendiente no dio error'; END IF;

    n3 := public.issue_delivery_note('pedido', NULL, v_ped2, NULL, NULL, NULL, false, NULL, 100);
    IF (n3->>'number')::int <> (n1->>'number')::int + 1 THEN
        RAISE EXCEPTION 'Correlativo con hueco: % después de %', n3->>'number', n1->>'number'; END IF;
    IF n3->>'delivery_address' <> 'Av. Principal' OR n3->>'client_name' <> 'Luis' OR (n3->>'show_prices')::boolean THEN
        RAISE EXCEPTION 'Nota de pedido mal armada: %', n3; END IF;

    -- Marcar entregada y no dos veces.
    v := public.mark_delivery_note_delivered((n1->>'id')::uuid, 'María', 'v-9999999');
    IF v->>'status' <> 'entregada' OR v->>'received_by_rif' <> 'V-9999999' THEN RAISE EXCEPTION 'No quedó entregada'; END IF;
    v_failed := false;
    BEGIN
        PERFORM public.mark_delivery_note_delivered((n1->>'id')::uuid, 'María', NULL);
    EXCEPTION WHEN no_data_found THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'Se marcó entregada dos veces'; END IF;

    -- Caja (venta) no anula; cocina no emite.
    UPDATE public.profiles SET role = 'venta' WHERE id = v_admin;
    v_failed := false;
    BEGIN
        PERFORM public.void_delivery_note((n3->>'id')::uuid, 'x');
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'La caja pudo anular'; END IF;

    UPDATE public.profiles SET role = 'cocina' WHERE id = v_admin;
    v_failed := false;
    BEGIN
        PERFORM public.issue_delivery_note('venta', v_ts, NULL, NULL, NULL, NULL, true, NULL, NULL);
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'Cocina pudo emitir'; END IF;

    UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;
    v := public.void_delivery_note((n3->>'id')::uuid, 'Prueba de anulación');
    IF v->>'status' <> 'anulada' THEN RAISE EXCEPTION 'No quedó anulada'; END IF;

    -- anon no puede ejecutar.
    IF has_function_privilege('anon', 'public.issue_delivery_note(text, timestamptz, uuid, text, text, text, boolean, text, numeric)', 'execute') THEN
        RAISE EXCEPTION 'anon puede emitir'; END IF;

    RAISE EXCEPTION 'OK 054: notas %, % y % probadas (todo se deshace)', n1->>'number', n2->>'number', n3->>'number';
END;
$$;
