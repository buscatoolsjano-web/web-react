-- Fase 96/98 · Categorías nuevas para vaciar «Otros» de Buscatools.
--
-- «Otros» tenía 12.594 productos mal clasificados. Se bajó a ~3.430
-- interpretando la descripción de cada uno (ver scripts/fase96-*.mjs,
-- fase97-decodificar.mjs, fase98-decodificar.mjs): la recategorización es por
-- palabra clave + modelo, así que vive en esos scripts; acá quedan sólo las
-- CATEGORÍAS que hubo que crear.
--
-- Públicas las que son vidriera (repuestos, herramientas manuales, mobiliario);
-- ocultas las que no son herramientas de catálogo (seguridad, automatización).
-- Todo acotado a Buscatools; Torquetools no se toca.

insert into product_categories (company_id, name, slug, slug_publico, position, publica, is_active)
values
  ((select id from companies where slug = 'buscatools'), 'Seguridad',                   'seguridad',             'seguridad',                    20, false, true),
  ((select id from companies where slug = 'buscatools'), 'Automatización y estructura',  'automatizacion',        'automatizacion-y-estructura',  21, false, true),
  ((select id from companies where slug = 'buscatools'), 'Repuestos',                    'repuestos',             'repuestos',                    22, true,  true),
  ((select id from companies where slug = 'buscatools'), 'Herramientas manuales',        'herramientas-manuales', 'herramientas-manuales',        23, true,  true),
  ((select id from companies where slug = 'buscatools'), 'Mobiliario',                   'mobiliario',            'mobiliario',                   24, true,  true)
on conflict do nothing;
