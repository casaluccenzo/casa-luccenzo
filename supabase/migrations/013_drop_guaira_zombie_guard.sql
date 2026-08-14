-- 013: Retirar la red de contención de 012
--
-- NO APLICAR TODAVÍA. Aplicar solo cuando se cumplan las dos condiciones:
--
--   1. Todos los dispositivos que registran ventas están en v282 o superior.
--      Verificable abriendo el sistema en cada uno y confirmando `?v=` en el
--      código fuente, o tocando "Sincronizar y Limpiar este Dispositivo".
--
--      NO usar `active_sessions` como inventario de equipos: lockSession()
--      borra la fila al cerrar sesión, así que la tabla solo lista lo que está
--      conectado en este instante. Un equipo ausente de esa lista no está
--      actualizado -- está apagado, y puede volver mañana con la caché vieja.
--
--   2. La consulta de abajo no devuelve bloqueos recientes, Y hubo una jornada
--      real de operación con los equipos conectados desde que se aplicó 012.
--      Cero bloqueos durante horas en que nadie estuvo conectado no prueba
--      nada; es silencio de una sala vacía.
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
