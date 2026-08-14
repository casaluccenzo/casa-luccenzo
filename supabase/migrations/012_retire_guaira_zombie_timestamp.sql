-- 012: Retirar el horario "zombie" de la cuenta La guaira (2026-08-14)
--
-- CONTEXTO
-- El 14/08/2026 la cuenta "La guaira" (horario 10:56:27.615+00) se duplicó seis
-- veces seguidas. La causa de fondo estaba en el cliente y se corrigió en v282:
-- loadAllDataFromSupabase() reinsertaba en el servidor cualquier venta que el
-- dispositivo tuviera en su caché local y el servidor ya no, sin poder
-- distinguir un borrado deliberado de una escritura perdida. Cualquier equipo
-- con la copia vieja en memoria resucitaba la cuenta cada ~45s.
--
-- Mientras queden dispositivos ejecutando código anterior a v282, siguen
-- pudiendo reinsertar esas filas. Este trigger es la red de contención hasta
-- que todos estén actualizados.
--
-- POR QUÉ ASÍ Y NO SILENCIOSO
-- La primera versión (aplicada a mano el 14/08 desde una sesión, sin quedar en
-- ninguna migración) hacía RETURN NULL y descartaba la fila sin dejar rastro.
-- Un INSERT que desaparece sin error es exactamente el tipo de cosa que genera
-- un misterio irresoluble meses después. Esta versión hace lo mismo pero lo
-- registra en activity_logs, así que si alguna vez bloquea algo, se ve.
--
-- ESTO ES TEMPORAL. Ver 013 para el retiro.

CREATE OR REPLACE FUNCTION block_guaira_zombie_timestamp()
RETURNS trigger AS $$
BEGIN
  IF NEW.timestamp = '2026-08-14 10:56:27.615+00' THEN
    BEGIN
      INSERT INTO public.activity_logs (role, action, details, timestamp)
      VALUES (
        'sistema',
        'Inserción Bloqueada (horario retirado)',
        format(
          'Se bloqueó un INSERT en sales sobre el horario retirado de "La guaira" (2026-08-14 10:56:27.615+00). Producto: %s, monto: %s, uuid: %s. Indica que todavía hay un dispositivo ejecutando código anterior a v282.',
          COALESCE(NEW.name, '(sin nombre)'), COALESCE(NEW.price::text, '?'), COALESCE(NEW.uuid, '?')
        ),
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      -- Registrar nunca debe impedir el bloqueo en sí.
      NULL;
    END;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_guaira_zombie ON public.sales;
CREATE TRIGGER trg_block_guaira_zombie
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION block_guaira_zombie_timestamp();
