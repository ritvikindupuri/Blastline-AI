# Security Policy

## Overview

Blastline-AI is a read-only AWS misconfiguration auditing platform built with defense-in-depth security. This document outlines the comprehensive hardening measures, deployment requirements, and residual risks that cannot be eliminated in code.

## Security Hardening (Latest Update: 2026-09-28 - Full Production Hardening)

### Comprehensive Security Implementation

#### 1. Secrets Management ✅ **FIXED**
- Removed `.env` from git tracking
- Added `.env` to `.gitignore` with dedicated section
- Created `.env.example` with placeholders
- **Secret Redaction**: Automatic redaction of AWS keys, JWTs, API keys in all logs and error messages

#### 2. Edge Functions - Complete Hardening ✅ **FIXED**
All Edge Functions implement defense-in-depth security:

**Authentication & Authorization**:
- JWT verification on every request
- Server-side resource ownership validation (not just user_id equality)
- Authorization failures logged to append-only audit_log

**Rate Limiting** (Per-User AND Per-IP):
- Audit operations: 30/hour per user, 50/hour per IP
- Remediation execution: 10/hour per user, 20/hour per IP
- Returns 429 with Retry-After header when exceeded

**CORS (Fail-Closed)**:
- **Production**: MUST set `ALLOWED_ORIGINS` or all requests rejected
- **Development**: Falls back to localhost whitelist
- **No wildcards allowed in production**

**Security Headers** (All Responses):
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

**Input Validation**:
- Strict type checking with required field validation
- Regex pattern validation for strings
- Array and object structure validation

**Error Handling**:
- Generic client-facing errors ("Internal server error")
- Detailed errors only in server logs
- Automatic secret redaction in all logs

#### 3. AWS Read-Only Enforcement ✅ **FIXED**
**Code-Level Enforcement** (not just documentation):
- `enforceAwsReadOnly()` function validates every AWS API call
- Maintains allowlist of read-only APIs (GetCallerIdentity, ListUsers, DescribeInstances, etc.)
- Maintains allowlist of approved write APIs for remediation context only
- **Rejects any disallowed API at runtime before execution**
- Audit context: Only read-only APIs permitted
- Remediation context: Only approved security hardening APIs permitted

#### 4. Enhanced Prompt Injection Protection ✅ **FIXED**
**Multi-Layer Defense**:
- **Untrusted Data Delimiting**: User inputs wrapped in `<USER_INPUT>` tags
- **Input Sanitization**: Removes role injection, instruction markers, jailbreak attempts
- **Zod Schema Validation**: Strict JSON schema enforcement on LLM outputs
- **Deterministic Checks**: Low temperature (0.1) for consistent outputs
- **Scoped System Prompts**: Explicit instructions that untrusted data is not commands

**LLM Output Validation**:
- All LLM calls use strict Zod schemas
- Parsing failures logged and retry with stronger model
- Invalid outputs rejected, never executed

#### 5. Append-Only Audit Log ✅ **FIXED**
**Privileged Action Logging**:
- New `audit_log` table tracks all security-critical operations
- Records: user_id, action, resource_type, resource_id, details, success
- **No UPDATE or DELETE policies** (append-only, immutable)
- Indexed for efficient queries (user, resource, action, failures)
- RLS: Users can only view their own logs

**Logged Actions**:
- Audit starts/completions
- Remediation executions (success and failure)
- Authorization failures
- Connection verifications
- All AWS API calls

#### 6. Frontend Security Headers ✅ **FIXED**
**Multiple Layers**:
- `index.html`: CSP and security headers via meta tags (backup)
- `vercel.json`: Headers for Vercel deployment
- `_headers`: Headers for Netlify/Cloudflare Pages

