# Fase 11 · Legacy security — Entrega 0: auditoría de llamadores y plan de contención

> **Versión pública, sanitizada (2026-09-14).** Este repositorio es público y el
> sistema legacy auditado sigue en producción. Se quitaron a propósito los
> nombres de funciones, tablas y endpoints afectados, los mecanismos exactos de
> autorización y de bypass, las ubicaciones de credenciales, las líneas de
> código y cualquier paso reproducible. Se conservan severidad, categoría,
> impacto, estado, uso medido, plan de contención y dependencias de cutover.
> La versión completa es **interna** y vive fuera del repositorio.

Estado de la entrega: **sólo lectura**, 2026-09-13.
- No se cerró nada ni se modificó el legacy ni React.
- No se migró el delta.
- No se ejecutó ninguna escritura ni se probó ningún ataque.

## Fuentes (genéricas)

- Catálogo y agregados del Supabase legacy, en modo lectura.
- Logs del legacy de 7 días (2026-09-07 → 2026-09-13).
- Código de las Edge Functions del legacy y del bundle publicado del legacy.
- Referencias en el ERP React (`src/`, `backend/`).

Ningún secreto se copió a este documento ni a la versión interna.

---

## A · Resumen

1. **El legacy sigue vivo, pero el negocio ya no carga documentos en él.** Los
   documentos nuevos llegan desde **STEL Order** por una sincronización diaria
   del lado del servidor. Del delta medido, 9 de 10 documentos vienen de STEL y
   1 se creó a mano en la UI legacy.
2. **Lo que mantiene vivo el legacy es la consulta**: el equipo lo abre para ver
   lo que entra de STEL. React no recibe esa sincronización.
3. **La superficie expuesta del legacy es mayor que la estimada en la auditoría
   global**: incluye lectura y escritura sin autenticación real, funciones de
   servidor sin autenticación y datos personales accesibles.
4. **Una parte es cerrable ya** (grupo A): superficie con 0 referencias en código,
   0 uso en 7 días y sin dependencias.
5. **Lo más urgente:** 2 hallazgos **CRITICAL** y varios **HIGH** (§C).

---

## B · Uso del legacy (medido, agregado)

| llamador | tipo | actividad en 7 días |
|---|---|---|
| Navegador del legacy (UI publicada) | lectura periódica y guardados | todos los días |
| Sincronización STEL → legacy | servidor, credencial privada | diaria |
| Mensajería interna / push del legacy | función de servidor | 2 días |
| Automatizaciones externas (Make) | servidor | hasta 2026-09-11; 0 desde el cierre de Emails E0.5 |
| Suites de seguridad propias | pruebas de rechazo | 2026-09-11 a 13 |

- Una parte relevante de la superficie expuesta tuvo **0 llamadas** en 7 días.
- La bitácora del navegador se reenvía completa en cada guardado, sin
  deduplicar: una tabla de log del legacy supera **1,2 M filas / 279 MB** y crece
  sin control.

### Delta legacy → React

React tiene 288 cotizaciones, 166 pedidos y 182 remitos importados el
2026-09-09. En el legacy hay **+7 cotizaciones y +3 remitos** posteriores
(6 cotizaciones y 3 remitos de STEL, sin moneda; 1 cotización manual). No hay
pedidos nuevos.

---

## C · Hallazgos

