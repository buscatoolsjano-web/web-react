# Auditoría global del ERP — punto de partida del perfeccionamiento

Fecha: 2026-09-19. Proyecto: `uaxcfufvapzulqvynanp`. Producción: https://app.buscatools.com

> Esta es la **foto inicial**, no el trabajo. Inventaría qué hay, mide lo que se puede medir
> hoy y propone el orden. La auditoría profunda de cada módulo se hace al empezar su fase:
> decir que ya audité diez módulos a fondo sería mentir sobre el alcance de una sola sesión.

---

## 1 · Git

Árbol **limpio**, sin stash, sin worktrees, una sola rama.

| Commit | Fecha | Qué |
|---|---|---|
| `85911c0` | 18/09 | F18 E1C — allowlist dinámica + paquete de despliegue |
| `06d0807` | 18/09 | F18 E1B — el 2186 vinculado, primer grupo entrando |
| `3197810` | 18/09 | F18 E1B — `/health` |
| `4589954` | 18/09 | F18 E1B — vincular desde cualquier terminal |
| `e50f66f` | 18/09 | F18 E1B — transporte Baileys |
| **`4d97a8a`** | 18/09 | **F19 E1 — ficha rápida de cliente** |
| `05e6b22` | 18/09 | F18 E0 — listener, arquitectura |

**F18 y F19 no comparten un solo archivo.** Verificado: los seis commits de F18 tocan
`backend/whatsapp-listener/`, `docs/` y `scripts/`, y **cero** archivos de `src/`; el de F19
toca `src/`, `docs/` y `scripts/`, y **cero** de `backend/`. No hace falta separar ramas ni
worktrees: la separación ya existe por ruta y el árbol está limpio.

**Lo que esto implica y conviene tener presente:** producción corre `944d1e2`. Los siete
commits son locales, así que **nada de F18 ni de F19 E1 está publicado**. Cuanto más crezca
la pila local, más grande y menos revisable va a ser el push eventual. Es un riesgo de
proceso, no de código.

Un detalle que sí hay que saber: `resumen_cliente_360` **ya está aplicada en la base de
producción**, pero la pantalla que la usa no está desplegada. Es inofensivo —es una función
de sólo lectura que nadie llama— pero la base está por delante del frontend.

---

## 2 · Qué hay

**61 rutas reales**, 10 módulos, ~63.500 líneas de código de módulo, **136 archivos de test
con 1.621 tests**, 124 scripts de base.

| Módulo | Archivos | Tests | Líneas | Rutas |
|---|---:|---:|---:|---|
| compras | 65 | 13 | 13.039 | proveedores · pedidos · recepciones · facturas |
| ventas | 64 | 31 | 11.229 | cotizaciones · pedidos · entregas |
| mantenimiento | 51 | 8 | 10.079 | activos · órdenes · puntos |
| clientes | 52 | 18 | 9.545 | listado · nuevo · revisar · detalle |
| configuracion | 31 | 11 | 4.370 | empresa · numeración · usuarios · listas · marcas · categorías · atributos · auditoría · whatsapp-ia |
| emails | 30 | 6 | 4.005 | bandeja · redactar · borradores · hilo |
| informes | 32 | 6 | 3.584 | informes |
| catalogo | 22 | 11 | 2.980 | catálogo · ficha de SKU |
| whatsapp | 22 | 11 | 4.067 | bandeja · informes |
| dashboard | 6 | 1 | 627 | inicio |

Batería completa en verde: `tsc -b`, `eslint`, **1.621 tests**, `build`.

**No hay pantallas muertas ni botones falsos.** Verificado: cero `TODO`/`FIXME` en el código
de módulos, cero botones permanentemente deshabilitados, y la bandera `proximamente` de la
navegación existe pero **ningún ítem la usa**.

---

## 3 · El dato que reordena el plan