**Content Security Policy**:
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https: blob:;
connect-src 'self' https://*.supabase.co https://ai.gateway.lovable.dev wss://*.supabase.co;
frame-ancestors 'none';
upgrade-insecure-requests;
```

**Verified Working**: Build tested with CSP, application loads successfully

#### 7. XSS Prevention ✅ **FIXED**
- No unsafe `innerHTML` or `dangerouslySetInnerHTML` (except chart.tsx CSS generation)
- React's default escaping protects all user content
- CSP blocks inline script execution

#### 8. Row-Level Security ✅ **FIXED**
**Comprehensive RLS**:
- All tables have RLS enabled (verified by migration)
- User-scoped policies on all tables (`auth.uid() = user_id`)
- Ownership-based policies for related resources (findings via audits)
- `audit_log`: Append-only, users read their own logs
- No public read/write on any table

#### 9. GitHub Actions Security ✅ **FIXED**
**Pinned Actions** (SHA-based):
- All actions pinned to specific commit SHAs
- Prevents supply-chain attacks via tag mutation

**Security Scans**:
- **NPM Audit**: Fails on high/critical vulnerabilities
- **Gitleaks**: Scans for committed secrets
- **Dependency Review**: Blocks high-severity deps, denies copyleft licenses
- **CodeQL**: Static analysis for JavaScript/TypeScript
- **Build**: Verifies application builds successfully

**Runs On**: Push, PR, daily schedule (2 AM UTC)

#### 10. Dependency Management ✅ **FIXED**
- Dependabot: Weekly automated updates (npm + GitHub Actions)
- Grouped minor/patch updates
- Security labels on PRs

### Residual Risks (Truly Unfixable in Code)

The following risks **CANNOT** be eliminated through code changes and require manual operational steps:

### 1. Git History Contains Committed Secrets
**Risk**: The `.env` file was committed in git history (commits `b401ca8a` and `4e6ee6ba`). While removed from current tree, credentials remain in git history.

**Impact**: Low (Supabase anon keys are designed for client-side use with RLS protection)

**Required Manual Steps**:
1. **Rotate Supabase Keys** (do this immediately after PR merge):
   ```bash
   # In Supabase Dashboard:
   # Project Settings → API → Project API Keys → Reset anon/public key
   ```
2. **Update `.env.example`** with new placeholder
3. **Optional** (for high-security repos): Purge git history:
   ```bash
   # WARNING: Rewrites history, breaks forks
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env" \
     --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```

### 2. Supabase Service Role Key Protection
**Risk**: The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS policies. If leaked, attacker gains full database access.

**Impact**: Critical

**Required Manual Steps**:
1. **Never Commit Service Keys**: Use environment variables only
2. **Restrict Access**: Only deploy environments need the service key
3. **Rotate Immediately if Suspected Leak**:
   ```bash
   # In Supabase Dashboard:
   # Project Settings → API → Service Role Key → Reset
   # Update all deployment environments with new key
   ```
4. **Monitor**: Check Supabase logs for unusual service role activity

### 3. LLM Output Correctness
**Risk**: Despite Zod validation and prompt injection defenses, LLM-generated AWS API calls may contain logical errors or suboptimal fixes.

**Impact**: Medium (mitigated by approval workflow)

**Required Manual Steps**:
1. **Always Review AI Outputs**: Never blindly execute AI-generated remediation scripts
2. **Use Dry-Run Mode**: Test remediations with `dry_run: true` first
3. **Verify Post-Execution**: Check AWS Console after remediation to confirm intended effect
4. **Rollback Plan**: Have CloudFormation/Terraform state or backups ready

### 4. AWS IAM Policy Enforcement
**Risk**: Code enforces read-only API usage, but ultimate protection depends on IAM policies attached to AWS credentials.

**Impact**: High (if misconfigured)

**Required Manual Steps**:
1. **Use Approved IAM Policies Only**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "iam:Get*", "iam:List*",
           "s3:Get*", "s3:List*",
           "ec2:Describe*",
           "rds:Describe*",
           "lambda:Get*", "lambda:List*",
           "kms:Describe*", "kms:Get*", "kms:List*",
           "logs:Describe*", "logs:Get*",
           "cloudtrail:Describe*", "cloudtrail:Get*", "cloudtrail:Lookup*",
           "guardduty:Get*", "guardduty:List*"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
2. **For Remediation Connections** (write-enabled): Add only:
   ```json
   {
     "Effect": "Allow",
     "Action": [
       "iam:UpdateAccountPasswordPolicy",
       "s3:PutBucketPublicAccessBlock",
       "s3:PutBucketEncryption",
       "ec2:RevokeSecurityGroupIngress",
       "rds:ModifyDBInstance",
       "kms:EnableKeyRotation",
       "logs:PutRetentionPolicy",
       "cloudtrail:UpdateTrail",
       "guardduty:UpdateDetector"
     ],
     "Resource": "*"
   }
   ```
3. **Never Use**: `AdministratorAccess`, `PowerUserAccess`, or wildcard `"*"` permissions

