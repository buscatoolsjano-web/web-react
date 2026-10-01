-- Fase 38 · El catálogo se lee como el de la web vieja
--
-- Dos cambios en la base. Los dos son de PRESENTACIÓN, pero se hacen acá
-- porque el orden y el criterio tienen que valer para cualquiera que consulte,
-- no sólo para la pantalla que los pida.

-- ── 1 · «Otros» va al final ──────────────────────────────────────────────
--
-- `catalog_facets` ordenaba las categorías por CANTIDAD descendente, así que
-- «Otros» —el cajón de sastre, 12.536 productos— era el PRIMER chip que se
-- ofrecía. Es exactamente al revés de lo útil: lo primero tiene que ser lo que
-- está clasificado.
--
-- La columna `position` ya existía para esto y ya tenía el orden bueno para
-- las categorías reales (Puntas 1, Balanceadores 2, Atornilladores 3,
-- Accesorios 4). El problema era que los tres cajones de sastre habían quedado
-- en 0, o sea empatados y primeros.
update product_categories set position = 8  where slug = 'herramientas';
update product_categories set position = 90 where slug = 'pendiente-clasificacion-stel';
update product_categories set position = 99 where slug = 'otros';

-- Y la RPC pasa a respetarla. A partir de acá el orden de los chips se cambia
-- con un UPDATE y no con un deploy.
--
--   ORDER BY s.n DESC, c.name   →   ORDER BY c.position, c.name
--
-- (el reemplazo se hizo sobre `pg_get_functiondef`, para no copiar las 200
-- líneas de la función y arriesgarse a perder algo en el camino)
do $$
declare d text; viejo text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'catalog_facets';
  viejo := 'ORDER BY s.n DESC, c.name), ''[]''::jsonb) AS j';
  if position(viejo in d) = 0 then
    raise notice 'catalog_facets ya estaba ordenando por position';
    return;
  end if;
  execute replace(d, viejo, 'ORDER BY c.position, c.name), ''[]''::jsonb) AS j');
end $$;

-- ── 2 · Ordenar por MODELO ───────────────────────────────────────────────
--
-- La columna del NOMBRE se fue de la tabla: era la más ancha y decía lo mismo
-- que las tres de al lado («APEX *5422 EMBOCADURA» = marca + modelo + serie),
-- y por su culpa había que scrollear de costado para llegar al precio. En su
-- lugar va MODELO, que es lo que identifica al producto dentro de su marca.
--
-- Para que esa columna se pueda ordenar hay que agregarla a la CTE y al
-- ORDER BY de `search_products`.
do $$
declare d text; v1 text; v2 text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_products';

  v1 := '      p.id, p.name, p.sku,';
  v2 := '          CASE WHEN NOT v_desc AND v_campo = ''sku''       THEN m.sku       END ASC,';

  if position(v1 in d) = 0 or position(v2 in d) = 0 then
    raise notice 'search_products ya tenia el orden por modelo';
    return;
  end if;

  d := replace(d, v1, v1 || E'\n      coalesce(p.model_code, '''') AS modelo,');
  d := replace(d, v2,
         '          CASE WHEN NOT v_desc AND v_campo = ''modelo''    THEN m.modelo    END ASC,'   || E'\n' ||
         '          CASE WHEN     v_desc AND v_campo = ''modelo''    THEN m.modelo    END DESC,'  || E'\n' || v2);
  execute d;
end $$;

-- ── Comprobación ─────────────────────────────────────────────────────────
-- select jsonb_path_query_array(
--          public.catalog_facets('<empresa>'), '$.categories[*].name');
--   → «Otros» tiene que ser el último.

-- ── 3 · Ordenar por TIPO ─────────────────────────────────────────────────
--
-- `product_type` vuelve a ser columna, como la TIPO de la web vieja. No es lo
-- mismo que SERIE y por eso van las dos: `series` es la familia («Punta») y
-- `product_type` el tipo concreto («Torx»). Está cargado en el 67 % de los
-- productos —más que `series`, que llega al 42 %—.
do $$
declare d text; v1 text; v2 text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_products';

  if position('v_campo = ''tipo''' in d) > 0 then
    raise notice 'search_products ya ordenaba por tipo';
    return;
  end if;

  v1 := '      coalesce(p.series,'''') AS serie,';
  v2 := '          CASE WHEN NOT v_desc AND v_campo = ''serie''     THEN m.serie     END ASC,';
  if position(v1 in d) = 0 or position(v2 in d) = 0 then
    raise exception 'no encontre los bloques de serie';
  end if;

  d := replace(d, v1, v1 || E'\n      coalesce(p.product_type,'''') AS tipo,');
  d := replace(d, v2,
        '          CASE WHEN NOT v_desc AND v_campo = ''tipo''      THEN m.tipo      END ASC,'  || E'\n' ||
        '          CASE WHEN     v_desc AND v_campo = ''tipo''      THEN m.tipo      END DESC,' || E'\n' || v2);
  execute d;
end $$;
