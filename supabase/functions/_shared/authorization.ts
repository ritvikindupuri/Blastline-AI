/**
 * Server-side authorization utilities
 * Verifies resource ownership and org/role access
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuthContext {
  user_id: string;
  email?: string;
}

/**
 * Verify user owns the specified resource
 * @param client - Supabase admin client
 * @param table - Table name (e.g., "audits", "aws_connections")
 * @param resourceId - Resource ID to check
 * @param userId - User ID claiming ownership
 * @returns true if user owns resource, false otherwise
 */
export async function verifyResourceOwnership(
  client: SupabaseClient,
  table: string,
  resourceId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from(table)
    .select("user_id")
    .eq("id", resourceId)
    .single();
  
  if (error || !data) {
    return false;
  }
  
  return data.user_id === userId;
}

/**
 * Verify user owns the AWS connection
 * Used by functions that perform AWS operations
 */
export async function verifyConnectionOwnership(
  client: SupabaseClient,
  connectionId: string,
  userId: string
): Promise<{ authorized: boolean; connection?: any }> {
  const { data: conn, error } = await client
    .from("aws_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .single();
  
  if (error || !conn) {
    return { authorized: false };
  }
  
  return { authorized: true, connection: conn };
}

/**
 * Verify user owns the audit and its associated connection
 */
export async function verifyAuditOwnership(
  client: SupabaseClient,
  auditId: string,
  userId: string
): Promise<{ authorized: boolean; audit?: any; connection?: any }> {
  const { data: audit, error: auditError } = await client
    .from("audits")
    .select("*, aws_connections(*)")
    .eq("id", auditId)
    .eq("user_id", userId)
    .single();
  
  if (auditError || !audit) {
    return { authorized: false };
  }
  
  // Verify connection also belongs to user
  const conn = (audit as any).aws_connections;
  if (!conn || conn.user_id !== userId) {
    return { authorized: false };
  }
  
  return { authorized: true, audit, connection: conn };
}

/**
 * Verify user owns the finding (via audit ownership)
 */
export async function verifyFindingOwnership(
  client: SupabaseClient,
  findingId: string,
  userId: string
): Promise<{ authorized: boolean; finding?: any; audit?: any }> {
  const { data: finding, error: findingError } = await client
    .from("findings")
    .select("*, audits!inner(user_id)")
    .eq("id", findingId)
    .single();
  
  if (findingError || !finding) {
    return { authorized: false };
  }
  
  const audit = (finding as any).audits;
  if (!audit || audit.user_id !== userId) {
    return { authorized: false };
  }
  
  return { authorized: true, finding, audit };
}

/**
 * Verify user owns the remediation (via finding ownership)
 */
export async function verifyRemediationOwnership(
  client: SupabaseClient,
  remediationId: string,
  userId: string
): Promise<{ authorized: boolean; remediation?: any; finding?: any }> {
  const { data: remediation, error } = await client
    .from("remediations")
    .select("*, findings!inner(audit_id, audits!inner(user_id))")
    .eq("id", remediationId)
    .eq("user_id", userId)
    .single();
  
  if (error || !remediation) {
    return { authorized: false };
  }
  
  // Double-check audit ownership
  const finding = (remediation as any).findings;
  const audit = finding?.audits;
  if (!audit || audit.user_id !== userId) {
    return { authorized: false };
  }
  
  return { authorized: true, remediation, finding };
}

/**
 * Log authorization failure for security audit
 */
export async function logAuthFailure(
  client: SupabaseClient,
  userId: string | null,
  action: string,
  resource: string,
  reason: string
): Promise<void> {
  try {
    await client.from("audit_log").insert({
      user_id: userId,
      action: "authorization_failure",
      resource_type: resource,
      resource_id: null,
      details: { action, reason },
      ip_address: null, // Set by trigger if available
      success: false,
    });
  } catch (e) {
    console.error("Failed to log auth failure:", e);
  }
}
