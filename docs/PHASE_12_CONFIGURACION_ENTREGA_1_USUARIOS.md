# Fase 12 · Configuración — Entrega 1: usuarios, roles, invitaciones y recuperación

Estado: **implementada y probada contra la base real; commit local, sin push.**
Fecha: 2026-09-14. No se tocó STEL, numeración, catálogo, precios, empresa,
depósitos, WhatsApp, Emails, Informes, legacy, Make, Resend, Firebase ni
Cloudflare. `MIGRATION_STATUS.md` no se actualizó.

Emails de personas: sólo enmascarados. Ningún token, enlace ni clave en este
documento.

---

## 1 · Precheck (medido antes de programar)

| medida | valor |
|---|---:|
| Auth users | 7 (0 con prefijo zz) |
| profiles | 7 |
| memberships | 8 (admin 3 · salesperson 2 · employee 1 · customer 1 · distributor 1; todas `active`) |
| empresas | 2 (buscatools, torquetools) |
| usuarios sin profile / profiles sin Auth | 0 / 0 |
| memberships huérfanas (sin usuario / sin empresa) | 0 / 0 |
| usuarios sin membresía | 0 |
| `allowed_sections` con valor | 0 |
| rol `supplier` | existe en el CHECK, 0 filas |

**Roles reales** (CHECK `company_memberships_role_check`): `admin`, `employee`,
`salesperson`, `technician`, `distributor`, `customer`, `supplier`. No se agregó
ninguno. `chk_external_link` exige `customer_id` a customer/distributor y
`supplier_id` a supplier. **Estado**: `active` / `suspended` (CHECK) — ya
existía una suspensión reversible; no hizo falta schema para eso.

**Inconsistencias encontradas (no corregidas en silencio):**

1. `memberships_write` (policy ALL para admin) permitía por REST insertar,
   borrar y reasignar `user_id`/`company_id`, y dejar una empresa sin admin.
   `RLS_MATRIX.md` decía «no puede quitarse a sí mismo el rol admin» y **no
   estaba implementado**. → corregido en esta entrega (§3).
2. Auth del proyecto nuevo: **Site URL = `http://localhost:3000`, Redirect URLs
   vacías, SMTP propio deshabilitado, alta pública (`disable_signup=false`)
   habilitada**, plantillas por defecto (no editables sin SMTP). → reportado
   (§6, §12); son cambios de configuración del panel que requieren tu OK.
3. El login decía «pedile el restablecimiento a un administrador»: no había
   recuperación. → implementada (§5).
4. Advisor preexistente fuera de alcance: vista `product_availability` SECURITY
   DEFINER (ERROR) y «leaked password protection» deshabilitado (WARN).

## 2 · Arquitectura

```
Navegador (JWT del admin)
 ├─ rpc config_listar_usuarios(p_company)            ← definer, valida is_admin
 ├─ rpc config_cambiar_rol(p_membership, p_rol)      ← definer, valida is_admin
 ├─ rpc config_cambiar_estado(p_membership, p_estado)← definer, valida is_admin
 └─ functions/v1/config-usuarios  {invitar | reenviar}
        │ verify_jwt (gateway) + auth.getUser(jwt)
        │ valida cuerpo (sin campos extra)
        ├─ rpc config_validar_invitacion(actor, …)   ← sólo service_role
        ├─ auth.admin.inviteUserByEmail(…)           ← mecanismo oficial
        └─ rpc config_registrar_miembro(actor, …)    ← sólo service_role

company_memberships
 ├─ BEFORE UPDATE/DELETE  trg_memberships_ultimo_admin
 └─ AFTER UPDATE          trg_memberships_auditar → users_audit
```

- **Autoridad**: Supabase Auth = identidad; `profiles` = datos globales;
  `company_memberships` = empresa + rol + estado. Sin contraseñas, hashes ni
  auth paralelo.
- **Backend elegido**: Edge Function del proyecto nuevo (no había ninguna). Es
  la única pieza con la clave de servicio, que inyecta la plataforma
  (`SUPABASE_SERVICE_ROLE_KEY`). No se reutilizó el servicio de Emails para no
  mezclar módulos.
- Código: `supabase/functions/config-usuarios/{index,logica}.ts` (v2
  desplegada, `verify_jwt=true`), `src/modules/configuracion/**`,
  `src/services/auth/{callbackUrl,capturarCallback,contrasena,contrasenaPendiente}.ts`,
  `src/features/auth/pages/{RecuperarPage,DefinirContrasenaPage}.tsx`.

