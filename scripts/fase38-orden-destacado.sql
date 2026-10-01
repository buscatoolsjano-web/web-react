-- Fase 38 · El catálogo abre por lo que se usa, no por el abecedario
--
-- El orden por defecto era `nombre`. Con 21.757 productos, eso ponía en la
-- primera página los que empiezan con «*» o con un número — justo los que
-- menos se usan.
--
-- Lo que se usa todos los días es otra cosa, y los datos lo dicen:
--   · 379 productos tienen stock en el depósito  (1,7 %)
--   · 3.979 tienen foto cargada                  (18 %)
--
-- Tener foto no es casualidad: alguien se tomó el trabajo de cargarla, y eso
-- ya es una señal de que el producto importa.

do $$
declare d text; v1 text; v2 text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_products';

  if position('destacado' in d) > 0 then
    raise notice 'search_products ya tiene el orden destacado'; return;
  end if;

  -- 1 · Saber si tiene foto.
  v1 := '      s.saldo_real, s.saldo_virtual,';
  d := replace(d, v1, v1 || E'\n' ||
    '      EXISTS (SELECT 1 FROM product_images i' || E'\n' ||
    '               WHERE i.product_id = p.id AND i.is_primary) AS tiene_foto,');

  -- 2 · LA TRAMPA · el saldo sólo se calculaba al ORDENAR por stock
  --
  -- La subconsulta de stock lleva `AND v_por_stock`, que es una optimización
  -- buena: no sumar saldos cuando nadie los va a mirar. Pero con `destacado`
  -- esa bandera es falsa, así que `saldo_real` venía NULL y la rama de stock
  -- del orden no hacía NADA: ordenaba sólo por foto, y en la primera prueba
  -- los 50 primeros tenían foto y ninguno tenía stock.
  --
  -- Se agrega una bandera propia en vez de ensanchar `v_por_stock`, que
  -- también se usa como criterio de desempate más abajo y significa otra cosa.
  d := replace(d,
    '  v_por_stock boolean := v_campo in (''stock_real'', ''stock_virtual'');',
    '  v_por_stock boolean := v_campo in (''stock_real'', ''stock_virtual'');' || E'\n' ||
    '  v_necesita_stock boolean := v_campo in (''stock_real'', ''stock_virtual'', ''destacado'');');

  d := replace(d, '         AND v_por_stock' || E'\n' || '    ) s ON true',
                  '         AND v_necesita_stock' || E'\n' || '    ) s ON true');

  -- 3 · El orden. Va después del puntaje: cuando hay búsqueda manda la
  --     relevancia, como siempre. Las dos ramas son constantes cuando el
  --     orden NO es `destacado`, así que no afectan a los demás.
  v2 := '          CASE WHEN v_busca THEN m.score END DESC NULLS LAST,';
  d := replace(d, v2, v2 || E'\n' ||
    '          CASE WHEN v_campo = ''destacado'' AND coalesce(m.saldo_real, 0) > 0' || E'\n' ||
    '               THEN 0 ELSE 1 END ASC,' || E'\n' ||
    '          CASE WHEN v_campo = ''destacado'' AND m.tiene_foto THEN 0 ELSE 1 END ASC,');

  execute d;
end $$;

-- Comprobación: los 50 primeros tienen que tener stock Y foto.
--   select count(*) filter (where con_stock), count(*) filter (where con_foto)
--   from (select exists (select 1 from stock_balances b
--                         where b.product_id = r.id and b.on_hand > 0) as con_stock,
--                exists (select 1 from product_images i
--                         where i.product_id = r.id and i.is_primary) as con_foto
--         from public.search_products('<empresa>', null, 50, 0, null, null, null,
--                                     null, null, 'destacado') r) x;
--   → 50 y 50.
--
-- Costo: 163 ms contra 146 del orden por nombre. 17 ms por la columna nueva.
