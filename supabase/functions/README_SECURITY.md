# Edge Functions Security Guidelines

## Overview

All Supabase Edge Functions in this project MUST follow these security guidelines:

## Required Security Measures

### 1. Import Security Utilities
```typescript
import { verifyAuth, jsonResponse, validateInput, getCorsHeaders, getSecurityHeaders } from "../_shared/security.ts";
```

### 2. CORS with Origin Allowlist
```typescript
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...corsHeaders, ...getSecurityHeaders() } });
  }
  // ... rest of handler
});
```

### 3. JWT Authentication
For user-facing endpoints:
```typescript
const auth = await verifyAuth(req);
if (!auth) {
  return jsonResponse({ error: "unauthenticated" }, 401, origin);
}
const { user } = auth;
```

### 4. Input Validation
```typescript
const body = await req.json().catch(() => ({}));
const validation = validateInput(body, {
  field_name: { type: "string", required: true },
  optional_field: { type: "number", required: false },
  array_field: { type: "array", required: true },
});

if (!validation.valid) {
  return jsonResponse({ error: validation.error }, 400, origin);
}
```

### 5. Response with Security Headers
```typescript
return jsonResponse({ data: result }, 200, origin);
```

### 6. Error Handling
```typescript
try {
  // ... function logic
} catch (e: any) {
  console.error("function-name error:", e.message); // Log detailed error
  return jsonResponse({ error: "Internal server error" }, 500, origin); // Return generic error
}
```

### 7. Sanitize Logged Data
```typescript
import { sanitizeForLog } from "../_shared/security.ts";

console.log("User input:", sanitizeForLog(userInput, 200));
```

## Functions Updated

### ✅ Fully Hardened
- `start-audit/index.ts` - JWT auth, input validation, CORS allowlist, security headers
- `verify-aws-connection/index.ts` - JWT auth, input validation, CORS allowlist, security headers
- `apply-remediation/index.ts` - JWT auth, input validation, CORS allowlist, security headers, prompt injection protection
- `run-agent-pipeline/index.ts` - Security headers, CORS allowlist, prompt injection protection (internal service-to-service call)

### ⚠️ Needs Update
The following functions should be updated to follow the same pattern:
- `export-audit/index.ts`
- `review-plan/index.ts`
- `simulate-impact/index.ts`
- `list-aws-resources/index.ts`
- `cloudtrail-replay/index.ts`
- `run-drift-diff/index.ts`

## CORS Configuration

Set the `ALLOWED_ORIGINS` environment variable in Supabase Edge Function secrets:

```bash
# Development
supabase secrets set ALLOWED_ORIGINS="http://localhost:8080,http://localhost:5173"

# Production
supabase secrets set ALLOWED_ORIGINS="https://your-production-domain.com"
```

If `ALLOWED_ORIGINS` is not set, all cross-origin requests will be blocked (fail-safe default).

## Prompt Injection Protection

For functions that call LLMs (OpenAI, Gemini, etc.):

```typescript
function sanitizeLlmInput(input: string): string {
  return input
    .replace(/system:|assistant:|user:/gi, "")
    .replace(/\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/g, "")
    .slice(0, 8000);
}

const safeInput = sanitizeLlmInput(userProvidedText);
```

## AWS Read-Only Enforcement

All AWS credential usage MUST be read-only except for `apply-remediation`:
- Connections MUST use IAM policies: `SecurityAudit` + `ReadOnlyAccess`
- `apply-remediation` is the ONLY function allowed to make write calls
- `apply-remediation` REQUIRES `lifecycle_state = 'approved'` before execution

## Testing

After updating a function:
1. Test with valid auth token: `Authorization: Bearer <valid_jwt>`
2. Test without auth (should return 401)
3. Test with invalid input (should return 400 with validation error)
4. Test CORS preflight: `curl -X OPTIONS -H "Origin: https://attacker.com" <function-url>`
   - Should return `Access-Control-Allow-Origin: null` if origin not in allowlist
5. Verify security headers in response

## Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [OWASP Prompt Injection](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
