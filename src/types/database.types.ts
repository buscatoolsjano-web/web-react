/**
 * Tipos generados desde el schema de Supabase (proyecto uaxcfufvapzulqvynanp).
 *
 * NO editar a mano. Se regenera con:
 *   npx supabase gen types typescript --project-id uaxcfufvapzulqvynanp
 *
 * Refleja el schema completo: catálogo, stock y las tablas de Ventas de la
 * Fase 4 (incluido el precio por línea de entrega de Stage 3).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          bytes: number | null
          company_id: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string | null
          id: string
          kind: string | null
          mime_type: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          bytes?: number | null
          company_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name?: string | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          bytes?: number | null
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
            foreignKeyName: "brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
            foreignKeyName: "companies_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          decimals: number
          name: string
          symbol: string
        }
        Insert: {
          code: string
          decimals?: number
          name: string
          symbol: string
        }
        Update: {
          code?: string
          decimals?: number
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          city: string | null
          company_id: string
          country_code: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_default: boolean
          kind: string
          notes: string | null
          postal_code: string | null
          state: string | null
          street: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city?: string | null
          company_id: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_default?: boolean
          kind: string
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city?: string | null
          company_id?: string
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_default?: boolean
          kind?: string
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          email: string | null
          fax: string | null
          full_name: string
          id: string
          is_default: boolean
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          email?: string | null
          fax?: string | null
          full_name: string
          id?: string
          is_default?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string | null
          fax?: string | null
          full_name?: string
          id?: string
          is_default?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_po_candidates: {
        Row: {
          candidate: string
          company_id: string
          confidence: string
          created_at: string
          customer_id: string | null
          doc_count: number
          id: string
          po_id: string | null
          raw_text: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_field: string
          source_ref: string
          source_type: string
          status: string
        }
        Insert: {
          candidate: string
          company_id: string
          confidence: string
          created_at?: string
          customer_id?: string | null
          doc_count?: number
          id?: string
          po_id?: string | null
          raw_text: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field: string
          source_ref: string
          source_type: string
          status?: string
        }
        Update: {
          candidate?: string
          company_id?: string
          confidence?: string
          created_at?: string
          customer_id?: string | null
          doc_count?: number
          id?: string
          po_id?: string | null
          raw_text?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field?: string
          source_ref?: string
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_po_candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_po_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_product_aliases: {
        Row: {
          company_id: string
          confidence: number | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_code: string | null
          customer_description: string | null
          customer_id: string
          id: string
          last_used_at: string | null
          normalized_key: string
          product_id: string
          source: string | null
          status: string
          times_used: number
          updated_at: string
        }
        Insert: {
          company_id: string
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_description?: string | null
          customer_id: string
          id?: string
          last_used_at?: string | null
          normalized_key: string
          product_id: string
          source?: string | null
          status?: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_description?: string | null
          customer_id?: string
          id?: string
          last_used_at?: string | null
          normalized_key?: string
          product_id?: string
          source?: string | null
          status?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_product_aliases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_purchase_order_lines: {
        Row: {
          company_id: string
          created_at: string
          customer_description: string | null
          customer_product_code: string | null
          discount_pct: number | null
          id: string
          line_no: number
          match_confidence: number | null
          match_status: string
          matched_at: string | null
          matched_by: string | null
          po_id: string
          product_id: string | null
          quantity: number | null
          quote_line_id: string | null
          unit_price: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          discount_pct?: number | null
          id?: string
          line_no: number
          match_confidence?: number | null
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          po_id: string
          product_id?: string | null
          quantity?: number | null
          quote_line_id?: string | null
          unit_price?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          discount_pct?: number | null
          id?: string
          line_no?: number
          match_confidence?: number | null
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          po_id?: string
          product_id?: string | null
          quantity?: number | null
          quote_line_id?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_purchase_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_order_lines_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_purchase_orders: {
        Row: {
          company_id: string
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          exchange_rate: number | null
          id: string
          match_status: string
          needs_review: boolean
          notes: string | null
          payment_terms: string | null
          po_date: string | null
          po_number: string
          quote_id: string | null
          raw_text: string | null
          received_at: string | null
          received_by: string | null
          review_reason: string | null
          shipping_address_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          exchange_rate?: number | null
          id?: string
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string | null
          po_number: string
          quote_id?: string | null
          raw_text?: string | null
          received_at?: string | null
          received_by?: string | null
          review_reason?: string | null
          shipping_address_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          exchange_rate?: number | null
          id?: string
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string | null
          po_number?: string
          quote_id?: string | null
          raw_text?: string | null
          received_at?: string | null
          received_by?: string | null
          review_reason?: string | null
          shipping_address_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customer_purchase_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_purchase_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          legacy_name: string | null
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
          legacy_name?: string | null
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
          legacy_name?: string | null
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
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_default_currency_fkey"
            columns: ["default_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customers_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customers_price_list"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          carrier: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          delivery_date: string
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          imported_at: string | null
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          order_id: string | null
          original_number: string | null
          review_reason: string | null
          series_code: string | null
          shipping_address_id: string | null
          status: string
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          tracking: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          carrier?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          delivery_date: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          tracking?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          carrier?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          delivery_date?: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          tracking?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          company_id: string
          created_at: string
          delivery_id: string
          discount_pct: number | null
          id: string
          name_snapshot: string | null
          notes: string | null
          order_line_id: string | null
          product_id: string | null
          quantity: number
          sku_snapshot: string | null
          tax_rate_snapshot: number | null
          tax_treatment: string | null
          unit_price: number | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          delivery_id: string
          discount_pct?: number | null
          id?: string
          name_snapshot?: string | null
          notes?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string | null
          unit_price?: number | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          delivery_id?: string
          discount_pct?: number | null
          id?: string
          name_snapshot?: string | null
          notes?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number | null
          tax_treatment?: string | null
          unit_price?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_serials: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_line_id: string
          id: string
          notes: string | null
          product_id: string
          serial_number: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_date: string
          delivery_line_id: string
          id?: string
          notes?: string | null
          product_id: string
          serial_number: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_date?: string
          delivery_line_id?: string
          id?: string
          notes?: string | null
          product_id?: string
          serial_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_serials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          company_id: string
          doc_type: string
          is_default: boolean
          next_number: number
          padding: number
          prefix: string
          series_code: string
        }
        Insert: {
          company_id: string
          doc_type: string
          is_default?: boolean
          next_number: number
          padding?: number
          prefix: string
          series_code?: string
        }
        Update: {
          company_id?: string
          doc_type?: string
          is_default?: boolean
          next_number?: number
          padding?: number
          prefix?: string
          series_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          method: string | null
          notes: string | null
          payment_date: string
          reference: string | null
          synced_at: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          payment_date: string
          reference?: string | null
          synced_at?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
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
            foreignKeyName: "price_lists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
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
            foreignKeyName: "product_attribute_categories_attribute_definition_id_fkey"
            columns: ["attribute_definition_id"]
            isOneToOne: false
            referencedRelation: "product_attribute_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_attribute_definitions_applies_to_category_id_fkey"
            columns: ["applies_to_category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_definitions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_images_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          is_serialized: boolean
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
          is_serialized?: boolean
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
          is_serialized?: boolean
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
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      purchase_order_discrepancies: {
        Row: {
          company_id: string
          created_at: string
          field: string
          id: string
          po_id: string
          po_line_id: string | null
          po_value: string | null
          quote_line_id: string | null
          quote_value: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
        }
        Insert: {
          company_id: string
          created_at?: string
          field: string
          id?: string
          po_id: string
          po_line_id?: string | null
          po_value?: string | null
          quote_line_id?: string | null
          quote_value?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          field?: string
          id?: string
          po_id?: string
          po_line_id?: string | null
          po_value?: string | null
          quote_line_id?: string | null
          quote_value?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_discrepancies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          diff: Json | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: number
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          diff?: Json | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: number
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_lines: {
        Row: {
          company_id: string
          created_at: string
          delivery_line_id: string | null
          discount_pct: number
          id: string
          invoice_id: string
          name_snapshot: string | null
          order_line_id: string | null
          product_id: string | null
          quantity: number
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          delivery_line_id?: string | null
          discount_pct?: number
          id?: string
          invoice_id: string
          name_snapshot?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          company_id?: string
          created_at?: string
          delivery_line_id?: string | null
          discount_pct?: number
          id?: string
          invoice_id?: string
          name_snapshot?: string | null
          order_line_id?: string | null
          product_id?: string | null
          quantity?: number
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          due_date: string | null
          exchange_rate: number | null
          external_id: string | null
          external_number: string | null
          external_source: string | null
          external_status: string | null
          id: string
          invoice_date: string
          needs_review: boolean
          notes: string | null
          number: string | null
          order_id: string | null
          original_number: string | null
          review_reason: string | null
          status: string
          subtotal: number | null
          synced_at: string | null
          tax_amount: number | null
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          due_date?: string | null
          exchange_rate?: number | null
          external_id?: string | null
          external_number?: string | null
          external_source?: string | null
          external_status?: string | null
          id?: string
          invoice_date: string
          needs_review?: boolean
          notes?: string | null
          number?: string | null
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          status?: string
          subtotal?: number | null
          synced_at?: string | null
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          due_date?: string | null
          exchange_rate?: number | null
          external_id?: string | null
          external_number?: string | null
          external_source?: string | null
          external_status?: string | null
          id?: string
          invoice_date?: string
          needs_review?: boolean
          notes?: string | null
          number?: string | null
          order_id?: string | null
          original_number?: string | null
          review_reason?: string | null
          status?: string
          subtotal?: number | null
          synced_at?: string | null
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_lines: {
        Row: {
          company_id: string
          created_at: string
          customer_description: string | null
          customer_product_code: string | null
          description_snapshot: string | null
          discount_pct: number
          id: string
          kit_components_snapshot: Json | null
          line_no: number
          line_type: string
          list_price_snapshot: number | null
          name_snapshot: string | null
          notes: string | null
          order_id: string
          po_line_id: string | null
          product_id: string | null
          quantity_ordered: number
          quote_line_id: string | null
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_id: string
          po_line_id?: string | null
          product_id?: string | null
          quantity_ordered: number
          quote_line_id?: string | null
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_description?: string | null
          customer_product_code?: string | null
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no?: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          order_id?: string
          po_line_id?: string | null
          product_id?: string | null
          quantity_ordered?: number
          quote_line_id?: string | null
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          billing_address_id: string | null
          commercial_status: string
          company_id: string
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          discount_pct: number | null
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          fulfillment_status: string
          id: string
          imported_at: string | null
          invoicing_status: string
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          order_date: string
          origin: string
          original_number: string | null
          payment_status: string
          payment_terms: string | null
          perception_pct: number | null
          po_id: string | null
          quote_id: string | null
          review_reason: string | null
          salesperson_id: string | null
          series_code: string | null
          shipping_address_id: string | null
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_address_id?: string | null
          commercial_status?: string
          company_id: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          fulfillment_status?: string
          id?: string
          imported_at?: string | null
          invoicing_status?: string
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          order_date: string
          origin?: string
          original_number?: string | null
          payment_status?: string
          payment_terms?: string | null
          perception_pct?: number | null
          po_id?: string | null
          quote_id?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_address_id?: string | null
          commercial_status?: string
          company_id?: string
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          fulfillment_status?: string
          id?: string
          imported_at?: string | null
          invoicing_status?: string
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          order_date?: string
          origin?: string
          original_number?: string | null
          payment_status?: string
          payment_terms?: string | null
          perception_pct?: number | null
          po_id?: string | null
          quote_id?: string | null
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          shipping_address_id?: string | null
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_billing_address_id_fkey"
            columns: ["billing_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "customer_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quote_lines: {
        Row: {
          brand_snapshot: string | null
          company_id: string
          created_at: string
          description_snapshot: string | null
          discount_pct: number
          id: string
          kit_components_snapshot: Json | null
          line_no: number
          line_type: string
          list_price_snapshot: number | null
          name_snapshot: string | null
          notes: string | null
          product_id: string | null
          quantity: number
          quote_id: string
          sku_snapshot: string | null
          tax_rate_snapshot: number
          tax_treatment: string
          unit_price: number
        }
        Insert: {
          brand_snapshot?: string | null
          company_id: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          product_id?: string | null
          quantity: number
          quote_id: string
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price: number
        }
        Update: {
          brand_snapshot?: string | null
          company_id?: string
          created_at?: string
          description_snapshot?: string | null
          discount_pct?: number
          id?: string
          kit_components_snapshot?: Json | null
          line_no?: number
          line_type?: string
          list_price_snapshot?: number | null
          name_snapshot?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number
          quote_id?: string
          sku_snapshot?: string | null
          tax_rate_snapshot?: number
          tax_treatment?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_quote_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          customer_id: string
          discount_pct: number | null
          exchange_rate: number | null
          external_id: string | null
          external_source: string | null
          id: string
          imported_at: string | null
          legacy_source: string | null
          needs_review: boolean
          notes: string | null
          number: string
          number_outlier: boolean
          original_number: string | null
          payment_terms: string | null
          perception_pct: number | null
          quote_date: string
          review_reason: string | null
          salesperson_id: string | null
          series_code: string | null
          status: string
          subtotal: number | null
          suspected_normalized_number: string | null
          tax_amount: number | null
          title: string | null
          total: number | null
          updated_at: string
          updated_by: string | null
          valid_until: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number: string
          number_outlier?: boolean
          original_number?: string | null
          payment_terms?: string | null
          perception_pct?: number | null
          quote_date: string
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          customer_id?: string
          discount_pct?: number | null
          exchange_rate?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          imported_at?: string | null
          legacy_source?: string | null
          needs_review?: boolean
          notes?: string | null
          number?: string
          number_outlier?: boolean
          original_number?: string | null
          payment_terms?: string | null
          perception_pct?: number | null
          quote_date?: string
          review_reason?: string | null
          salesperson_id?: string | null
          series_code?: string | null
          status?: string
          subtotal?: number | null
          suspected_normalized_number?: string | null
          tax_amount?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sales_quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "stock_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
            foreignKeyName: "stock_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
        Insert: {
          company_id?: string | null
          is_available?: never
          product_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string | null
          is_available?: never
          product_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      catalog_facets: {
        Args: {
          p_attrs?: Json
          p_brand?: string
          p_category?: string
          p_company: string
          p_query?: string
          p_ranges?: Json
          p_type?: string[]
        }
        Returns: Json
      }
      next_document_number: {
        Args: { p_company: string; p_doc_type: string; p_series?: string }
        Returns: string
      }
      registrar_evento_venta: {
        Args: {
          p_action: string
          p_diff?: Json
          p_entity_id: string
          p_entity_type: string
          p_from_status?: string
          p_to_status?: string
        }
        Returns: number
      }
      search_products: {
        Args: {
          p_attrs?: Json
          p_brand?: string
          p_category?: string
          p_company: string
          p_limit?: number
          p_offset?: number
          p_orden?: string
          p_query?: string
          p_ranges?: Json
          p_type?: string[]
        }
        Returns: {
          id: string
          rank_position: number
          score: number
          total_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database['public']

export type Tables<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> =
  (PublicSchema['Tables'] & PublicSchema['Views'])[T] extends { Row: infer R } ? R : never

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Update: infer U } ? U : never