| Tabla | Filas |
|---|---:|
| customers | **1.010** |
| products | **21.828** |
| sales_quotes / sales_orders / deliveries | **306 / 172 / 193** |
| suppliers | 142 |
| email_threads | 546 |
| stock_balances / stock_movements | 379 / 381 |
| **purchase_orders / goods_receipts / supplier_invoices** | **0 / 0 / 0** |
| **maintenance_orders / maintenance_assets** | **0 / 0** |
| **sales_invoices / payments / payment_allocations** | **0 / 0 / 0** |
| stock_reservations | 0 |

Tres consecuencias directas:

1. **Compras y Mantenimiento tienen 23.118 líneas de código y cero filas.** El código existe y
   está testeado, pero **nadie lo usó todavía**. Perfeccionar la UX de un módulo sin uso real
   es diseñar contra un flujo imaginado: no se sabe qué molesta porque nadie se molestó aún.
2. **Facturación y cobranzas están modeladas y vacías.** `sales_invoices`, `payments` y
   `payment_allocations` existen sin una fila. Por lo tanto **el «saldo del cliente» del § 11
   no tiene fuente real** y tiene que mostrarse como no disponible, nunca simulado.
3. **Stock sí tiene datos reales** (379 balances, 381 movimientos). La información de stock en
   Ventas y Catálogo puede ser real; las reservas, no.

---

## 4 · Matriz de estado

`✓` verificado en esta auditoría · `~` inventariado, falta auditoría profunda · `!` riesgo identificado

| Sección | Funcional | Datos | Perf | Seguridad | Deuda conocida |
|---|---|---|---|---|---|
| **Clientes** | ✓ listado server-side, filtros en URL, ficha 360 local | ✓ 1.010 | ✓ 1 consulta por ficha, sin N+1 | ✓ RLS por vendedor probada | Ficha rápida sin desplegar; sin fuente de saldo |
| **Ventas** | ~ alta/edición completas (F15) | ✓ 671 documentos | ~ | ✓ authority server-side | **! STEL congelado: no se puede emitir** |
| **Catálogo** | ~ lectura avanzada, facetas server-side | ✓ 21.828 | ✓ `search_products` pagina en el servidor | ~ | Escritura sin auditar |
| **Compras** | ~ circuito completo escrito | **! 0 filas** | ~ | ~ | Sin uso real que validar |
| **Mantenimiento** | ~ circuito completo escrito | **! 0 filas** | ~ | ~ | Sin uso real que validar |
| **Informes** | ~ pipeline y actividad sobre RPC | ✓ sobre Ventas | ~ | ~ | Sin facturación que informar |
| **Emails** | ~ Gmail como fuente | ✓ 546 hilos | ~ | ~ | Enviar documentos por email: sin backend |
| **Configuración** | ~ 9 subsecciones | ✓ | ~ | ~ | Separar editable de controlado por STEL |
| **Dashboard** | ✓ **ya es operativo** | ✓ | ✓ reutiliza RPC y caché de Informes | ✓ | Menos deuda de la esperada |
| **WhatsApp** | — fuera de alcance | 18 | — | — | Listener local corriendo |

Dos correcciones a supuestos del plan, porque conviene no trabajar sobre una premisa falsa:

- **El Dashboard ya no es «tarjetas bonitas».** Muestra cotizaciones abiertas y pedidos
  pendientes por moneda, actividad del mes, órdenes de mantenimiento abiertas y emails
  pendientes, **reutilizando las RPC y la caché de Informes sin agregar una sola consulta**.
  Tiene deuda, pero no la que el § 20 anticipa.
- **El Catálogo no tiene el problema de las 21.828 filas.** Búsqueda, facetas y ranking se
  calculan en el servidor con límite.

---

## 5 · Riesgos y bloqueos

