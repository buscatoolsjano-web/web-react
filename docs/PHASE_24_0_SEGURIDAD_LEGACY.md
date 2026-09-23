# Fase 24.0 · Seguridad del legacy

**Auditoría de sólo lectura, hecha desde código, policies y configuración.**
No usé el token expuesto para nada. No probé la vulnerabilidad contra
producción. No hay contención aplicada.

```
DB_CHANGES_APPLIED = 0
PROD_DATA_CHANGED  = 0
STEL_WRITES        = 0
```

---

## 1. Qué está expuesto (§1)

```
LEGACY_SUPABASE_PROJECT   = hnyngsejohkmlaccpkux («Buscatools»)
                            NO es el proyecto del ERP React
                            (ése es uaxcfufvapzulqvynanp)

EXPOSED_ANON_KEY          = sb_pub…KOe7 (46 car.)
EXPOSED_APP_TOKEN_PRESENT = SÍ · bterp_…zGJg (49 car.)
```

**Sobre la clave anónima, una corrección a lo que escribí ayer.** En F24 · E0
la puse al mismo nivel que el token. No es lo mismo: es una clave
**`sb_publishable_…`**, el formato nuevo de Supabase, **diseñado para ir en
el código del cliente**. Por sí sola no da acceso a nada: la RLS decide. No
es el problema.

**El problema es el otro.**

```
TOKEN_USED_BY          = app.js del legacy, en 4 lugares:
                         · línea 1182  declaración
                         · línea 1207  header `x-erp-token` de _supaH
                         · línea 14436 mismo header
                         · línea 43374 mismo header

TOKEN_VALIDATION_PATH  = policy → función erp_valid_token() → comparación de
                         string contra el literal
```

La función, entera:

```sql
CREATE FUNCTION public.erp_valid_token() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(current_setting('request.headers',true)::json->>'x-erp-token','')
           = 'bterp_…'                      -- el MISMO literal del repo público
      OR COALESCE(current_setting('request.headers',true)::json->>'x-suite-key','')
           = 'bterp_…'
$$;
```

Es decir: **el secreto que autoriza es literalmente el mismo string que está
publicado**. No hay nada más en el medio — ni sesión, ni caducidad, ni
origen, ni `auth.uid()`.

```
TABLES_PROTECTED_BY_TOKEN = 9
TABLES_POTENTIALLY_EXPOSED = las mismas 9
```

Todas con la policy en modo `ALL` (lectura **y** escritura) y para los roles
`{authenticated, anon}` — o sea, también para quien no inició sesión:

| tabla | filas | qué contiene |
|---|---:|---|
| `erp_legacy_trazabilidad` | 1.257.714 | registro de actividad |
| `erp_activity_log` | 2.362 | ídem |
| `erp_ai_conversations` | 218 | conversaciones con la IA |
| `deliveries` | 161 | remitos |
| **`erp_store`** | **30 claves** | **el ERP entero del legacy** |
| `erp_ai_memory` | 28 | memoria de la IA |
| `erp_clone_conversations` | 16 | clon conversacional |
| `erp_ai_daily_summaries` | 10 | resúmenes diarios |
| `delivery_items` | 0 | — |

Las 30 claves de `erp_store` incluyen: 313 cotizaciones, 204 remitos, 180
pedidos, 87 contactos, 22 movimientos de stock, los permisos de usuario, y
**`erp_auth_users` y `erp_client_accounts`**.

`erp_clone_conversations` tiene una particularidad: su policy define `USING`
pero **no** `WITH CHECK`. En Postgres eso significa que para `INSERT` no hay
condición que evaluar.

---

## 2. Riesgo por tabla (§3)

Todo lo de abajo sale de leer la policy y el código, no de probar nada.

| ámbito | READ | WRITE | AUTH | exposición en repo público |
|---|---|---|---|---|
| `erp_store` → cotizaciones, pedidos, remitos, contactos | **ALTO** | **ALTO** | — | SÍ |
| `erp_store` → `erp_auth_users` (equipo) | **ALTO** | **ALTO** | **CRÍTICO** | SÍ |
| `erp_store` → `erp_client_accounts` (clientes) | **ALTO** | **ALTO** | **CRÍTICO** | SÍ |
| `erp_store` → `erp_user_perms` | ALTO | **ALTO** | **ALTO** | SÍ |
| `deliveries` | MEDIO | **ALTO** | — | SÍ |
| `erp_legacy_trazabilidad`, `erp_activity_log` | MEDIO | ALTO | — | SÍ |
| `erp_ai_*`, `erp_clone_conversations` | MEDIO | ALTO | — | SÍ |

