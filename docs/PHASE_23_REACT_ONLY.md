# Fase 23 · Lo que React tiene y el legacy no

**Esto no compensa nada.** Diez funcionalidades nuevas no cancelan una
función operativa faltante (§25). Está acá para que el mapa esté completo,
no para mejorar el número.

Todas verificadas contra el código, no supuestas.

---

## Capacidades que el legacy no tiene

| qué | React | legacy |
|---|---|---|
| **Borradores de email** | `EmailBorradoresPage` | no existe |
| **Asignar un hilo de email a un usuario** | RPC `asignar_hilo_email`, `usuarios_asignables_email` | no existe |
| **Autocompletar destinatarios** | RPC `autocompletar_destinatarios_email` | no existe |
| **Revisar clientes dudosos / duplicados** | `ClientesRevisarPage`, RPC `resolver_revision_cliente`, `grupos_cuit_legacy` | no existe |
| **Puntos de mantenimiento** | `PuntosPage` | no existe |
| **IA sobre WhatsApp** | `ConfigIAWhatsappPage`, RPC `estado_ia_whatsapp`, `metricas_ia_whatsapp`, `resolver_item_ia_whatsapp`, `reintentar_analisis_whatsapp` | el legacy tiene IA de catálogo, no de WhatsApp |
| **Informe de WhatsApp** | `InformeWhatsappPage`, RPC `informe_whatsapp` | no existe |
| **Señales de atención en WhatsApp** | RPC `senales_atencion_whatsapp` | no existe |
| **Histórico STEL separado del operativo** | F20 · E2, opción C: 36 cadenas, 76 documentos origen, 200 registros de servicio | el legacy los mezcla |
| **Diagnóstico de numeración** | RPC `config_numeracion_diagnostico` | no existe |
| **Duplicados de serial** | RPC `duplicados_de_serial` | no existe |
| **Capacidad de torque como dato** | RPC `capacidad_torque` | calculado en el navegador |
| **Precheck antes de cerrar una orden** | RPC `precheck_cierre_mantenimiento` | no existe |
| **Equivalencias bidireccionales** | `productos_similares` consulta los dos extremos (F22) | el legacy sólo mira `sim_*` de ida |

---

## Diferencias de arquitectura que sí cambian lo que el usuario puede hacer

Éstas están en la matriz como `INTENTIONALLY_DIFFERENT`, no como capacidades
nuevas, porque resuelven algo que el legacy también resolvía — pero el
resultado para el usuario **es mejor**, y conviene tenerlo escrito.

### URLs que se pueden compartir

El legacy guarda todo el estado en `state = {}` en memoria. No hay forma de
mandarle a alguien «mirá esta cotización con este filtro». React tiene 76
rutas y los filtros viven en el querystring: el catálogo, los informes y los
listados se comparten con un enlace, y el botón «atrás» del navegador
funciona.

### RLS de verdad

El legacy decide los permisos con `display:none` sobre datos que **ya están en
el navegador**. `isCatCliente`, `isDetCliente`, `_isCmpCliente` y
`_isClienteExport` ocultan el costo y el stock virtual al dibujar; el dato ya
se descargó. En React el dato no sale de la base.

Esto no es una funcionalidad nueva: es la misma funcionalidad, sin el agujero.

### Drill-down que reconcilia

En el legacy, tocar un KPI te lleva a la sección. En React te lleva a **los
documentos exactos que forman ese número** — 18 de 18 reconciliaciones
verificadas en F21 · E3, con funciones de base como fuente única
(`documentos_comerciales`, `abierta(sales_quotes)`).

El legacy tenía un problema que React no puede tener: una tarjeta que decía
154 y una lista que mostraba 143.

### «Sin saldo registrado» no es cero

El legacy muestra `0` para un producto que nunca tuvo movimientos de stock.
React muestra `—`. Eran 21.449 productos de 21.828 afirmando una cantidad que
nadie midió.

### El error de un bloque no tira la pantalla

Informes hace cinco consultas independientes. Si el ranking se cae, el
resumen, el gráfico y los documentos siguen sirviendo. El legacy no tiene
estado de error: el render falla en silencio.

### Responsive de verdad

En el legacy sólo el catálogo tiene vista mobile (`mob-prod-card`,
`mob-cat-view`). Los editores de documento no son usables en teléfono. React
lo es en todo el sistema.

### Tests

161 archivos de test, 2.084 casos. El legacy no tiene ninguno.

---

## Una advertencia sobre esta lista

Es tentador leer esto y concluir que la migración va bien. La conclusión
correcta está en el documento principal: **no se puede apagar el legacy hoy**,
porque no se puede facturar.

Que React tenga borradores de email no ayuda a cobrar.
