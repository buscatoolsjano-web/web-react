# Fase 23 · Orden propuesto para cerrar la paridad

**Nada de esto está implementado.** Es el orden, no el trabajo.

El criterio no es sólo la severidad: **93 gaps no son 93 trabajos.** Muchos
dependen de la misma pieza, y hacerlos juntos cuesta menos que hacerlos
sueltos. Por eso el plan está en grupos.

```
ESTIMATED_GAP_GROUPS = 9
```

---

## G1 · Facturación de venta — **el que desbloquea el apagado**

**Cierra:** `FA-01` `FA-02` `FA-03` `FA-04` `FA-05` `FA-06` `VE-50`
(3 BLOCKER + 3 HIGH + 1 BLOCKER)

Factura de venta con sus líneas, recibo de cobro, nota de crédito, sus
listados y CSV, impresión, y el botón «Generar factura» desde el remito.

**Por qué primero.** Es la única razón *estructural* por la que no se puede
apagar el legacy. Todo lo demás tiene rodeo; esto no.

**Antes de escribir código hay que decidir una cosa:** ¿React **emite** la
factura (numeración fiscal, AFIP) o sólo la **registra** como hace hoy el
legacy? La respuesta cambia el tamaño del trabajo por un factor grande. El
legacy sólo registra.

**Reutiliza:** la numeración por serie (`autoridad_numeracion_*`,
`next_document_number`), el motor de impresión A4 de Ventas, el editor de
líneas, `PanelAdjuntos`, `PanelRelacionados`.

**Áreas protegidas que toca:** Ventas. Sólo para agregar el enlace desde el
remito — no hay que abrir el editor.

---

## G2 · Tipo de cambio y cuentas por cobrar

**Cierra:** `FI-01` `FI-02` `FI-03` (2 HIGH + 1 MEDIUM)

**Por qué acá.** El aging necesita facturas: **depende de G1.** El tipo de
cambio no depende de nada y lo necesitan los documentos multi-moneda que
React ya emite hoy — se puede adelantar.

**Sugerencia:** partir G2 en dos. `FI-01` (tipo de cambio) se puede hacer
antes que G1, es una tabla con fecha y valor.

---

## G3 · Carrito del catálogo

**Cierra:** `CA-02` (BLOCKER) `CA-03` (HIGH)

El stepper por fila, la barra flotante con total, «Ver cotización», y la
exportación del catálogo con columnas a elegir.

**Por qué acá y no más abajo.** Es BLOCKER y **no depende de nada**. Es el
trabajo con mejor relación entre lo que cuesta y lo que cambia el día a día:
hoy armar una cotización en React obliga a abrirla primero y buscar cada
producto adentro.

**Dependencia hacia adelante:** G5 (portal del cliente) necesita el carrito,
así que hacer éste primero abarata aquél.

**Áreas protegidas que toca:** Catálogo (F22) y Ventas (F19), las dos sólo
para agregar. El comparador y `productos_similares` no se tocan.

---

## G4 · Mandar el documento y generar el PDF

**Cierra:** `VE-15` `CO-10` (HIGH) `VE-14` (MEDIUM)

El botón «Enviar» en los cinco documentos, y que React **genere** el archivo
PDF en vez de abrir el diálogo del navegador.

**Por qué juntos.** Mandar el documento sin poder adjuntarlo es la mitad del
trabajo. El legacy usa `mailto:` y manda el cuerpo; React ya tiene backend de
correo (F9) y puede adjuntar de verdad.

**Decisión abierta:** replicar `mailto:` (barato, igual de limitado) o usar el
backend (más trabajo, resuelve el problema). Recomiendo lo segundo: es el
caso donde «reproducir la capacidad con la arquitectura correcta» se paga
solo.

---

## G5 · Portal del cliente y visitante

**Cierra:** `SH-04` `PC-01` `PC-02` `PC-03` `PC-05` (HIGH) `PC-04` `DA-10`
(MEDIUM/HIGH) y, de arrastre, `CR-01` (los leads se alimentan de acá)

**Por qué acá.** Depende de G3 (el carrito) y de una decisión de seguridad
que no es una pantalla: **hoy React no tiene rol anónimo.** Abrir el catálogo
sin sesión es tocar RLS.

