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
      agent_relations: {
        Row: {
          agent_code: string | null
          bound_merchant_id: string | null
          created_at: string
          id: string
          is_agent: boolean
          upline_id: string | null
          upline_l2_id: string | null
          user_id: string
        }
        Insert: {
          agent_code?: string | null
          bound_merchant_id?: string | null
          created_at?: string
          id?: string
          is_agent?: boolean
          upline_id?: string | null
          upline_l2_id?: string | null
          user_id: string
        }
        Update: {
          agent_code?: string | null
          bound_merchant_id?: string | null
          created_at?: string
          id?: string
          is_agent?: boolean
          upline_id?: string | null
          upline_l2_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_relations_bound_merchant_id_fkey"
            columns: ["bound_merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_relations_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_relations_upline_l2_id_fkey"
            columns: ["upline_l2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          title: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          title: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          title?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      client_error_logs: {
        Row: {
          created_at: string
          error_code: string | null
          error_details: string | null
          error_hint: string | null
          error_message: string | null
          id: string
          op: string
          payload: Json | null
          scope: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_details?: string | null
          error_hint?: string | null
          error_message?: string | null
          id?: string
          op: string
          payload?: Json | null
          scope?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_details?: string | null
          error_hint?: string | null
          error_message?: string | null
          id?: string
          op?: string
          payload?: Json | null
          scope?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      commission_config: {
        Row: {
          id: string
          l1_rate: number
          l2_rate: number
          platform_rate: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          l1_rate?: number
          l2_rate?: number
          platform_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          l1_rate?: number
          l2_rate?: number
          platform_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      commission_records: {
        Row: {
          amount: number
          beneficiary_id: string
          created_at: string
          id: string
          level: number
          order_id: string
          rate: number
        }
        Insert: {
          amount: number
          beneficiary_id: string
          created_at?: string
          id?: string
          level: number
          order_id: string
          rate: number
        }
        Update: {
          amount?: number
          beneficiary_id?: string
          created_at?: string
          id?: string
          level?: number
          order_id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          contact: string | null
          content: string
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          contact?: string | null
          content: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          contact?: string | null
          content?: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lottery_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      merchant_applications: {
        Row: {
          created_at: string
          description: string | null
          fans_count: number | null
          id: string
          phone: string
          public_account: string | null
          real_name: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["merchant_status"]
          updated_at: string
          user_id: string
          wechat_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          fans_count?: number | null
          id?: string
          phone: string
          public_account?: string | null
          real_name: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["merchant_status"]
          updated_at?: string
          user_id: string
          wechat_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          fans_count?: number | null
          id?: string
          phone?: string
          public_account?: string | null
          real_name?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["merchant_status"]
          updated_at?: string
          user_id?: string
          wechat_id?: string | null
        }
        Relationships: []
      }
      merchants: {
        Row: {
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          fans_count: number | null
          id: string
          is_disabled: boolean
          payment_channel_id: string | null
          public_account: string | null
          real_name: string | null
          shop_avatar_url: string | null
          shop_description: string | null
          shop_name: string
          status: Database["public"]["Enums"]["merchant_status"]
          total_sales: number
          updated_at: string
          user_id: string
          wechat_id: string | null
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          fans_count?: number | null
          id?: string
          is_disabled?: boolean
          payment_channel_id?: string | null
          public_account?: string | null
          real_name?: string | null
          shop_avatar_url?: string | null
          shop_description?: string | null
          shop_name: string
          status?: Database["public"]["Enums"]["merchant_status"]
          total_sales?: number
          updated_at?: string
          user_id: string
          wechat_id?: string | null
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          fans_count?: number | null
          id?: string
          is_disabled?: boolean
          payment_channel_id?: string | null
          public_account?: string | null
          real_name?: string | null
          shop_avatar_url?: string | null
          shop_description?: string | null
          shop_name?: string
          status?: Database["public"]["Enums"]["merchant_status"]
          total_sales?: number
          updated_at?: string
          user_id?: string
          wechat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchants_payment_channel_id_fkey"
            columns: ["payment_channel_id"]
            isOneToOne: false
            referencedRelation: "payment_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          category: string
          content: string | null
          created_at: string
          id: string
          is_read: boolean
          read_at: string | null
          reference_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          content?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          reference_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          reference_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          agent_l1_id: string | null
          agent_l2_id: string | null
          amount: number
          buyer_id: string
          created_at: string
          id: string
          merchant_id: string
          paid_at: string | null
          product_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          agent_l1_id?: string | null
          agent_l2_id?: string | null
          amount: number
          buyer_id: string
          created_at?: string
          id?: string
          merchant_id: string
          paid_at?: string | null
          product_id: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          agent_l1_id?: string | null
          agent_l2_id?: string | null
          amount?: number
          buyer_id?: string
          created_at?: string
          id?: string
          merchant_id?: string
          paid_at?: string | null
          product_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_agent_l1_id_fkey"
            columns: ["agent_l1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_agent_l2_id_fkey"
            columns: ["agent_l2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_channels: {
        Row: {
          code: string
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          name: string
          provider: string
          remark: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          provider: string
          remark?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          provider?: string
          remark?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_history: {
        Row: {
          content: string
          created_at: string
          id: string
          issue_no: string
          product_id: string
          publish_at: string
          result: Database["public"]["Enums"]["product_result"]
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          issue_no: string
          product_id: string
          publish_at?: string
          result?: Database["public"]["Enums"]["product_result"]
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          issue_no?: string
          product_id?: string
          publish_at?: string
          result?: Database["public"]["Enums"]["product_result"]
        }
        Relationships: [
          {
            foreignKeyName: "product_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string
          created_at: string
          disclaimer: string | null
          id: string
          is_recommended: boolean
          issue_no: string
          merchant_id: string
          paid_content: string | null
          price: number
          publish_at: string
          result: Database["public"]["Enums"]["product_result"]
          result_note: string | null
          reveal_at: string | null
          sales_count: number
          status: Database["public"]["Enums"]["product_status"]
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          disclaimer?: string | null
          id?: string
          is_recommended?: boolean
          issue_no: string
          merchant_id: string
          paid_content?: string | null
          price?: number
          publish_at?: string
          result?: Database["public"]["Enums"]["product_result"]
          result_note?: string | null
          reveal_at?: string | null
          sales_count?: number
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          disclaimer?: string | null
          id?: string
          is_recommended?: boolean
          issue_no?: string
          merchant_id?: string
          paid_content?: string | null
          price?: number
          publish_at?: string
          result?: Database["public"]["Enums"]["product_result"]
          result_note?: string | null
          reveal_at?: string | null
          sales_count?: number
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "lottery_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          id: string
          is_disabled: boolean
          nickname: string | null
          phone: string | null
          referred_merchant_id: string | null
          referrer_id: string | null
          updated_at: string
          user_code: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          is_disabled?: boolean
          nickname?: string | null
          phone?: string | null
          referred_merchant_id?: string | null
          referrer_id?: string | null
          updated_at?: string
          user_code: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          is_disabled?: boolean
          nickname?: string | null
          phone?: string | null
          referred_merchant_id?: string | null
          referrer_id?: string | null
          updated_at?: string
          user_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          reference_id: string | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type?: Database["public"]["Enums"]["tx_type"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          total_commission: number
          total_recharge: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          total_commission?: number
          total_recharge?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          total_commission?: number
          total_recharge?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          account_info: string | null
          amount: number
          channel: string | null
          created_at: string
          id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["withdraw_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_info?: string | null
          amount: number
          channel?: string | null
          created_at?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdraw_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_info?: string | null
          amount?: number
          channel?: string | null
          created_at?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdraw_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_recharge_user: {
        Args: { _amount: number; _note?: string; _user_id: string }
        Returns: string
      }
      become_agent: { Args: never; Returns: string }
      become_agent_for_merchant: {
        Args: { _merchant_id: string }
        Returns: string
      }
      bind_referrer: { Args: { _agent_code: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_user_disabled: { Args: { _user_id: string }; Returns: boolean }
      mark_notifications_read: { Args: { _ids?: string[] }; Returns: number }
      purchase_product: { Args: { _product_id: string }; Returns: string }
      submit_withdraw: {
        Args: { _account_info: string; _amount: number; _channel: string }
        Returns: string
      }
      switch_agent_merchant: {
        Args: { _merchant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "buyer" | "agent" | "merchant" | "admin"
      merchant_status: "pending" | "approved" | "rejected" | "suspended"
      order_status: "pending" | "paid" | "refunded" | "cancelled"
      product_result: "pending" | "won" | "lost"
      product_status: "draft" | "published" | "unpublished"
      tx_type:
        | "recharge"
        | "purchase"
        | "commission"
        | "withdraw"
        | "refund"
        | "admin_adjust"
      withdraw_status: "pending" | "approved" | "rejected" | "paid"
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
  public: {
    Enums: {
      app_role: ["buyer", "agent", "merchant", "admin"],
      merchant_status: ["pending", "approved", "rejected", "suspended"],
      order_status: ["pending", "paid", "refunded", "cancelled"],
      product_result: ["pending", "won", "lost"],
      product_status: ["draft", "published", "unpublished"],
      tx_type: [
        "recharge",
        "purchase",
        "commission",
        "withdraw",
        "refund",
        "admin_adjust",
      ],
      withdraw_status: ["pending", "approved", "rejected", "paid"],
    },
  },
} as const
