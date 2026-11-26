-- Líneas alternativas en la cotización (2026-11).
-- «Nos piden algo y tenemos alternativas: queremos mostrarlas.» Una línea
-- alternativa se muestra (en chico, debajo de la línea a la que reemplaza) pero
-- NO suma al total y NO pasa al pedido. Si el cliente elige la alternativa, se
-- intercambia cuál es la principal antes de generar el pedido.
alter table public.sales_quote_lines
  add column if not exists is_alternative boolean not null default false;

comment on column public.sales_quote_lines.is_alternative is
  'Alternativa a la línea principal anterior: se muestra pero no suma al total ni pasa al pedido.';

-- El total no suma las alternativas.
create or replace function app.totales_cotizacion(p_quote uuid, p_dto numeric, p_perc numeric)
 returns table(subtotal numeric, tax_amount numeric, total numeric)
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with l as (
    select coalesce(quantity, 0) * coalesce(unit_price, 0)
             * (1 - coalesce(discount_pct, 0) / 100) as neto,
           coalesce(tax_rate_snapshot, 0) / 100      as tasa
      from sales_quote_lines
     where quote_id = p_quote and line_type <> 'chapter' and not is_alternative
  ),
  c as (
    select round(coalesce(sum(neto), 0) * (1 - coalesce(p_dto, 0) / 100), 2)  as subtotal,
           round(coalesce(sum(neto * (1 - coalesce(p_dto, 0) / 100) * tasa), 0), 2) as iva
      from l
  )
  select c.subtotal,
         round(c.iva + c.subtotal * coalesce(p_perc, 0) / 100, 2),
         c.subtotal + round(c.iva + c.subtotal * coalesce(p_perc, 0) / 100, 2)
    from c;
$function$;

-- crear / guardar llevan la marca; convertir no copia las alternativas.
do $$
declare v_def text; v_nueva text;
  cuenta int;
begin
  v_def := pg_get_functiondef('public.crear_cotizacion'::regproc);
  v_nueva := replace(v_def,
    E'      tax_treatment, tax_rate_snapshot, delivery_time\n    ) values (',
    E'      tax_treatment, tax_rate_snapshot, delivery_time, is_alternative\n    ) values (');
  v_nueva := replace(v_nueva,
    E'      nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n    );',
    E'      nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), ''''),\n      coalesce((v_l->>''is_alternative'')::boolean, false)\n    );');
  cuenta := (length(v_nueva) - length(replace(v_nueva, 'is_alternative', ''))) / length('is_alternative');
  if cuenta <> 2 then raise exception 'crear_cotizacion: el parche no entró (%)', cuenta; end if;
  execute v_nueva;

  v_def := pg_get_functiondef('public.guardar_cotizacion'::regproc);
  v_nueva := replace(v_def,
    E'        quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot, delivery_time\n      ) values (',
    E'        quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot, delivery_time, is_alternative\n      ) values (');
  v_nueva := replace(v_nueva,
    E'        nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n      ) returning id into v_id;',
    E'        nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), ''''),\n        coalesce((v_l->>''is_alternative'')::boolean, false)\n      ) returning id into v_id;');
  v_nueva := replace(v_nueva,
    E'        delivery_time        = nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n      where l.id = v_id;',
    E'        delivery_time        = nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), ''''),\n        is_alternative       = coalesce((v_l->>''is_alternative'')::boolean, false)\n      where l.id = v_id;');
  cuenta := (length(v_nueva) - length(replace(v_nueva, 'is_alternative', ''))) / length('is_alternative');
  if cuenta <> 4 then raise exception 'guardar_cotizacion: el parche no entró (%)', cuenta; end if;
  execute v_nueva;

  v_def := pg_get_functiondef('app.convertir_cotizacion_a_pedido'::regproc);
  v_nueva := replace(v_def,
    'for v_l in select * from sales_quote_lines where quote_id = p_quote order by line_no, id loop',
    'for v_l in select * from sales_quote_lines where quote_id = p_quote and not is_alternative order by line_no, id loop');
  if v_nueva = v_def then raise exception 'convertir_cotizacion_a_pedido: el parche no entró'; end if;
  execute v_nueva;
end $$;