| id | categoría | severidad | impacto | uso medido | estado (2026-09-14) |
|---|---|---|---|---|---|
| S-1 | Almacén principal del legacy **escribible con una credencial embebida en el cliente público** (incluye cuentas y permisos del legacy) | **CRITICAL** | integridad de todo el estado del legacy; toma de cuentas y bloqueo del equipo | usado a diario (lectura y guardados) | abierto · requiere reemplazo previo (grupo B) |
| S-2 | Función de envío de correo **sin autenticación real** (relay con la marca de la empresa); credencial del proveedor escrita en el código | **CRITICAL** | suplantación y abuso de envío | 0 uso en 7 días | **cerrada** (Fase 11 E0.5, responde 410); la credencial se trata como comprometida |
| S-3 | **Funciones de base de datos ejecutables sin autenticación** que **leen datos personales** de clientes y un historial de auditoría | **HIGH** | exposición de PII y de cambios históricos | 0 uso en 7 días | abierto · grupo A/B |
| S-4 | Funciones de base de datos ejecutables sin autenticación que **escriben y borran** en la base normalizada del legacy (catálogo, precios, órdenes, stock, notificaciones, dispositivos de push) | **HIGH** | integridad del espejo del legacy; desvío de notificaciones; inyección persistente en la memoria del asistente | uso nulo o bajo | abierto · grupos A/B |
| S-5 | Función de mensajería interna **sin autenticación real** | **HIGH** | mensajes y push a nombre de empleados | uso bajo | abierto · grupo B |
| S-6 | **Vistas que ignoran la RLS** de sus tablas base | MEDIUM | lectura de stock y estado de pedidos | 0 uso | abierto · grupo A |
| S-7 | Permisos de ejecución concedidos también a `PUBLIC` (revocar sólo al rol anónimo no alcanza) | MEDIUM | agrava S-3/S-4 | — | abierto · se corrige con cada cierre |
| S-8 | Crecimiento sin límite de la tabla de trazabilidad | MEDIUM | costo y cuota del proyecto legacy | diario | abierto · grupo B |
| S-9 | Webhook de mensajería heredado sin autenticación | MEDIUM | inserción de mensajes | 0 uso | a verificar con el proveedor (grupo C) |
| S-10 | Contraseñas del legacy con hash **sin sal** y valores por defecto en el cliente; control de permisos sólo en la UI | HIGH | compromiso de cuentas del legacy | en uso | abierto · se resuelve con el apagado (las cuentas del ERP nuevo usan Supabase Auth) |
| S-11 | Alta abierta en el Auth del proyecto legacy (si está habilitada) | MEDIUM | un usuario autenticado hereda los mismos permisos que el anónimo | — | a verificar (grupo C) |
| S-12 | Base de datos en tiempo real de Firebase del legacy: reglas no auditables desde el repositorio | HIGH hasta verificar | chat interno | — | a verificar (grupo C) |

**Rotar la credencial embebida no resuelve S-1 por sí sola**: el legacy
necesita tenerla publicada para funcionar. La solución es el reemplazo y el
congelamiento del legacy (§E, olas 4–5).

La **sincronización con STEL no es superficie pública** (credencial privada,
autenticación activa) y **es el flujo que alimenta al negocio**: no se toca
hasta reemplazarla.

**React no depende del legacy**: usa otro proyecto de Supabase y no tiene
referencias al legacy en `src/` ni `backend/`.

---

## D · Clasificación para contención

| grupo | criterio | contenido (genérico) | severidades |
|---|---|---|---|
| **A · SAFE_TO_CLOSE_NOW** | 0 referencias en código, 0 uso en 7 días, 0 dependencias, sin integraciones externas | 17 firmas de funciones, 2 vistas, permisos directos sobre 3 tablas y 1 publicación de tiempo real | HIGH ×2, MEDIUM ×6, LOW ×2 |
| **B · MUST_REPLACE_BEFORE_CLOSE** | tiene un llamador activo o sostiene el uso actual | almacén principal (lectura y escritura), credencial embebida y sus políticas, log de actividad, trazabilidad, funciones de sincronización del espejo, herramientas del asistente, catálogo del espejo, push, mensajería interna, sincronización STEL | CRITICAL ×3, HIGH ×5, MEDIUM ×4, INFO ×1 |
| **C · UNKNOWN_CALLER** | no se puede descartar un llamador externo | correo (cerrado en E0.5), webhook heredado, un escaneo manual, Firebase, Make, worker de IA, guards de funciones con identidad, alta de Auth | CRITICAL (cerrado), HIGH ×1, MEDIUM ×3, LOW ×3 |

