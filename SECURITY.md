# Security Policy

## Overview

Blastline-AI is a read-only AWS misconfiguration auditing platform built with security-first principles. This document outlines the security measures implemented, responsible disclosure process, and residual risks.

## Security Hardening (Latest Update: 2026-09-28)

### What Changed

#### 1. Secrets Management
- **Removed committed .env from git**: Sensitive Supabase credentials were previously committed to the repository. These have been removed from git tracking and added to `.gitignore`.
- **Created .env.example**: A template file with placeholder values for local development setup.
- **Note on Supabase Anon Keys**: While Supabase anonymous keys are low-risk (designed for client-side use with RLS protection), they should still not be committed to public repositories as a best practice.

#### 2. Supabase Edge Functions Security
All Edge Functions now implement:
- **JWT Verification**: Every function verifies the user's authentication token before processing requests.
- **Input Validation**: Strict type checking and required field validation on all request bodies.
- **CORS Allowlist**: Replaced wildcard (`*`) CORS headers with environment-driven `ALLOWED_ORIGINS` configuration. Falls back to denying all cross-origin requests if not configured.
- **Security Headers**: All responses include:
  - `X-Content-Type-Options: nosniff` (prevents MIME sniffing)
  - `X-Frame-Options: DENY` (prevents clickjacking)
  - `Referrer-Policy: strict-origin-when-cross-origin` (limits referrer leakage)
- **Error Handling**: Generic error messages prevent information disclosure; detailed errors only logged server-side.

#### 3. AWS Credential Handling
- **Read-Only Enforcement**: Documentation and code comments emphasize that AWS credentials must have `ReadOnlyAccess` + `SecurityAudit` IAM policies.
- **No Secret Logging**: AWS credentials are never logged or included in error messages.
- **Approval Workflow**: The `apply-remediation` function (the only write-capable endpoint) requires explicit approval workflow state (`lifecycle_state = 'approved'`) before executing changes.

#### 4. Prompt Injection Guardrails
AI/LLM endpoints (`apply-remediation`, `run-agent-pipeline`) now include:
- **Input Sanitization**: Removes prompt injection patterns (`system:`, `assistant:`, instruction markers) from user inputs before sending to LLM.
- **Length Limits**: Hard caps on user-provided text to prevent context stuffing attacks.
- **Scoped Instructions**: LLM system prompts explicitly restrict output to specific AWS API actions and forbid unrelated commands.

#### 5. XSS Prevention
- **No Unsafe HTML**: The codebase avoids `dangerouslySetInnerHTML` and `innerHTML` except in `chart.tsx` (Shadcn UI component) which generates CSS—a low-risk, controlled use case.
- **Framework Protection**: React's default escaping protects against XSS in all user-rendered content.

#### 6. Injection & SSRF
- **URL Validation**: The `awsConsole.ts` helper validates AWS console URLs before opening them in new windows.
- **Fetch Restrictions**: All `fetch()` calls in Edge Functions are limited to:
  - AWS APIs (signed with SigV4)
  - Lovable AI Gateway (over HTTPS)
  - No user-controlled URLs are fetched

#### 7. Row-Level Security (RLS)
All Supabase tables enforce RLS policies:
- Users can only access their own data (`auth.uid() = user_id` policies)
- No public read or write access
- Service role operations are explicitly scoped to user ownership checks

#### 8. Dependency Management
- **Dependabot**: Automated weekly dependency updates for npm packages and GitHub Actions.
- **Security Audits**: Run `npm audit` regularly; overrides for `lodash`, `rollup`, `js-yaml`, and `yaml` included to address known vulnerabilities.

### Residual Risks

Despite hardening, the following risks remain:

#### 1. AWS Credential Exposure
**Risk**: AWS access keys are stored encrypted in Supabase but could be exposed if the database or service role key is compromised.  
**Mitigation**: Use IAM Roles with AssumeRole and short-lived STS tokens instead of long-lived access keys where possible. Enable AWS CloudTrail to audit all API calls.

#### 2. Supabase Service Role Key
**Risk**: The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and could be used to access all user data if leaked.  
**Mitigation**: Never commit service role keys. Use environment variables or Supabase Vault secrets. Rotate keys if compromise is suspected.

#### 3. LLM Output Trust
**Risk**: AI-generated remediation scripts could contain errors or unintended actions despite prompt injection defenses.  
**Mitigation**: Human-in-the-loop approval workflow (`lifecycle_state` transitions) is mandatory before execution. Always review AI outputs.

#### 4. Denial of Service
**Risk**: No rate limiting is enforced on Edge Functions beyond Supabase's platform limits.  
**Mitigation**: Implement application-level rate limiting (e.g., via Redis or Supabase edge caching) for production deployments.

#### 5. Frontend CSP Not Enforced
**Risk**: No Content Security Policy (CSP) headers are set on the frontend hosting (Vite build).  
**Mitigation**: Configure CSP headers in your hosting provider (e.g., Vercel, Netlify) or via a reverse proxy. Example policy:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co https://ai.gateway.lovable.dev;
```

#### 6. Git History Contains Secrets
**Risk**: The `.env` file was previously committed; credentials remain in git history.  
**Mitigation**: Rotate the exposed Supabase anon key (regenerate in Supabase dashboard). For sensitive repos, consider using `git filter-branch` or `BFG Repo-Cleaner` to purge history, then force-push (breaks all forks).

#### 7. Browser-Based AWS Credential Storage
**Risk**: User AWS credentials are sent to the browser for some frontend AWS SDK operations.  
**Mitigation**: Minimize client-side AWS SDK usage. Proxy all AWS calls through Edge Functions where possible.

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

## Security Best Practices for Operators

If you deploy Blastline-AI:

1. **Environment Variables**: Never commit `.env` files. Use Supabase Vault or your hosting provider's secrets manager.
2. **AWS IAM Policies**: Ensure connected AWS accounts use `arn:aws:iam::aws:policy/SecurityAudit` and `arn:aws:iam::aws:policy/ReadOnlyAccess`. Never grant `AdministratorAccess`.
3. **CORS Configuration**: Set `ALLOWED_ORIGINS` environment variable in Supabase Edge Functions to your production domain (e.g., `https://app.example.com`).
4. **TLS/HTTPS**: Always access the application over HTTPS. Supabase endpoints are HTTPS by default.
5. **Audit Logs**: Enable AWS CloudTrail and Supabase database audit logging for compliance and forensics.
6. **Dependency Updates**: Monitor Dependabot PRs and apply security updates promptly.

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
