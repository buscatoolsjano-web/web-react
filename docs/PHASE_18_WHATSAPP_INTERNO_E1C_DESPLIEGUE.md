# Fase 18 · E1C — El listener 24/7

Fecha: 2026-09-18.
Código: [`backend/whatsapp-listener/`](../backend/whatsapp-listener) · despliegue en [`despliegue/`](../backend/whatsapp-listener/despliegue).

E1B dejó el listener funcionando **en la PC de Juan**. Eso alcanzó para validar la
ingesta; no alcanza para nada más: si la PC se apaga, se pierden los mensajes de esas
horas, y **WhatsApp no los reenvía** a un dispositivo vinculado que estaba caído.

---

## 1 · Los dos cabos sueltos de E1B

### `messages.update` y los eventos sin contenido

E1B terminó con dos eventos que llegaron con la llave completa y sin contenido
(`conMensaje=false`), y dos hipótesis sin evidencia. Auditado sobre el código de la
versión instalada (`baileys@7.0.0-rc14`, `lib/Socket/messages-recv.js`):

- cuando un mensaje **no se puede descifrar**, Baileys le pone
  `messageStubType = CIPHERTEXT` y **igual emite el upsert** (hay un comentario
  explícito en la fuente: «Don't return — fall through to upsertMessage so the stub
  is emitted»);
- después pide un *placeholder resend*, y **el mensaje reenviado vuelve como otro
  `messages.upsert`**, no como una actualización con contenido. El `messages.update`
  que se emite en ese camino sólo lleva `messageStubParameters` con el id del pedido;
- los avisos del sistema —«Fulano se unió», «cambió el código de seguridad»— usan la
  misma estructura, también sin contenido, con su propio `messageStubType`.

O sea: **por ese camino no se pierde ningún mensaje**, porque el reenvío entra por la
puerta que ya escuchábamos. Aun así se agregaron dos cosas:

1. **Se escucha `messages.update`** y, si alguna vez trae contenido, se traduce y se
   emite igual. No puede duplicar: la RPC contesta `duplicado` por el índice único de
   `provider_message_id`. «Casi nunca» no es «nunca», y perder un mensaje en silencio
   ya costó tres pruebas reales una vez.
2. **El diagnóstico ahora dice `stub`**, así que la próxima vez que aparezca un evento
   vacío no hay que deducir nada: el log dice si era un aviso del sistema o un mensaje
   que no se pudo descifrar.

### La allowlist deja de vivir en el `.env`

Antes, habilitar un grupo obligaba a reiniciar el proceso — y reiniciar un listener no
es gratis: durante el reconnect, lo que llegue se pierde.

Ahora la fuente de verdad es `whatsapp_group_allowlist`, la misma tabla que ya validaba
la RPC del lado del servidor. Se relee **cada minuto** y habilitar o deshabilitar un
grupo tiene efecto sin tocar el proceso.

**Qué pasa si Supabase no contesta.** Acá hay un compromiso que conviene ver escrito,
porque no es obvio:

| Situación | Qué hace | Por qué |
|---|---|---|
| Nunca se pudo leer la tabla | **No hay nada autorizado** | Sin confirmación no se ingiere. Esto no se negocia. |
| Se leyó bien y ahora la base falla | La última lista buena vale **10 minutos más** | Un mensaje descartado **no vuelve**. Cortar la ingesta por un hipo de dos segundos pierde conversación real y para siempre; seguir diez minutos con una lista que cambia una vez por mes no le hace daño a nadie. |
| La base lleva más de 10 minutos caída | **Se deniega todo** | Media hora sin base es un problema de verdad, y ahí sí conviene dejar de escribir. |

La ventana es configurable. `/health` publica `allowlistLeidaEn`, así que un atraso se
ve antes de que corte.

---

## 2 · Dónde vive el proceso

Lo que necesita este listener es poco y muy específico: **un proceso siempre
encendido**, **un volumen persistente** de ~2 MB con muchos archivos chicos, reinicio
automático, secretos y logs. No sirve HTTP público, no escala horizontalmente y no
tiene picos.

Y tiene un requisito que manda sobre todos los demás:

> **Nunca puede haber dos procesos con la misma sesión.**
> WhatsApp permite un dispositivo vinculado por sesión. Si dos instancias levantan la
> misma carpeta de credenciales, se echan mutuamente (`connectionReplaced`, 440) y se
> turnan para reconectar hasta que WhatsApp corta. Con un cliente no oficial, ése es el
> camino más corto a perder el número.

| | VPS + systemd | Fly.io | Railway |
|---|---|---|---|
| Proceso persistente | Sí | Sí | Sí |
| Volumen persistente | El disco, sin configurar nada | Volumen, hay que crearlo y montarlo | Volumen |
| **Riesgo de dos sesiones** | **Ninguno**: una máquina, un servicio | Real durante los deploys y las migraciones de máquina; se evita con `strategy = immediate`, `min_machines_running = 1` y sin autoescalado | Real en los redeploys; menos control |
| Reinicio automático | `Restart=always` + `RestartSec` | Política de reinicio | Sí |
| Secretos | Archivo `600` de root | `fly secrets` | Variables del proyecto |
| Costo | ~4–6 USD/mes, fijo | ~2–5 USD/mes | ~5 USD + uso |
| Qué hay que administrar | La máquina: updates, systemd | Casi nada | Nada |

