-- Plazo de entrega por línea (2026-11).
-- «Inmediato», «30-45 días», «Según llegada de importación»: lo segundo que
-- pregunta un comprador industrial después del precio. Texto libre, por línea,
-- sale impreso en la cotización y pasa al pedido al convertirla.
alter table public.sales_quote_lines add column if not exists delivery_time text;
alter table public.sales_order_lines add column if not exists delivery_time text;

comment on column public.sales_quote_lines.delivery_time is 'Plazo de entrega de la línea, tal como se le promete al cliente. Sale en la hoja.';
comment on column public.sales_order_lines.delivery_time is 'Plazo de entrega heredado de la línea de la cotización.';

-- Las tres funciones que escriben líneas, parcheadas en su lugar: cada
-- reemplazo se verifica, y si alguno no entra la migración entera se cae.
do $$
declare
  v_def text;
  v_nueva text;
begin
  -- 1 · crear_cotizacion: el alta.
  v_def := pg_get_functiondef('public.crear_cotizacion'::regproc);
  v_nueva := replace(v_def,
    E'      tax_treatment, tax_rate_snapshot\n    ) values (',
    E'      tax_treatment, tax_rate_snapshot, delivery_time\n    ) values (');
  v_nueva := replace(v_nueva,
    E'      coalesce((v_l->>''tax_rate_snapshot'')::numeric, 0)\n    );',
    E'      coalesce((v_l->>''tax_rate_snapshot'')::numeric, 0),\n      nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n    );');
  if (length(v_nueva) - length(replace(v_nueva, 'delivery_time', ''))) / length('delivery_time') <> 2 then
    raise exception 'crear_cotizacion: el parche no entró';
  end if;
  execute v_nueva;

  -- 2 · guardar_cotizacion: líneas nuevas y líneas que se editan.
  v_def := pg_get_functiondef('public.guardar_cotizacion'::regproc);
  v_nueva := replace(v_def,
    E'        quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot\n      ) values (',
    E'        quantity, unit_price, discount_pct, tax_treatment, tax_rate_snapshot, delivery_time\n      ) values (');
  v_nueva := replace(v_nueva,
    E'        coalesce((v_l->>''tax_rate_snapshot'')::numeric, 0)\n      ) returning id into v_id;',
    E'        coalesce((v_l->>''tax_rate_snapshot'')::numeric, 0),\n        nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n      ) returning id into v_id;');
  v_nueva := replace(v_nueva,
    E'        tax_rate_snapshot    = coalesce((v_l->>''tax_rate_snapshot'')::numeric, l.tax_rate_snapshot)\n      where l.id = v_id;',
    E'        tax_rate_snapshot    = coalesce((v_l->>''tax_rate_snapshot'')::numeric, l.tax_rate_snapshot),\n        delivery_time        = nullif(btrim(coalesce(v_l->>''delivery_time'', '''')), '''')\n      where l.id = v_id;');
  if (length(v_nueva) - length(replace(v_nueva, 'delivery_time', ''))) / length('delivery_time') <> 4 then
    raise exception 'guardar_cotizacion: el parche no entró completo';
  end if;
  execute v_nueva;

  -- 3 · convertir_cotizacion_a_pedido: el plazo viaja al pedido.
  v_def := pg_get_functiondef('app.convertir_cotizacion_a_pedido'::regproc);
  v_nueva := replace(v_def,
    E'      tax_treatment, tax_rate_snapshot, kit_components_snapshot, notes\n    ) values (',
    E'      tax_treatment, tax_rate_snapshot, kit_components_snapshot, notes, delivery_time\n    ) values (');
  v_nueva := replace(v_nueva,
    E'      v_l.tax_treatment, v_l.tax_rate_snapshot, v_l.kit_components_snapshot, v_l.notes\n    );',
    E'      v_l.tax_treatment, v_l.tax_rate_snapshot, v_l.kit_components_snapshot, v_l.notes, v_l.delivery_time\n    );');
  if (length(v_nueva) - length(replace(v_nueva, 'delivery_time', ''))) / length('delivery_time') <> 2 then
    raise exception 'convertir_cotizacion_a_pedido: el parche no entró completo';
  end if;
  execute v_nueva;
end $$;