## 3 · Schema (migración `fase12_configuracion_entrega1_usuarios`)

SQL completo: `docs/database/PHASE_12_CONFIGURACION_ENTREGA_1.sql`.

| cambio | detalle |
|---|---|
| tabla `users_audit` | id, company_id, membership_id, target_user_id, action (CHECK: `USER_INVITED`, `MEMBERSHIP_ADDED`, `INVITATION_RESENT`, `MEMBERSHIP_ROLE_CHANGED`, `MEMBERSHIP_SUSPENDED`, `MEMBERSHIP_REACTIVATED`), from/to role, from/to status, actor_id, created_at. RLS: SELECT sólo `app.is_admin(company_id)`; sin grants de escritura para anon/authenticated |
| `company_memberships` | `drop policy memberships_write`; `revoke insert, update, delete, truncate, references, trigger` de authenticated; `revoke all` de anon. Queda `memberships_select` |
| `app.proteger_ultimo_admin()` + trigger BEFORE UPDATE/DELETE | ver §7 |
| `app.auditar_membresia()` + trigger AFTER UPDATE | registra cambios de rol y de estado con `auth.uid()` como actor (null si viene de service_role: no se inventa) |
| RPC admin (authenticated) | `config_listar_usuarios`, `config_cambiar_rol`, `config_cambiar_estado` |
| RPC servicio (sólo service_role) | `config_validar_invitacion`, `config_registrar_miembro`, `config_preparar_reenvio`, `config_auditar_reenvio` + helper `app.es_admin_activo` |

Todas SECURITY DEFINER con `search_path = public, pg_temp`; `revoke all … from
public, anon` explícito (el default ACL del schema public concede EXECUTE a
anon). Verificado en `pg_proc.proacl`.

Reglas de las RPC:
- inexistente y ajena devuelven el mismo `sin_permiso` (no confirman ids);
- sólo se ASIGNAN roles internos; los externos (customer/distributor) no se
  cambian desde la UI (`rol_externo`) pero sí se pueden suspender;
- nadie se suspende a sí mismo (`no_auto_suspension`);
- la lista devuelve sólo miembros de la empresa pedida, nunca la lista global
  de Auth, con: nombre, email, rol, estado, cliente (externos), alta,
  `invited_at`, email confirmado, `last_sign_in_at`, baneo, «es propia».

## 4 · Invitación

Flujo (`config-usuarios`, acción `invitar`):

1. JWT verificado dos veces (gateway + `auth.getUser`).
2. Cuerpo: exactamente `accion, company_id, email, nombre?, rol`; email
   normalizado (trim + minúsculas) y validado; rol ∈ internos.
3. `config_validar_invitacion`: actor admin **activo** de esa empresa (y empresa
   activa), rol, email; devuelve la identidad existente y su membresía.
4. Decisión (`decidirInvitacion`, pura y testeada):

| caso | resultado |
|---|---|
| email sin cuenta | `inviteUserByEmail` → cuenta nueva + membresía + `USER_INVITED` |
| cuenta existente confirmada (p. ej. de otra empresa) | **no se crea otra identidad**: sólo membresía + `MEMBERSHIP_ADDED`; no se manda correo |
| cuenta existente sin confirmar (invitación previa o alta pública) | membresía + nueva invitación |
| ya es miembro activo | 409 `ya_es_miembro` (no cambia el rol) |
| membresía suspendida | 409 `membresia_suspendida` (no se reactiva sola) |
| cuenta baneada | 409 `cuenta_bloqueada` |
| dos cuentas con el mismo email | 409 `identidad_ambigua` |

5. Errores de Auth clasificados sin texto crudo: `demasiados_envios` (429),
   `email_rechazado` (dirección inválida para Auth), `correo_no_autorizado`
   (mailer por defecto), `correo_no_enviado`.
6. Nunca devuelve el enlace, tokens ni la clave.

**Reenviar**: sólo membresía activa con cuenta sin confirmar; si ya confirmó,
409 `invitacion_no_pendiente` (la UI sugiere «¿Olvidaste tu contraseña?»).

**Aceptación**: el enlace de Supabase vuelve con la sesión en el fragmento.
La app lo captura antes del router (§5) y obliga a elegir contraseña antes de
entrar (`ProtectedRoute` redirige mientras esté pendiente). Si la persona abre
el enlace y cierra sin elegir contraseña, la cuenta queda confirmada y puede
usar «¿Olvidaste tu contraseña?».

## 5 · Recuperación de contraseña