**Antes de planificarlo hace falta un dato:** cuántos clientes usan hoy el
portal del legacy. Si son cero, esto baja a MEDIUM y se puede posponer. Si no
son cero, apagar el legacy los deja afuera sin aviso.

---

## G6 · Importar la OC y la memoria del cliente

**Cierra:** `VE-51` `CL-17` (HIGH) `CL-18` (LOW)

Parsear el PDF de la orden de compra, proponer las líneas, y recordar que
ese texto del cliente es ese SKU.

**Se puede partir, y conviene.** La memoria de alias (`CL-17`) es una tabla y
vale por sí sola: mejora el matcheo manual aunque el parser no exista. El
parser (`VE-51`) es frágil por naturaleza.

**Orden sugerido:** `CL-17` primero, `VE-51` después.

---

## G7 · Alta y edición de productos

**Cierra:** `CA-07` `CA-08` (HIGH)

**Por qué tan abajo, siendo HIGH.** Porque choca con una decisión abierta: hoy
los productos entran por STEL y por el catálogo técnico, y F22 documentó 226
duplicados nacidos justamente de tener dos puertas de alta. Abrir una tercera
sin resolver eso es pedir más duplicados.

**Depende de:** cerrar F22 · duplicados (los 88 `SAFE_TO_MERGE` y el modelo
`merged`). Ese trabajo ya está preparado y esperando aprobación.

---

## G8 · Catálogo: comparar, ordenar, filtrar por stock

**Cierra:** `CA-04` (HIGH) `CA-05` `CA-06` (MEDIUM)

**`CA-05` no debería esperar a este grupo.** Ordenar por columna es el gap más
barato de toda la auditoría: el parámetro ya viaja hasta `search_products` y
ya vive en la URL, falta el encabezado clickeable. Se puede cerrar en
cualquier momento, incluso dentro de otro grupo.

---

## G9 · El resto

37 MEDIUM y 31 LOW que no dependen unos de otros. Se van cerrando por
oportunidad, no por plan. Los que más se van a notar:

| | ids | por qué |
|---|---|---|
| Permiso por sección y por usuario | `SH-11` `CF-04` | hoy React sólo da un rol entero |
| Etiquetas y reglas de email | `EM-10` `EM-11` | la bandeja crece |
| Mantenimiento: lotes, modelos, manuales | `MA-10` `MA-11` `MA-12` | el módulo está al 39 % |
| Agenda | `AG-01` `AG-02` | módulo entero |
| Importación (calculadora) | `IM-01` `IM-02` `IM-03` | módulo entero, sin dependencias |
| Biblioteca de archivos | `IN-11` | los adjuntos ya existen; falta la vista central |
| Reordenar líneas | `VE-22` `VE-23` | `line_no` ya es un dato |

**Lo que no entra en el plan y conviene decirlo:** la IA (`IA-01`…`IA-05`)
queda fuera por decisión explícita. El chat interno (`CH-01`…`CH-03`) queda
fuera hasta saber si alguien lo usó — hoy sólo funciona entre pestañas del
mismo navegador.

---

## Resumen

```
RECOMMENDED_NEXT_PHASE = F24 · Facturación de venta (G1)

  Con el adelanto de FI-01 (tipo de cambio) y CA-05 (ordenar por columna),
  que no dependen de nada y son baratos.
```

| grupo | cierra | severidad máxima | depende de |
|---|---|---|---|
| G1 Facturación | 7 | BLOCKER | decisión: ¿emite o registra? |
| G2 Finanzas | 3 | HIGH | G1 (salvo `FI-01`) |
| G3 Carrito | 2 | BLOCKER | — |
| G4 Enviar + PDF | 3 | HIGH | decisión: `mailto:` o backend |
| G5 Portal cliente | 7 | HIGH | G3 + decisión de RLS + dato de uso |
| G6 OC y memoria | 3 | HIGH | — |
| G7 Alta de producto | 2 | HIGH | F22 · duplicados |
| G8 Catálogo | 3 | HIGH | — |
| G9 El resto | 66 | MEDIUM | — |

**Tres decisiones bloquean tres grupos y ninguna es técnica:**

1. ¿La factura se emite o se registra? (G1)
2. ¿`mailto:` o backend de correo? (G4)
3. ¿Cuántos clientes usan hoy el portal? (G5)

Contestarlas cuesta una conversación y cambia el tamaño del trabajo más que
cualquier decisión de implementación que venga después.
