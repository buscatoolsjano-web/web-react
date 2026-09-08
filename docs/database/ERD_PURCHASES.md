# ERD — COMPRAS E IMPORTACIÓN

> **PROPUESTA — no ejecutado.**

Simétrico a Ventas: mismas reglas de snapshot y de recepción parcial por
línea. Datos reales del legacy: **142 proveedores**.

```mermaid
erDiagram
    companies ||--o{ suppliers : "posee"
    suppliers ||--o{ supplier_contacts : "tiene"
    suppliers ||--o{ purchase_orders : "recibe"
    purchase_orders ||--o{ purchase_order_items : "contiene"
    purchase_orders ||--o{ purchase_receipts : "genera 1:N parciales"
    purchase_receipts ||--o{ purchase_receipt_items : "contiene"
    purchase_order_items ||--o{ purchase_receipt_items : "recepcion parcial de"
    suppliers ||--o{ supplier_invoices : "emite"
    purchase_receipts ||--o{ supplier_invoices : "factura"
    supplier_invoices ||--o{ supplier_payments : "se paga con"
    products ||--o{ purchase_order_items : "referencia"
    purchase_receipts ||--o{ stock_movements : "ingresa stock"

    suppliers {
        uuid id PK
        uuid company_id FK
        text legal_name "legacy nj"
        text trade_name "legacy nc"
        text tax_id "legacy cif"
        text email
        text phone
        text address
        text activity "legacy actividad"
        text agent "legacy agente"
        text payment_terms "legacy formaPago - FOB 180 DIAS"
        text default_currency FK
        text country
        text notes
        text status "active|inactive"
        text legacy_ref "PROV00008"
        timestamptz created_at
        timestamptz deleted_at
    }

    supplier_contacts {
        uuid id PK
        uuid supplier_id FK
        text full_name
        text email
        text phone
        boolean is_primary
    }

    purchase_orders {
        uuid id PK
        uuid company_id FK
        text doc_number UK "OC00123"
        uuid supplier_id FK "FK REAL - el legacy guarda texto"
        date issue_date
        date eta_date "fecha estimada de llegada"
        timestamptz confirmed_at
        text incoterm "FOB|CIF|EXW"
        text currency_code FK
        numeric exchange_rate
        text payment_terms
        text status "draft|sent|confirmed|partial|received|cancelled"
        numeric subtotal
        numeric tax_amount
        numeric total
        numeric freight_cost
        numeric customs_cost
        numeric other_costs
        text notes
        uuid created_by FK
        text legacy_ref
        timestamptz created_at
        timestamptz deleted_at
    }

    purchase_order_items {
        uuid id PK
        uuid purchase_order_id FK
        int position
        text line_type "item|chapter"
        uuid product_id FK "nullable"
        text sku_snapshot
        text name_snapshot
        text supplier_sku "codigo del proveedor"
        numeric quantity
        numeric received_qty "por trigger"
        numeric unit_cost
        numeric discount_pct
        numeric line_total
        numeric landed_unit_cost "costo con flete+aduana prorrateado"
    }

    purchase_receipts {
        uuid id PK
        uuid company_id FK
        text doc_number UK "REC00123"
        uuid purchase_order_id FK
        uuid supplier_id FK
        uuid warehouse_id FK
        date receipt_date
        text status "draft|confirmed|cancelled"
        text notes
        uuid created_by FK
        timestamptz created_at
    }

    purchase_receipt_items {
        uuid id PK
        uuid purchase_receipt_id FK
        uuid purchase_order_item_id FK "liga la parcial a su linea"
        int position
        uuid product_id FK
        text sku_snapshot
        numeric quantity
        numeric unit_cost
    }

    supplier_invoices {
        uuid id PK
        uuid company_id FK
        text doc_number "numero del proveedor"
        uuid supplier_id FK
        uuid purchase_receipt_id FK
        date issue_date
        date due_date
        text currency_code FK
        numeric exchange_rate
        numeric subtotal
        numeric tax_amount
        numeric total
        numeric paid_amount
        text status "pending|partial|paid|overdue|cancelled"
        timestamptz created_at
    }

    supplier_payments {
        uuid id PK
        uuid company_id FK
        uuid supplier_invoice_id FK
        date payment_date
        numeric amount
        text currency_code FK
        text method "transfer|check|cash"
        text reference
        uuid created_by FK
        timestamptz created_at
    }
```

## Notas de diseño

### Recepciones parciales

Igual que en ventas: `purchase_receipt_items.purchase_order_item_id` liga
cada recepción a la línea concreta que la origina, y `received_qty` se
mantiene por trigger. Nada de índices de array.

### Costos de importación

`freight_cost`, `customs_cost` y `other_costs` viven en la cabecera de la
orden, y `landed_unit_cost` en la línea guarda el costo real prorrateado
por unidad. Es lo que hoy calcula la "Calculadora Europa → Argentina" del
legacy (940 líneas) **sin persistir nada**: se calcula, se muestra y se
pierde.

Con el costo desembarcado guardado, el margen real por producto pasa a ser
una consulta en vez de un cálculo manual.

### Stock

Un `purchase_receipt` en estado `confirmed` genera movimientos
`purchase_receipt` en `stock_movements`. Es el único camino por el que
entra mercadería: no hay forma de sumar stock sin un documento que lo
respalde.

Las órdenes confirmadas y no recibidas alimentan el **stock proyectado**
(sección G del diseño), reemplazando el `sv` del legacy con un significado
verificable.

### Lo que no se creó todavía

Una tabla `imports` para el seguimiento de importaciones (despacho, BL,
aduana). El módulo existe en el legacy sólo como calculadora, sin
persistencia ni estados. Se diseña en Fase 5, cuando esté claro qué
estados sigue realmente el equipo; forzarlo ahora sería inventar campos
sin evidencia.