**Por qué AUTH es crítico y no sólo alto.** El login del legacy compara el
hash de lo que se tipea contra lo guardado en `erp_auth_users`. Quien pueda
**escribir** esa clave puede poner el hash que quiera para el usuario ADMIN y
entrar como ADMIN. No hace falta romper ningún hash: alcanza con
reemplazarlo. Y `erp_user_perms` decide qué secciones ve cada usuario.

```
READ_RISK  = ALTO     · todo el ERP legacy, incluidos datos de clientes
WRITE_RISK = ALTO     · se puede modificar o borrar cualquier documento
AUTH_RISK  = CRÍTICO  · escribir erp_auth_users permite entrar como ADMIN
```

---

## 3. Los hashes (§6)

```
PASSWORD_HASH_RISK = ALTO
```

Del código (`hashPass`, app.js:1579):

```js
const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(raw)))
```

**SHA-256, una pasada, sin sal.** El verificador es
`/^[0-9a-f]{64}$/`.

Es el almacenamiento de contraseñas más débil que se usa en la práctica: sin
sal, dos personas con la misma contraseña tienen el mismo hash, y una tabla
arcoíris resuelve cualquier contraseña común en el acto. Sin factor de
trabajo, probar miles de millones por segundo es barato.

**No intenté romper ninguno y no hace falta**: el riesgo se establece por el
algoritmo, no por el resultado.

Están en `erp_auth_users` (equipo) y `erp_client_accounts` (clientes), las
dos dentro de `erp_store`, o sea alcanzables con el token publicado.

**La consecuencia que importa no es el hash, es la reutilización.** Si
alguien del equipo usa esa contraseña en otro lado, el problema se va del
ERP. Por eso el plan de abajo incluye avisar, no sólo rotar.

---

## 4. ¿Se puede apagar la escritura del legacy? (§5)

```
LEGACY_WRITES_LAST_7D  = 3 claves
LEGACY_WRITES_LAST_30D = 25 claves
LEGACY_WRITES_LAST_90D = 30 claves
```

Pero hay que mirar **cuáles**:

| clave escrita en los últimos 7 días | qué es |
|---|---|
| `erp_traz_ADMIN` (hace 1 día) | traza de actividad |
| `erp_trazabilidad_log` (hace 1 día) | traza de actividad |
| `erp_traz_JUAN` (hace 2 días) | traza de actividad |

**Las tres son registros de trazabilidad**, que se escriben con sólo abrir la
aplicación. Ningún documento comercial.

El último dato de negocio escrito en el legacy:

| clave | hace |
|---|---|
| `erp_cotizaciones` | 14 días (2026-09-09) |
| `erp_mensajes` | 15 días |
| `erp_notas_entrega`, `erp_pedidos`, `erp_contactos` | más de 30 días |

```
LEGACY_WRITE_PATHS = interceptor de localStorage.setItem → _supaPut →
                     PATCH/POST a /rest/v1/erp_store con el header x-erp-token.
                     Whitelist SUPA_SYNC_KEYS (app.js:1176), 33 claves.

MIGRATION_REQUIRES_LEGACY_WRITE = NO.
  Nada de lo que hace React escribe en ese proyecto. Los cinco scripts del
  repo que lo mencionan (fase8 y fase9, WhatsApp y Emails) son auditorías y
  backups de sólo lectura.

LEGACY_CAN_BECOME_READ_ONLY = SÍ, con una advertencia.
```

**La advertencia.** Poner `erp_store` en sólo lectura hace que el legacy
**siga funcionando** —lee, muestra, deja trabajar— pero **deje de guardar en
silencio**: el interceptor de `localStorage` no avisa al usuario cuando el
`PATCH` falla (`catch(e){}`, app.js:1208). Alguien podría cargar una
cotización, verla en pantalla, y perderla al cerrar el navegador.

Si se pasa a sólo lectura hay que avisarle al equipo el mismo día. No es un
cambio invisible.

---

## 5. El repositorio (§7)

```
PUBLIC_REPO_CONFIRMED     = SÍ · github.com/buscatoolsjano-web/Buscatools
                            private: false · creado 2026-07-14 · Pages activo
CURRENT_HEAD_EXPOSES_TOKEN = SÍ · app.js, commit e074e79
```

Y además:

```
GITHUB PAGES LO SIRVE AHORA MISMO.
  GET https://buscatoolsjano-web.github.io/Buscatools/app.js
  → HTTP 200 · 5.288.337 bytes · contiene el token
```

O sea que no hace falta ni clonar el repositorio: se descarga por HTTP.

