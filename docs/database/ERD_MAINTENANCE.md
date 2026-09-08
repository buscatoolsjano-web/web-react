# ERD — MANTENIMIENTO

> **PROPUESTA — no ejecutado.**

La ficha del legacy (`mant_fichas`) tiene **36 campos en un solo objeto**
que mezclan cinco etapas del proceso. Acá se separa en cabecera + etapas +
tablas hijas.

```mermaid
erDiagram
    companies ||--o{ assets : "posee"
    customers ||--o{ assets : "es dueño de"
    products ||--o{ assets : "modelo de catalogo"
    brands ||--o{ assets : "marca"
    assets ||--o{ maintenance_orders : "historial"
    profiles ||--o{ maintenance_orders : "tecnico asignado"
    maintenance_orders ||--o{ maintenance_order_steps : "etapas"
    maintenance_orders ||--o{ maintenance_parts : "repuestos"
    maintenance_orders ||--o{ maintenance_measurements : "mediciones torque"
    maintenance_orders ||--o{ maintenance_files : "fotos y videos"
    files ||--o{ maintenance_files : ""
    products ||--o{ maintenance_parts : "repuesto del catalogo"
    maintenance_orders ||--o{ quotes : "puede generar"

    assets {
        uuid id PK
        uuid company_id FK
        uuid customer_id FK "FK REAL - legacy: clienteNombre texto"
        uuid product_id FK "nullable - si esta en el catalogo"
        uuid brand_id FK
        text identifier "legacy identificador"
        text model
        text serial_number "UK por empresa cuando no es null"
        text asset_type "herramienta|maquina"
        text location_city
        text location_state
        date warranty_start
        date warranty_end
        boolean under_maintenance_contract "legacy sujetoMant"
        date next_preventive_date
        text status "active|retired"
        text notes
        text legacy_ref "ACTIVO-<ts>"
        timestamptz created_at
        timestamptz deleted_at
    }

    maintenance_orders {
        uuid id PK
        uuid company_id FK
        text doc_number UK "SVC00123"
        uuid asset_id FK
        uuid customer_id FK "denormalizado para filtrar sin join"
        text service_type "corrective|preventive|warranty"
        uuid assigned_technician_id FK
        uuid received_by FK
        date received_date
        date repaired_date
        date delivered_date
        text current_step "diagnosis|quote|repair|torque|closing"
        text status "open|paused|waiting_approval|waiting_parts|repaired|closed|cancelled"
        text entry_reason "legacy motivoIngreso"
        text visual_condition "legacy condicionVisual"
        text diagnosis_notes
        text work_performed "legacy trabajosRealizados"
        text pending_parts
        uuid quote_id FK "cotizacion generada"
        text quote_status "pending|approved|rejected"
        uuid approved_by FK
        date approved_at
        numeric actual_hours
        numeric overall_efficiency
        numeric torque_nominal
        numeric torque_lcl "limite inferior"
        numeric torque_ucl "limite superior"
        text final_notes
        date next_preventive_date
        text legacy_ref "SVC-<ts>"
        uuid created_by FK
        timestamptz created_at
        timestamptz deleted_at
    }

    maintenance_order_steps {
        uuid id PK
        uuid maintenance_order_id FK
        text step "diagnosis|quote|repair|torque|closing"
        text status "pending|in_progress|done|skipped"
        uuid performed_by FK
        timestamptz started_at
        timestamptz completed_at
        text notes
        jsonb data "campos propios de la etapa"
    }

    maintenance_parts {
        uuid id PK
        uuid maintenance_order_id FK
        uuid product_id FK "nullable si no esta en catalogo"
        text sku_snapshot
        text name_snapshot
        text phase "diagnosis|repair"
        numeric quantity
        numeric unit_price
        boolean replaced
        text notes
    }

    maintenance_measurements {
        uuid id PK
        uuid maintenance_order_id FK
        int position
        text measurement_type "torque"
        numeric target_value
        numeric min_value
        numeric max_value
        numeric measured_value
        boolean passed
        timestamptz measured_at
    }

    maintenance_files {
        uuid maintenance_order_id FK
        uuid file_id FK
        text role "before|after|diagnosis|document|video"
        int position
    }
```

## Notas de diseño

### Por qué se rompió la ficha de 36 campos

El objeto legacy mezcla estado actual, datos de cinco etapas y arrays de
tamaño fijo. Tres consecuencias concretas:

- **`torqueMediciones` es un array de 10 posiciones fijas**, siempre
  presente aunque se usen dos. Pasa a ser `maintenance_measurements`, con
  las filas que hagan falta.
- **`diagnosticoPartes {}` y `reparacionPartes {}`** son objetos sin forma
  definida. Pasan a ser `maintenance_parts` con una columna `phase`, y con
  FK al producto cuando el repuesto está en el catálogo — lo que permite
  descontar stock y calcular el costo real del servicio.
- **`lastStep` + `fechaIngreso/fechaReparacion/fechaEntrega/fechaAprobacion`**
  sólo dicen dónde está la ficha ahora. `maintenance_order_steps` guarda
  quién hizo cada etapa y cuándo, que es lo que se necesita para medir
  tiempos de taller.

`data jsonb` en cada etapa absorbe los campos específicos que hoy están
sueltos en la ficha (`aprietesIngreso`, `obsDiagnostico`, `obsCotizacion`…)
sin inflar la cabecera con columnas que sólo aplican a una etapa.

### Las preguntas que el modelo responde

| Pregunta | Consulta |
|---|---|
| ¿Qué equipos tiene el cliente? | `assets WHERE customer_id = $1` |
| ¿Cuándo se vendió? | `delivery_note_items` → `product_id` + serie |
| ¿Qué historial tiene la serie XYZ? | `assets.serial_number` → `maintenance_orders` |
| ¿Qué problema tuvo? | `entry_reason`, `diagnosis_notes` |
| ¿Qué técnico lo atendió? | `assigned_technician_id` |
| ¿Qué piezas se cambiaron? | `maintenance_parts WHERE replaced` |
| ¿Fotos y videos? | `maintenance_files` → `files` → Storage |
| ¿Está en garantía? | `warranty_end >= current_date` |
| ¿Próxima acción? | `next_preventive_date` |

### `asset_serials` no se creó

En los datos reales un activo **es** una unidad física con su número de
serie: `assets.serial_number`. Una tabla aparte sólo tendría sentido si un
activo agrupara varias unidades, y no hay evidencia de eso en el legacy.
Es un caso de sobre-normalización evitada.

### `technicians` tampoco

Un técnico es un `profile` con rol `technician` en su membresía. Una tabla
`technicians` duplicaría la identidad y obligaría a mantener dos altas por
persona.
