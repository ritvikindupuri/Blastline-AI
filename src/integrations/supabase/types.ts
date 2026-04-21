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
      agent_messages: {
        Row: {
          agent: string
          content: string | null
          created_at: string
          data: Json | null
          id: string
          role: string
          run_id: string
          seq: number
          user_id: string
        }
        Insert: {
          agent: string
          content?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          role?: string
          run_id: string
          seq?: number
          user_id: string
        }
        Update: {
          agent?: string
          content?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          role?: string
          run_id?: string
          seq?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "war_room_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          aws_account_label: string | null
          aws_region: string | null
          created_at: string
          id: string
          splunk_realm: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aws_account_label?: string | null
          aws_region?: string | null
          created_at?: string
          id?: string
          splunk_realm?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aws_account_label?: string | null
          aws_region?: string | null
          created_at?: string
          id?: string
          splunk_realm?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          created_at: string
          detector_name: string | null
          id: string
          raw: Json | null
          severity: string | null
          splunk_incident_id: string | null
          status: string | null
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          detector_name?: string | null
          id?: string
          raw?: Json | null
          severity?: string | null
          splunk_incident_id?: string | null
          status?: string | null
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          detector_name?: string | null
          id?: string
          raw?: Json | null
          severity?: string | null
          splunk_incident_id?: string | null
          status?: string | null
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      remediation_actions: {
        Row: {
          approved: boolean | null
          command: string | null
          command_type: string | null
          created_at: string
          description: string | null
          id: string
          risk: string | null
          run_id: string
          title: string
          user_id: string
        }
        Insert: {
          approved?: boolean | null
          command?: string | null
          command_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          risk?: string | null
          run_id: string
          title: string
          user_id: string
        }
        Update: {
          approved?: boolean | null
          command?: string | null
          command_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          risk?: string | null
          run_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remediation_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "war_room_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      war_room_runs: {
        Row: {
          completed_at: string | null
          final_report: Json | null
          id: string
          incident_id: string | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          final_report?: Json | null
          id?: string
          incident_id?: string | null
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          final_report?: Json | null
          id?: string
          incident_id?: string | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "war_room_runs_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