**Y está en la historia, no sólo en HEAD.** `app.js` existe desde un solo
commit (2026-09-08); antes el código vivía dentro de `index.html`, que tiene
**95 commits desde 2026-07-14**. Muestreé cuatro y **los cuatro contienen el
token**:

| commit | archivo | token |
|---|---|---|
| `e074e79` (HEAD) | `app.js` | **sí** |
| `50bca62` | `index.html` | **sí** |
| `7640306` | `index.html` | **sí** |
| `9f055f3` | `index.html` | **sí** |
| `fc4700f` | `index.html` | **sí** |

```
TOKEN_ROTATION_REQUIRED = SÍ, y es lo primero.
```

Como dijiste: **borrarlo del repo sin rotarlo no resuelve nada.** Cualquiera
pudo haberlo copiado en los dos meses que lleva publicado, y limpiar la
historia de git no borra las copias ajenas.

---

## 6. Plan de contención (§4) — **preparado, no aplicado**

Mínimo, en este orden. Los pasos 1 y 2 son los que cierran el agujero; el
resto es higiene.

### Paso 1 · Rotar el secreto (10 minutos, sin tocar el repo)

Un valor nuevo, generado al azar, **que no se escribe en ningún archivo
versionado**:

```sql
-- NO APLICADO. El valor nuevo se genera aparte y no se pega en git.
create or replace function public.erp_valid_token() returns boolean
language sql stable security definer as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-erp-token', '')
           = current_setting('app.erp_token', true)
$$;
-- y el valor se fija a nivel de base, fuera del código:
--   alter database postgres set app.erp_token = '<nuevo>';
```

Esto **rompe el legacy a propósito y al instante**: hasta que no se ponga el
token nuevo en su `app.js`, deja de sincronizar. Por eso hay que decidir
antes si se quiere eso (ver paso 3) o si se le pone el valor nuevo —que
volvería a quedar publicado, sólo que esta vez a sabiendas—.

### Paso 2 · Que el token no habilite escritura

Aunque se rote, un secreto en el cliente **no puede ser lo que autoriza a
escribir**. Partir la policy en dos:

```sql
-- NO APLICADO
drop policy erp_token_store on public.erp_store;

create policy erp_store_lectura on public.erp_store
  for select to anon, authenticated using (public.erp_valid_token());

-- la escritura deja de depender de un secreto del navegador
create policy erp_store_escritura on public.erp_store
  for all to service_role using (true) with check (true);
```

Lo mismo para las otras ocho tablas. Y `erp_clone_conversations` necesita su
`WITH CHECK`, que hoy no tiene.

### Paso 3 · Decidir si el legacy sigue escribiendo

Los datos de §4 dicen que hace 14 días que no se carga un documento ahí. Si
se confirma, la opción más simple y más segura es **dejar el legacy en sólo
lectura** y no volver a darle un token de escritura nunca.

### Paso 4 · Contraseñas

Rotar las del equipo y avisar a quien haya reutilizado la suya en otro
servicio. El hash es SHA-256 sin sal y estuvo alcanzable dos meses.

### Paso 5 · Recién ahora, el repositorio

Sacar el token de HEAD, y evaluar si vale reescribir los 95 commits de
`index.html`. **Es el paso menos urgente**: una vez rotado, lo publicado ya
no sirve para nada.

```
CONTAINMENT_PLAN      = 5 pasos, ninguno aplicado
POLICY_CHANGE_REQUIRED = SÍ · 9 policies + la función + un WITH CHECK faltante
```

**Lo que NO propongo:** rediseñar la autenticación del legacy, migrar sus
datos ahora, ni tocar nada del ERP React. El agujero se cierra con el paso 1
y el 2.

---

## 7. Facturación local del legacy (§8)

```
LEGACY_INVOICES_LOCAL_COUNT      = NO SE PUDO MEDIR
LEGACY_RECEIPTS_LOCAL_COUNT      = NO SE PUDO MEDIR
LEGACY_CREDIT_NOTES_LOCAL_COUNT  = NO SE PUDO MEDIR
```

Las claves, confirmadas en el código:

| módulo | clave | ¿se sincroniza? |
|---|---|---|
| Facturas | `erp_facturas` (app.js:27002) | **no** |
| Recibos | `erp_recibos` (app.js:26790) | **no** |
| Notas de crédito | `erp_notas_credito` (app.js:26809) | **no** |

Ninguna está en `SUPA_SYNC_KEYS`, y confirmé que **no existen** como fila en
`erp_store`. Viven sólo en el `localStorage` del navegador que las creó.