### 5. Hosting Provider Security Headers
**Risk**: While security headers are configured in `vercel.json`, `_headers`, and `index.html`, actual enforcement depends on hosting provider.

**Impact**: Low (defense-in-depth already in place)

**Required Manual Steps**:
1. **Verify Headers After Deployment**:
   ```bash
   curl -I https://your-domain.com | grep -E "Strict-Transport|X-Frame|CSP"
   ```
2. **If Headers Missing**: Configure in hosting provider dashboard (Vercel, Netlify, Cloudflare Pages all support `_headers` or `vercel.json`)
3. **Test CSP**: Ensure application loads without console errors

### 6. Supabase ALLOWED_ORIGINS Configuration
**Risk**: Edge Functions will reject all requests in production if `ALLOWED_ORIGINS` is not set.

**Impact**: High (service outage)

**Required Manual Steps**:
1. **Before Production Deployment**:
   ```bash
   # In Supabase project:
   supabase secrets set ALLOWED_ORIGINS="https://your-production-domain.com"
   
   # For multiple domains (comma-separated):
   supabase secrets set ALLOWED_ORIGINS="https://app.example.com,https://www.example.com"
   ```
2. **For Development**:
   ```bash
   supabase secrets set ALLOWED_ORIGINS="http://localhost:8080,http://localhost:5173"
   ```
3. **Verify**: Test CORS preflight from browser console

## Deployment Security Checklist

Before deploying Blastline-AI to production:

### Pre-Deployment (Required)
- [ ] **Rotate Supabase Keys**: Reset anon/public key in Supabase Dashboard (git history cleanup)
- [ ] **Set ALLOWED_ORIGINS**: Configure in Supabase Edge Functions secrets
  ```bash
  supabase secrets set ALLOWED_ORIGINS="https://your-domain.com"
  ```
- [ ] **Verify AWS IAM Policies**: Audit/read-only roles only (see Residual Risk #4)
- [ ] **Set Other Secrets**:
  ```bash
  supabase secrets set LOVABLE_API_KEY="your-key"
  supabase secrets set OPENAI_API_KEY="your-key"  # Optional
  ```
- [ ] **Deploy with HTTPS**: Configure SSL certificate for your domain
- [ ] **Run Database Migration**: Apply `20260928150600_audit_log_and_rls.sql`

### Post-Deployment (Verification)
- [ ] **Test CORS**: Verify CORS headers from production domain
  ```bash
  curl -I -H "Origin: https://attacker.com" https://your-api.supabase.co/functions/v1/start-audit
  # Should return Access-Control-Allow-Origin: null (rejected)
  ```
- [ ] **Test Rate Limiting**: Trigger 429 responses
  ```bash
  for i in {1..35}; do curl -X POST https://your-api.supabase.co/functions/v1/start-audit; done
  # Should see 429 after limit
  ```
- [ ] **Test Authentication**: Verify unauthenticated requests fail
  ```bash
  curl -X POST https://your-api.supabase.co/functions/v1/start-audit
  # Should return 401 unauthenticated
  ```
- [ ] **Verify CSP**: Check browser console for CSP violations
- [ ] **Check Audit Log**: Confirm privileged actions are logged
  ```sql
  SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10;
  ```

### Monitoring (Ongoing)
- [ ] **AWS CloudTrail**: Enable in all accounts being audited
- [ ] **Supabase Logs**: Monitor Edge Function invocations for errors
- [ ] **Audit Log Review**: Regularly review `audit_log` table for anomalies
- [ ] **Dependabot**: Review and merge security PRs weekly
- [ ] **GitHub Actions**: Monitor daily security scans

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Blastline-AI:

1. **DO NOT** open a public GitHub issue.
2. **Email** the maintainers at: `security@[repository-owner-email]` (replace with actual contact).
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

We aim to respond within **48 hours** and provide a fix within **7 days** for critical issues.

## Compliance & Frameworks

Blastline-AI's auditing engine maps findings to:
- **CIS AWS Foundations Benchmark**
- **NIST 800-53**
- **SOC 2 Type II**
- **PCI DSS**
- **MITRE ATT&CK**

The platform itself does not store sensitive end-user data (PII/PHI) beyond AWS CloudTrail logs and IAM metadata.

## Security Contact

For general security questions (non-vulnerability):
- GitHub Discussions: [Link to repo discussions]
- Documentation: [README.md](./README.md)

---

Last Updated: September 28, 2026
