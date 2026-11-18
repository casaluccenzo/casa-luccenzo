// Aviso de actualización y dispositivos activos.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Display a full screen blur overlay when a PWA/ServiceWorker update is found/downloading
 */
function showUpdateOverlay() {
    if (document.getElementById('pwa-update-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pwa-update-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(10, 15, 30, 0.9)';
    overlay.style.backdropFilter = 'blur(12px)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';
    overlay.style.transition = 'opacity 0.3s ease-in-out';
    overlay.style.color = '#FFFFFF';
    overlay.style.textAlign = 'center';
    overlay.style.padding = '2rem';
    overlay.style.boxSizing = 'border-box';

    overlay.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.02); border: 1.5px solid var(--color-gold); box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 30px rgba(212,175,55,0.15); max-width: 380px; padding: 2.25rem; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 1.25rem; transform: scale(0.9); animation: scaleIn 0.3s forwards ease-out;">
            <div id="pwa-update-icon-container" style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; background: rgba(212, 175, 55, 0.1); border-radius: 100px; border: 1px solid rgba(212, 175, 55, 0.3);">
                <i class="fa-solid fa-arrows-rotate fa-spin" style="color: var(--color-gold); font-size: 1.75rem;"></i>
            </div>
            <div>
                <h3 id="pwa-update-title" style="font-family: var(--font-serif); font-size: 1.2rem; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; margin-top: 0;">Cargando Actualización</h3>
                <p id="pwa-update-desc" style="font-size: 0.8rem; color: var(--color-white); line-height: 1.5; margin: 0;">
                    Estamos instalando la versión más reciente del sistema en producción. Espera un momento por favor...
                </p>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; position: relative;">
                <div style="height: 100%; background: var(--color-gold); border-radius: 3px; width: 35%; animation: loaderProgress 1.5s infinite linear; position: absolute; left: 0;"></div>
            </div>
        </div>
        
        <style>
            @keyframes loaderProgress {
                0% { left: -35%; width: 35%; }
                50% { left: 30%; width: 40%; }
                100% { left: 100%; width: 35%; }
            }
            @keyframes pulseSuccess {
                0% { transform: scale(0.7); opacity: 0; }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); opacity: 1; }
            }
        </style>
    `;

    document.body.appendChild(overlay);
}

/**
 * Update the overlay UI state to indicate that the update has successfully completed
 */
function updateOverlayStatusSuccess() {
    const iconContainer = document.getElementById('pwa-update-icon-container');
    const title = document.getElementById('pwa-update-title');
    const desc = document.getElementById('pwa-update-desc');

    if (iconContainer) {
        iconContainer.style.background = 'rgba(16, 185, 129, 0.15)';
        iconContainer.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        iconContainer.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--color-success); font-size: 1.85rem; animation: pulseSuccess 0.5s;"></i>`;
    }

    if (title) {
        title.style.color = 'var(--color-success)';
        title.innerText = '¡Sistema Actualizado!';
    }

    if (desc) {
        desc.innerText = 'Actualización completada con éxito. Reiniciando el sistema ahora...';
    }
}

/**
 * Render connected devices inside settings modal
 * @param {Array} sessions List of active sessions
 * @param {string} currentDeviceId This device's UUID
 * @param {Function} onDisconnect Callback when clicking disconnect/expulsar
 * @param {Function} onTrust Callback when clicking trust/autorizar
 */
function renderActiveDevices(sessions, currentDeviceId, onDisconnect, onTrust) {
    const listDiv = document.getElementById('settings-devices-list');
    if (!listDiv) return;

    if (!sessions || sessions.length === 0) {
        listDiv.innerHTML = `
            <div style="text-align: center; padding: 1rem 0; color: var(--color-text-muted); font-size: 0.75rem;">
                No hay dispositivos registrados en el servidor.
            </div>
        `;
        return;
    }

    let html = '';
    sessions.forEach(sess => {
        const isMe = sess.device_id === currentDeviceId;
        const isTrusted = sess.is_trusted === true;
        const meBadge = isMe ? '<span style="font-size: 8px; background: rgba(201, 162, 74, 0.15); border: 1px solid var(--color-gold); color: var(--color-gold); padding: 1px 4px; border-radius: 4px; font-weight: 800; margin-left: 0.25rem;">ESTE DISPOSITIVO</span>' : '';
        const trustBadge = isTrusted ? '<span style="font-size: 8px; background: rgba(16, 185, 129, 0.15); border: 1px solid var(--color-success); color: var(--color-success); padding: 1px 4px; border-radius: 4px; font-weight: 800; margin-left: 0.25rem;">CONFIABLE</span>' : '';
        const roleName = sess.role === 'admin' ? 'Administrador' : sess.role === 'cocina' ? 'Cocina' : 'Ventas (Local)';
        const dateObj = new Date(sess.last_active_at);
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isOnline = (Date.now() - dateObj.getTime()) < 120000;
        const statusDot = isOnline 
            ? '<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: var(--color-success); box-shadow: 0 0 6px var(--color-success); margin-left: 0.25rem;" title="En línea"></span>'
            : '<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: var(--color-text-muted); margin-left: 0.25rem;" title="Desconectado"></span>';

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.625rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-sm);">
                <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1;">
                    <div style="font-size: 1.15rem; color: ${isMe ? 'var(--color-gold)' : isTrusted ? '#34D399' : 'var(--color-text-muted)'};">
                        <i class="${sess.device_name.includes('Phone') || sess.device_name.includes('iPad') ? 'fa-solid fa-mobile-screen-button' : 'fa-solid fa-desktop'}"></i>
                    </div>
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-size: 0.75rem; font-weight: 700; color: var(--color-white); display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">${sess.device_name}</span>
                            ${statusDot} ${meBadge} ${trustBadge}
                        </div>
                        <div style="font-size: 9px; color: var(--color-text-muted);">
                            Rol: <strong>${roleName}</strong> | Activo: ${timeStr}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                    <!-- Botón de Autorización (Verde) -->
                    <button class="btn-trust-device" data-id="${sess.device_id}" data-trusted="${isTrusted}" style="width: 2rem; height: 2rem; border-radius: var(--radius-sm); border: 1px solid ${isTrusted ? 'var(--color-success)' : 'rgba(16, 185, 129, 0.3)'}; background: ${isTrusted ? 'rgba(16, 185, 129, 0.15)' : 'transparent'}; color: ${isTrusted ? '#34D399' : 'rgba(16, 185, 129, 0.7)'}; cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: all 0.2s;">
                        <i class="${isTrusted ? 'fa-solid fa-shield-halved' : 'fa-solid fa-shield'}" style="font-size: 0.75rem;"></i>
                    </button>

                    <!-- Botón de Expulsión (Rojo) -->
                    ${!isMe ? `
                        <button class="btn-eject-device" data-id="${sess.device_id}" style="width: 2rem; height: 2rem; border-radius: var(--radius-sm); border: 1px solid var(--color-danger-border); background: var(--color-danger-bg); color: var(--color-danger); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: opacity 0.2s;">
                            <i class="fa-solid fa-right-from-bracket" style="font-size: 0.75rem;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    listDiv.innerHTML = html;

    // Bind eject button click events
    listDiv.querySelectorAll('.btn-eject-device').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const devId = e.currentTarget.dataset.id;
            onDisconnect(devId);
        });
    });

    // Bind trust button click events
    listDiv.querySelectorAll('.btn-trust-device').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const devId = e.currentTarget.dataset.id;
            const currentVal = e.currentTarget.dataset.trusted === 'true';
            onTrust(devId, !currentVal);
        });
    });
}
