# Herramientas de Mantenimiento y Depuración - Casa Lucenzo

Este directorio contiene scripts de diagnóstico y mantenimiento ejecutable con Node.js para inspeccionar y depurar el backend de Supabase:

- `check-recent-sales.js`: Consulta las ventas registradas en las últimas horas y verifica el formato de timestamps.
- `check-sales.js`: Realiza un conteo total de ventas y desglose por categorías en la base de datos de Supabase.
- `clean-active-sales.js`: Script de mantenimiento para reiniciar ventas activas de prueba o desasociadas durante pruebas.

## Uso:
```bash
node tools/check-sales.js
node tools/check-recent-sales.js
```
