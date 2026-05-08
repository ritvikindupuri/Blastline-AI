# Blastline Cloud Security Platform
## Technical Documentation

**By:** Ritvik Indupuri
**Date:** 5/8/2026

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Feature Breakdown](#3-feature-breakdown)
   - [AWS Connections & Authorization](#aws-connections--authorization)
   - [Dashboard Analytics](#dashboard-analytics)
   - [Audit Engine & Agent Pipeline](#audit-engine--agent-pipeline)
   - [Findings Management](#findings-management)
   - [Attack Path Analysis](#attack-path-analysis)
   - [Blast Radius Engine](#blast-radius-engine)
   - [Principal Replay & CloudTrail Analysis](#principal-replay--cloudtrail-analysis)
   - [Effective Permissions Resolution](#effective-permissions-resolution)
   - [IaC Drift Detection](#iac-drift-detection)
   - [Terraform Plan Review](#terraform-plan-review)
   - [AI-Driven Remediations & Lifecycle](#ai-driven-remediations--lifecycle)
4. [Conclusion](#4-conclusion)

---

## 1. Executive Summary

Blastline is a read-only, zero-exploit cloud security auditing and remediation platform engineered for modern AWS environments. It provides deep visibility into misconfigurations, IAM vulnerabilities, and attack vectors, ensuring compliance with CIS, NIST, SOC2, and PCI standards. By leveraging AI-powered agents via Supabase Edge Functions, Blastline automates the generation, analysis, and safe execution of security remediations directly to AWS accounts. The platform strictly enforces a human-in-the-loop lifecycle, requiring peer reviews and approvals before executing any state-altering commands, ensuring a secure, auditable, and highly reliable operational workflow.

---

## 2. System Architecture

The architecture relies on a React/Vite frontend using Tailwind CSS and Shadcn UI for a sleek interface, communicating with a Supabase backend. Supabase handles authentication, PostgreSQL data persistence, and Edge Functions (written in Deno/TypeScript). These Edge Functions execute the core logic, integrating with the AWS SDK, external AI providers (OpenAI/Lovable), and executing complex security evaluations.

```mermaid
graph TD
    UI[Frontend Client (React/Vite)] -->|Auth & Database Queries| SupabaseDB[(Supabase PostgreSQL)]
    UI -->|Triggers Pipeline| EdgeFunctions[Supabase Edge Functions]

    subgraph Supabase Backend
        EdgeFunctions -->|Audit/Verify/Analyze| AWSSDK[AWS SDK]
        EdgeFunctions -->|Generate Code/Analyze Failures| AI[AI Gateway / LLMs]
        EdgeFunctions -->|Read/Write State| SupabaseDB
    end

    AWSSDK -->|Read-Only Queries / API Executions| AWSCloud((AWS Environment))
    AI -.->|Returns Remediation Snippets| EdgeFunctions
```
<div align="center"><em>Figure 1: Blastline System Architecture Flow</em></div>

### Flow-by-Flow Explanation
1. **User Interaction:** The security operator interacts with the UI, viewing analytics, triggering new audits, or reviewing proposed remediations.
2. **Database Layer:** The UI directly queries the Supabase PostgreSQL database using Row Level Security (RLS) policies to retrieve authorized connections, findings, and audit trails.
3. **Agent Pipeline:** When an action is required (e.g., scanning an account, applying a fix), the UI invokes a Supabase Edge Function (e.g., `run-agent-pipeline`, `apply-remediation`).
4. **Cloud Execution:** The Edge Function assumes the configured AWS IAM Role using securely stored credentials, executing read-only checks or, upon approval, applying infrastructure updates.
5. **AI Synthesis:** When vulnerabilities are found, the Edge Function queries an AI model to synthesize context-aware, infrastructure-as-code snippets (Terraform, CLI) tailored to the specific AWS resource state.
6. **Persistence & Auditing:** The results, including strict, unmodified AWS API logs, are written back to the Supabase database.

---

## 3. Feature Breakdown

### AWS Connections & Authorization
The platform requires users to connect AWS accounts via Cross-Account IAM Roles or direct API Keys. The system supports multi-account management with regional targeting. It includes connection verification endpoints (`verify-aws-connection`) to ensure the provided credentials possess the necessary read-only permissions (e.g., `SecurityAudit`, `ReadOnlyAccess`) before allowing the connection to be saved. Operators can also enforce a "Require Separate Approver" policy on a per-connection basis to ensure segregation of duties during remediation.

### Dashboard Analytics
A high-level command center displaying real-time metrics across all connected AWS accounts. It visualizes the total number of findings broken down by severity (Critical, High, Medium, Low), the number of identified attack paths, and recent remediation activities. The dashboard provides security leaders with an immediate posture overview.

### Audit Engine & Agent Pipeline
The core of Blastline is its asynchronous audit engine (`run-agent-pipeline`). When an audit is triggered, the AI agent performs reconnaissance across the target AWS account using read-only API calls. It analyzes IAM policies, S3 configurations, EC2 security groups, RDS databases, Lambda functions, and KMS keys. The engine parses the responses, identifies misconfigurations against compliance frameworks, and generates structured output written to the `audits` and `findings` tables.

### Findings Management
A detailed inventory of all security vulnerabilities discovered across all audits. Each finding includes the resource ARN, the AWS region, a severity classification, a detailed explanation of the risk, and compliance tags. Operators can filter findings by connection, service, or severity, and click into individual findings to review proposed fixes.

### Attack Path Analysis
The platform correlates multiple distinct findings to identify complex, multi-stage attack vectors (e.g., an over-privileged IAM role attached to a publicly exposed EC2 instance). These paths are visualized using ReactFlow, displaying the initial breach point, privilege escalation vectors, and the ultimate target (e.g., data exfiltration or administrative takeover). This contextualizes risk beyond isolated misconfigurations.

### Blast Radius Engine
This feature calculates the hypothetical damage an attacker could cause if a specific resource or principal were compromised. By inputting an IAM Role ARN or Resource ARN, the Edge Function queries the AWS environment to map out all downstream permissions, accessible data stores, and connected infrastructure, rendering a visual graph of the blast radius.

### Principal Replay & CloudTrail Analysis
A forensic and behavioral analysis tool that evaluates historical AWS CloudTrail logs. It analyzes the actions taken by a specific IAM Principal over a defined timeframe, utilizing AI to detect anomalies such as privilege escalation attempts, unusual data access spikes, off-hours activity, or unauthorized API calls, providing a risk score and actionable summary.

### Effective Permissions Resolution
A deeply technical utility that calculates the true, net-effective permissions of an IAM entity. It factors in IAM Policies, Resource-Based Policies, Permission Boundaries, Service Control Policies (SCPs), and Session Policies, allowing security engineers to mathematically verify if a specific action (e.g., `s3:GetObject`) is explicitly allowed or implicitly/explicitly denied on a given resource.

### IaC Drift Detection
Monitors the live state of the AWS environment and compares it against intended Infrastructure-as-Code (IaC) templates. It identifies manual modifications made outside the CI/CD pipeline (ClickOps) and flags them as drift, allowing teams to quickly sync their cloud state back to version control.

### Terraform Plan Review
An integration that allows operators to upload Terraform plan outputs (`terraform plan -out=tfplan`). The system parses the plan to detect high-risk changes (e.g., making an S3 bucket public, attaching `AdministratorAccess` to a role, deleting KMS keys) before they are applied, generating an AI-driven risk verdict, confidence score, and proposed Pull Request comments.

### AI-Driven Remediations & Lifecycle
When a finding is identified, the AI synthesizes an exact CLI or Terraform snippet to fix it. This enters a rigorous lifecycle:
1. **Proposed:** The fix is generated and awaits human review.
2. **Reviewed:** An engineer reviews the code and marks it as safe.
3. **Approved:** An authorized operator (potentially requiring a separate user, based on connection settings) approves the execution.
4. **Executed:** The `apply-remediation` Edge Function safely executes the API calls directly against AWS. The official, unmodified output from AWS is streamed back into the database for compliance auditing.
5. **Verified:** A post-execution check confirms the resource state has been permanently corrected.
6. **Failure Analysis:** If execution fails, the system provides a "Failure Diagnostics" sheet, parsing the raw AWS error and proposing a newly refined snippet for the operator to review and retry.

---

## 4. Conclusion

Blastline provides an end-to-end cloud security lifecycle management system. By combining comprehensive read-only reconnaissance with an auditable, human-in-the-loop remediation framework, it allows organizations to bridge the gap between identifying risks and safely mitigating them. The strict adherence to raw AWS log retention and rigorous approval gating guarantees that the platform meets the highest standards of operational security and compliance.
