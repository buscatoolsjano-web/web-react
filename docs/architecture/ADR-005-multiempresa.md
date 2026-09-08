# ADR-005 — Arquitectura multiempresa

**Estado:** Aceptada (principios) · Diseño detallado en Fase 2
**Fecha:** 2026-09-08

## Contexto

El legacy ya contempla varias empresas —Buscatools, Torquetools, GAS— pero
las resuelve con **namespacing de claves de localStorage** mediante una
función `_ekey()` que antepone un prefijo por empresa. Consecuencias:

- El aislamiento depende de que **cada punto de llamada** se acuerde de
  usar `_ekey()`. Olvidarlo una vez mezcla datos entre empresas.
- No hay ninguna garantía del lado del servidor.
- Los datos de las tres empresas conviven en las mismas filas de
  `erp_store`.

## Decisión

### 1. `company_id` en toda tabla de negocio

Toda tabla lleva `company_id uuid not null references companies(id)`.

### 2. El filtro lo hace RLS, no el componente

Requisito explícito del proyecto: *"no quiero agregar manualmente filtros
de empresa en cada componente"*.

Las políticas RLS filtran por las empresas a las que pertenece el usuario
autenticado, vía `company_memberships`. Un `select` sin filtro de empresa
**ya viene filtrado por la base**.

Esto invierte el modelo del legacy: antes el aislamiento dependía de que el
código se acordara; ahora es imposible saltearlo, incluso modificando la
request a mano.

### 3. Empresa activa en el cliente = preferencia de UI

`features/empresa/` mantiene qué empresa está mirando el usuario. Es
**sólo una preferencia de presentación** que puede persistirse en
localStorage: no es un control de seguridad. Aunque alguien la manipule, la
base sigue devolviendo únicamente lo que RLS permite.

### 4. Un usuario puede pertenecer a varias empresas

`company_memberships` es N:N, con rol **por empresa**: alguien puede ser
ADMIN en Buscatools y VENDEDOR en Torquetools.

## Pendiente para Fase 2

- Esquema de `companies`, `company_memberships`, `roles`, `permissions`.
- Función auxiliar en Postgres (ej. `auth_company_ids()`) para no repetir
  la subconsulta en cada política.
- Decidir si los datos legacy de las tres empresas se migran o si sólo
  arranca Buscatools.

## Consecuencias

- Los componentes no saben de empresas. Piden datos y reciben lo que
  corresponde.
- Costo: hay que pensar el `company_id` en cada tabla desde el inicio.
  Agregarlo después obligaría a migrar datos.
