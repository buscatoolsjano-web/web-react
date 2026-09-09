/**
 * Tipos generados desde el schema de Supabase (proyecto uaxcfufvapzulqvynanp).
 *
 * NO editar a mano. Se regenera con:
 *   npx supabase gen types typescript --project-id uaxcfufvapzulqvynanp
 *
 * Refleja las 15 tablas de la Etapa 1, la vista product_availability y la
 * función search_products de la Fase 3.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      brands: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brands_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          brand_color: string | null
          created_at: string
          default_currency: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          logo_path: string | null
          name: string
          phone: string | null
          slug: string
          tax_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          brand_color?: string | null
          created_at?: string
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_path?: string | null
          name: string
          phone?: string | null
          slug: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          brand_color?: string | null
          created_at?: string
          default_currency?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_path?: string | null
          name?: string
          phone?: string | null
          slug?: string
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'companies_default_currency_fkey'
            columns: ['default_currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      company_memberships: {
        Row: {
          allowed_sections: string[] | null
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          role: string
          status: string
          supplier_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_sections?: string[] | null
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          role: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_sections?: string[] | null
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          role?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'company_memberships_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'company_memberships_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'company_memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      currencies: {
        Row: { code: string; decimals: number; name: string; symbol: string }
        Insert: { code: string; decimals?: number; name: string; symbol: string }
        Update: { code?: string; decimals?: number; name?: string; symbol?: string }
        Relationships: []
      }
      customers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          credit_limit: number | null
          customer_type: string
          default_currency: string | null
          default_price_list_id: string | null
          deleted_at: string | null
          discount_pct: number
          email_domains: string[]
          id: string
          legacy_ref: string | null
          legal_name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          salesperson_id: string | null
          status: string
          tax_id: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          customer_type?: string
          default_currency?: string | null
          default_price_list_id?: string | null
          deleted_at?: string | null
          discount_pct?: number
          email_domains?: string[]
          id?: string
          legacy_ref?: string | null
          legal_name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          salesperson_id?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          customer_type?: string
          default_currency?: string | null
          default_price_list_id?: string | null
          deleted_at?: string | null
          discount_pct?: number
          email_domains?: string[]
          id?: string
          legacy_ref?: string | null
          legal_name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          salesperson_id?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'customers_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_customers_price_list'
            columns: ['default_price_list_id']
            isOneToOne: false
            referencedRelation: 'price_lists'
            referencedColumns: ['id']
          },
        ]
      }
      price_lists: {
        Row: {
          company_id: string
          created_at: string
          currency_code: string
          id: string
          is_default: boolean
          name: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          currency_code: string
          id?: string
          is_default?: boolean
          name: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          currency_code?: string
          id?: string
          is_default?: boolean
          name?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'price_lists_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'price_lists_currency_code_fkey'
            columns: ['currency_code']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      product_attribute_definitions: {
        Row: {
          applies_to_category_id: string | null
          company_id: string
          created_at: string
          data_type: string
          id: string
          is_filterable: boolean
          key: string
          label: string
          position: number
          unit: string | null
        }
        Insert: {
          applies_to_category_id?: string | null
          company_id: string
          created_at?: string
          data_type: string
          id?: string
          is_filterable?: boolean
          key: string
          label: string
          position?: number
          unit?: string | null
        }
        Update: {
          applies_to_category_id?: string | null
          company_id?: string
          created_at?: string
          data_type?: string
          id?: string
          is_filterable?: boolean
          key?: string
          label?: string
          position?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'product_attribute_definitions_applies_to_category_id_fkey'
            columns: ['applies_to_category_id']
            isOneToOne: false
            referencedRelation: 'product_categories'
            referencedColumns: ['id']
          },
        ]
      }
      product_attribute_categories: {
        Row: {
          attribute_definition_id: string
          category_id: string
          company_id: string
          created_at: string
        }
        Insert: {
          attribute_definition_id: string
          category_id: string
          company_id: string
          created_at?: string
        }
        Update: {
          attribute_definition_id?: string
          category_id?: string
          company_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_attribute_categories_attribute_definition_id_fkey'
            columns: ['attribute_definition_id']
            isOneToOne: false
            referencedRelation: 'product_attribute_definitions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_attribute_categories_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'product_categories'
            referencedColumns: ['id']
          },
        ]
      }
      product_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          needs_review: boolean
          parent_id: string | null
          position: number
          slug: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          needs_review?: boolean
          parent_id?: string | null
          position?: number
          slug: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          needs_review?: boolean
          parent_id?: string | null
          position?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_categories_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'product_categories'
            referencedColumns: ['id']
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          bytes: number | null
          checked_at: string | null
          company_id: string
          created_at: string
          http_status: number | null
          id: string
          is_primary: boolean
          kind: string
          position: number
          product_id: string
          source_url: string | null
          storage_path: string | null
          thumb_url: string | null
        }
        Insert: {
          alt_text?: string | null
          bytes?: number | null
          checked_at?: string | null
          company_id: string
          created_at?: string
          http_status?: number | null
          id?: string
          is_primary?: boolean
          kind?: string
          position?: number
          product_id: string
          source_url?: string | null
          storage_path?: string | null
          thumb_url?: string | null
        }
        Update: {
          alt_text?: string | null
          bytes?: number | null
          checked_at?: string | null
          company_id?: string
          created_at?: string
          http_status?: number | null
          id?: string
          is_primary?: boolean
          kind?: string
          position?: number
          product_id?: string
          source_url?: string | null
          storage_path?: string | null
          thumb_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'product_images_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_prices: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          id: string
          price_list_id: string
          product_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          id?: string
          price_list_id: string
          product_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          id?: string
          price_list_id?: string
          product_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'product_prices_price_list_id_fkey'
            columns: ['price_list_id']
            isOneToOne: false
            referencedRelation: 'price_lists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_prices_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          brand_id: string | null
          category_id: string
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          description_long: string | null
          id: string
          is_kit: boolean
          legacy_ref: string | null
          model_code: string | null
          name: string
          ncm_code: string | null
          needs_review: boolean
          origin_country: string | null
          product_type: string | null
          search_vector: unknown
          series: string | null
          sku: string
          status: string
          updated_at: string
          volume_cm3: number | null
          weight_g: number | null
        }
        Insert: {
          attributes?: Json
          brand_id?: string | null
          category_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          description_long?: string | null
          id?: string
          is_kit?: boolean
          legacy_ref?: string | null
          model_code?: string | null
          name: string
          ncm_code?: string | null
          needs_review?: boolean
          origin_country?: string | null
          product_type?: string | null
          search_vector?: unknown
          series?: string | null
          sku: string
          status?: string
          updated_at?: string
          volume_cm3?: number | null
          weight_g?: number | null
        }
        Update: {
          attributes?: Json
          brand_id?: string | null
          category_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          description_long?: string | null
          id?: string
          is_kit?: boolean
          legacy_ref?: string | null
          model_code?: string | null
          name?: string
          ncm_code?: string | null
          needs_review?: boolean
          origin_country?: string | null
          product_type?: string | null
          search_vector?: unknown
          series?: string | null
          sku?: string
          status?: string
          updated_at?: string
          volume_cm3?: number | null
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'products_brand_id_fkey'
            columns: ['brand_id']
            isOneToOne: false
            referencedRelation: 'brands'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'products_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'product_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'products_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          is_active: boolean
          locale: string
          phone: string | null
          theme: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          id: string
          is_active?: boolean
          locale?: string
          phone?: string | null
          theme?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          locale?: string
          phone?: string | null
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_balances: {
        Row: {
          company_id: string
          on_hand: number
          product_id: string
          reserved: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          on_hand?: number
          product_id: string
          reserved?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          on_hand?: number
          product_id?: string
          reserved?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stock_balances_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'stock_balances_warehouse_id_fkey'
            columns: ['warehouse_id']
            isOneToOne: false
            referencedRelation: 'warehouses'
            referencedColumns: ['id']
          },
        ]
      }
      stock_movements: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: number
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          source_id: string | null
          source_type: string | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: never
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          source_id?: string | null
          source_type?: string | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: never
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          source_id?: string | null
          source_type?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stock_movements_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      stock_reservations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          source_id: string | null
          source_type: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          source_id?: string | null
          source_type: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          source_id?: string | null
          source_type?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stock_reservations_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      warehouses: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'warehouses_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      product_availability: {
        Row: {
          company_id: string | null
          is_available: boolean | null
          product_id: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'stock_balances_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      /**
       * Listado Y búsqueda del catálogo. Con p_query null hace de listado,
       * ordenado por nombre o SKU. Una sola definición de qué productos
       * entran, compartida con catalog_facets.
       */
      search_products: {
        Args: {
          p_company: string
          p_query?: string | null
          p_limit?: number
          p_offset?: number
          p_category?: string | null
          p_brand?: string | null
          p_attrs?: Json | null
          p_type?: string[] | null
          p_ranges?: Json | null
          p_orden?: string
        }
        Returns: {
          id: string
          rank_position: number
          score: number
          total_count: number
        }[]
      }
      /**
       * Opciones disponibles de cada filtro. Cada faceta se calcula con
       * todos los filtros activos MENOS el suyo.
       */
      catalog_facets: {
        Args: {
          p_company: string
          p_query?: string | null
          p_category?: string | null
          p_brand?: string | null
          p_type?: string[] | null
          p_attrs?: Json | null
          p_ranges?: Json | null
        }
        Returns: Json
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

type PublicSchema = Database['public']

export type Tables<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> =
  (PublicSchema['Tables'] & PublicSchema['Views'])[T] extends { Row: infer R } ? R : never

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Update: infer U } ? U : never
