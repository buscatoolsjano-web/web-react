# ADR-004 — Autenticación y Row Level Security

**Estado:** Aceptada (principios) · Pendiente de diseño detallado en Fase 2.5
**Fecha:** 2026-09-08

## Contexto — qué encontró la auditoría del legacy

El sistema actual **no usa Supabase Auth**. En su lugar:

| Qué hace el legacy | Problema |
|---|---|
| `crypto.subtle.digest('SHA-256', password)` sin salt ni KDF | Vulnerable a rainbow tables |
| Hashes guardados en `erp_auth_users` → sincronizado a `erp_store` | Los hashes de todo el equipo son legibles por cualquiera |
| Política RLS `FOR ALL TO anon USING (erp_check_app_token())` | El token está hardcodeado en el frontend: no es seguridad |
| Sesión = `localStorage.setItem('erp_session_user', 'ADMIN')` | Editarlo en DevTools es suplantar a un usuario |
| Permisos = `el.style.display = 'none'` | Ocultar un botón no protege el dato |

**Nada de esto se replica.**

## Decisión

### Principios (fijados ahora)

1. **Supabase Auth es la única fuente de identidad.** No almacenamos
   contraseñas ni hashes propios.
2. **La sesión la maneja el SDK** (`persistSession`, `autoRefreshToken`,
   PKCE). Nunca localStorage a mano.
3. **RLS obligatorio en toda tabla de negocio.** Una tabla sin política es
   un bug que bloquea el merge.
4. **La UI no es seguridad.** `PermissionGate` mejora la experiencia; el
   dato lo protege la base. Toda pantalla oculta debe tener su política
   equivalente en Postgres.
5. **Cero secretos en el frontend.** Lo que requiera privilegios va a una
   Edge Function.
6. **Las políticas se diseñan y documentan antes de escribirse.** No se
   improvisan de memoria.

### Lo que queda para Fase 2.5

- Modelo `profiles` / `companies` / `company_memberships` / `roles` /
  `permissions`.
- Políticas RLS por rol: ADMIN, EMPLEADO, VENDEDOR, DISTRIBUIDOR, CLIENTE,
  TECNICO, PROVEEDOR (futuro).
- Casos de prueba obligatorios, verificados contra la API y no sólo en la
  UI:
  - un distribuidor no puede leer datos de otro distribuidor;
  - un cliente no puede leer pedidos de otro cliente;
  - un vendedor ve sólo lo que le corresponde;
  - modificar la request a mano no cambia ninguno de los tres resultados.

## Estado en Fase 1

**No se implementó nada de auth.** `LoginPage` es un placeholder. La única
operación contra Supabase es `auth.getSession()`, que sólo lee.

Esto es deliberado: implementar auth antes de decidir el modelo de datos
fijaría decisiones de schema sin aprobación.

## Regla de bloqueo

**El sistema no se abre a usuarios externos (distribuidores, clientes,
proveedores) hasta que esta ADR esté implementada y sus casos de prueba
pasen.**