**Recomendación: VPS con systemd.**

No por costo —la diferencia es de dos dólares— sino por el modelo de fallas. En un VPS
hay **una** máquina y **un** servicio: la situación de dos sesiones simultáneas
directamente no puede ocurrir. En una plataforma que orquesta máquinas, evitarla
depende de tres líneas de configuración que hay que acertar y sostener en cada deploy.
Para una pieza cuyo peor fallo es perder el número de la empresa, prefiero el diseño
donde el fallo es imposible al diseño donde el fallo está configurado.

`fly.toml` queda escrito y comentado por si se prefiere no administrar una máquina;
las tres líneas críticas están marcadas.

---

## 3 · La sesión, al servidor

La carpeta `.whatsapp-auth/` son **credenciales**: 826 archivos, ~1,2 MB, y quien las
tenga puede hablar por la cuenta y leer sus grupos. No van a git, ni a Supabase, ni a
los logs, ni a la imagen de Docker.

Hay dos caminos y el segundo es mejor:

**A · Mover la sesión existente.** Copiar la carpeta por `scp` a
`/var/lib/buscatools/whatsapp-auth`, con `chmod 700` y dueño `buscatools`. Es más
rápido, pero las credenciales pasan por dos discos más y por el portapapeles de quien
lo haga.

**B · Vincular de nuevo desde el servidor.** Levantar el proceso en el servidor, que
imprima el QR en esa terminal, y que Juan lo escanee. La sesión nace donde va a vivir y
no viaja. Son treinta segundos más y **es lo que recomiendo**.

En los dos casos, **antes**: `systemctl stop` del listener viejo. Que no queden dos.

---

## 4 · Qué publica `/health`

```json
{
  "estado": "conectado",
  "conexion": "conectado",
  "ultimaConexion": "2026-09-18T19:02:11.000Z",
  "ultimoEvento": "2026-09-18T19:14:03.000Z",
  "allowlistLeidaEn": "2026-09-18T19:14:00.000Z",
  "gruposActivos": 1,
  "errores": 0,
  "motivo": null,
  "cuenta": "id:5491….net"
}
```

`estado` es lo que hace el listener y `conexion` lo que hace el socket: con el kill
switch apagado el primero dice `apagado` y el segundo sigue diciendo la verdad. Devuelve
**200** con `conectado` o `apagado`, y **503** con `reconectando` o
`requiere_autenticacion` — un healthcheck que siempre contesta 200 no sirve para
reiniciar nada.

No publica el número, ni el QR, ni claves, ni nombres de grupo, ni una línea de
contenido. La cuenta va ofuscada.

---

## 5 · Los logs

Salen eventos, cuentas y errores saneados. **Nunca** texto, número completo, QR, estado
de sesión, tokens ni media.

Eso no lo garantiza la configuración del servidor sino el código: `registro.ts` ofusca
los ids y corta los errores a 200 caracteres, y `registroParaBaileys.ts` **tira
`debug` y `trace` de la librería**, que es donde Baileys escribe el contenido de los
mensajes. Sin eso, el primer arranque contra un grupo real deja la conversación entera
en journald.

---

## 6 · Pasos en el servidor

```bash
# 1 · usuario, carpetas y permisos
sudo useradd --system --home /opt/buscatools/listener --shell /usr/sbin/nologin buscatools
sudo mkdir -p /opt/buscatools/listener /var/lib/buscatools/whatsapp-auth /etc/buscatools
sudo chown -R buscatools:buscatools /opt/buscatools /var/lib/buscatools
sudo chmod 700 /var/lib/buscatools/whatsapp-auth

# 2 · código y dependencias de runtime
#    (se compila antes, local: el servidor no necesita TypeScript)
sudo -u buscatools cp -r dist package.json package-lock.json /opt/buscatools/listener/
cd /opt/buscatools/listener && sudo -u buscatools npm ci --omit=dev --omit=optional

# 3 · secretos
sudo install -m 600 -o root -g root listener.env /etc/buscatools/listener.env
sudo nano /etc/buscatools/listener.env     # completar el service role

# 4 · servicio
sudo cp buscatools-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buscatools-listener

# 5 · vincular (camino B): el QR aparece acá y en ningún otro lado
sudo -u buscatools journalctl -u buscatools-listener -f

# 6 · verificar
curl -s localhost:8081/health | jq '{estado, conexion, gruposActivos, allowlistLeidaEn}'
```

---

## 7 · Lo que queda para la próxima

- **Backup de la sesión.** Hoy si se pierde el volumen hay que volver a escanear. Es
  tolerable —son treinta segundos y una persona— pero conviene decidirlo a propósito y
  no descubrirlo un domingo.
- **Alerta sobre `/health`.** El endpoint dice la verdad; nadie la está mirando. Un
  `curl` cada cinco minutos que avise si `conexion != conectado` o si
  `allowlistLeidaEn` se atrasa más de diez minutos.
- **Rotar el service role** cuando el listener deje de ser experimental.