- Login: enlace «¿Olvidaste tu contraseña?» → `/auth/recuperar`.
- `POST /auth/v1/recover` (endpoint oficial). Respuesta **siempre** «Si existe
  una cuenta asociada, vas a recibir un correo.»; sólo se distinguen límite de
  envíos, sin red y error 5xx. Medido: email inexistente → 200 `{}`.
- `/auth/definir-contrasena`: valida largo (8–72 bytes), espacios y
  confirmación; `updateUser({ password })`; errores traducidos (`weak_password`,
  `same_password`, sesión vencida). Enlace vencido/usado → pantalla propia.

**Por qué no `resetPasswordForEmail` y por qué se captura el fragmento:**
- El cliente usa `flowType: 'pkce'`. Con PKCE el enlace sólo funciona en el
  navegador que lo pidió (verificador en su localStorage).
- Las invitaciones de `inviteUserByEmail` y la plantilla por defecto vuelven
  con `#access_token=…&type=invite`. El SDK en modo PKCE **rechaza** esa URL
  («Not a valid PKCE flow url», leído en `auth-js` 2.116) y el HashRouter la
  tomaría como ruta.
- Solución: `capturarCallback.ts` se importa primero en `main.tsx`, guarda el
  callback **en memoria**, reemplaza la URL por `#/auth/definir-contrasena` con
  `replaceState` (el token no queda en la barra ni en el historial) y la página
  hace `setSession`. Sólo invitación y recuperación obligan a elegir
  contraseña; otro tipo de enlace deja la sesión y nada más.
- Alternativa más robusta cuando haya SMTP propio: plantillas con
  `{{ .TokenHash }}` + `verifyOtp` (hoy las plantillas no se pueden editar).

## 6 · Emails de Auth (auditoría)

| punto | medido |
|---|---|
| SMTP propio | **deshabilitado**: se usa el mailer por defecto de Supabase |
| mailer por defecto | sólo entrega a direcciones del equipo de la organización Supabase; **el equipo tiene 1 miembro** (la cuenta de Jano) |
| límite | `over_email_send_rate_limit` (429) en el 3.er intento dentro de la hora, medido en logs de Auth |
| direcciones `.test` | rechazadas por Auth con `email_address_invalid` antes de enviar |
| plantillas | por defecto (inglés); **no editables sin SMTP propio** |
| Site URL / Redirect URLs | `http://localhost:3000` / vacías → `redirect_to` a `app.buscatools.com` se IGNORA (medido: el verify redirige a localhost:3000) |
| Resend | no usado ni introducido |

**Conclusión: el SMTP de Auth NO está listo para producción.** Invitar a
Brian, Facundo, Norberto u Oscar, o que ellos recuperen su contraseña, hoy no
funciona por correo. Es un **blocker explícito** (§12).

## 7 · Permisos e invariante del último admin

| acción | admin misma empresa | employee | salesperson | technician | customer | distributor | admin otra empresa | anon |
|---|---|---|---|---|---|---|---|---|
| listar | ✅ | ❌ sin_permiso | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cambiar rol | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| suspender / reactivar | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| invitar / reenviar | ✅ | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| escribir memberships por REST | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| leer users_audit | ✅ (su empresa) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Último admin (en la base):**
- Si la fila es un admin activo y el UPDATE le quita `admin`, `active` o la
  empresa, o se la borra: se toma `FOR NO KEY UPDATE` sobre `companies` (mutex
  por empresa, sin bloquear las FK de otras tablas) y se cuentan los **otros**
  admins activos; si son 0 → `ultimo_admin`.
- Vale para authenticated **y service_role en UPDATE**. DELETE sólo se exime en
  cascada (empresa o persona eliminada) o con service_role/SQL: son operaciones
  de plataforma (las suites limpian fixtures así).
- Concurrencia: el segundo cambio espera el mutex y, al seguir, su conteo (nuevo
  snapshot por sentencia en READ COMMITTED) ve lo que el primero confirmó.
- La UI lo anticipa (el único admin no ofrece otros roles ni «Suspender»; la
  auto-degradación pide confirmación específica), pero decide la base.

## 8 · Multiempresa

- Un email = una identidad. Invitar una cuenta existente a otra empresa agrega
  sólo la membresía (probado: 1 cuenta antes y después; rol distinto por
  empresa; su nombre no se pisa).
- Suspender es **por empresa**: la cuenta y sus otras membresías siguen. No hay
  baneo global desde la UI.
- La pantalla trabaja sobre la empresa activa del selector.

## 9 · Frontend