**Por qué no puedo contarlas:** ese almacenamiento está en la máquina de
quien usa el legacy, atado al origen `buscatoolsjano-web.github.io`. No tengo
acceso al navegador de nadie, y abrir el sitio con una sesión ajena no me
daría los datos de esa persona: cada navegador tiene los suyos.

> **Lo que necesito de vos, Juan (2 minutos):** abrir el legacy, entrar a
> Facturación, y decirme cuántas filas hay en cada listado —facturas, recibos
> y notas de crédito—. Con eso cierro la pregunta de si el módulo se usó.

La evidencia indirecta de F24 · E0 sigue apuntando a que no: 140 remitos en
estado «facturada» y **ninguno** con `facturaRef`, que es lo que pone la
función que genera la factura.

---

## 8. STEL (§9)

No volví a insistir con los endpoints. El pedido, en texto corto:

> **Asunto: permiso de lectura del módulo de facturación vía API**
>
> Hola. Usamos la API de STEL Order con una API key para leer
> `salesEstimates`, `salesOrders` y `salesDeliveryNotes`, y funcionan bien.
>
> Al consultar `GET /invoices` recibimos:
>
> ```
> HTTP 403 — {"error": "Insufficient permissions", "error-code": "E000006"}
> ```
>
> Necesitamos **lectura** (sólo GET) de facturas de venta para reflejarlas en
> nuestro sistema de gestión. No vamos a crear ni modificar nada en STEL.
>
> Tres preguntas:
>
> 1. ¿Qué permiso hay que habilitar en la API key para leer `/invoices`?
> 2. ¿Las líneas de la factura vienen en ese mismo recurso o hay uno aparte?
> 3. ¿La API expone **cobros/recibos**, **notas de crédito**, **vencimientos**
>    o el **PDF** del comprobante? Probamos `receipts`, `payments`,
>    `collections`, `creditNotes`, `salesCreditNotes`, `refunds` y `dueDates`
>    y todos devuelven 404.
>
> Gracias.

```
STEL_PERMISSION_REQUIRED = READ /invoices (mínimo).
                           A confirmar si existen y requieren permiso aparte:
                           líneas, cobros, notas de crédito, vencimientos, PDF.
```

---

## 9. Autoridad fiscal (§10)

Busqué evidencia en contra de la hipótesis y no apareció:

| | |
|---|---|
| ¿El legacy emite algo fiscal? | No. Cero AFIP, cero CAE, cero punto de venta, cero tipo de comprobante |
| ¿Su número es fiscal? | No. `FC00001`, contador en `localStorage` |
| ¿Hay rastro de facturación electrónica? | No |
| ¿De dónde sale «pendiente de facturar»? | De STEL: no aparece en el código del legacy |

```
FISCAL_AUTHORITY = STEL
RECOMMENDED_MODE = REGISTER_ONLY
```

---

## 10. Capacidad que existe contra capacidad que se usa (§11)

La distinción que pediste, aplicada:

| capacidad | ¿existe? | ¿se usa? | evidencia |
|---|---|---|---|
| Facturación de venta (legacy) | SÍ | **probablemente no** | 140 remitos «facturada» sin `facturaRef`; 0 filas sincronizadas; falta confirmar el conteo local |
| Portal del cliente | SÍ | **casi no** | 1 solicitud, 6 leads, carrito vacío; en React, 2 cuentas demo con 0 documentos |
| Chat interno | SÍ | **no puede** | guarda en `localStorage`: sólo funciona entre pestañas del mismo navegador |

**No actualizo F23 todavía**, como pediste. Cuando tenga el conteo local de
Facturación, las filas `FA-01`, `FA-02`, `FA-03` y `VE-50` bajan de
`BLOCKER` a lo que corresponda, y con ellas cambia la respuesta a «¿se puede
apagar el legacy?». Si Facturación tiene 0 datos reales, el único bloqueante
que queda es **poder leer las facturas de STEL**, que es un permiso, no un
desarrollo.

---

## Resumen

| | |
|---|---|
| ¿El token está expuesto? | **Sí**, y GitHub Pages lo sirve ahora mismo |
| ¿Autoriza de verdad? | **Sí**: la policy compara contra ese mismo literal |
| ¿Cuánto alcanza? | 9 tablas, lectura **y** escritura, también sin sesión |
| ¿Lo peor? | Escribir `erp_auth_users` permite entrar como ADMIN sin romper ningún hash |
| ¿Hace cuánto? | Al menos desde 2026-07-14, en 95 commits de `index.html` |
| ¿Alcanza con borrarlo del repo? | **No.** Primero rotar |
| ¿El legacy necesita escribir? | No hace 14 días que no se carga un documento |
| ¿Toqué algo? | No. Ni el token, ni las policies, ni los datos |