**Qué rompe cada cierre (resumen):**

| cierre | efecto sobre el uso actual |
|---|---|
| grupo A | ninguno medido |
| lectura del almacén principal | **rompe el uso actual**: nadie ve lo que entra de STEL |
| escritura del almacén principal | fallan guardados del legacy (esta semana: sólo bitácora y preferencias); STEL sigue |
| funciones del espejo, asistente, catálogo, push | degradación aceptable (uso nulo o bajo) |
| sincronización STEL | **no tocar** hasta tener la ingesta en el ERP nuevo |

---

## E · Oleadas de contención

Ninguna se ejecutó en la Entrega 0. Estado al 2026-09-14 en la última columna.

| ola | contenido | precondición | estado |
|---|---|---|---|
| **0 · Verificación y respaldo** | revisar integraciones externas (correo, Make, Firebase, Auth legacy), plan de backups, snapshot de permisos y respaldo del almacén principal | acceso del dueño a los paneles | en curso |
| **1 · Superficie sin uso + relay de correo** | grupo A completo; cerrar la función de correo; revocar su credencial | ola 0 | correo **cerrado** (E0.5); resto pendiente |
| **2 · Lectura pública sin autenticación** | funciones con PII, mensajería interna, webhook heredado | aceptar la degradación del asistente | pendiente |
| **3 · Escritura sin autenticación con degradación aceptada** | sincronización del espejo, catálogo, push, memoria del asistente, retención de trazabilidad (con backup) | decisiones P-3 y P-4 | pendiente |
| **4 · Almacén principal y auth legacy** | primero escritura (legacy en sólo lectura), después lectura y credencial | **ingesta STEL → ERP nuevo** funcionando y equipo consultando en React | pendiente |
| **5 · Apagado del legacy** | despublicar la UI legacy, deshabilitar sus funciones, redirigir STEL, archivar el proyecto | ola 4 + respaldo final | pendiente |

### Dependencias de cutover

- **Ingesta STEL → ERP nuevo**: precondición de la ola 4 y del apagado.
- **Adopción de React por el equipo** (cuentas activas: ver Fase 12 E1).
- **Congelamiento del legacy en sólo lectura** (decisión P-1).

---

## F · Fail-safe por cambio (resumen)

Cada cierre exige: snapshot de permisos y políticas antes (fuera del repo),
backup de datos si puede ocultar filas, prueba funcional del legacy antes y
después (login, listado, impresión, próxima sincronización STEL), verificación
de rechazo después, rollback preparado, invariantes de conteo, revisión de logs
a 24–48 h y **ningún borrado de datos** en las olas 1–3.

---

## G · Decisiones

1. **Congelamiento del legacy** en sólo lectura cuando React muestre lo que
   entra de STEL.
2. **Ingesta STEL → ERP nuevo** como fase propia (los documentos de STEL llegan
   sin moneda).
3. **Asistente IA del legacy**: aceptar que pierda sus herramientas de datos y su
   memoria.
4. **Tabla de trazabilidad (279 MB)**: respaldar y vaciar, o aplicar retención.
5. **Push y mensajería interna del legacy**: autenticación real o apagado.
6. **Correo**: función cerrada; confirmar la revocación de la credencial.
7. **Accesos externos** para verificar el grupo C.
8. **Cotización creada a mano en el legacy**: migrar con el delta o descartar.

## H · Respaldos

- Existen respaldos locales (fuera del repo) de Compras, Emails y WhatsApp del
  legacy.
- **Sin respaldo local verificado**: el almacén principal actual, los logs y las
  tablas del asistente, notificaciones y auditoría del legacy, el código de las
  Edge Functions y el chat de Firebase. Hace falta antes de las olas 1 y 4.