- Menú: «Configuración» sólo para admin (sale de «Próximamente»).
- Rutas: `/configuracion` → `/configuracion/usuarios` (shell con navegación
  interna, preparado para Empresa, Listas, Marcas, Auditoría; hoy sólo
  Usuarios); `/auth/recuperar`; `/auth/definir-contrasena`.
- Lista: persona (nombre, email, «vos»), rol (selector), estado, último ingreso
  (`last_sign_in_at` de Auth; «Nunca» si no hay). Tabla en desktop, cards en
  mobile, búsqueda.
- Estados mostrados sólo si son ciertos: **Activo**, **Invitación pendiente**
  (Auth registró la invitación y el email no se confirmó — no se infiere de
  «nunca inició sesión»), **Sin confirmar**, **Suspendido**, **Cuenta
  bloqueada**.
- Confirmación para cada cambio (rol, suspender, reactivar, reenviar), con texto
  específico para la auto-degradación; loading, vacío, error y éxito.

## 10 · Pruebas

| suite | resultado |
|---|---|
| `scripts/fase12-configuracion-entrega1-tests.mjs` (base + Edge Function desplegada) | **89 PASS · 0 FAIL** (9 secciones; ver abajo) |
| `scripts/fase12-configuracion-entrega1-enlaces.mjs api` (enlaces reales) | **15 PASS · 0 FAIL** |
| vitest (`npm test`) | 58 archivos · **687 PASS** (nuevos: `callbackUrl.test.ts`, `configuracion/lib/usuarios.test.ts`) |
| `npm run test:isolated` | 687 PASS |
| `npm run lint` · `npm run typecheck` · `npm run build` | verdes |
| regresión, en serie, contra la base real | `regresion-rls-roles` 71 PASS · `fase10-informes-cierre` 39 · `fase9-emails-entrega4` 115 · `fase7-mantenimiento-entrega5` 82 · `fase6-cierre` 82 · `stage3-cierre` 46 · `fase5-cierre` 74 — **0 FAIL** |

Suite de la entrega, por sección: lógica pura (10) · matriz de permisos con
JWT reales de 8 identidades + anon (20) · sin escrituras directas (10) · último
admin incluida concurrencia 8 rondas de degradación cruzada y 4 de suspensión
cruzada (11) · bitácora (7) · API red team: sin JWT, JWT inválido, firma
alterada, JWT de sesión cerrada, GET, cuerpo no JSON, 15 ataques (employee,
salesperson, technician, customer, distributor, admin ajeno, company_id ajeno o
inexistente, rol customer/owner, email inválido, `user_id` y `status`
inyectados, reenvío ajeno), CORS (10) · idempotencia/multiempresa/invitaciones
simultáneas (14) · estático de secretos (5) · datos reales intactos (2).

## 11 · Pruebas reales

**Enlaces reales de Supabase** (`generateLink`: el mismo enlace del correo, sin
enviar correo), fixtures `zz-cfg1ui-*` borradas al final:

| prueba | resultado |
|---|---|
| API: invitación → verify 303 → sesión en el fragmento → `setSession` → `updateUser` → login con la contraseña elegida → email confirmado → membresía y nombre correctos → como employee NO administra | PASS |
| API: reusar el enlace → `otp_expired` | PASS |
| API: recuperación completa; contraseña de 3 caracteres rechazada (`weak_password`) | PASS |
| Navegador (localhost:3000 = Site URL): magic link de un admin zz → sesión, URL sin token → Configuración → Usuarios | PASS |
| Navegador: cambiar rol con confirmación; suspender; reactivar; invitar una cuenta de otra empresa escrita en MAYÚSCULAS → «ya tenía cuenta… no se envió correo»; 5 miembros | PASS |
| Navegador: reenviar invitación → error del límite de Supabase mostrado en el diálogo | PASS |
| Navegador: único admin sin opciones de rol ni «Suspender»; con 2 admins, auto-degradación muestra «Dejar de ser administrador» (cancelado) | PASS |
| Navegador: employee → sin menú, URL directa «sin acceso», 0 llamadas a la RPC | PASS |
| Navegador: enlace de invitación → «Bienvenido: elegí tu contraseña», token fuera de la URL, `#/clientes` redirige a definir contraseña; reusar → «El enlace venció o ya se usó» | PASS |
| Navegador: enlace de recuperación → «Elegí una contraseña nueva» | PASS |
| Navegador: «¿Olvidaste tu contraseña?» con email inexistente → 200 y mensaje genérico | PASS |
| Bitácora de la sesión de navegador: 6 eventos con actor | PASS |

