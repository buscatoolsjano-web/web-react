# Resultados de pruebas — Fase 2B · Etapa 1 (CERRADA)

Ejecutadas el **2026-09-08** sobre `uaxcfufvapzulqvynanp`.

# TOTAL TESTS: 121 · PASS: 121 · FAIL: 0

| Suite | Pruebas | PASS | FAIL |
|---|---:|---:|---:|
| RLS | 51 | **51** | 0 |
| Regresión | 20 | **20** | 0 |
| Stock | 15 | **15** | 0 |
| Multiempresa | 14 | **14** | 0 |
| Búsqueda | 11 | **11** | 0 |
| Atributos | 5 | **5** | 0 |
| Precios | 4 | **4** | 0 |
| Diagnóstico | 1 | 1 | 0 |
| **TOTAL** | **121** | **121** | **0** |

## Cómo se probó RLS sin contraseñas

`execute_sql` del MCP corre como `supabase_read_only_user`, que tiene
**`rolbypassrls = true`**: por esa vía RLS nunca se evalúa.

Las pruebas usaron un harness que reproduce **exactamente lo que hace
PostgREST** al atender a un usuario autenticado:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
```

`auth.uid()` lee `request.jwt.claims ->> 'sub'`, así que las políticas se
evalúan por el mismo camino de código que en producción.

**No se pidieron ni se usaron contraseñas.** El harness fue **eliminado**
al cerrar la etapa (ver Limpieza).

## Usuarios de prueba — 7, ninguno creado por mí

| Nombre | Email | Rol | Empresa | Cliente asociado |
|---|---|---|---|---|
| Admin | `info@buscatools.com.ar` | `admin` | Buscatools | — |
| Juan | `jmocciaro@gmail.com` | `admin` | Buscatools | — |
| **Jano** | `buscatools.jano@gmail.com` | **`admin`** | **Buscatools** | — |
| **Jano** | *(el mismo id)* | **`salesperson`** | **Torquetools** | — |
| Norberto | `ing.buscatools@gmail.com` | `employee` | Buscatools | — |
| Facundo | `buscatools.epp@gmail.com` | `salesperson` | Buscatools | — |
| Cliente Demo (test) | `cliente.test@buscatools.com.ar` | `customer` | Buscatools | Cliente Demo S.A. |
| Distribuidor Demo (test) | `distribuidor.test@buscatools.com.ar` | `distributor` | Buscatools | Distribuidor Demo S.R.L. |

**7 usuarios · 7 profiles · 8 memberships.** Los profiles los creó el
trigger `on_auth_user_created`, sin intervención.

---

## Multiempresa — 14 pruebas

El caso que pediste verificar expresamente: **mismo `auth.users.id`, un
solo profile, dos memberships, roles distintos.**

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| A | Jano ve los 216 productos de Buscatools | 216 | 216 | ✅ |
| A2 | Jano **sí** puede crear productos en BT (admin) | 1 | 1 | ✅ |
| B | Jano ve los 3 productos de Torquetools | 3 | 3 | ✅ |
| **C** | `app.current_role(TT)` = `salesperson`, **no** `admin` | salesperson | salesperson | ✅ |
| **C2** | `app.is_admin(TT)` es `false` pese a ser admin en BT | false | false | ✅ |
| **D** | Jano **no** puede crear productos en TT | error de política | `new row violates row-level security policy` | ✅ |
| **D2** | Jano **no** puede crear marcas en TT | error | error de política | ✅ |
| **E** | Sin filtro, ve 216 + 3 = 219 de **sus** dos empresas | 219 | 219 | ✅ |
| **E2** | Y quedan bien atribuidos, sin mezcla | `buscatools=216 \| torquetools=3` | idéntico | ✅ |
| E3 | Admin BT (1 membresía) sigue viendo sólo 216 | 216 | 216 | ✅ |
| **F** | `current_role(BT)` = admin, mismo usuario | admin | admin | ✅ |
| F2 | `current_company_ids()` devuelve 2 empresas | 2 | 2 | ✅ |
| F3 | `is_internal` true en ambas | true/true | true/true | ✅ |
| G | `profiles` **no** tiene columna de rol | 0 | 0 | ✅ |

**Tus seis puntos, respondidos:**

- **A** ✅ Jano accede a Buscatools como admin, incluida escritura.
- **B** ✅ Accede a Torquetools sólo con capacidades de salesperson: lee,
  no escribe.
- **C** ✅ Ser admin en Buscatools **no** lo hace admin en Torquetools:
  `is_admin(TT) = false`.
- **D** ✅ Poner `company_id = <Torquetools>` en el INSERT **no** eleva
  permisos: la política evalúa el rol *de esa empresa*.
- **E** ✅ Una consulta sin `company_id` devuelve 219 filas correctamente
  atribuidas (216 + 3), sin contaminación cruzada.
- **F** ✅ Los helpers `SECURITY DEFINER` resuelven la membresía correcta
  por empresa en la misma sesión.

---

## RLS — 51 pruebas

### Sin membresía y anon (24) — ejecutadas ANTES de asignar membresías

Aprovechando la ventana con 0 memberships, como propusiste. Sin cuentas
descartables. 13 tablas invisibles + su propio perfil + monedas + 7 tablas
denegadas a `anon` + 2 intentos de escritura de `anon`. **Todas PASS.**

### Roles internos (12)

Admin ve lo suyo (216 productos, 3 clientes, 50 saldos) y **no** ve
Torquetools. Vendedor ve **1 de 3 clientes** (su cartera) pero el catálogo
completo. Vendedor **no** puede crear productos; empleado sí. Nadie edita
el perfil de otro. **Todas PASS.**

### Roles externos (15) — las 5 que faltaban, más 10 derivadas

| # | Prueba | Esperado | Obtenido | R |
|---|---|---|---|---|
| **4** | Cliente ve 1 de 3 clientes | 1 | 1 | ✅ |
| 4b | Y el que ve es el suyo | Cliente Demo | Cliente Demo | ✅ |
| **10** | Cliente pide **por id** el registro de otro cliente | 0 | 0 | ✅ |
| 10b | Cliente pide precios de listas ajenas | 0 | 0 | ✅ |
| **5** | Distribuidor ve 1 de 3 listas | 1 | 1 | ✅ |
| **5b** | Y es la lista Distribuidores | Distribuidores | Distribuidores | ✅ |
| 5c | Ve 124 precios, no 372 | 124 | 124 | ✅ |
| 5d | El precio que ve es el suyo (504,36), no el de lista (593,37) | 504.3645 | 504.3645 | ✅ |
| **11** | Distribuidor **no** ve cantidades de stock | 0 | 0 | ✅ |
| 11b | Pero **sí** ve disponibilidad por la vista | 51 | 51 | ✅ *(tras corregir la vista)* |
| 11c | No ve depósitos | 0 | 0 | ✅ |
| 11d | Sigue sin ver cantidades exactas | 0 | 0 | ✅ |
| 11e | La vista no expone `on_hand` ni `reserved` | 4 columnas | idéntico | ✅ |
| 11f | El cliente también ve disponibilidad | 51 | 51 | ✅ |
| 11g | `anon` no ve la vista | error | `permission denied` | ✅ |

---

## Stock — 15 pruebas

IN → 100 · OUT → 70 · ADJUSTMENT → 65 · RESERVATION 20 → `reserved` sube
sin tocar `on_hand` · RELEASE → 0 · ciclo completo con 45 verificado.

`UPDATE stock_balances`, `UPDATE stock_movements` y `DELETE
stock_movements` → **error de permisos incluso para el admin**.
`quantity = 0`, reserva negativa y `movement_type` inválido → error de
CHECK. `SUM(movimientos) = SUM(saldos)`. **Todas PASS.**

---

## Regresión — 20 pruebas (tu checklist)

| # | Verificación pedida | Esperado | Obtenido | R |
|---|---|---|---|---|
| R1 | **Integridad de stock** | consistente | consistente | ✅ |
| R1b | Ningún `reserved` negativo | 0 | 0 | ✅ |
| R2 | **Aislamiento de precios** admin/Jano/distrib./cliente | 372/375/124/124 | idéntico | ✅ |
| R3 | **Aislamiento por `company_id`**: Admin 216, Jano 219 | 216/219 | 216/219 | ✅ |
| R3b | Ninguna tabla sin RLS | 0 | 0 | ✅ |
| R3c | Toda tabla de negocio tiene `company_id` (12 de 15) | 0 | 0 | ✅ |
| R4 | **`anon` bloqueado**: sin SELECT en ninguna tabla | 0 | 0 | ✅ |
| R4b | `anon` no lee `products` | error | `permission denied` | ✅ |
| R4c | Ninguna política otorga acceso a `anon` | 0 | 0 | ✅ |
| R5 | **Usuario sin membresía activa bloqueado** (suspendida) | 0 | 0 | ✅ |
| R5b | Reactivada, vuelve a ver los 216 | 216 | 216 | ✅ |
| R6 | **`stock_movements` inmutable** (UPDATE y DELETE) | 2 errores | 2 errores | ✅ |
| R7 | **`stock_balances` no escribible** (UPDATE e INSERT) | 2 errores | 2 errores | ✅ |
| R8 | **`profiles` 1:1 con `auth.users`** | 7/7/7, 0 huérfanos | idéntico | ✅ |
| R9 | **N memberships por profile**: Jano 2, resto 1 | Jano=2 | Jano=2 | ✅ |
| R10 | `profiles` sin rol ni `company_id` globales | 0 | 0 | ✅ |
| R11 | La vista de disponibilidad filtra por empresa | contiene el filtro | contiene el filtro | ✅ |
| R12 | Sin sesión, la vista no devuelve nada | 0 | 0 | ✅ |
| R13 | Admin BT ve la disponibilidad de sus 51 saldos | 51 | 51 | ✅ |
| R14 | El distribuidor no ve disponibilidad de otra empresa | 0 | 0 | ✅ |

**Cero `service_role` en el frontend**: verificado con `grep` sobre `src/`
antes de cada commit. La `service_role` key no aparece en ningún archivo
del repositorio.

---

## Búsqueda — 11 pruebas · Atributos — 5 pruebas

Búsqueda: SKU exacto, nombre parcial, tipeo con trigram, texto libre,
marca, categoría, atributo JSONB, acentos, y **`pgvector` no instalado**.

Tiempos (219 productos): atributo JSONB 0,11 ms · ILIKE 0,59 ms · SKU
exacto 0,70 ms · trigram 2,02 ms · full-text 3,20 ms · join 4,77 ms.
Como acordamos, **no se marcó ningún test como fallo por elegir Seq Scan**.

Atributos: clave declarada acepta, clave no declarada da error nombrándola,
`{}` acepta, una clave inválida invalida el INSERT completo.

---

## Problemas encontrados y corregidos — 8

### 🔴 1. El RELEASE de reservas estaba roto (prueba S5)

Liberar una reserva no bajaba `reserved`. El diagnóstico descartó RLS y
mostró la causa:

```
new row for relation "stock_balances" violates check constraint
"chk_reserved_non_negative"
```

**PostgreSQL evalúa los `CHECK` sobre la fila propuesta *antes* de resolver
el `ON CONFLICT`**, así que el delta negativo del RELEASE (`-20`) violaba
la restricción aunque el resultado hubiera sido 0.

Corregido: upsert en el alta, `UPDATE` directo en la baja. **Habría llegado
a producción dejando stock reservado imposible de liberar.**

### 🔴 2. La vista de disponibilidad no servía a quienes estaba destinada (prueba 11b)

`product_availability` se creó con `security_invoker = true`, así que
heredaba la política de `stock_balances`, que **deniega a clientes y
distribuidores**. Devolvía 0 filas justamente a los usuarios externos para
los que fue diseñada.

RLS es a nivel de **fila**, no de **columna**: no se puede dar acceso a
`stock_balances` "pero sin las cantidades". La vista debe correr con
privilegios de su dueño y filtrar ella misma por empresa.

Corregido. Verificado con 6 pruebas (11b, 11d–11g, R11–R14).

> **Advisor aceptado con justificación.** Supabase marca esta vista como
> `security_definer_view` (nivel ERROR). Es deliberado y es la única
> herramienta que Postgres ofrece para exponer una proyección restringida
> de una tabla protegida por RLS. Mitigación verificada: la vista filtra
> por `app.current_company_ids()` (su único control de acceso, probado en
> R11–R14), expone **sólo un booleano**, y está revocada para `anon`.

### 🟠 3. La búsqueda por tipeo quedó rota al mover las extensiones (B3)

Mover `pg_trgm` a `extensions` dejó el operador `%` fuera del `search_path`
de `authenticated`. La app no habría podido resolverlo. Corregido con
`ALTER ROLE ... SET search_path`.

### 🟠 4. Nueve marcas inventadas en el seed

ATLAS COPCO, DESOUTTER, CLECO, STANLEY, BOSCH, MAKITA, METABO, DEWALT y
MILWAUKEE **no existen en el catálogo legacy: las supuse**. Reemplazadas
por las 9 reales que faltaban (BR, RIVIT, TO, GE, NA, KI, KOKEN, SI, MI).

### 🟢 5–8

`stock_movements` aceptaba `UPDATE` en silencio → `REVOKE`.
`PUBLIC` conservaba `EXECUTE` en las funciones `SECURITY DEFINER`.
Extensiones instaladas en `public` (advisor).
Dos expectativas mías mal escritas en la regresión (R2 y R3c), corregidas
con su justificación, no forzadas a verde.

---

## Limitaciones documentadas

**1. `attributes` valida la clave, no el tipo.** `{"min_kg": "texto"}` se
acepta aunque `min_kg` esté declarado como `number`. Deliberado: no se
agregó lógica al trigger sin necesidad demostrada. El tipo se valida mejor
con Zod en el borde de la aplicación.

**2. Hallazgo para la búsqueda en Fase 3.** El operador `%` compara la
cadena completa y se diluye en nombres largos; `%>` usa umbral 0.6 y
`balansiador` vs `BALANCEADOR` puntúa 0.5. **Recomendación:** filtrar con
`word_similarity(q, name) > 0.4` y `ORDER BY … DESC LIMIT n`.

---

## Estado final

| | Antes | Después |
|---|---|---|
| Tablas / con RLS / políticas | 0 / 0 / 0 | **15 / 15 / 30** |
| Usuarios / profiles / memberships | 0 / 0 / 0 | **7 / 7 / 8** |
| Empresas | 0 | **2** |
| Productos | 0 | **219** (216 BT + 3 TT) |
| Precios | 0 | **375** |
| Movimientos / saldos | 0 | **53 / 51** |
| Clientes | 0 | **3** |
| Tamaño de la base | 10.203 kB | **13 MB** |

## Limpieza realizada

El harness (`app.as_user`, `app.as_anon`) hacía `SET ROLE` y **fue
eliminado** al cerrar la etapa. `app.test_results` se conserva como
registro de las 121 pruebas; no tiene privilegios especiales y se puede
borrar cuando quieras.

## Advertencia abierta — acción tuya

**Leaked Password Protection** sigue desactivado en Authentication →
Policies. Es configuración de tu cuenta y no la toco. Recomiendo activarlo
antes de abrir el sistema a usuarios externos reales.
