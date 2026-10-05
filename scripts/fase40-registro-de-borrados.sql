-- Fase 40 · Trazabilidad de los borrados: quién, qué, cuándo y POR QUÉ
--
-- POR QUÉ
--
-- Borrar algo lo hacía desaparecer sin dejar rastro. No es una exageración:
-- `app.proteger_borrado_entrega` limpia a propósito los eventos de
-- `sales_audit` de la entidad antes de borrarla —son suyos y se van con ella—,
-- así que de un remito borrado no quedaba ni la auditoría. Un documento que no
-- está y nadie puede decir quién lo sacó ni para qué.
--
-- Y lo que más falta no es el «quién»: es el «por qué». «Se borró la cotización
-- COTI02581» no le sirve a nadie dentro de tres meses; «era una prueba del
-- cutover» sí.
--
-- QUÉ SE AGREGA
--
--   public.deletion_log          la tabla. Vive aparte de `sales_audit`
--                                justamente para sobrevivir a lo que describe,
--                                y guarda la fila ENTERA en `snapshot`.
--
--   public.registrar_borrado()   anota. SECURITY DEFINER, porque la tabla no
--                                tiene policy de insert: es el único camino.
--
--   public.borrar_con_motivo()   anota Y borra, en una transacción.
--
-- LA COPIA DE LA FILA NO ES PARA RESTAURAR CON UN BOTÓN
--
-- Es para que alguien pueda rehacer a mano lo que se borró por error, sabiendo
-- exactamente qué decía. Un botón de restaurar prometería más de lo que se
-- puede cumplir: las líneas, los adjuntos y los vínculos no están ahí.
--
-- POR QUÉ `borrar_con_motivo` ES SECURITY INVOKER
--
-- Es la decisión importante de todo esto. El DELETE lo sigue haciendo el
-- usuario, con su RLS y contra todos los triggers de protección de siempre: un
-- remito despachado se sigue negando, un documento histórico también. Esto
-- agrega trazabilidad, NO permisos. Un SECURITY DEFINER habría convertido un
-- registro de auditoría en una puerta trasera.
--
-- Y si un trigger rechaza el borrado, la excepción se lleva puesto también el
-- registro, porque es la misma transacción: nunca queda anotado un borrado que
-- no pasó. El `get diagnostics` de cero filas está por el caso contrario —RLS
-- diciendo que no en silencio—, donde sin él la pantalla festejaría un borrado
-- que no ocurrió.
--
-- LA LISTA BLANCA
--
-- `app.entidad_borrable` existe porque la función arma SQL dinámico y el nombre
-- de tabla entra en el `format`. Que lo mande el cliente sería inyección. De
-- paso documenta en un solo lugar qué cosas de la app son «una cosa» que se
-- borra entera.
--
-- LAS BAJAS LÓGICAS TAMBIÉN
--
-- El cliente que se da de baja y el equipo que se desactiva no borran ninguna
-- fila, pero para quien los hace es lo mismo —«lo borré», la cosa dejó de
-- aparecer— y merecen el mismo registro. Van con `action = 'deactivate'`, que
-- se distingue en la pantalla: una se reactiva con un clic y la otra hay que
-- rehacerla a mano.
--
-- ADEMÁS
--
-- `borrar_contacto` y `borrar_direccion` ganan `p_motivo` AL FINAL, que es
-- donde no rompe a nadie, y delegan el registro en `registrar_borrado`. Las
-- versiones de un solo argumento se DROPEAN en la misma transacción: sin eso,
-- `create or replace` con un parámetro nuevo deja un overload y la llamada
-- vieja queda ambigua.
--
-- Aplicado en São Paulo como las migraciones `fase40_registro_de_borrados` y
-- `fase40_motivo_al_borrar_contacto_y_direccion`. Este archivo es el guión con
-- el porqué; el SQL exacto está en esas dos migraciones.

-- Ensayo que se corrió antes de darlo por bueno, como `authenticated` y
-- revertido con el `raise` del final:
--
--   1 · sin motivo            → DELETION_REASON_REQUIRED
--   2 · con motivo, despachado → «El remito RT-ERP00002 todavía tiene stock
--                                afuera: anulalo primero» (el trigger de
--                                siempre, intacto), y el registro se fue con
--                                la transacción
--   3 · anulado + motivo      → borrado, con el registro completo:
--                                label RT-ERP00002, reason «Remito de prueba
--                                del cutover, no es una entrega real»,
--                                deleted_by Jano

do $ensayo$
declare v_d uuid; v_res jsonb; v_log jsonb; v_err text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"<uuid del usuario>","role":"authenticated"}', true);

  select id into v_d from deliveries where number = 'RT-ERP00002';

  begin
    perform public.borrar_con_motivo('delivery', v_d, '   ');
    v_err := 'NO FRENO SIN MOTIVO';
  exception when others then v_err := 'sin motivo -> ' || sqlerrm;
  end;

  begin
    perform public.borrar_con_motivo('delivery', v_d, 'remito de prueba');
    v_err := v_err || ' | NO FRENO DESPACHADO';
  exception when others then v_err := v_err || ' | despachado -> ' || sqlerrm;
  end;

  perform public.anular_entrega(v_d);
  v_res := public.borrar_con_motivo('delivery', v_d, 'Remito de prueba del cutover');

  select to_jsonb(l) - 'snapshot' into v_log from deletion_log l where l.entity_id = v_d;

  raise exception E'ENSAYO (revertido)\n%\nborrado=%\nregistro=%', v_err, v_res, v_log;
end
$ensayo$;