La contraseña en el navegador no la tipeó el agente (regla de no ingresar
contraseñas): ese paso se probó por API con el mismo `updateUser`.

**Correo real**: `NEEDS_SMTP` / `NEEDS_CONTROLLED_ACCOUNT`. Con el mailer por
defecto sólo se puede entregar a la cuenta del equipo Supabase (productiva, de
Jano), y no se usó una cuenta productiva. No se envió ningún correo a nadie.

**Mobile** (medido con `scrollWidth`, alto de controles y `font-size`):

| ancho | overflow global | controles < 44px | inputs | vista |
|---|---|---|---|---|
| 390 | no | 0 | 16px | cards |
| 430 | no | 0 | 16px | cards |
| 768 | no | 0 | 16px | tabla con scroll interno (navegación interna arriba) |
| 1440 | no | 0 | 16px | tabla |

## 12 · Pendientes y blockers

**BLOCKER — configuración del panel de Supabase (proyecto nuevo), requiere tu OK:**

1. **Auth → URL Configuration**: Site URL `https://app.buscatools.com`;
   Redirect URLs `https://app.buscatools.com/**` y, para desarrollo,
   `http://localhost:5173/**`. Sin esto los enlaces llevan a localhost:3000.
2. **Auth → SMTP**: SMTP propio (no Resend). Sin esto ningún correo de Auth
   llega a nadie fuera del equipo de Supabase. Decisión: proveedor/buzón
   remitente.
3. **Auth → Sign In / Providers**: desactivar «Allow new users to sign up»
   (hoy cualquiera crea una cuenta; no ve datos, pero ensucia y habilita
   pre-registrar un email ajeno). Las invitaciones siguen funcionando.
4. **Auth → Attack Protection**: activar leaked password protection; largo
   mínimo 8.

**No bloqueantes:**
- Plantillas en castellano y con `{{ .TokenHash }}` cuando haya SMTP.
- `users_audit` sin visor todavía (Entrega 4 del plan).
- `authenticated` conserva `MAINTAIN` sobre `company_memberships` (privilegio
  de PG17 para VACUUM/ANALYZE; sin efecto sobre datos).
- La marca «contraseña pendiente» es de navegación (sessionStorage), no de
  seguridad: la sesión del enlace es válida para Supabase.
- Roles externos (portal de clientes) fuera de la UI (decisión F15).

## 13 · Equipo

| persona | AUTH | PROFILE | MEMBERSHIP | ROLE | STATUS | ACTION_REQUIRED |
|---|---|---|---|---|---|---|
| Juan | sí (`jmo…@gmail.com`), confirmada, nunca ingresó | sí | Buscatools, activa | admin | **MATCH** | activar acceso: recuperación de contraseña → bloqueada por SMTP + Site URL |
| Jano | sí (`bus…@gmail.com`), ingresó 14/09 | sí | Buscatools activa · Torquetools activa | admin (BT) · salesperson (TT) | **MATCH** en Buscatools; Torquetools fuera de la propuesta | confirmar si en Torquetools debe ser admin |
| Facundo | sí (`bus…@gmail.com`), confirmada, nunca ingresó | sí | Buscatools, activa | salesperson | **DIFFERENT_ROLE** (propuesto employee) | confirmar el cambio (sube permisos: ve todos los clientes y edita productos/precios). Se aplica en un clic desde la pantalla nueva. Activar acceso: bloqueado por SMTP |
| Norberto | sí (`ing…@gmail.com`), confirmada, nunca ingresó | sí | Buscatools, activa | employee | **MATCH** | activar acceso: bloqueado por SMTP |
| Brian | no | no | no | — | **MISSING** | email: no está en ninguna fuente (legacy sólo tiene el nombre en `TEAM_USERS`). Invitar cuando haya email + SMTP. **READY TO INVITE BRIAN = NO** |
| Oscar | no | no | no | — | **MISSING** | no aparece ni en el legacy ni en React: confirmar identidad y email; invitar cuando haya SMTP |

Además: cuenta **«Admin»** (`inf…@buscatools.com.ar`, admin de Buscatools,
nunca ingresó) — no está en la propuesta; cuenta como admin para el invariante.
Decidir si se conserva. Cuentas demo (Cliente Demo, Distribuidor Demo) sin
cambios.

No se aplicó ningún cambio de rol a personas reales ni se reseteó ninguna
contraseña: la huella de memberships y perfiles de las empresas reales es
idéntica antes y después de las suites.
