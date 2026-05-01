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
      agent_transcripts: {
        Row: {
          agent: string
          audit_id: string
          content: string | null
          created_at: string
          data: Json | null
          id: string
          phase: string | null
          seq: number
          user_id: string
        }
        Insert: {
          agent: string
          audit_id: string
          content?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          phase?: string | null
          seq?: number
          user_id: string
        }
        Update: {
          agent?: string
          audit_id?: string
          content?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          phase?: string | null
          seq?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_transcripts_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      attack_paths: {
        Row: {
          audit_id: string
          blast_radius: Json | null
          created_at: string
          finding_ids: string[]
          graph: Json
          id: string
          narrative: string | null
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          audit_id: string
          blast_radius?: Json | null
          created_at?: string
          finding_ids?: string[]
          graph: Json
          id?: string
          narrative?: string | null
          severity: string
          title: string
          user_id: string
        }
        Update: {
          audit_id?: string
          blast_radius?: Json | null
          created_at?: string
          finding_ids?: string[]
          graph?: Json
          id?: string
          narrative?: string | null
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attack_paths_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          completed_at: string | null
          connection_id: string
          created_at: string
          error: string | null
          id: string
          scope: Json | null
          started_at: string
          status: string
          summary: Json | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          created_at?: string
          error?: string | null
          id?: string
          scope?: Json | null
          started_at?: string
          status?: string
          summary?: Json | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          error?: string | null
          id?: string
          scope?: Json | null
          started_at?: string
          status?: string
          summary?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audits_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "aws_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      aws_connections: {
        Row: {
          access_key_id: string | null
          account_label: string
          aws_account_id: string | null
          created_at: string
          default_region: string
          external_id: string | null
          id: string
          last_verified_at: string | null
          require_separate_approver: boolean
          role_arn: string | null
          secret_access_key: string | null
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          access_key_id?: string | null
          account_label: string
          aws_account_id?: string | null
          created_at?: string
          default_region?: string
          external_id?: string | null
          id?: string
          last_verified_at?: string | null
          require_separate_approver?: boolean
          role_arn?: string | null
          secret_access_key?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          access_key_id?: string | null
          account_label?: string
          aws_account_id?: string | null
          created_at?: string
          default_region?: string
          external_id?: string | null
          id?: string
          last_verified_at?: string | null
          require_separate_approver?: boolean
          role_arn?: string | null
          secret_access_key?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: []
      }
      findings: {
        Row: {
          audit_id: string
          check_id: string
          confidence: number
          created_at: string
          critic_reasoning: string | null
          critic_verdict: string | null
          description: string | null
          evidence: Json | null
          framework_refs: Json | null
          id: string
          region: string | null
          resource_arn: string | null
          service: string
          severity: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          audit_id: string
          check_id: string
          confidence?: number
          created_at?: string
          critic_reasoning?: string | null
          critic_verdict?: string | null
          description?: string | null
          evidence?: Json | null
          framework_refs?: Json | null
          id?: string
          region?: string | null
          resource_arn?: string | null
          service: string
          severity: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          audit_id?: string
          check_id?: string
          confidence?: number
          created_at?: string
          critic_reasoning?: string | null
          critic_verdict?: string | null
          description?: string | null
          evidence?: Json | null
          framework_refs?: Json | null
          id?: string
          region?: string | null
          resource_arn?: string | null
          service?: string
          severity?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
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
      remediation_events: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          after_state: Json | null
          api_call: string | null
          attack_node_id: string | null
          attack_path_id: string | null
          before_state: Json | null
          command: string | null
          created_at: string
          event_type: string
          finding_id: string | null
          id: string
          notes: string | null
          remediation_id: string
          user_id: string
          verification: Json | null
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          after_state?: Json | null
          api_call?: string | null
          attack_node_id?: string | null
          attack_path_id?: string | null
          before_state?: Json | null
          command?: string | null
          created_at?: string
          event_type: string
          finding_id?: string | null
          id?: string
          notes?: string | null
          remediation_id: string
          user_id: string
          verification?: Json | null
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          after_state?: Json | null
          api_call?: string | null
          attack_node_id?: string | null
          attack_path_id?: string | null
          before_state?: Json | null
          command?: string | null
          created_at?: string
          event_type?: string
          finding_id?: string | null
          id?: string
          notes?: string | null
          remediation_id?: string
          user_id?: string
          verification?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "remediation_events_remediation_id_fkey"
            columns: ["remediation_id"]
            isOneToOne: false
            referencedRelation: "remediations"
            referencedColumns: ["id"]
          },
        ]
      }
      remediations: {
        Row: {
          applied: boolean
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          attack_node_id: string | null
          attack_path_id: string | null
          aws_changes: Json | null
          aws_console_url: string | null
          created_at: string
          description: string | null
          executed_at: string | null
          executed_by: string | null
          executed_script: string | null
          execution_output: string | null
          execution_status: string
          finding_id: string
          fix_type: string
          id: string
          lifecycle_state: string
          proposer_thinking: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk: string
          rollback_reason: string | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          snippet: string
          title: string
          user_id: string
          verification_result: Json | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          applied?: boolean
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          attack_node_id?: string | null
          attack_path_id?: string | null
          aws_changes?: Json | null
          aws_console_url?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string | null
          executed_by?: string | null
          executed_script?: string | null
          execution_output?: string | null
          execution_status?: string
          finding_id: string
          fix_type: string
          id?: string
          lifecycle_state?: string
          proposer_thinking?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk?: string
          rollback_reason?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          snippet: string
          title: string
          user_id: string
          verification_result?: Json | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          applied?: boolean
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          attack_node_id?: string | null
          attack_path_id?: string | null
          aws_changes?: Json | null
          aws_console_url?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string | null
          executed_by?: string | null
          executed_script?: string | null
          execution_output?: string | null
          execution_status?: string
          finding_id?: string
          fix_type?: string
          id?: string
          lifecycle_state?: string
          proposer_thinking?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk?: string
          rollback_reason?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          snippet?: string
          title?: string
          user_id?: string
          verification_result?: Json | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remediations_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "findings"
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
