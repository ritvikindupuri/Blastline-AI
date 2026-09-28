/**
 * Security utilities for Supabase Edge Functions
 * Provides JWT validation, CORS handling, input validation, and security headers
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface SecurityConfig {
  requireAuth?: boolean;
  allowedOrigins?: string[];
  validateInput?: (body: any) => { valid: boolean; error?: string };
}

/**
 * Get CORS headers with environment-driven origin allowlist
 * Falls back to strict same-origin if ALLOWED_ORIGINS not set
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOriginsEnv = Deno.env.get("ALLOWED_ORIGINS") || "";
  const allowedOrigins = allowedOriginsEnv
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);
  
  // If no allowed origins configured, deny all cross-origin requests
  if (allowedOrigins.length === 0) {
    return {
      "Access-Control-Allow-Origin": "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
  }
  
  // Check if origin is in allowlist
  const isAllowed = origin && allowedOrigins.some(allowed => 
    allowed === "*" || origin === allowed || origin.endsWith(allowed)
  );
  
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin! : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Security headers to include in all responses
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Type": "application/json",
  };
}

/**
 * Verify JWT and return authenticated user
 * Returns null if authentication fails
 */
export async function verifyAuth(req: Request): Promise<{ user: any; client: SupabaseClient } | null> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return null;
  }
  
  return { user, client: userClient };
}

/**
 * Validate input parameters with basic type and required field checking
 */
export function validateInput(
  body: any,
  schema: Record<string, { type: string; required?: boolean; pattern?: RegExp }>
): { valid: boolean; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  
  for (const [key, rules] of Object.entries(schema)) {
    const value = body[key];
    
    // Check required fields
    if (rules.required && (value === undefined || value === null || value === "")) {
      return { valid: false, error: `Missing required field: ${key}` };
    }
    
    // Skip type checking if field is not present and not required
    if (value === undefined || value === null) {
      continue;
    }
    
    // Type validation
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (rules.type !== "any" && actualType !== rules.type) {
      return { valid: false, error: `Field '${key}' must be of type ${rules.type}` };
    }
    
    // Pattern validation for strings
    if (rules.pattern && typeof value === "string" && !rules.pattern.test(value)) {
      return { valid: false, error: `Field '${key}' has invalid format` };
    }
  }
  
  return { valid: true };
}

/**
 * Create standardized JSON response with security headers
 */
export function jsonResponse(
  body: unknown,
  status: number = 200,
  origin: string | null = null
): Response {
  const headers = {
    ...getCorsHeaders(origin),
    ...getSecurityHeaders(),
  };
  
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Sanitize string to prevent log injection
 * Removes control characters and limits length
 */
export function sanitizeForLog(input: string, maxLength: number = 200): string {
  return input
    .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
    .slice(0, maxLength);
}

/**
 * Validate that AWS credentials will only be used for read-only operations
 * This is a documentation/reminder function - actual enforcement happens in IAM policies
 */
export function enforceAwsReadOnly(): void {
  // This product is designed for read-only AWS auditing
  // All AWS connections MUST use roles/users with ReadOnlyAccess + SecurityAudit policies
  // The apply-remediation function is the only exception and requires explicit approval workflow
  // DO NOT modify this behavior without security review
}

/**
 * Basic rate limiting helper (in-memory, per-function instance)
 * For production, use Redis or Supabase edge caching
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 60,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = identifier;
  const limit = rateLimitMap.get(key);
  
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }
  
  if (limit.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: limit.resetAt };
  }
  
  limit.count++;
  return { allowed: true, remaining: maxRequests - limit.count, resetAt: limit.resetAt };
}
