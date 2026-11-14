
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounting_periods": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"id": string,"note": string | null,"period_month": string,"reopened_at": string | null,"reopened_by": string | null,"status": Database["public"]['Enums']["period_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"id"?: string,"note"?: string | null,"period_month": string,"reopened_at"?: string | null,"reopened_by"?: string | null,"status"?: Database["public"]['Enums']["period_status"]
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"id"?: string,"note"?: string | null,"period_month"?: string,"reopened_at"?: string | null,"reopened_by"?: string | null,"status"?: Database["public"]['Enums']["period_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounting_periods_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounting_periods_reopened_by_fkey"
      columns: ["reopened_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "admin_can_approve_funds": boolean,"id": boolean,"identity_retention_years": number,"long_stay_days": number,"pm_price_source_name": string,"staff_can_view_other_inventory": boolean,"tax_basis": Database["public"]['Enums']["tax_basis"],"tax_rounding": Database["public"]['Enums']["rounding_mode"],"ui_mode": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_can_approve_funds"?: boolean,"id"?: boolean,"identity_retention_years"?: number,"long_stay_days"?: number,"pm_price_source_name"?: string,"staff_can_view_other_inventory"?: boolean,"tax_basis"?: Database["public"]['Enums']["tax_basis"],"tax_rounding"?: Database["public"]['Enums']["rounding_mode"],"ui_mode"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "admin_can_approve_funds"?: boolean,"id"?: boolean,"identity_retention_years"?: number,"long_stay_days"?: number,"pm_price_source_name"?: string,"staff_can_view_other_inventory"?: boolean,"tax_basis"?: Database["public"]['Enums']["tax_basis"],"tax_rounding"?: Database["public"]['Enums']["rounding_mode"],"ui_mode"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"approval_requests": {
                  Row: {
                    "decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"idempotency_key": string,"payload": NonNullable<Json>,"reason": string,"request_type": Database["public"]['Enums']["approval_type"],"requested_at": string,"requested_by": string,"result": Json | null,"status": Database["public"]['Enums']["approval_status"],"target_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"idempotency_key": string,"payload"?: NonNullable<Json>,"reason": string,"request_type": Database["public"]['Enums']["approval_type"],"requested_at"?: string,"requested_by": string,"result"?: Json | null,"status"?: Database["public"]['Enums']["approval_status"],"target_id"?: string | null
                  }
                  Update: {
                    "decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"idempotency_key"?: string,"payload"?: NonNullable<Json>,"reason"?: string,"request_type"?: Database["public"]['Enums']["approval_type"],"requested_at"?: string,"requested_by"?: string,"result"?: Json | null,"status"?: Database["public"]['Enums']["approval_status"],"target_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_requests_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"after_data": Json | null,"before_data": Json | null,"context": Json | null,"id": number,"occurred_at": string,"record_id": string | null,"table_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"context"?: Json | null,"id"?: number,"occurred_at"?: string,"record_id"?: string | null,"table_name"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"context"?: Json | null,"id"?: number,"occurred_at"?: string,"record_id"?: string | null,"table_name"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"customer_identity_records": {
                  Row: {
                    "created_at": string,"customer_id": string,"disposed_at": string | null,"disposed_by": string | null,"encrypted_payload": string,"id": string,"key_version": number,"purchase_transaction_id": string | null,"retain_until": string,"verification_method": string,"verified_at": string,"verified_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"disposed_at"?: string | null,"disposed_by"?: string | null,"encrypted_payload": string,"id"?: string,"key_version": number,"purchase_transaction_id"?: string | null,"retain_until": string,"verification_method": string,"verified_at": string,"verified_by": string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"disposed_at"?: string | null,"disposed_by"?: string | null,"encrypted_payload"?: string,"id"?: string,"key_version"?: number,"purchase_transaction_id"?: string | null,"retain_until"?: string,"verification_method"?: string,"verified_at"?: string,"verified_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_identity_records_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identity_records_disposed_by_fkey"
      columns: ["disposed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identity_records_purchase_transaction_id_fkey"
      columns: ["purchase_transaction_id"]
isOneToOne: false
      referencedRelation: "purchase_transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_identity_records_verified_by_fkey"
      columns: ["verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"name": string,"name_kana": string | null,"note": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"name": string,"name_kana"?: string | null,"note"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"name"?: string,"name_kana"?: string | null,"note"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_allocations": {
                  Row: {
                    "amount_excl": number,"amount_incl": number,"basis": Database["public"]['Enums']["expense_allocation_basis"],"created_at": string,"created_by": string,"expense_id": string,"id": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_excl": number,"amount_incl": number,"basis": Database["public"]['Enums']["expense_allocation_basis"],"created_at"?: string,"created_by": string,"expense_id": string,"id"?: string,"staff_id": string
                  }
                  Update: {
                    "amount_excl"?: number,"amount_incl"?: number,"basis"?: Database["public"]['Enums']["expense_allocation_basis"],"created_at"?: string,"created_by"?: string,"expense_id"?: string,"id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_allocations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_allocations_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_allocations_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount_excl": number,"amount_incl": number,"amount_tax": number,"attributed_staff_id": string | null,"category": string,"created_at": string,"created_by": string,"description": string | null,"expense_no": string,"fund_account_id": string | null,"id": string,"idempotency_key": string,"incurred_on": string,"paid_by_staff_id": string | null,"status": string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_excl": number,"amount_incl": number,"amount_tax": number,"attributed_staff_id"?: string | null,"category": string,"created_at"?: string,"created_by": string,"description"?: string | null,"expense_no": string,"fund_account_id"?: string | null,"id"?: string,"idempotency_key": string,"incurred_on": string,"paid_by_staff_id"?: string | null,"status"?: string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  Update: {
                    "amount_excl"?: number,"amount_incl"?: number,"amount_tax"?: number,"attributed_staff_id"?: string | null,"category"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"expense_no"?: string,"fund_account_id"?: string | null,"id"?: string,"idempotency_key"?: string,"incurred_on"?: string,"paid_by_staff_id"?: string | null,"status"?: string,"tax_category"?: Database["public"]['Enums']["tax_category"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_attributed_staff_id_fkey"
      columns: ["attributed_staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_fund_account_id_fkey"
      columns: ["fund_account_id"]
isOneToOne: false
      referencedRelation: "fund_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_paid_by_staff_id_fkey"
      columns: ["paid_by_staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fund_accounts": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["fund_account_kind"],"name": string,"owner_profile_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["fund_account_kind"],"name": string,"owner_profile_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["fund_account_kind"],"name"?: string,"owner_profile_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fund_accounts_owner_profile_id_fkey"
      columns: ["owner_profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fund_reconciliations": {
                  Row: {
                    "account_id": string,"adjustment_request_id": string | null,"counted_amount": number,"counted_at": string,"counted_by": string,"created_at": string,"difference": number | null,"id": string,"ledger_balance": number,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"adjustment_request_id"?: string | null,"counted_amount": number,"counted_at": string,"counted_by": string,"created_at"?: string,"difference"?: never,"id"?: string,"ledger_balance": number,"note"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"adjustment_request_id"?: string | null,"counted_amount"?: number,"counted_at"?: string,"counted_by"?: string,"created_at"?: string,"difference"?: never,"id"?: string,"ledger_balance"?: number,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fund_reconciliations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "fund_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fund_reconciliations_adjustment_request_id_fkey"
      columns: ["adjustment_request_id"]
isOneToOne: false
      referencedRelation: "approval_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fund_reconciliations_counted_by_fkey"
      columns: ["counted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fund_transactions": {
                  Row: {
                    "account_id": string,"amount": number,"approval_request_id": string | null,"created_at": string,"created_by": string,"id": string,"idempotency_key": string,"memo": string | null,"occurred_at": string,"purchase_transaction_id": string | null,"transfer_group_id": string | null,"tx_type": Database["public"]['Enums']["fund_tx_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount": number,"approval_request_id"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"idempotency_key": string,"memo"?: string | null,"occurred_at": string,"purchase_transaction_id"?: string | null,"transfer_group_id"?: string | null,"tx_type": Database["public"]['Enums']["fund_tx_type"]
                  }
                  Update: {
                    "account_id"?: string,"amount"?: number,"approval_request_id"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string,"memo"?: string | null,"occurred_at"?: string,"purchase_transaction_id"?: string | null,"transfer_group_id"?: string | null,"tx_type"?: Database["public"]['Enums']["fund_tx_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "fund_transactions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "fund_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fund_transactions_approval_request_id_fkey"
      columns: ["approval_request_id"]
isOneToOne: false
      referencedRelation: "approval_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fund_transactions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fund_transactions_purchase_transaction_id_fkey"
      columns: ["purchase_transaction_id"]
isOneToOne: false
      referencedRelation: "purchase_transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "cost_excl_delta": number,"cost_incl_delta": number,"created_at": string,"created_by": string,"id": string,"item_id": string,"movement_type": Database["public"]['Enums']["inventory_movement_type"],"occurred_at": string,"quantity_delta": number,"sale_item_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_excl_delta": number,"cost_incl_delta": number,"created_at"?: string,"created_by": string,"id"?: string,"item_id": string,"movement_type": Database["public"]['Enums']["inventory_movement_type"],"occurred_at": string,"quantity_delta": number,"sale_item_id"?: string | null
                  }
                  Update: {
                    "cost_excl_delta"?: number,"cost_incl_delta"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"item_id"?: string,"movement_type"?: Database["public"]['Enums']["inventory_movement_type"],"occurred_at"?: string,"quantity_delta"?: number,"sale_item_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "purchase_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_sale_item_id_fkey"
      columns: ["sale_item_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id"]
    }
                  ]
                },"item_categories": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"item_photos": {
                  Row: {
                    "content_type": string,"created_at": string,"deleted_at": string | null,"deleted_by": string | null,"id": string,"item_id": string,"size_bytes": number,"sort_order": number,"storage_path": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_type": string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"item_id": string,"size_bytes": number,"sort_order"?: number,"storage_path": string,"uploaded_by": string
                  }
                  Update: {
                    "content_type"?: string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"item_id"?: string,"size_bytes"?: number,"sort_order"?: number,"storage_path"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_photos_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_photos_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "purchase_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_photos_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_records": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"idempotency_key": string,"kind": Database["public"]['Enums']["payment_record_kind"],"method": string | null,"note": string | null,"received_at": string,"recorded_by": string,"reverses_id": string | null,"sale_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"idempotency_key": string,"kind": Database["public"]['Enums']["payment_record_kind"],"method"?: string | null,"note"?: string | null,"received_at": string,"recorded_by": string,"reverses_id"?: string | null,"sale_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["payment_record_kind"],"method"?: string | null,"note"?: string | null,"received_at"?: string,"recorded_by"?: string,"reverses_id"?: string | null,"sale_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_records_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_records_reverses_id_fkey"
      columns: ["reverses_id"]
isOneToOne: false
      referencedRelation: "payment_records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_records_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"pm_grades": {
                  Row: {
                    "code": string,"is_active": boolean,"label": string,"metal": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"is_active"?: boolean,"label": string,"metal": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"label"?: string,"metal"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"pm_market_prices": {
                  Row: {
                    "created_at": string,"fetched_at": string,"grade_code": string,"id": string,"method": string,"note": string | null,"price_date": string,"recorded_by": string | null,"source_name": string,"source_url": string | null,"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"fetched_at": string,"grade_code": string,"id"?: string,"method": string,"note"?: string | null,"price_date": string,"recorded_by"?: string | null,"source_name": string,"source_url"?: string | null,"unit_price": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"fetched_at"?: string,"grade_code"?: string,"id"?: string,"method"?: string,"note"?: string | null,"price_date"?: string,"recorded_by"?: string | null,"source_name"?: string,"source_url"?: string | null,"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pm_market_prices_grade_code_fkey"
      columns: ["grade_code"]
isOneToOne: false
      referencedRelation: "pm_grades"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "pm_market_prices_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"pm_purchase_items": {
                  Row: {
                    "grade_code": string,"id": string,"item_name": string | null,"line_no": number,"market_price_date": string | null,"market_price_id": string | null,"metal_value": number,"price_basis": string,"purchase_id": string,"unit_price": number,"weight_g": number
                  }
                  ComputedFields: never
                  Insert: {
                    "grade_code": string,"id"?: string,"item_name"?: string | null,"line_no": number,"market_price_date"?: string | null,"market_price_id"?: string | null,"metal_value": number,"price_basis": string,"purchase_id": string,"unit_price": number,"weight_g": number
                  }
                  Update: {
                    "grade_code"?: string,"id"?: string,"item_name"?: string | null,"line_no"?: number,"market_price_date"?: string | null,"market_price_id"?: string | null,"metal_value"?: number,"price_basis"?: string,"purchase_id"?: string,"unit_price"?: number,"weight_g"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pm_purchase_items_grade_code_fkey"
      columns: ["grade_code"]
isOneToOne: false
      referencedRelation: "pm_grades"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "pm_purchase_items_market_price_id_fkey"
      columns: ["market_price_id"]
isOneToOne: false
      referencedRelation: "pm_market_prices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pm_purchase_items_purchase_id_fkey"
      columns: ["purchase_id"]
isOneToOne: false
      referencedRelation: "pm_purchases"
      referencedColumns: ["id"]
    }
                  ]
                },"pm_purchases": {
                  Row: {
                    "created_at": string,"customer_address": string | null,"customer_name": string,"customer_phone": string | null,"entered_by": string,"expected_profit": number | null,"id": string,"idempotency_key": string,"note": string | null,"paid_amount": number,"purchase_no": string,"purchased_on": string,"staff_id": string,"status": string,"total_metal_value": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_address"?: string | null,"customer_name": string,"customer_phone"?: string | null,"entered_by": string,"expected_profit"?: never,"id"?: string,"idempotency_key": string,"note"?: string | null,"paid_amount": number,"purchase_no": string,"purchased_on": string,"staff_id": string,"status"?: string,"total_metal_value": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"customer_address"?: string | null,"customer_name"?: string,"customer_phone"?: string | null,"entered_by"?: string,"expected_profit"?: never,"id"?: string,"idempotency_key"?: string,"note"?: string | null,"paid_amount"?: number,"purchase_no"?: string,"purchased_on"?: string,"staff_id"?: string,"status"?: string,"total_metal_value"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pm_purchases_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pm_purchases_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pm_purchases_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string | null,"id": string,"is_active": boolean,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"email"?: string | null,"id": string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"purchase_items": {
                  Row: {
                    "brand": string | null,"category_id": string,"condition": Database["public"]['Enums']["item_condition"],"cost_excl": number,"cost_incl": number,"cost_tax": number,"created_at": string,"id": string,"item_no": string,"line_no": number,"model_no": string | null,"name": string,"note": string | null,"parent_item_id": string | null,"purchase_transaction_id": string,"purchased_at": string,"quantity": number,"serial_no": string | null,"staff_id": string,"status": Database["public"]['Enums']["item_status"],"storage_location": string | null,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  ComputedFields: never
                  Insert: {
                    "brand"?: string | null,"category_id": string,"condition": Database["public"]['Enums']["item_condition"],"cost_excl": number,"cost_incl": number,"cost_tax": number,"created_at"?: string,"id"?: string,"item_no": string,"line_no": number,"model_no"?: string | null,"name": string,"note"?: string | null,"parent_item_id"?: string | null,"purchase_transaction_id": string,"purchased_at": string,"quantity": number,"serial_no"?: string | null,"staff_id": string,"status"?: Database["public"]['Enums']["item_status"],"storage_location"?: string | null,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  Update: {
                    "brand"?: string | null,"category_id"?: string,"condition"?: Database["public"]['Enums']["item_condition"],"cost_excl"?: number,"cost_incl"?: number,"cost_tax"?: number,"created_at"?: string,"id"?: string,"item_no"?: string,"line_no"?: number,"model_no"?: string | null,"name"?: string,"note"?: string | null,"parent_item_id"?: string | null,"purchase_transaction_id"?: string,"purchased_at"?: string,"quantity"?: number,"serial_no"?: string | null,"staff_id"?: string,"status"?: Database["public"]['Enums']["item_status"],"storage_location"?: string | null,"tax_category"?: Database["public"]['Enums']["tax_category"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "item_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_items_parent_item_id_fkey"
      columns: ["parent_item_id"]
isOneToOne: false
      referencedRelation: "purchase_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_items_purchase_transaction_id_fkey"
      columns: ["purchase_transaction_id"]
isOneToOne: false
      referencedRelation: "purchase_transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_items_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"purchase_transactions": {
                  Row: {
                    "created_at": string,"customer_id": string | null,"entered_by": string,"fund_account_id": string,"id": string,"idempotency_key": string,"method": Database["public"]['Enums']["purchase_method"],"note": string | null,"payment_method": Database["public"]['Enums']["payment_method"],"purchase_no": string,"purchased_at": string,"staff_id": string,"status": string,"total_excl": number,"total_incl": number,"total_tax": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id"?: string | null,"entered_by": string,"fund_account_id": string,"id"?: string,"idempotency_key": string,"method": Database["public"]['Enums']["purchase_method"],"note"?: string | null,"payment_method": Database["public"]['Enums']["payment_method"],"purchase_no": string,"purchased_at": string,"staff_id": string,"status"?: string,"total_excl": number,"total_incl": number,"total_tax": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string | null,"entered_by"?: string,"fund_account_id"?: string,"id"?: string,"idempotency_key"?: string,"method"?: Database["public"]['Enums']["purchase_method"],"note"?: string | null,"payment_method"?: Database["public"]['Enums']["payment_method"],"purchase_no"?: string,"purchased_at"?: string,"staff_id"?: string,"status"?: string,"total_excl"?: number,"total_incl"?: number,"total_tax"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_transactions_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_transactions_fund_account_id_fkey"
      columns: ["fund_account_id"]
isOneToOne: false
      referencedRelation: "fund_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_transactions_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_transactions_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_expenses": {
                  Row: {
                    "amount_excl": number,"amount_incl": number,"amount_tax": number,"created_at": string,"expense_type": Database["public"]['Enums']["sale_expense_type"],"id": string,"note": string | null,"sale_id": string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_excl": number,"amount_incl": number,"amount_tax": number,"created_at"?: string,"expense_type": Database["public"]['Enums']["sale_expense_type"],"id"?: string,"note"?: string | null,"sale_id": string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  Update: {
                    "amount_excl"?: number,"amount_incl"?: number,"amount_tax"?: number,"created_at"?: string,"expense_type"?: Database["public"]['Enums']["sale_expense_type"],"id"?: string,"note"?: string | null,"sale_id"?: string,"tax_category"?: Database["public"]['Enums']["tax_category"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_expenses_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "category_id": string,"cost_excl": number,"cost_incl": number,"created_at": string,"direct_expense_excl": number,"direct_expense_incl": number,"id": string,"item_id": string,"line_no": number,"purchaser_staff_id": string,"quantity": number,"returned_from_sale_item_id": string | null,"revenue_excl": number,"revenue_incl": number,"revenue_tax": number,"sale_id": string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"cost_excl": number,"cost_incl": number,"created_at"?: string,"direct_expense_excl"?: number,"direct_expense_incl"?: number,"id"?: string,"item_id": string,"line_no": number,"purchaser_staff_id": string,"quantity": number,"returned_from_sale_item_id"?: string | null,"revenue_excl": number,"revenue_incl": number,"revenue_tax": number,"sale_id": string,"tax_category": Database["public"]['Enums']["tax_category"]
                  }
                  Update: {
                    "category_id"?: string,"cost_excl"?: number,"cost_incl"?: number,"created_at"?: string,"direct_expense_excl"?: number,"direct_expense_incl"?: number,"id"?: string,"item_id"?: string,"line_no"?: number,"purchaser_staff_id"?: string,"quantity"?: number,"returned_from_sale_item_id"?: string | null,"revenue_excl"?: number,"revenue_incl"?: number,"revenue_tax"?: number,"sale_id"?: string,"tax_category"?: Database["public"]['Enums']["tax_category"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "item_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "purchase_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_purchaser_staff_id_fkey"
      columns: ["purchaser_staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_returned_from_sale_item_id_fkey"
      columns: ["returned_from_sale_item_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "buyer_name": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"channel": Database["public"]['Enums']["sales_channel"],"created_at": string,"direct_expense_excl": number,"direct_expense_incl": number,"entered_by": string,"expected_receipt_amount": number,"id": string,"idempotency_key": string,"kind": Database["public"]['Enums']["sale_kind"],"note": string | null,"original_sale_id": string | null,"payment_due_date": string | null,"payment_status": Database["public"]['Enums']["payment_status"],"revenue_excl": number,"revenue_incl": number,"revenue_tax": number,"sale_no": string,"sales_staff_id": string,"sold_at": string,"status": Database["public"]['Enums']["sale_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "buyer_name"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"channel": Database["public"]['Enums']["sales_channel"],"created_at"?: string,"direct_expense_excl"?: number,"direct_expense_incl"?: number,"entered_by": string,"expected_receipt_amount": number,"id"?: string,"idempotency_key": string,"kind"?: Database["public"]['Enums']["sale_kind"],"note"?: string | null,"original_sale_id"?: string | null,"payment_due_date"?: string | null,"payment_status"?: Database["public"]['Enums']["payment_status"],"revenue_excl": number,"revenue_incl": number,"revenue_tax": number,"sale_no": string,"sales_staff_id": string,"sold_at": string,"status"?: Database["public"]['Enums']["sale_status"]
                  }
                  Update: {
                    "buyer_name"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"channel"?: Database["public"]['Enums']["sales_channel"],"created_at"?: string,"direct_expense_excl"?: number,"direct_expense_incl"?: number,"entered_by"?: string,"expected_receipt_amount"?: number,"id"?: string,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["sale_kind"],"note"?: string | null,"original_sale_id"?: string | null,"payment_due_date"?: string | null,"payment_status"?: Database["public"]['Enums']["payment_status"],"revenue_excl"?: number,"revenue_incl"?: number,"revenue_tax"?: number,"sale_no"?: string,"sales_staff_id"?: string,"sold_at"?: string,"status"?: Database["public"]['Enums']["sale_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_original_sale_id_fkey"
      columns: ["original_sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_sales_staff_id_fkey"
      columns: ["sales_staff_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_item_photo":
{ Args: { "p_content_type": string,"p_item_id": string,"p_path": string,"p_size": number }; Returns: string
                           },
"admin_list_staff":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"display_name": string,"email": string,"id": string,"is_active": boolean,"reserve_account_id": string,"reserve_balance": number,"role": Database["public"]['Enums']["user_role"]
            }[]
                           },
"cancel_sale":
{ Args: { "p_reason": string,"p_sale_id": string }; Returns: Json
                           },
"close_period":
{ Args: { "p_month": string,"p_note"?: string }; Returns: undefined
                           },
"create_approval_request":
{ Args: { "p": Json }; Returns: Json
                           },
"decide_approval_request":
{ Args: { "p_approve": boolean,"p_note": string,"p_request_id": string }; Returns: Json
                           },
"find_customers_by_phone":
{ Args: { "p_phone": string }; Returns: {
              "id": string,"name": string,"name_kana": string
            }[]
                           },
"fund_balances":
{ Args: Record<PropertyKey, never>; Returns: {
              "account_id": string,"balance": number,"is_active": boolean,"kind": Database["public"]['Enums']["fund_account_kind"],"last_tx_at": string,"name": string,"owner_name": string,"owner_profile_id": string
            }[]
                           },
"fund_operation":
{ Args: { "p": Json }; Returns: Json
                           },
"get_identity_record":
{ Args: { "p_purpose": string,"p_record_id": string }; Returns: {
              "customer_id": string,"encrypted_payload": string,"id": string,"key_version": number,"retain_until": string,"verification_method": string,"verified_at": string
            }[]
                           },
"get_item":
{ Args: { "p_item_id": string }; Returns: Json
                           },
"get_sale_lines":
{ Args: { "p_sale_id": string }; Returns: {
              "cost_excl": number,"cost_incl": number,"direct_expense_excl": number,"direct_expense_incl": number,"id": string,"item_id": string,"item_name": string,"item_no": string,"line_no": number,"profit_excl": number,"profit_incl": number,"purchaser_name": string,"purchaser_staff_id": string,"quantity": number,"returned_from_sale_item_id": string,"returned_quantity": number,"revenue_excl": number,"revenue_incl": number,"tax_category": Database["public"]['Enums']["tax_category"]
            }[]
                           },
"pm_prices_for_date":
{ Args: { "p_date": string }; Returns: {
              "fetched_at": string,"grade_code": string,"is_exact_date": boolean,"market_price_id": string,"price_date": string,"source_name": string,"unit_price": number
            }[]
                           },
"pm_register_purchase":
{ Args: { "p": Json }; Returns: Json
                           },
"pm_report_by_staff":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "count": number,"display_name": string,"expected_profit": number,"paid_amount": number,"staff_id": string,"total_metal_value": number
            }[]
                           },
"pm_report_summary":
{ Args: { "p_from": string,"p_staff"?: string,"p_to": string }; Returns: Json
                           },
"pm_report_timeseries":
{ Args: { "p_from": string,"p_grain"?: string,"p_staff"?: string,"p_to": string }; Returns: {
              "bucket": string,"count": number,"expected_profit": number,"paid_amount": number,"total_metal_value": number
            }[]
                           },
"pm_upsert_market_prices":
{ Args: { "p": Json }; Returns: number
                           },
"pm_void_purchase":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"purchase_identity_records":
{ Args: { "p_purchase_id": string }; Returns: {
              "id": string,"retain_until": string,"verification_method": string,"verified_at": string
            }[]
                           },
"record_payment":
{ Args: { "p": Json }; Returns: Json
                           },
"record_reconciliation":
{ Args: { "p_account_id": string,"p_counted_amount": number,"p_note": string }; Returns: Json
                           },
"register_purchase":
{ Args: { "p": Json }; Returns: Json
                           },
"register_return":
{ Args: { "p": Json }; Returns: Json
                           },
"register_sale":
{ Args: { "p": Json }; Returns: Json
                           },
"remove_item_photo":
{ Args: { "p_photo_id": string }; Returns: undefined
                           },
"reopen_period":
{ Args: { "p_month": string,"p_note": string }; Returns: undefined
                           },
"report_breakdown":
{ Args: { "p_dimension": string,"p_from": string,"p_staff"?: string,"p_to": string }; Returns: {
              "cost_of_sales": number,"direct_expense": number,"gross_profit": number,"key": string,"label": string,"net_profit": number,"quantity": number,"revenue": number
            }[]
                           },
"report_staff_ranking":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "cost_of_sales": number,"direct_expense": number,"display_name": string,"gross_profit": number,"net_profit": number,"purchase_amount": number,"purchase_count": number,"revenue": number,"sales_count": number,"sold_by_staff_revenue": number,"staff_id": string
            }[]
                           },
"report_summary":
{ Args: { "p_from": string,"p_staff"?: string,"p_to": string }; Returns: Json
                           },
"report_timeseries":
{ Args: { "p_from": string,"p_grain"?: string,"p_staff"?: string,"p_to": string }; Returns: {
              "bucket": string,"cost_of_sales": number,"direct_expense": number,"gross_profit": number,"net_profit": number,"purchase_amount": number,"purchase_count": number,"revenue": number,"sales_count": number
            }[]
                           },
"search_items":
{ Args: { "p_category"?: string,"p_limit"?: number,"p_offset"?: number,"p_q"?: string,"p_scope"?: string,"p_staff"?: string,"p_status"?: string }; Returns: {
              "brand": string,"can_see_cost": boolean,"category_id": string,"category_name": string,"condition": Database["public"]['Enums']["item_condition"],"id": string,"is_mine": boolean,"item_no": string,"model_no": string,"name": string,"photo_path": string,"purchased_at": string,"quantity": number,"staff_id": string,"staff_name": string,"status": Database["public"]['Enums']["item_status"],"stock_cost": number,"stock_quantity": number,"storage_location": string,"total_count": number
            }[]
                           },
"set_user_active":
{ Args: { "p_active": boolean,"p_user_id": string }; Returns: undefined
                           },
"set_user_role":
{ Args: { "p_role": Database["public"]['Enums']["user_role"],"p_user_id": string }; Returns: undefined
                           },
"split_item":
{ Args: { "p": Json }; Returns: Json
                           },
"update_display_name":
{ Args: { "p_name": string,"p_user_id": string }; Returns: undefined
                           },
"update_settings":
{ Args: { "p": Json }; Returns: undefined
                           },
"void_purchase":
{ Args: { "p_purchase_id": string,"p_reason": string }; Returns: Json
                           },
"withdraw_approval_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "approval_status": "pending"|"approved"|"rejected"|"withdrawn","approval_type": "fund_adjustment"|"fund_replenish"|"fund_transfer"|"purchase_void"|"sale_cancel","expense_allocation_basis": "revenue"|"purchase_amount"|"equal"|"manual","fund_account_kind": "staff_reserve"|"company_cash"|"company_bank","fund_tx_type": "opening"|"replenish"|"purchase_payment"|"purchase_refund"|"return_to_company"|"transfer"|"approved_adjustment","inventory_movement_type": "purchase_in"|"sale_out"|"return_in"|"sale_cancel_in"|"purchase_void_out"|"split_out"|"split_in"|"adjustment","item_condition": "new"|"S"|"A"|"B"|"C"|"D"|"junk","item_status": "in_stock"|"partially_sold"|"sold"|"split"|"voided","payment_method": "cash"|"bank_transfer"|"other","payment_record_kind": "receipt"|"refund","payment_status": "unpaid"|"partial"|"paid","period_status": "open"|"closed","purchase_method": "store"|"visit"|"delivery"|"other","rounding_mode": "floor"|"round"|"ceil","sale_expense_type": "fee"|"shipping"|"other","sale_kind": "sale"|"return","sale_status": "confirmed"|"cancelled","sales_channel": "store"|"dealer"|"auction"|"ec"|"other","tax_basis": "incl"|"excl","tax_category": "standard_10"|"reduced_8"|"exempt"|"non_taxable"|"tax_free_export","user_role": "owner"|"admin"|"staff"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "approval_status": ["pending", "approved", "rejected", "withdrawn"],"approval_type": ["fund_adjustment", "fund_replenish", "fund_transfer", "purchase_void", "sale_cancel"],"expense_allocation_basis": ["revenue", "purchase_amount", "equal", "manual"],"fund_account_kind": ["staff_reserve", "company_cash", "company_bank"],"fund_tx_type": ["opening", "replenish", "purchase_payment", "purchase_refund", "return_to_company", "transfer", "approved_adjustment"],"inventory_movement_type": ["purchase_in", "sale_out", "return_in", "sale_cancel_in", "purchase_void_out", "split_out", "split_in", "adjustment"],"item_condition": ["new", "S", "A", "B", "C", "D", "junk"],"item_status": ["in_stock", "partially_sold", "sold", "split", "voided"],"payment_method": ["cash", "bank_transfer", "other"],"payment_record_kind": ["receipt", "refund"],"payment_status": ["unpaid", "partial", "paid"],"period_status": ["open", "closed"],"purchase_method": ["store", "visit", "delivery", "other"],"rounding_mode": ["floor", "round", "ceil"],"sale_expense_type": ["fee", "shipping", "other"],"sale_kind": ["sale", "return"],"sale_status": ["confirmed", "cancelled"],"sales_channel": ["store", "dealer", "auction", "ec", "other"],"tax_basis": ["incl", "excl"],"tax_category": ["standard_10", "reduced_8", "exempt", "non_taxable", "tax_free_export"],"user_role": ["owner", "admin", "staff"]
          }
        }
} as const
