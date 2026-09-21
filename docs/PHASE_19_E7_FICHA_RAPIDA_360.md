# Fase 19 · E7 — La ficha rápida como tablero comercial

Fecha: 2026-09-21. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`scripts/fase19-e7-recientes.sql`](../scripts/fase19-e7-recientes.sql).
Antecedente: [`PHASE_19_E1_CLIENTE_360.md`](PHASE_19_E1_CLIENTE_360.md).

**0 tablas nuevas, 0 columnas nuevas, 0 índices nuevos.** Un bloque de una función de
sólo lectura, y una pantalla que dejó de pelearse con el listado.

---

## 1 · Qué estaba mal

Los datos eran correctos y la ficha se podía leer. El problema es que había que
**leerla entera**: cuatro tarjetas del mismo tamaño, tres líneas de datos
administrativos arriba de todo, los importes al final y un gráfico con tres
series de 4 px en un panel de 380. Ninguna jerarquía; ninguna respuesta
inmediata.

Y abrir la ficha **rompía el listado**. El panel era una columna al lado de la
tabla:

| a 1440 px | tabla |
|---|---|
| panel cerrado | **1135 px** |
| panel abierto | **625 px** |

510 px menos: columnas recalculadas, emails recortados, y la fila que se venía
mirando corrida de lugar. Un panel que existe para no perder el contexto del
listado hacía exactamente lo contrario.

## 2 · Lo que se hizo

### La fila entera abre la ficha

Antes había que acertarle al nombre —un blanco de 14 rem en una fila de 1135
px—. Ahora cualquier click en la fila abre el panel, **menos** sobre los
controles que se manejan solos: el checkbox de exportar, los links y cualquier
`button`, `input`, `select` o `label`. El nombre sigue siendo un link, así que
Ctrl+click y «abrir en pestaña nueva» siguen funcionando. La fila es enfocable
y Enter o Espacio también la abren.

Un detalle que no es cosmético: si hay **texto seleccionado**, el click no abre
nada. Seleccionar un CUIT para copiarlo termina en un click sobre la fila, y
robarle la selección a quien la hizo es peor que no tener el atajo.

### El panel se superpone

`position: fixed` a la derecha. La tabla de atrás no se entera:

| ancho | tabla cerrada | tabla abierta | panel | modal |
|---|---|---|---|---|
| 375 | 343 (tarjetas) | 343 | 375 | sí |
| 390 | — | = | 390 | sí |
| 430 | — | = | 430 | sí |
| 768 | 654 | **654** | 560 | sí |
| 1024 | 719 | **719** | 520 | no |
| 1280 | 1034,1 | **1034,1** | 520 | no |
| 1440 | 1135 | **1135** | 576 | no |
| 1920 | 1615 | **1615** | 620 | no |

Sin desborde horizontal en ninguno. Desde 1024 px el cajón **no es modal**:
`role="complementary"`, sin trampa de foco y sin `inert`, porque el listado se
sigue viendo y se puede clickear otra fila sin cerrar nada. Abajo de 1024 tapa
la lista, y ahí sí es un `dialog` modal con el foco adentro. Escape cierra en
los dos casos y el foco vuelve a la fila.

### La jerarquía

```
1 segundo   · quién es · COTIZADO ESTE MES · ↑ 24 % vs. agosto
3 segundos  · abiertas · por entregar · productos · última actividad
10 segundos · doce meses · histórico reciente · productos
```

**«Cotizado» y no «vendido» ni «facturado».** No hay fuente fiscal productiva:
`sales_invoices` no sostiene un KPI. Un número con la etiqueta equivocada se
usa para decidir igual que uno correcto, y por eso el nombre del KPI es el del
dato que realmente se está midiendo.

El color del porcentaje dice la **dirección de la métrica**, no si el cliente
es bueno: verde es que cotizamos más que el mes pasado. Nunca va solo —flecha,
porcentaje y texto dicen lo mismo— porque una de cada doce personas no
distingue el verde del rojo.

### El gráfico

Una serie por vez (cotizado por defecto, con chips para pedidos y entregas) y
**una moneda por vez**, con selector cuando hay más de una. Las doce barras son
del mismo gris; **sólo la del mes en curso** se pinta según la dirección contra
el mes anterior. Pintar las doce haría un semáforo del que no se lee nada.

Dos cosas que el gráfico dice y antes no:

- **un mes sin movimientos deja un resto sobre el eje**, para que «no hubo
  nada» no se vea igual que «no hay dato»;
- **la escala está escrita** (`Escala: 0 — USD 172.198,94`). Un cliente con un
  mes enorme achata a los otros once, y eso no se puede esconder normalizando
  en silencio.

### El cliente sin actividad

No es un tablero en cero. `USD 0 · 0 · 0 · 0` y un gráfico vacío hacen pensar
que la pantalla se rompió, y encima esconden lo único que importa de un cliente
así. Dice «Sin actividad comercial registrada», explica qué va a aparecer
cuando tenga el primer documento, y deja los datos y las acciones.

## 3 · El único cambio de base

`resumen_cliente_360` devolvía en `recientes` el **último documento de cada
tipo**: tres filas. Con eso se podía decir «la última cotización fue ésta»,
pero no leer la historia reciente —cinco cotizaciones en dos semanas y ningún
pedido es una historia, y con una línea por tipo no se ve.

La alternativa era pedir los documentos aparte al abrir el panel, y eso
devolvería la ficha a dos consultas cuando E2 la había bajado a una. Se amplió
el resumen: **los últimos ocho documentos, de cualquier tipo, en orden**,
incluidos los cancelados —que una cotización se haya caído es parte de la
historia del cliente.

La sustitución fue quirúrgica: se lee la definición viva, se reemplaza sólo ese
CTE y se vuelve a crear. Si el bloque no está tal cual se espera, la migración
falla sin hacer nada. Lo verificado después: **una** sola versión de la
función, `security invoker`, `STABLE`, y los permisos intactos
(`authenticated` y `service_role`, nunca `anon` ni `PUBLIC`).

| | antes | después |
|---|---|---|
| abrir un cliente | 1 consulta | **1 consulta** |
| diez clientes seguidos | 10 | **10** |
| filas de `recientes` | 3 | 8 |

## 4 · Lo que NO se tocó

Ni lógica comercial ni nada de la cadena de Ventas: STEL, authority, series,
`COT-ERP`, `PDV-ERP`, `RT-ERP`, stock, reservas, `confirmar_entrega` y WhatsApp
quedaron como estaban. La única escritura de esta entrega fue el bloque
`recientes` de una función de sólo lectura.

`KpisComerciales` sigue siendo el que usa la **ficha completa**: las dos
pantallas leen los mismos valores del mismo resumen, así que no pueden decir
números distintos.
