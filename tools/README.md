# Herramientas de Mantenimiento y Depuración - Casa Lucenzo

Este directorio contiene scripts de diagnóstico y mantenimiento ejecutable con Node.js para inspeccionar y depurar el backend de Supabase:

- `check-recent-sales.js`: Consulta las ventas registradas en las últimas horas y verifica el formato de timestamps.
- `check-sales.js`: Realiza un conteo total de ventas y desglose por categorías en la base de datos de Supabase.
- `clean-active-sales.js`: Script de mantenimiento para reiniciar ventas activas de prueba o desasociadas durante pruebas.
- `test-whatsapp-bot.js`: Corre el mismo set de pruebas de integración que `tests/unit.test.js` contra `api/whatsapp-webhook.js`.

## Uso:
```bash
node tools/check-sales.js
node tools/check-recent-sales.js
```

## ⚠️ `whatsapp-qr-bridge.js` — solo local/manual, NO usar en producción

Este script usa [Baileys](https://github.com/WhiskeySockets/Baileys), un cliente de WhatsApp Web **no oficial** (ingeniería inversa del protocolo), como alternativa al webhook oficial de Meta (`api/whatsapp-webhook.js`, que sí corre en producción vía Vercel).

- **Riesgo de baneo**: Meta puede bloquear el número que se conecte así, en cualquier momento.
- Requiere escanear un QR y mantiene una sesión persistente en `whatsapp-session/` — pensado para correr en tu máquina/servidor propio, nunca en un entorno serverless.
- Ya tiene el mismo control de autorización por número de teléfono (`WHATSAPP_ADMIN_PHONE`) que el webhook oficial, pero **no** tiene verificación de firma HMAC (no aplica, no es un webhook HTTP).
- Úsalo solo como respaldo manual si el webhook oficial de Meta no está disponible, y no lo corras simultáneamente en el mismo número que ya usa el webhook oficial.
