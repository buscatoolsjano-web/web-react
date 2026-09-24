-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 26 · Un producto dado de baja no se ve, tampoco para admin          ║
-- ║                                                                          ║
-- ║                 APLICADO — 24/09/2026                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Apareció probando el alta de producto (Fase 26 · E3): se creó uno de prueba,
-- se le puso `deleted_at` y **siguió apareciendo en el catálogo**.
--
-- La causa no es del alta ni del catálogo: es de las policies de `products`.
--
--   products_select  FOR SELECT  permisiva
--     using (empresa del usuario AND deleted_at is null AND (interno OR status='active'))
--
--   products_write   FOR ALL     permisiva
--     using (empresa donde el usuario escribe)      ← sin deleted_at
--
-- `FOR ALL` **incluye SELECT**, y dos policies permisivas se combinan con OR.
-- Para un admin o employee alcanza con que pase la de `products_write`, que no
-- mira `deleted_at` ni `status`. Resultado: un rol interno ve TODOS los
-- productos de su empresa, incluidos los dados de baja.
--
-- Nunca se había notado porque **no había ningún producto dado de baja**: al
-- momento de encontrarlo, `select count(*) from products where deleted_at is
-- not null` daba 1, y ese 1 era el de prueba. El comentario dentro de
-- `search_products` —«deleted_at y status los decide RLS, no esta función»— es
-- cierto para un rol externo y falso para uno interno.
--
-- Esto **no lo introdujo la Fase 25 ni la 26**: las dos policies son de la
-- Fase 3. Lo que hizo la 26 fue ejercitar por primera vez el camino.
--
-- ── El arreglo, y por qué no se aplicó solo ────────────────────────────────
--
-- Agregarle `deleted_at is null` al `using` de `products_write` cierra el
-- agujero de lectura, pero tiene una consecuencia que hay que querer: deja de
-- poder **actualizar** una fila dada de baja, así que «restaurar» un producto
-- pasa a necesitar service_role. Para el modelo actual —donde nada da de baja
-- productos desde la app— es correcto; el día que haya un «archivar producto»
-- con su «restaurar», hay que volver acá y partir la policy por comando.
--
-- Toca cómo lee productos TODO rol interno, en las cinco pantallas que los usan,
-- así que se verificó a mano antes y después (ver el pie de este archivo).
--
--   supabase: apply_migration fase26_rls_productos_borrados

alter policy products_write on products
  using (
    company_id in (select unnest(app.current_writer_company_ids()))
    and deleted_at is null
  )
  with check (
    company_id in (select unnest(app.current_writer_company_ids()))
  );

-- ── Cómo se verificó ──────────────────────────────────────────────────────
--
-- Con un producto de prueba, consultando con la sesión de un admin desde la
-- propia app (no con service_role, que se saltea RLS):
--
--   · vivo        → la consulta lo devuelve, y aparece en el catálogo;
--   · con deleted_at → la consulta devuelve `[]`;
--   · un producto normal (`SP.TX40`) se sigue viendo;
--   · el total visible queda en 21.828, que son los productos no borrados.
--
-- El producto de prueba se eliminó después: `products` quedó en 21.828 filas y
-- ninguna dada de baja.