| # | Riesgo | Impacto | Qué haría |
|---|---|---|---|
| 1 | **STEL sigue siendo autoridad** de `quote`, `sales_order` y `delivery` | No se puede crear ni un documento de prueba desde el ERP: toda mejora en el alta de Ventas queda sin validación de punta a punta | La serie piloto `COT-ERP` ya está justificada en F19 E1 §7: dos filas, sin DDL, sin tocar la autoridad productiva. **Requiere tu autorización** |
| 2 | **Compras y Mantenimiento sin datos** | No hay sesión real que probar; habría que inventar fixtures y diseñar contra un flujo imaginado | Moverlos después de los módulos con uso real, o hacer un pase corto de «listo para el primer uso» en vez de un perfeccionamiento completo |
| 3 | **7 commits locales sin publicar** | El push eventual va a ser grande y difícil de revisar | Publicar F18 + F19 E1 cuando lo autorices, antes de apilar más |
| 4 | **Sin facturación ni cobranzas** | El saldo del cliente y varios informes no tienen fuente | Mostrar «no disponible», nunca estimar |
| 5 | **Listener de WhatsApp corriendo local** | Fuera de alcance por tu indicación, pero está vivo y conectado | No lo toco. Cuando quieras, se baja |

---

## 6 · Orden propuesto

El § 9 propone: Ventas/Clientes → Compras → Catálogo → Mantenimiento → Informes → Emails →
Configuración → Dashboard → Coherencia.

**Propongo mover Compras y Mantenimiento al final**, y subir Catálogo, Informes y Dashboard.
El motivo es el § 3: son los dos módulos sin una sola fila. Perfeccionar la experiencia diaria
de algo que todavía nadie usó es optimizar contra suposiciones; cuando Compras tenga treinta
órdenes reales, media hora de mirar cómo las cargan va a decir más que una semana de diseño a
ciegas.

| | Fase | Contenido | Por qué ahí |
|---|---|---|---|
| 1 | **F19** | Clientes + Ventas | Uso diario real, 1.681 registros vivos |
| 2 | **F20** | Catálogo | 21.828 productos; alimenta las líneas de Ventas |
| 3 | **F21** | Informes + Dashboard | Leen lo de F19/F20; sólo lectura, riesgo bajo |
| 4 | **F22** | Emails | 546 hilos reales |
| 5 | **F23** | Configuración | Habilita al admin a operar el resto |
| 6 | **F24** | Coherencia global · mobile · performance | Con todo lo de uso diario ya tocado |
| 7 | **F25** | Compras | Cuando haya uso, o pase corto de «listo para el primer uso» |
| 8 | **F26** | Mantenimiento | Ídem |

Si preferís el orden original lo sigo sin discutir — pero prefiero que la decisión se tome con
el dato de las cero filas a la vista.

### F19, entrega por entrega

| Entrega | Contenido | Riesgo |
|---|---|---|
| **E2** | Clientes: listado (búsqueda, filtros, columnas, acciones rápidas) + desplegar la ficha rápida que ya existe + saldo como «no disponible» | Bajo |
| **E3** | Clientes: ficha completa — contactos, direcciones, memoria, precios, documentos, adjuntos, relaciones | Bajo |
| **E4** | Ventas: los tres listados — búsqueda, filtros por columna, período, estado, vendedor, moneda, serie, totales por moneda | Bajo |
| **E5** | Ventas: cabecera comercial + acciones + pipeline Cotización→Pedido→Entrega | Bajo |
| **E6** | Ventas: líneas — buscar producto, precio, descuento, stock relevante, faltantes | Medio: toca el borrador |
| **E7** | Pedidos: pedido/entregado/pendiente por documento y por línea · Remitos: origen y trazabilidad | Medio |
| **E8** | Serie piloto `COT-ERP` y alta real de prueba | **Requiere autorización** |
| **E9** | Ficha rápida de cliente reutilizable desde Ventas | Bajo |

---

## 7 · Lo que necesito de vos

Nada de esto lo decido yo:

1. **¿El orden propuesto o el original?**
2. **¿Autorizás la serie piloto `COT-ERP`?** Dos filas —una en `document_sequences`, otra en
   `document_numbering_authority_series`— que permiten crear cotizaciones de prueba **sin
   tocar la autoridad de `quote`, sin consumir la secuencia COTI (va por 2630) y sin mover
   stock**. Sin esto, E8 no existe y el alta de Ventas queda sin validación real.
3. **¿Publico F18 + F19 E1?** Para no seguir apilando commits sin revisar.

Mientras tanto arranco con **F19 E2 (Clientes)**, que no toca nada de lo anterior y es
reversible.
