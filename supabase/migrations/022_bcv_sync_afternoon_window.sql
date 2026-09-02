-- Migration 022: acotar el cron de la tasa BCV a la franja 3pm-8pm Venezuela
--
-- El BCV publica la tasa del próximo día hábil en la tarde/noche. Correr el
-- sync 24 veces al día no aportaba nada fuera de esa ventana. Venezuela es
-- UTC-4 fijo (sin horario de verano), así que 15:00-20:00 VET = 19:00-00:00
-- UTC. Corre en el minuto :07 de las horas UTC 19, 20, 21, 22, 23 y 0
-- (= 3pm, 4pm, 5pm, 6pm, 7pm y 8pm hora Venezuela). 6 corridas por día.
--
-- cron.schedule con el mismo jobname reemplaza el schedule anterior (el de
-- la migración 021, que era '7 * * * *' = cada hora).

SELECT cron.schedule('sync-bcv-rate', '7 0,19,20,21,22,23 * * *', $$SELECT public.sync_bcv_rate()$$);
