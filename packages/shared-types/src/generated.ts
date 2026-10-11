export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          apartment: string | null
          building: string | null
          contact_phone: string | null
          created_at: string
          customer_id: string
          entrance: string | null
          floor: string | null
          geo: unknown
          id: string
          intercom_code: string | null
          is_default: boolean
          label: string | null
          lat: number | null
          lng: number | null
          notes: string | null
          sector: string | null
          street_address: string
        }
        Insert: {
          apartment?: string | null
          building?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id: string
          entrance?: string | null
          floor?: string | null
          geo?: unknown
          id?: string
          intercom_code?: string | null
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          sector?: string | null
          street_address: string
        }
        Update: {
          apartment?: string | null
          building?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string
          entrance?: string | null
          floor?: string | null
          geo?: unknown
          id?: string
          intercom_code?: string | null
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          sector?: string | null
          street_address?: string
        }
        Relationships: []
      }
      cash_policy: {
        Row: {
          cap_mdl: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          new_courier_cap_mdl: number
          new_courier_days: number
          note: string | null
          offload_channel_text: string
          reactivation_threshold_mdl: number
        }
        Insert: {
          cap_mdl: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          new_courier_cap_mdl?: number
          new_courier_days?: number
          note?: string | null
          offload_channel_text: string
          reactivation_threshold_mdl: number
        }
        Update: {
          cap_mdl?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          new_courier_cap_mdl?: number
          new_courier_days?: number
          note?: string | null
          offload_channel_text?: string
          reactivation_threshold_mdl?: number
        }
        Relationships: []
      }
      catering_details: {
        Row: {
          contact_person: string
          contact_phone: string
          created_at: string
          event_address_text: string
          event_date: string
          event_time: string | null
          guest_count: number
          order_id: string
          quote_status: string
          quoted_total_mdl: number | null
          restaurant_notes: string | null
        }
        Insert: {
          contact_person: string
          contact_phone: string
          created_at?: string
          event_address_text: string
          event_date: string
          event_time?: string | null
          guest_count: number
          order_id: string
          quote_status?: string
          quoted_total_mdl?: number | null
          restaurant_notes?: string | null
        }
        Update: {
          contact_person?: string
          contact_phone?: string
          created_at?: string
          event_address_text?: string
          event_date?: string
          event_time?: string | null
          guest_count?: number
          order_id?: string
          quote_status?: string
          quoted_total_mdl?: number | null
          restaurant_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_cash_movements: {
        Row: {
          amount_mdl: number
          courier_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          order_id: string | null
        }
        Insert: {
          amount_mdl: number
          courier_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          order_id?: string | null
        }
        Update: {
          amount_mdl?: number
          courier_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_cash_movements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_cash_movements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "courier_cash_movements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "courier_cash_movements_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_cash_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_locations: {
        Row: {
          accuracy_m: number | null
          courier_id: string
          geo: unknown
          is_plausible: boolean
          lat: number
          lng: number
          updated_at: string
        }
        Insert: {
          accuracy_m?: number | null
          courier_id: string
          geo?: unknown
          is_plausible?: boolean
          lat: number
          lng: number
          updated_at?: string
        }
        Update: {
          accuracy_m?: number | null
          courier_id?: string
          geo?: unknown
          is_plausible?: boolean
          lat?: number
          lng?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "courier_locations_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_satisfaction_surveys: {
        Row: {
          comment: string | null
          courier_id: string
          created_at: string
          id: string
          stars: number
          week_start: string
        }
        Insert: {
          comment?: string | null
          courier_id: string
          created_at?: string
          id?: string
          stars: number
          week_start: string
        }
        Update: {
          comment?: string | null
          courier_id?: string
          created_at?: string
          id?: string
          stars?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_satisfaction_surveys_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_satisfaction_surveys_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_satisfaction_surveys_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "courier_satisfaction_surveys_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "courier_satisfaction_surveys_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_shifts: {
        Row: {
          courier_id: string
          created_at: string
          ended_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          courier_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Update: {
          courier_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_shifts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_shifts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_shifts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "courier_shifts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "courier_shifts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_suspensions: {
        Row: {
          appeal_deadline: string
          courier_id: string
          decided_at: string
          decided_by: string
          id: string
          reason: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          appeal_deadline: string
          courier_id: string
          decided_at?: string
          decided_by: string
          id?: string
          reason: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          appeal_deadline?: string
          courier_id?: string
          decided_at?: string
          decided_by?: string
          id?: string
          reason?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_suspensions_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "courier_suspensions_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_suspensions_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "courier_suspensions_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "courier_suspensions_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_tariff_config: {
        Row: {
          base_mdl: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
          per_km_mdl: number
          wait_grace_minutes: number
          wait_per_min_mdl: number
          weather_surcharge_mdl: number
        }
        Insert: {
          base_mdl: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
          per_km_mdl: number
          wait_grace_minutes?: number
          wait_per_min_mdl: number
          weather_surcharge_mdl?: number
        }
        Update: {
          base_mdl?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
          per_km_mdl?: number
          wait_grace_minutes?: number
          wait_per_min_mdl?: number
          weather_surcharge_mdl?: number
        }
        Relationships: []
      }
      couriers: {
        Row: {
          consecutive_ignored_offers: number
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string
          rating_avg: number | null
          rating_count: number
          referral_code: string
          referred_by: string | null
          status: string
          updated_at: string
          user_id: string
          vehicle_type: string
        }
        Insert: {
          consecutive_ignored_offers?: number
          created_at?: string
          full_name: string
          id?: string
          is_active?: boolean
          phone: string
          rating_avg?: number | null
          rating_count?: number
          referral_code?: string
          referred_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vehicle_type: string
        }
        Update: {
          consecutive_ignored_offers?: number
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string
          rating_avg?: number | null
          rating_count?: number
          referral_code?: string
          referred_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "couriers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "couriers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couriers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "couriers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "couriers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_status_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: string
        }
        Insert: {
          actor_id?: string | null
          actor_role: string
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          expo_token: string
          id: string
          last_seen_at: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expo_token: string
          id?: string
          last_seen_at?: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          expo_token?: string
          id?: string
          last_seen_at?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      dispatch_errors: {
        Row: {
          count: number
          error_code: string
          first_at: string
          last_at: string
          message: string
          order_id: string
          phase: string
        }
        Insert: {
          count?: number
          error_code: string
          first_at?: string
          last_at?: string
          message: string
          order_id: string
          phase: string
        }
        Update: {
          count?: number
          error_code?: string
          first_at?: string
          last_at?: string
          message?: string
          order_id?: string
          phase?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_offers: {
        Row: {
          courier_id: string
          created_at: string
          distance_km: number | null
          expires_at: string
          id: string
          offered_at: string
          order_id: string
          responded_at: string | null
          score: number
          status: string
          wave: number
        }
        Insert: {
          courier_id: string
          created_at?: string
          distance_km?: number | null
          expires_at: string
          id?: string
          offered_at?: string
          order_id: string
          responded_at?: string | null
          score: number
          status?: string
          wave?: number
        }
        Update: {
          courier_id?: string
          created_at?: string
          distance_km?: number | null
          expires_at?: string
          id?: string
          offered_at?: string
          order_id?: string
          responded_at?: string | null
          score?: number
          status?: string
          wave?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "dispatch_offers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "dispatch_offers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "dispatch_offers_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_scoring_config: {
        Row: {
          alpha0: number
          alpha1: number
          alpha2: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
        }
        Insert: {
          alpha0?: number
          alpha1?: number
          alpha2?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
        }
        Update: {
          alpha0?: number
          alpha1?: number
          alpha2?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          customer_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          courier_id: string
          created_at: string
          detail: Json
          id: string
          kind: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          courier_id: string
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          courier_id?: string
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fraud_flags_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "fraud_flags_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "fraud_flags_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "fraud_flags_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          courier_id: string
          created_at: string
          dist_m: number
          id: string
          kind: string
          lat: number
          lng: number
          order_id: string
        }
        Insert: {
          courier_id: string
          created_at?: string
          dist_m: number
          id?: string
          kind: string
          lat: number
          lng: number
          order_id: string
        }
        Update: {
          courier_id?: string
          created_at?: string
          dist_m?: number
          id?: string
          kind?: string
          lat?: number
          lng?: number
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "geofence_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "geofence_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "geofence_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          application_id: string
          created_at: string
          doc_type: string
          id: string
          storage_path: string
        }
        Insert: {
          application_id: string
          created_at?: string
          doc_type: string
          id?: string
          storage_path: string
        }
        Update: {
          application_id?: string
          created_at?: string
          doc_type?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "onboarding_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string | null
          catering_min_qty: number | null
          created_at: string
          description: string | null
          id: string
          is_available: boolean
          is_catering_only: boolean
          name: string
          photo_url: string | null
          price_mdl: number
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          catering_min_qty?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_catering_only?: boolean
          name: string
          photo_url?: string | null
          price_mdl: number
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          catering_min_qty?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_catering_only?: boolean
          name?: string
          photo_url?: string | null
          price_mdl?: number
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_option_groups: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          max_select: number
          menu_item_id: string
          min_select: number
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_select?: number
          menu_item_id: string
          min_select?: number
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_select?: number
          menu_item_id?: string
          min_select?: number
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_option_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          name: string
          price_delta_mdl: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          name: string
          price_delta_mdl?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          name?: string
          price_delta_mdl?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "menu_option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          body: string
          claimed_at: string | null
          created_at: string
          id: string
          sent_at: string | null
          tag: string | null
          title: string
          url: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          sent_at?: string | null
          tag?: string | null
          title: string
          url?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          sent_at?: string | null
          tag?: string | null
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_applications: {
        Row: {
          applicant_type: string
          created_at: string
          details: Json
          email: string | null
          full_name: string
          id: string
          phone: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          applicant_type: string
          created_at?: string
          details?: Json
          email?: string | null
          full_name: string
          id?: string
          phone: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          applicant_type?: string
          created_at?: string
          details?: Json
          email?: string | null
          full_name?: string
          id?: string
          phone?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          item_name_snapshot: string
          line_total_mdl: number
          menu_item_id: string | null
          notes: string | null
          order_id: string
          quantity: number
          selected_options: Json
          unit_price_mdl: number
        }
        Insert: {
          id?: string
          item_name_snapshot: string
          line_total_mdl: number
          menu_item_id?: string | null
          notes?: string | null
          order_id: string
          quantity: number
          selected_options?: Json
          unit_price_mdl: number
        }
        Update: {
          id?: string
          item_name_snapshot?: string
          line_total_mdl?: number
          menu_item_id?: string | null
          notes?: string | null
          order_id?: string
          quantity?: number
          selected_options?: Json
          unit_price_mdl?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancellation_reason: string | null
          courier_arrived_restaurant_at: string | null
          courier_fee_mdl: number | null
          courier_fee_quoted_mdl: number | null
          courier_fee_surcharge_mdl: number | null
          courier_id: string | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivery_address_id: string | null
          delivery_fee_mdl: number
          estimated_ready_at: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          order_number: string
          order_type: string
          payment_method: string
          payment_status: string
          pod_photo_path: string | null
          prep_time_override_minutes: number | null
          requested_for: string | null
          restaurant_id: string
          status: string
          subtotal_mdl: number
          tip_mdl: number
          total_mdl: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          courier_arrived_restaurant_at?: string | null
          courier_fee_mdl?: number | null
          courier_fee_quoted_mdl?: number | null
          courier_fee_surcharge_mdl?: number | null
          courier_id?: string | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_fee_mdl?: number
          estimated_ready_at?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_number?: string
          order_type: string
          payment_method: string
          payment_status?: string
          pod_photo_path?: string | null
          prep_time_override_minutes?: number | null
          requested_for?: string | null
          restaurant_id: string
          status?: string
          subtotal_mdl?: number
          tip_mdl?: number
          total_mdl?: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          courier_arrived_restaurant_at?: string | null
          courier_fee_mdl?: number | null
          courier_fee_quoted_mdl?: number | null
          courier_fee_surcharge_mdl?: number | null
          courier_id?: string | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_fee_mdl?: number
          estimated_ready_at?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_number?: string
          order_type?: string
          payment_method?: string
          payment_status?: string
          pod_photo_path?: string | null
          prep_time_override_minutes?: number | null
          requested_for?: string | null
          restaurant_id?: string
          status?: string
          subtotal_mdl?: number
          tip_mdl?: number
          total_mdl?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_address_id_fkey"
            columns: ["delivery_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount_mdl: number
          created_at: string
          id: string
          order_id: string
          provider: string
          provider_ref: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_mdl: number
          created_at?: string
          id?: string
          order_id: string
          provider?: string
          provider_ref?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_mdl?: number
          created_at?: string
          id?: string
          order_id?: string
          provider?: string
          provider_ref?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_accounts: {
        Row: {
          holder_name: string
          iban: string
          recipient_id: string
          recipient_type: string
          updated_at: string
        }
        Insert: {
          holder_name: string
          iban: string
          recipient_id: string
          recipient_type: string
          updated_at?: string
        }
        Update: {
          holder_name?: string
          iban?: string
          recipient_id?: string
          recipient_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      payout_orders: {
        Row: {
          gross_mdl: number
          net_mdl: number
          order_id: string
          payout_id: string
          recipient_type: string
          reversed_at: string | null
        }
        Insert: {
          gross_mdl?: number
          net_mdl?: number
          order_id: string
          payout_id: string
          recipient_type: string
          reversed_at?: string | null
        }
        Update: {
          gross_mdl?: number
          net_mdl?: number
          order_id?: string
          payout_id?: string
          recipient_type?: string
          reversed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          commission_mdl: number
          created_at: string
          gross_mdl: number
          id: string
          net_mdl: number
          orders_count: number
          paid_at: string | null
          period_end: string
          period_start: string
          recipient_id: string
          recipient_type: string
          status: string
        }
        Insert: {
          commission_mdl?: number
          created_at?: string
          gross_mdl?: number
          id?: string
          net_mdl?: number
          orders_count?: number
          paid_at?: string | null
          period_end: string
          period_start: string
          recipient_id: string
          recipient_type: string
          status?: string
        }
        Update: {
          commission_mdl?: number
          created_at?: string
          gross_mdl?: number
          id?: string
          net_mdl?: number
          orders_count?: number
          paid_at?: string | null
          period_end?: string
          period_start?: string
          recipient_id?: string
          recipient_type?: string
          status?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          avoidable_wait_grace_minutes: number
          courier_commission_pct: number
          id: boolean
          restaurant_commission_pct: number
          updated_at: string
        }
        Insert: {
          avoidable_wait_grace_minutes?: number
          courier_commission_pct?: number
          id?: boolean
          restaurant_commission_pct?: number
          updated_at?: string
        }
        Update: {
          avoidable_wait_grace_minutes?: number
          courier_commission_pct?: number
          id?: boolean
          restaurant_commission_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_config: {
        Row: {
          courier_commission_pct: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
          restaurant_commission_pct: number
          tip_max_mdl: number
        }
        Insert: {
          courier_commission_pct: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
          restaurant_commission_pct: number
          tip_max_mdl?: number
        }
        Update: {
          courier_commission_pct?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          note?: string | null
          restaurant_commission_pct?: number
          tip_max_mdl?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          phone?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          courier_id: string | null
          created_at: string
          customer_id: string
          id: string
          order_id: string
          restaurant_id: string | null
          stars: number
          target_type: string
        }
        Insert: {
          comment?: string | null
          courier_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          order_id: string
          restaurant_id?: string | null
          stars: number
          target_type: string
        }
        Update: {
          comment?: string | null
          courier_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          order_id?: string
          restaurant_id?: string | null
          stars?: number
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "ratings_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "ratings_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "ratings_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_hours: {
        Row: {
          closes_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          opens_at: string
          restaurant_id: string
        }
        Insert: {
          closes_at: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          opens_at: string
          restaurant_id: string
        }
        Update: {
          closes_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          opens_at?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_prep_stats: {
        Row: {
          avg_prep_minutes: number
          hour_of_day: number
          p90_prep_minutes: number
          restaurant_id: string
          sample_count: number
          updated_at: string
        }
        Insert: {
          avg_prep_minutes: number
          hour_of_day: number
          p90_prep_minutes: number
          restaurant_id: string
          sample_count: number
          updated_at?: string
        }
        Update: {
          avg_prep_minutes?: number
          hour_of_day?: number
          p90_prep_minutes?: number
          restaurant_id?: string
          sample_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_prep_stats_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_prep_stats_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_prep_stats_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_prep_stats_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_prep_stats_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_staff: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          accept_sla_minutes: number
          accepting_orders: boolean
          accepts_catering: boolean
          address: string
          avg_prep_minutes: number
          busy_extra_minutes: number
          busy_until: string | null
          catering_min_amount_mdl: number | null
          cover_photo_url: string | null
          created_at: string
          cuisine_type: string
          delivery_fee_mdl: number
          description: string | null
          geo: unknown
          id: string
          is_active: boolean
          lat: number | null
          lng: number | null
          logo_url: string | null
          min_order_amount_mdl: number
          name: string
          phone: string
          rating_avg: number | null
          rating_count: number
          sector: string | null
          slug: string
          updated_at: string
          venue_type: string
        }
        Insert: {
          accept_sla_minutes?: number
          accepting_orders?: boolean
          accepts_catering?: boolean
          address: string
          avg_prep_minutes?: number
          busy_extra_minutes?: number
          busy_until?: string | null
          catering_min_amount_mdl?: number | null
          cover_photo_url?: string | null
          created_at?: string
          cuisine_type: string
          delivery_fee_mdl?: number
          description?: string | null
          geo?: unknown
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          min_order_amount_mdl?: number
          name: string
          phone: string
          rating_avg?: number | null
          rating_count?: number
          sector?: string | null
          slug: string
          updated_at?: string
          venue_type?: string
        }
        Update: {
          accept_sla_minutes?: number
          accepting_orders?: boolean
          accepts_catering?: boolean
          address?: string
          avg_prep_minutes?: number
          busy_extra_minutes?: number
          busy_until?: string | null
          catering_min_amount_mdl?: number | null
          cover_photo_url?: string | null
          created_at?: string
          cuisine_type?: string
          delivery_fee_mdl?: number
          description?: string | null
          geo?: unknown
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          min_order_amount_mdl?: number
          name?: string
          phone?: string
          rating_avg?: number | null
          rating_count?: number
          sector?: string | null
          slug?: string
          updated_at?: string
          venue_type?: string
        }
        Relationships: []
      }
      venue_bookings: {
        Row: {
          contact_person: string | null
          contact_phone: string | null
          created_at: string
          customer_id: string
          decline_reason: string | null
          ends_at: string
          id: string
          notes: string | null
          party_size: number
          purpose: string
          quoted_price_mdl: number | null
          starts_at: string
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id: string
          decline_reason?: string | null
          ends_at: string
          id?: string
          notes?: string | null
          party_size: number
          purpose: string
          quoted_price_mdl?: number | null
          starts_at: string
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string
          decline_reason?: string | null
          ends_at?: string
          id?: string
          notes?: string | null
          party_size?: number
          purpose?: string
          quoted_price_mdl?: number | null
          starts_at?: string
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      view_as_sessions: {
        Row: {
          admin_id: string
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          started_at: string
          target_app: string
          target_user_id: string
        }
        Insert: {
          admin_id: string
          ended_at?: string | null
          expires_at: string
          id?: string
          reason: string
          started_at?: string
          target_app: string
          target_user_id: string
        }
        Update: {
          admin_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          reason?: string
          started_at?: string
          target_app?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "view_as_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_as_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_as_sessions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_as_sessions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_courier_pilot_kpis: {
        Row: {
          avg_orders_per_shift_14d: number | null
          courier_id: string | null
          empty_shifts_14d: number | null
          full_name: string | null
          is_active: boolean | null
          median_gross_per_shift_14d: number | null
          satisfaction_avg_4w: number | null
          satisfaction_responses_4w: number | null
          shifts_14d: number | null
        }
        Relationships: []
      }
      admin_customers: {
        Row: {
          cancelled_orders: number | null
          created_at: string | null
          delivered_orders: number | null
          full_name: string | null
          id: string | null
          last_order_at: string | null
          phone: string | null
          spent_mdl: number | null
          total_orders: number | null
        }
        Relationships: []
      }
      admin_dispatch_metrics: {
        Row: {
          decline_cascade_depth_avg: number | null
          first_offer_acceptance_rate: number | null
          restaurant_handover_avg_seconds: number | null
          time_to_assign_avg_seconds: number | null
          total_delivery_avg_minutes: number | null
          total_delivery_median_minutes: number | null
          total_delivery_orders: number | null
          unfinished_order_rate: number | null
        }
        Relationships: []
      }
      admin_fleet_status: {
        Row: {
          active_order_id: string | null
          active_order_number: string | null
          active_order_status: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          lat: number | null
          lng: number | null
          location_stale: boolean | null
          location_updated_at: string | null
          phone: string | null
          status: string | null
          vehicle_type: string | null
        }
        Relationships: []
      }
      admin_low_ratings: {
        Row: {
          comment: string | null
          courier_name: string | null
          created_at: string | null
          id: string | null
          order_id: string | null
          order_number: string | null
          restaurant_name: string | null
          stars: number | null
          target_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["active_order_id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_order_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_payment_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_stuck_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_unpaid_delivered_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_order_board: {
        Row: {
          accept_sla_minutes: number | null
          avg_prep_minutes: number | null
          courier_arrived_restaurant_at: string | null
          courier_id: string | null
          courier_name: string | null
          courier_status: string | null
          created_at: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          id: string | null
          in_state_seconds: number | null
          in_state_since: string | null
          notes: string | null
          order_number: string | null
          order_type: string | null
          payment_method: string | null
          payment_status: string | null
          restaurant_id: string | null
          restaurant_name: string | null
          sector: string | null
          status: string | null
          street_address: string | null
          total_mdl: number | null
          wait_seconds_since_arrival: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_payment_queue: {
        Row: {
          cancellation_reason: string | null
          courier_name: string | null
          created_at: string | null
          id: string | null
          order_number: string | null
          payment_method: string | null
          payment_status: string | null
          restaurant_name: string | null
          status: string | null
          total_mdl: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      admin_referral_progress: {
        Row: {
          delivered_30d: number | null
          qualified: boolean | null
          referral_code: string | null
          referred_id: string | null
          referred_joined_at: string | null
          referred_name: string | null
          referrer_id: string | null
          referrer_name: string | null
          window_closed: boolean | null
        }
        Relationships: []
      }
      admin_restaurant_kpis: {
        Row: {
          accept_sla_minutes: number | null
          acceptance_rate_7d: number | null
          accepted_7d: number | null
          accepting_orders: boolean | null
          auto_cancelled_7d: number | null
          avg_accept_minutes_7d: number | null
          id: string | null
          is_active: boolean | null
          name: string | null
          orders_7d: number | null
          rejected_7d: number | null
        }
        Relationships: []
      }
      admin_stuck_orders: {
        Row: {
          accept_sla_minutes: number | null
          avg_prep_minutes: number | null
          courier_id: string | null
          courier_name: string | null
          courier_status: string | null
          created_at: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          id: string | null
          in_state_seconds: number | null
          in_state_since: string | null
          notes: string | null
          order_number: string | null
          order_type: string | null
          payment_method: string | null
          payment_status: string | null
          restaurant_id: string | null
          restaurant_name: string | null
          sector: string | null
          status: string | null
          street_address: string | null
          stuck_reason: string | null
          total_mdl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_courier_pilot_kpis"
            referencedColumns: ["courier_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_fleet_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referred_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "admin_referral_progress"
            referencedColumns: ["referrer_id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_unpaid_delivered_orders: {
        Row: {
          courier_covered: boolean | null
          courier_due_mdl: number | null
          courier_name: string | null
          days_since: number | null
          delivered_at: string | null
          id: string | null
          order_number: string | null
          restaurant_covered: boolean | null
          restaurant_name: string | null
        }
        Relationships: []
      }
      admin_wait_metrics: {
        Row: {
          avg_wait_minutes_7d: number | null
          avoidable_wait_orders_7d: number | null
        }
        Relationships: []
      }
      restaurant_analytics_daily: {
        Row: {
          day: string | null
          orders_count: number | null
          restaurant_id: string | null
          revenue_mdl: number | null
        }
        Relationships: []
      }
      restaurant_analytics_hourly: {
        Row: {
          hour_of_day: number | null
          orders_count: number | null
          restaurant_id: string | null
          revenue_mdl: number | null
        }
        Relationships: []
      }
      restaurant_top_items: {
        Row: {
          item_name: string | null
          qty: number | null
          restaurant_id: string | null
          revenue_mdl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "admin_restaurant_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_daily"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_analytics_hourly"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_wait_kpis"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_wait_kpis: {
        Row: {
          avg_courier_wait_minutes: number | null
          avoidable_wait_grace_minutes: number | null
          avoidable_wait_orders: number | null
          prep_accuracy_avg_minutes: number | null
          prep_accuracy_orders: number | null
          reject_rate_pct: number | null
          restaurant_id: string | null
          restaurant_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_dispatch_offer: {
        Args: { p_offer_id: string }
        Returns: undefined
      }
      accept_order: { Args: { p_order_id: string }; Returns: undefined }
      add_kyc_document: {
        Args: {
          p_application_id: string
          p_doc_type: string
          p_storage_path: string
        }
        Returns: undefined
      }
      admin_assign_courier: {
        Args: { p_new_courier_id: string; p_order_id: string }
        Returns: undefined
      }
      admin_courier_cash_status: {
        Args: { p_courier_id: string }
        Returns: {
          balance_mdl: number
          cap_mdl: number
          offload_channel_text: string
          reactivation_threshold_mdl: number
        }[]
      }
      admin_generate_payouts: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      admin_get_dispatch_scoring_config: {
        Args: never
        Returns: {
          alpha0: number
          alpha1: number
          alpha2: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
        }
        SetofOptions: {
          from: "*"
          to: "dispatch_scoring_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_mark_payout_paid: {
        Args: { p_payout_id: string }
        Returns: undefined
      }
      admin_pilot_go_no_go: {
        Args: never
        Returns: {
          kpi: string
          status: string
          target_text: string
          value_text: string
        }[]
      }
      admin_pilot_go_no_go_surge_pct: { Args: never; Returns: number }
      admin_reassign_courier: {
        Args: { p_new_courier_id: string; p_order_id: string }
        Returns: undefined
      }
      admin_scaling_triggers: {
        Args: never
        Returns: {
          armed: boolean
          current_value: string
          threshold_text: string
          trigger_name: string
        }[]
      }
      admin_update_payment_status: {
        Args: { p_new_status: string; p_note?: string; p_order_id: string }
        Returns: undefined
      }
      advance_delivery_status: {
        Args: {
          p_new_status: string
          p_order_id: string
          p_payment_confirmed?: boolean
        }
        Returns: undefined
      }
      assign_courier: { Args: { p_order_id: string }; Returns: undefined }
      attach_delivery_proof: {
        Args: { p_order_id: string; p_path: string }
        Returns: undefined
      }
      cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_venue_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      claim_notification_outbox: {
        Args: { p_batch?: number }
        Returns: {
          attempts: number
          body: string
          claimed_at: string | null
          created_at: string
          id: string
          sent_at: string | null
          tag: string | null
          title: string
          url: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_stale_courier_shifts: { Args: never; Returns: number }
      confirm_catering_quote: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      confirm_online_payment: {
        Args: {
          p_intent_id: string
          p_provider_ref?: string
          p_success: boolean
        }
        Returns: undefined
      }
      confirm_venue_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      courier_arrived_at_restaurant: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      courier_cash_balance: { Args: { p_courier_id: string }; Returns: number }
      courier_dispatch_distance_m: {
        Args: { p_courier_id: string; p_restaurant_id: string }
        Returns: number
      }
      courier_has_capacity: { Args: { p_courier_id: string }; Returns: boolean }
      courier_is_assigned_to_address: {
        Args: { target_address: string }
        Returns: boolean
      }
      current_avoidable_wait_grace_minutes: { Args: never; Returns: number }
      current_cash_policy: {
        Args: never
        Returns: {
          cap_mdl: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          new_courier_cap_mdl: number
          new_courier_days: number
          note: string | null
          offload_channel_text: string
          reactivation_threshold_mdl: number
        }
        SetofOptions: {
          from: "*"
          to: "cash_policy"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_courier_id: { Args: never; Returns: string }
      current_courier_tariff: {
        Args: never
        Returns: {
          base_mdl: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
          per_km_mdl: number
          wait_grace_minutes: number
          wait_per_min_mdl: number
          weather_surcharge_mdl: number
        }
        SetofOptions: {
          from: "*"
          to: "courier_tariff_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_dispatch_scoring_config: {
        Args: never
        Returns: {
          alpha0: number
          alpha1: number
          alpha2: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
        }
        SetofOptions: {
          from: "*"
          to: "dispatch_scoring_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_pricing_config: {
        Args: never
        Returns: {
          courier_commission_pct: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
          restaurant_commission_pct: number
          tip_max_mdl: number
        }
        SetofOptions: {
          from: "*"
          to: "pricing_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_has_active_order_with_courier: {
        Args: { target_courier: string }
        Returns: boolean
      }
      customer_has_order_with_courier: {
        Args: { target_courier: string }
        Returns: boolean
      }
      customer_sees_courier_point: {
        Args: { point_at: string; target_courier: string }
        Returns: boolean
      }
      decline_catering_quote: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      decline_dispatch_offer: {
        Args: { p_offer_id: string }
        Returns: undefined
      }
      decline_venue_booking: {
        Args: { p_booking_id: string; p_reason: string }
        Returns: undefined
      }
      dispatch_order: { Args: { p_order_id: string }; Returns: string }
      effective_cash_cap: { Args: { p_courier_id: string }; Returns: number }
      end_view_as: { Args: { p_session: string }; Returns: undefined }
      erase_customer_pii: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      expire_dispatch_offers: { Args: never; Returns: number }
      expire_stale_orders: { Args: never; Returns: number }
      generate_order_number: { Args: never; Returns: string }
      generate_payouts_internal: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      generate_weekly_payouts: { Args: { p_now?: string }; Returns: number }
      get_courier_cash_status: {
        Args: never
        Returns: {
          balance_mdl: number
          cap_mdl: number
          offload_channel_text: string
          reactivation_threshold_mdl: number
        }[]
      }
      get_prep_estimates: {
        Args: { p_restaurant_ids: string[] }
        Returns: {
          p90_prep_minutes: number
          prep_minutes: number
          restaurant_id: string
          sample_count: number
          source: string
        }[]
      }
      has_any_role: { Args: { roles: string[] }; Returns: boolean }
      has_restaurant_access: { Args: { target: string }; Returns: boolean }
      has_role: { Args: { required: string }; Returns: boolean }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_valid_iban: { Args: { p: string }; Returns: boolean }
      mark_ready_for_pickup: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      nearby_available_couriers: {
        Args: {
          p_limit?: number
          p_radius_km?: number
          p_restaurant_id: string
        }
        Returns: {
          courier_id: string
          distance_m: number
          located_at: string
        }[]
      }
      nearby_restaurants: {
        Args: {
          p_lat: number
          p_limit?: number
          p_lng: number
          p_radius_km?: number
        }
        Returns: {
          accepting_orders: boolean
          accepts_catering: boolean
          address: string
          avg_prep_minutes: number
          catering_min_amount_mdl: number
          cover_photo_url: string
          cuisine_type: string
          delivery_fee_mdl: number
          description: string
          distance_m: number
          id: string
          is_active: boolean
          lat: number
          lng: number
          logo_url: string
          min_order_amount_mdl: number
          name: string
          phone: string
          sector: string
          slug: string
        }[]
      }
      notify_venue_staff_or_admin: {
        Args: {
          p_body: string
          p_tag: string
          p_title: string
          p_url: string
          p_venue_id: string
        }
        Returns: undefined
      }
      offer_preview: {
        Args: { p_offer_id: string }
        Returns: {
          dropoff_sector: string
          pickup_km: number
          total_km: number
          trip_km: number
        }[]
      }
      order_courier_contact: {
        Args: { p_order_id: string }
        Returns: {
          first_name: string
          phone: string
        }[]
      }
      place_order: {
        Args: {
          p_catering?: Json
          p_delivery_address_id?: string
          p_idempotency_key?: string
          p_items: Json
          p_notes?: string
          p_order_type: string
          p_payment_method: string
          p_requested_for?: string
          p_restaurant_id: string
        }
        Returns: string
      }
      popular_hours: {
        Args: { p_restaurant_id: string }
        Returns: {
          hour_of_day: number
          intensity_pct: number
          orders_count: number
        }[]
      }
      pricing_config_at: {
        Args: { p_ts: string }
        Returns: {
          courier_commission_pct: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          note: string | null
          restaurant_commission_pct: number
          tip_max_mdl: number
        }
        SetofOptions: {
          from: "*"
          to: "pricing_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prune_notification_outbox: { Args: never; Returns: number }
      public_courier_tariff_history: {
        Args: never
        Returns: {
          base_mdl: number
          effective_from: string
          id: string
          note: string
          per_km_mdl: number
          wait_grace_minutes: number
          wait_per_min_mdl: number
          weather_surcharge_mdl: number
        }[]
      }
      public_pricing_history: {
        Args: never
        Returns: {
          courier_pct: number
          effective_from: string
          id: string
          note: string
          restaurant_pct: number
        }[]
      }
      purge_expired_pii: { Args: never; Returns: undefined }
      quote_venue_booking: {
        Args: { p_booking_id: string; p_price_mdl: number }
        Returns: undefined
      }
      rating_breakdown: {
        Args: { p_restaurant_id: string }
        Returns: {
          rating_count: number
          stars: number
          total_ratings: number
        }[]
      }
      reconcile_cash_ledger: { Args: never; Returns: undefined }
      record_cash_offload: {
        Args: { p_amount_mdl: number; p_courier_id: string; p_note?: string }
        Returns: string
      }
      record_geofence_event: {
        Args: {
          p_kind: string
          p_lat: number
          p_lng: number
          p_order_id: string
        }
        Returns: undefined
      }
      refresh_prep_stats: { Args: never; Returns: number }
      register_device_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      reinstate_courier: {
        Args: { p_courier_id: string; p_note?: string }
        Returns: undefined
      }
      reject_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      request_venue_booking: {
        Args: {
          p_contact_person: string
          p_contact_phone: string
          p_ends_at: string
          p_notes?: string
          p_party_size: number
          p_purpose: string
          p_starts_at: string
          p_venue_id: string
        }
        Returns: string
      }
      restaurant_cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      restaurant_has_active_order_with_courier: {
        Args: { target_courier: string }
        Returns: boolean
      }
      restaurant_open_at: {
        Args: { p_at: string; p_restaurant_id: string }
        Returns: boolean
      }
      restaurant_sees_courier_point: {
        Args: { point_at: string; target_courier: string }
        Returns: boolean
      }
      review_onboarding_application: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: undefined
      }
      search_menu_items: {
        Args: { p_query: string }
        Returns: {
          cuisine_type: string
          item_description: string
          item_id: string
          item_name: string
          photo_url: string
          price_mdl: number
          restaurant_id: string
          restaurant_name: string
          restaurant_slug: string
        }[]
      }
      set_cash_policy: {
        Args: {
          p_cap_mdl: number
          p_effective_from?: string
          p_new_courier_cap_mdl?: number
          p_new_courier_days?: number
          p_note?: string
          p_offload_text: string
          p_reactivation_mdl: number
        }
        Returns: string
      }
      set_courier_online_status: {
        Args: { p_status: string }
        Returns: undefined
      }
      set_courier_referrer: {
        Args: { p_courier_id: string; p_referrer_code: string }
        Returns: undefined
      }
      set_courier_tariff: {
        Args: {
          p_base_mdl: number
          p_effective_from?: string
          p_note?: string
          p_per_km_mdl: number
          p_wait_grace_minutes?: number
          p_wait_per_min_mdl: number
          p_weather_surcharge_mdl?: number
        }
        Returns: string
      }
      set_dispatch_scoring_config: {
        Args: {
          p_alpha0: number
          p_alpha1: number
          p_alpha2?: number
          p_effective_from?: string
          p_note?: string
        }
        Returns: string
      }
      set_order_tip: {
        Args: { p_order_id: string; p_tip_mdl: number }
        Returns: undefined
      }
      set_payout_account: {
        Args: {
          p_holder_name: string
          p_iban: string
          p_recipient_id: string
          p_recipient_type: string
        }
        Returns: undefined
      }
      set_prep_time_estimate: {
        Args: { p_minutes: number; p_order_id: string }
        Returns: undefined
      }
      set_pricing_config: {
        Args: {
          p_courier_pct: number
          p_effective_from: string
          p_note?: string
          p_restaurant_pct: number
        }
        Returns: string
      }
      set_restaurant_busy: {
        Args: { p_extra_minutes: number; p_restaurant_id: string }
        Returns: undefined
      }
      start_online_payment: { Args: { p_order_id: string }; Returns: string }
      start_view_as: {
        Args: { p_app: string; p_reason: string; p_target: string }
        Returns: string
      }
      submit_catering_quote: {
        Args: { p_order_id: string; p_quoted_total_mdl: number }
        Returns: undefined
      }
      submit_courier_satisfaction: {
        Args: { p_comment?: string; p_stars: number }
        Returns: undefined
      }
      submit_onboarding_application: {
        Args: {
          p_details: Json
          p_email: string
          p_full_name: string
          p_phone: string
          p_type: string
        }
        Returns: string
      }
      submit_rating: {
        Args: {
          p_comment?: string
          p_order_id: string
          p_stars: number
          p_target: string
        }
        Returns: undefined
      }
      suspend_courier: {
        Args: { p_courier_id: string; p_reason: string }
        Returns: string
      }
      viewer_session_live: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

