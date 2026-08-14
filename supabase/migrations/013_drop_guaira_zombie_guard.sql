-- 013: Retirar la red de contención de 012
--
-- NO APLICAR TODAVÍA. Aplicar solo cuando se cumplan las dos condiciones:
--
--   1. Todos los dispositivos que registran ventas están en v282 o superior.
--      Verificable abriendo el sistema en cada uno y confirmando `?v=` en el
--      código fuente, o tocando "Sincronizar y Limpiar este Dispositivo".
--
--   2. La consulta de abajo no devuelve bloqueos recientes. Si devuelve algo,
--      todavía queda un equipo con código viejo y 012 tiene que seguir puesto:
--
--        SELECT timestamp, details
--        FROM activity_logs
--        WHERE action = 'Inserción Bloqueada (horario retirado)'
--        ORDER BY timestamp DESC
--        LIMIT 20;
--
-- Un trigger que bloquea escrituras sobre una tabla de ventas no puede quedarse
-- indefinidamente: en el momento en que alguien olvide que existe, se vuelve
-- una fuente de datos faltantes imposible de explicar.

DROP TRIGGER IF EXISTS trg_block_guaira_zombie ON public.sales;
DROP FUNCTION IF EXISTS block_guaira_zombie_timestamp();
