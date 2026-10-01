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

-- ── 4 · Filtrar por SERIE desde la columna ───────────────────────────────
--
-- `filtros.serie` existía en el frontend desde hacía rato y se armaba en el
-- plan de consulta, pero NUNCA llegaba a la base: `search_products` no tenía
-- el parámetro. Era estado muerto. Con la fila de filtros por columna pasa a
-- hacer falta de verdad.
--
-- OJO · `CREATE OR REPLACE` con un parámetro NUEVO no reemplaza: crea una
-- SOBRECARGA. Con las dos vivas, PostgREST contesta
-- «Could not choose the best candidate function» y el catálogo queda en cero.
-- Hay que borrar la vieja. Eso lo hace el bloque del final.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_products'
     and position('p_series' in pg_get_function_arguments(p.oid)) = 0;
  if d is null then raise notice 'search_products ya acepta p_series'; return; end if;

  d := replace(d, 'p_solo_catalogo boolean DEFAULT false)',
                  'p_solo_catalogo boolean DEFAULT false, p_series text[] DEFAULT NULL::text[])');
  d := replace(d, '      AND (NOT v_busca',
                  '      AND (p_series IS NULL OR p.series = ANY(p_series))' || E'\n' || '      AND (NOT v_busca');
  execute d;
end $$;

-- Y las facetas: aceptan el filtro y además DEVUELVEN los valores de serie,
-- que son los que pueblan el desplegable de esa columna.
do $$
declare d text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'catalog_facets'
     and position('p_series' in pg_get_function_arguments(p.oid)) = 0;
  if d is null then raise notice 'catalog_facets ya acepta p_series'; return; end if;

  d := replace(d, 'p_solo_catalogo boolean DEFAULT false)',
                  'p_solo_catalogo boolean DEFAULT false, p_series text[] DEFAULT NULL::text[])');
  d := replace(d, '    SELECT p.brand_id, p.category_id, p.product_type, p.attributes,',
                  '    SELECT p.brand_id, p.category_id, p.product_type, p.series, p.attributes,');
  d := replace(d, '           (p_type     IS NULL OR p.product_type = ANY(p_type)) AS ok_tipo,',
                  '           (p_type     IS NULL OR p.product_type = ANY(p_type)) AS ok_tipo,' || E'\n' ||
                  '           (p_series   IS NULL OR p.series       = ANY(p_series)) AS ok_serie,');
  d := replace(d, 'SELECT count(*) AS n FROM marcado' || E'\n' || '    WHERE ok_cat AND ok_marca AND ok_tipo AND ok_attrs AND ok_rango',
                  'SELECT count(*) AS n FROM marcado' || E'\n' || '    WHERE ok_cat AND ok_marca AND ok_tipo AND ok_serie AND ok_attrs AND ok_rango');

  v_ancla := E'  )\n  SELECT jsonb_build_object(';
  d := replace(d, v_ancla, E'  ),\n' ||
    '  f_serie AS (' || E'\n' ||
    '    SELECT coalesce(jsonb_agg(jsonb_build_object(''value'', s.series, ''count'', s.n)' || E'\n' ||
    '                              ORDER BY s.n DESC, s.series), ''[]''::jsonb) AS j' || E'\n' ||
    '    FROM (SELECT series, count(*) n FROM marcado' || E'\n' ||
    '          WHERE ok_cat AND ok_marca AND ok_tipo AND ok_attrs AND ok_rango' || E'\n' ||
    '            AND coalesce(series, '''') <> ''''' || E'\n' ||
    '          GROUP BY 1) s' || E'\n' || '  )' || E'\n' || '  SELECT jsonb_build_object(');
  d := replace(d, '    ''product_types'', (SELECT j FROM f_tipo),',
                  '    ''product_types'', (SELECT j FROM f_tipo),' || E'\n' ||
                  '    ''series'',        (SELECT j FROM f_serie),');
  execute d;
end $$;

-- Las sobrecargas viejas se van: con las dos vivas, PostgREST no puede elegir.
drop function if exists public.search_products(uuid,text,integer,integer,uuid,uuid,jsonb,text[],jsonb,text,boolean);
drop function if exists public.catalog_facets(uuid,text,uuid,uuid,text[],jsonb,jsonb,boolean);

-- Comprobación: las dos tienen que dar el MISMO número.
--   select (public.catalog_facets('<empresa>', null, null, null, null, null, null,
--                                 false, array['Punta']) ->> 'total')::int;
--   select count(*) from public.search_products('<empresa>', null, 5000, 0, null,
--                       null, null, null, null, 'nombre', false, array['Punta']);

-- ── 5 · Las opciones numéricas se ordenan por número ─────────────────────
--
-- Los filtros dependientes YA funcionaban: al elegir `torq_min = 6`, las
-- opciones de `torq_max` salen de los productos que tienen torque mínimo 6, o
-- sea que ninguna puede ser menor. Lo que fallaba era el ORDEN: las opciones
-- venían por cantidad, así que se leían «20, 24, 12, 10, 15, 18» y parecía
-- que el filtro no había hecho nada.
--
-- Ordenar por texto tampoco sirve: «100» iría antes que «15».
--
-- Los atributos NO numéricos (Encastre, Carcasa) siguen por cantidad, que ahí
-- es lo útil: lo más usado arriba.
do $$
declare d text; viejo text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'catalog_facets';

  viejo := '                       ORDER BY ap.n DESC, ap.val) AS vals';
  if position(viejo in d) = 0 then
    raise notice 'catalog_facets ya ordena las opciones por numero'; return;
  end if;

  d := replace(d, viejo,
    '                       ORDER BY CASE WHEN ap.val ~ ''^\s*-?\d+([.,]\d+)?\s*$''' || E'\n' ||
    '                                     THEN replace(btrim(ap.val), '','', ''.'')::numeric' || E'\n' ||
    '                                END NULLS LAST,' || E'\n' ||
    '                                ap.n DESC, ap.val) AS vals');
  execute d;
end $$;

-- Comprobación:
--   select jsonb_path_query_array(public.catalog_facets('<empresa>', null,
--            '<categoria atornilladores>'::uuid, null, null,
--            '{"torq_min": ["6"]}'::jsonb), '$.attributes.torq_max.values[*].value');
--   → ["10","12","15","18","20","24"] · ninguno menor a 6, y en orden.
