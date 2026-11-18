/**
 * Clave de supervisor (v1.0.42).
 *
 * Algunas acciones son solo del admin (borrar un gasto, "Rellenar todo"). Si
 * la vendedora necesita hacer una, aparece esta ventanita: alguien de
 * confianza escribe la clave de supervisor y se hace SOLO esa acción, sin
 * abrir el perfil de admin. Cada autorización queda en el registro de
 * actividad (lo anota js/app/).
 *
 * La clave no está escrita aquí: solo su huella bcrypt (costo 12), que se
 * revisa en el equipo con bcryptjs, igual que el PIN rápido. Para cambiar la
 * clave hay que generar otra huella y reemplazar SUPERVISOR_PIN_HASH.
 */
(function () {
    const SUPERVISOR_PIN_HASH = '$2b$12$YquRng2QftFq9pR0H/sDD.yTkoAykwPmW6b8yOUmRKc6iP1zTnL4W';
    const MAX_FAILS = 3;
    const LOCK_MS = 60 * 1000;
    let fails = 0;
    let lockedUntil = 0;

    function checkPin(pin) {
        return new Promise(resolve => {
            if (!window.bcrypt) return resolve(null);
            try {
                window.bcrypt.compare(String(pin), SUPERVISOR_PIN_HASH, (err, ok) => resolve(err ? null : !!ok));
            } catch (e) {
                resolve(null);
            }
        });
    }

    /**
     * Pide la clave de supervisor para una acción.
     * @param {string} actionLabel Qué se va a hacer, en palabras ("Borrar el gasto ...").
     * @returns {Promise<boolean>} true si la clave fue correcta.
     */
    function ask(actionLabel) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'supervisor-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,30,0.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:4000;padding:1rem;box-sizing:border-box;';
            overlay.innerHTML = `
                <form class="card-pantry" style="width:100%;max-width:340px;padding:1.5rem;border-radius:12px;border:1px solid var(--color-gold);box-sizing:border-box;display:flex;flex-direction:column;gap:0.75rem;" autocomplete="off">
                    <h3 style="font-family:var(--font-serif);font-weight:900;color:var(--color-gold);font-size:1.1rem;margin:0;display:flex;align-items:center;gap:0.5rem;">
                        <i class="fa-solid fa-user-shield"></i> Clave de supervisor
                    </h3>
                    <p class="sup-label" style="margin:0;font-size:0.85rem;color:var(--color-white);opacity:0.9;"></p>
                    <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" class="form-input sup-pin" placeholder="Clave" style="font-size:1.25rem;letter-spacing:0.3em;text-align:center;height:48px;" required>
                    <div class="sup-msg" style="min-height:1.1em;font-size:0.8rem;color:var(--color-danger);"></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                        <button type="button" class="sup-cancel" style="height:42px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:var(--color-text-muted);font-weight:800;cursor:pointer;">Cancelar</button>
                        <button type="submit" class="sup-ok" style="height:42px;border-radius:6px;border:none;background:var(--color-gold);color:#000;font-weight:900;cursor:pointer;">Autorizar</button>
                    </div>
                </form>`;
            overlay.querySelector('.sup-label').textContent = actionLabel || 'Esta acción necesita autorización.';
            document.body.appendChild(overlay);

            const form = overlay.querySelector('form');
            const input = overlay.querySelector('.sup-pin');
            const msg = overlay.querySelector('.sup-msg');
            const okBtn = overlay.querySelector('.sup-ok');
            const done = (result) => {
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                resolve(result);
            };
            setTimeout(() => input.focus(), 50);

            overlay.querySelector('.sup-cancel').addEventListener('click', () => done(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const now = Date.now();
                if (now < lockedUntil) {
                    msg.textContent = `Demasiados intentos. Espere ${Math.ceil((lockedUntil - now) / 1000)} s.`;
                    return;
                }
                okBtn.disabled = true;
                msg.style.color = 'var(--color-text-muted)';
                msg.textContent = 'Revisando...';
                const ok = await checkPin(input.value.trim());
                okBtn.disabled = false;
                msg.style.color = 'var(--color-danger)';
                if (ok === null) {
                    msg.textContent = 'No se pudo revisar la clave en este equipo. Recargue la app.';
                    return;
                }
                if (ok) {
                    fails = 0;
                    done(true);
                    return;
                }
                fails++;
                input.value = '';
                if (fails >= MAX_FAILS) {
                    fails = 0;
                    lockedUntil = Date.now() + LOCK_MS;
                    msg.textContent = 'Clave incorrecta. Bloqueado 1 minuto.';
                } else {
                    msg.textContent = 'Clave incorrecta.';
                }
            });
        });
    }

    window.Supervisor = { ask };
})();
