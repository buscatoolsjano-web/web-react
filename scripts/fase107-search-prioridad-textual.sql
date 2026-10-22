-- Fase 107 · Prioridad textual en el buscador del catálogo (search_products).
--
-- Problema: buscar «riv» traía arriba productos «Mercedes Benz.Riv 0169500»
-- (tienen «Riv» suelto en el nombre, word_similarity=1.0) por encima de RIVIT,
-- porque el score sólo miraba name y sku e ignoraba la MARCA, y el desempate
-- por nombre alfabético ponía «Mercedes» antes que «RIVIT».
--
-- Fix: el score pasa a priorizar por tramos — marca que empieza con lo buscado
-- (3), SKU/modelo que empiezan (2), nombre (1), y recién ahí la similitud
-- difusa sobre name/sku/marca/modelo. Misma firma: CREATE OR REPLACE reemplaza
-- sin crear sobrecarga. Aplicada con apply_migration el 2026-10-22.
CREATE OR REPLACE FUNCTION public.search_products(p_company uuid, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_category uuid DEFAULT NULL::uuid, p_brand uuid DEFAULT NULL::uuid, p_attrs jsonb DEFAULT NULL::jsonb, p_type text[] DEFAULT NULL::text[], p_ranges jsonb DEFAULT NULL::jsonb, p_orden text DEFAULT 'nombre'::text, p_solo_catalogo boolean DEFAULT false, p_series text[] DEFAULT NULL::text[])
 RETURNS TABLE(id uuid, score real, rank_position integer, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_busca boolean := p_query is not null and btrim(p_query) <> '';
  v_desc  boolean := p_orden like '%\_desc';
  v_campo text   := case when p_orden like '%\_desc'
                         then left(p_orden, length(p_orden) - 5)
                         else coalesce(p_orden, 'nombre') end;
  v_por_stock boolean := v_campo in ('stock_real', 'stock_virtual');
  v_necesita_stock boolean := v_campo in ('stock_real', 'stock_virtual', 'destacado');
  v_attr_key  text    := case when v_campo like 'attr:%'
                              then substring(v_campo from 6) end;
  v_qn text;
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.4', true);
  IF v_busca THEN v_qn := lower(extensions.unaccent(btrim(p_query))); END IF;

  RETURN QUERY
  WITH matches AS (
    SELECT
      p.id, p.name, p.sku,
      coalesce(p.model_code, '') AS modelo,
      coalesce(b.name, '')  AS marca,
      coalesce(c.name, '')  AS categoria,
      coalesce(p.series,'') AS serie,
      coalesce(p.product_type,'') AS tipo,
      s.saldo_real, s.saldo_virtual,
      (v_campo = 'destacado'
       AND EXISTS (SELECT 1 FROM product_images i
                    WHERE i.product_id = p.id AND i.is_primary)) AS tiene_foto,
      CASE WHEN v_attr_key IS NOT NULL
           THEN p.attributes ->> v_attr_key END AS attr_txt,
      CASE WHEN v_attr_key IS NOT NULL
            AND p.attributes ->> v_attr_key ~ '^\s*-?\d+([.,]\d+)?\s*$'
           THEN replace(btrim(p.attributes ->> v_attr_key), ',', '.')::numeric
      END AS attr_num,
      CASE WHEN v_busca THEN (
             (CASE
                WHEN starts_with(lower(extensions.unaccent(coalesce(b.name,''))), v_qn) THEN 3.0
                WHEN starts_with(lower(extensions.unaccent(p.sku)), v_qn)
                  OR starts_with(lower(extensions.unaccent(coalesce(p.model_code,''))), v_qn) THEN 2.0
                WHEN starts_with(lower(extensions.unaccent(p.name)), v_qn)
                  OR strpos(lower(extensions.unaccent(p.name)), ' ' || v_qn) > 0 THEN 1.0
                ELSE 0.0
              END)
             + GREATEST(
                 word_similarity(p_query, p.name),
                 word_similarity(p_query, p.sku),
                 word_similarity(p_query, coalesce(b.name,'')),
                 word_similarity(p_query, coalesce(p.model_code,''))
               )
           )::real
           ELSE 0::real END AS score
    FROM products p
    LEFT JOIN brands b             ON b.id = p.brand_id
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT sum(sb.on_hand)               AS saldo_real,
             sum(sb.on_hand - sb.reserved) AS saldo_virtual
        FROM stock_balances sb
       WHERE sb.product_id = p.id
         AND v_necesita_stock
    ) s ON true
    WHERE p.company_id = p_company
      AND p.deleted_at IS NULL
      AND (p_category IS NULL OR p.category_id = p_category)
      AND (p_brand    IS NULL OR p.brand_id    = p_brand)
      AND (p_type     IS NULL OR p.product_type = ANY(p_type))
      AND (p_attrs  IS NULL OR p_attrs  = '{}'::jsonb
           OR app.attrs_match(p.attributes, p_attrs))
      AND (p_ranges IS NULL OR p_ranges = '{}'::jsonb
           OR app.ranges_match(p.attributes, p_ranges))
      AND (NOT p_solo_catalogo
           OR p.brand_id IS NULL
           OR EXISTS (SELECT 1 FROM brands b2
                       WHERE b2.id = p.brand_id AND b2.is_active))
      AND (NOT p_solo_catalogo
           OR p.category_id IS NULL
           OR EXISTS (SELECT 1 FROM product_categories c2
                       WHERE c2.id = p.category_id AND c2.is_active))
      AND (p_series IS NULL OR p.series = ANY(p_series))
      AND (NOT v_busca
           OR p.search_vector @@ websearch_to_tsquery('spanish', p_query)
           OR p_query <% p.name
           OR p_query <% p.sku)
  ),
  ranked AS (
    SELECT m.id, m.score,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_busca THEN m.score END DESC NULLS LAST,
          CASE WHEN v_campo = 'destacado' AND coalesce(m.saldo_real, 0) > 0
               THEN 0 ELSE 1 END ASC,
          CASE WHEN v_campo = 'destacado' AND m.tiene_foto THEN 0 ELSE 1 END ASC,
          CASE WHEN NOT v_desc AND v_campo = 'marca'     THEN m.marca     END ASC,
          CASE WHEN     v_desc AND v_campo = 'marca'     THEN m.marca     END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'categoria' THEN m.categoria END ASC,
          CASE WHEN     v_desc AND v_campo = 'categoria' THEN m.categoria END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'tipo'      THEN m.tipo      END ASC,
          CASE WHEN     v_desc AND v_campo = 'tipo'      THEN m.tipo      END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'serie'     THEN m.serie     END ASC,
          CASE WHEN     v_desc AND v_campo = 'serie'     THEN m.serie     END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'modelo'    THEN m.modelo    END ASC,
          CASE WHEN     v_desc AND v_campo = 'modelo'    THEN m.modelo    END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'sku'       THEN m.sku       END ASC,
          CASE WHEN     v_desc AND v_campo = 'sku'       THEN m.sku       END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_attr_key IS NOT NULL THEN m.attr_num END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_attr_key IS NOT NULL THEN m.attr_num END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_attr_key IS NOT NULL THEN m.attr_txt END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_attr_key IS NOT NULL THEN m.attr_txt END DESC NULLS LAST,
          CASE WHEN v_por_stock THEN m.name END ASC,
          CASE WHEN NOT v_desc AND v_campo NOT IN ('marca','categoria','serie','sku','stock_real','stock_virtual') THEN m.name END ASC,
          CASE WHEN     v_desc AND v_campo NOT IN ('marca','categoria','serie','sku','stock_real','stock_virtual') THEN m.name END DESC,
          m.id ASC
      ) AS rank_position,
      count(*) OVER () AS total_count
    FROM matches m
  )
  SELECT r.id, r.score, r.rank_position::integer, r.total_count
  FROM ranked r
  ORDER BY r.rank_position
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;
