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
 * FAIL-CLOSED: In production, if ALLOWED_ORIGINS is unset, all requests are rejected
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOriginsEnv = Deno.env.get("ALLOWED_ORIGINS");
  const env = Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "development";
  
  // FAIL-CLOSED: In production, ALLOWED_ORIGINS must be set
  if (!allowedOriginsEnv) {
    if (env === "production") {
      throw new Error("SECURITY: ALLOWED_ORIGINS must be set in production");
    }
    // Development: allow localhost only
    const devOrigins = ["http://localhost:8080", "http://localhost:5173", "http://127.0.0.1:8080"];
    const isDevAllowed = origin && devOrigins.includes(origin);
    return {
      "Access-Control-Allow-Origin": isDevAllowed ? origin! : "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Credentials": "true",
    };
  }
  
  const allowedOrigins = allowedOriginsEnv
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);
  
  // Check if origin is in allowlist (no wildcards in production)
  const isAllowed = origin && allowedOrigins.some(allowed => {
    if (allowed === "*" && env === "production") {
      throw new Error("SECURITY: Wildcard CORS not allowed in production");
    }
    return origin === allowed || origin.endsWith(allowed);
  });
  
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin! : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Security headers to include in all responses
 * Comprehensive defense-in-depth headers
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Type": "application/json",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
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
  origin: string | null = null,
  additionalHeaders: Record<string, string> = {}
): Response {
  const headers = {
    ...getCorsHeaders(origin),
    ...getSecurityHeaders(),
    ...additionalHeaders,
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
 * Redact secrets from logs and error messages
 * Replaces AWS keys, tokens, passwords with [REDACTED]
 */
export function redactSecrets(input: string): string {
  return input
    // AWS Access Keys
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]")
    // AWS Secret Keys (base64-like 40 chars)
    .replace(/[A-Za-z0-9/+=]{40}/g, (match) => {
      // Only redact if it looks like a secret (has mix of chars)
      return /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match) 
        ? "[REDACTED_SECRET]" 
        : match;
    })
    // JWT tokens
    .replace(/eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]")
    // API keys
    .replace(/sk-[a-zA-Z0-9]{32,}/g, "[REDACTED_API_KEY]")
    // Generic tokens
    .replace(/["\s](token|apikey|secret|password)[":\s]+[^\s"]{8,}/gi, 
      (match, key) => match.replace(/[^\s"]{8,}/, "[REDACTED]"));
}

/**
 * AWS API call classifications
 */
const AWS_READ_ONLY_APIS = new Set([
  // STS
  "GetCallerIdentity", "GetSessionToken", "AssumeRole",
  // IAM (read)
  "GetUser", "ListUsers", "GetRole", "ListRoles", "GetAccountPasswordPolicy", "ListAccessKeys",
  "GetPolicy", "GetPolicyVersion", "ListPolicies", "ListAttachedUserPolicies",
  // S3 (read)
  "ListBuckets", "GetBucketLocation", "GetBucketVersioning", "GetBucketEncryption",
  "GetBucketPublicAccessBlock", "GetBucketPolicyStatus", "GetBucketLogging", "GetBucketPolicy",
  "GetObject", "ListObjectsV2", "HeadObject", "GetObjectAcl",
  // EC2 (read)
  "DescribeInstances", "DescribeSecurityGroups", "DescribeVolumes", "DescribeVpcs",
  "DescribeSubnets", "DescribeRouteTables", "DescribeFlowLogs", "DescribeSnapshots",
  // RDS (read)
  "DescribeDBInstances", "DescribeDBClusters", "DescribeDBSnapshots", "DescribeDBParameterGroups",
  // Lambda (read)
  "ListFunctions", "GetFunction", "GetFunctionConfiguration", "GetFunctionUrlConfig",
  // KMS (read)
  "ListKeys", "DescribeKey", "GetKeyRotationStatus", "GetKeyPolicy",
  // CloudTrail (read)
  "DescribeTrails", "GetTrailStatus", "LookupEvents", "GetTrail",
  // GuardDuty (read)
  "ListDetectors", "GetDetector", "ListFindings", "GetFindings",
  // CloudWatch (read)
  "DescribeAlarms", "GetMetricData", "DescribeLogGroups", "DescribeLogStreams",
  // ECR (read)
  "DescribeRepositories", "DescribeImages", "GetRepositoryPolicy",
  // EKS (read)
  "ListClusters", "DescribeCluster", "DescribeNodegroup",
  // Secrets Manager (read)
  "ListSecrets", "DescribeSecret", "GetSecretValue",
]);

const AWS_WRITE_APIS_ALLOWED_IN_REMEDIATION = new Set([
  // IAM (write - password policy only)
  "UpdateAccountPasswordPolicy",
  // S3 (write - security configs only)
  "PutBucketPublicAccessBlock", "PutBucketEncryption", "PutBucketVersioning", "PutBucketLogging",
  // EC2 (write - security group rules only)
  "RevokeSecurityGroupIngress", "AuthorizeSecurityGroupIngress",
  // RDS (write - encryption/public access only)
  "ModifyDBInstance",
  // KMS (write - rotation only)
  "EnableKeyRotation",
  // CloudWatch Logs (write - retention only)
  "PutRetentionPolicy",
  // CloudTrail (write - logging only)
  "UpdateTrail", "StartLogging",
  // GuardDuty (write - enable only)
  "UpdateDetector", "CreateDetector",
  // Lambda (write - configuration only)
  "UpdateFunctionConfiguration",
  // Secrets Manager (write - rotation only)
  "RotateSecret",
]);

/**
 * Enforce that AWS API calls are read-only (or approved write calls in remediation context)
 * @param apiAction - The AWS API action (e.g., "GetCallerIdentity", "DeleteBucket")
 * @param context - "audit" (read-only) or "remediation" (approved write allowed)
 * @throws Error if the API call is not allowed in the given context
 */
export function enforceAwsReadOnly(apiAction: string, context: "audit" | "remediation" = "audit"): void {
  // Allow read-only APIs in all contexts
  if (AWS_READ_ONLY_APIS.has(apiAction)) {
    return;
  }
  
  // In audit context, reject all write operations
  if (context === "audit") {
    throw new Error(
      `SECURITY VIOLATION: AWS write operation "${apiAction}" is not allowed in audit context. ` +
      `This product is read-only. Only read-only APIs are permitted.`
    );
  }
  
  // In remediation context, allow approved write operations
  if (context === "remediation" && AWS_WRITE_APIS_ALLOWED_IN_REMEDIATION.has(apiAction)) {
    return;
  }
  
  // Reject everything else
  throw new Error(
    `SECURITY VIOLATION: AWS operation "${apiAction}" is not allowed. ` +
    context === "remediation"
      ? `Only approved security hardening operations are permitted in remediation.`
      : `This product is read-only.`
  );
}

/**
 * Rate limiting with dual tracking (per-user and per-IP)
 * Protects expensive AI/AWS endpoints
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number; firstSeen: number }>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetAt + 300000) { // 5 min after reset
      rateLimitMap.delete(key);
    }
  }
}, 60000); // Run cleanup every minute

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  identifier: string; // user_id or IP
  type: "user" | "ip";
}

export function checkRateLimit(
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  const now = Date.now();
  const key = `${config.type}:${config.identifier}`;
  const limit = rateLimitMap.get(key);
  
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + config.windowMs, firstSeen: now });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }
  
  if (limit.count >= config.maxRequests) {
    const retryAfter = Math.ceil((limit.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetAt: limit.resetAt, retryAfter };
  }
  
  limit.count++;
  return { allowed: true, remaining: config.maxRequests - limit.count, resetAt: limit.resetAt };
}

/**
 * Apply rate limiting to expensive endpoints (AI/AWS)
 * Returns 429 response if limit exceeded
 */
export async function enforceRateLimit(
  req: Request,
  userId: string | null,
  origin: string | null,
  config: { maxPerUser: number; maxPerIP: number; windowMs: number }
): Promise<Response | null> {
  // Per-user rate limit (if authenticated)
  if (userId) {
    const userLimit = checkRateLimit({
      maxRequests: config.maxPerUser,
      windowMs: config.windowMs,
      identifier: userId,
      type: "user",
    });
    
    if (!userLimit.allowed) {
      return jsonResponse(
        { error: "Rate limit exceeded", retryAfter: userLimit.retryAfter },
        429,
        origin,
        {
          "Retry-After": String(userLimit.retryAfter || 60),
          "X-RateLimit-Limit": String(config.maxPerUser),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(userLimit.resetAt / 1000)),
        }
      );
    }
  }
  
  // Per-IP rate limit (always)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
             req.headers.get("x-real-ip") ||
             "unknown";
  
  const ipLimit = checkRateLimit({
    maxRequests: config.maxPerIP,
    windowMs: config.windowMs,
    identifier: ip,
    type: "ip",
  });
  
  if (!ipLimit.allowed) {
    return jsonResponse(
      { error: "Rate limit exceeded", retryAfter: ipLimit.retryAfter },
      429,
      origin,
      {
        "Retry-After": String(ipLimit.retryAfter || 60),
        "X-RateLimit-Limit": String(config.maxPerIP),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(ipLimit.resetAt / 1000)),
      }
    );
  }
  
  return null; // Rate limit not exceeded
}
