# Project: Custom Application Monitoring Platform

## 1. Project Objective

Build a reusable monitoring platform that can monitor multiple applications, APIs, websites, scheduled jobs, ports, email workflows, third-party integrations, and business processes.

The system must detect:

- Failures
- Performance degradation
- Missed scheduled jobs
- Unusual behaviour

It must send alerts through:

- Email
- SMS
- WhatsApp
- Slack
- Microsoft Teams

The platform should be reusable across multiple client projects and environments.

---

## 2. Core System Requirements

The platform must support:

- HTTP and HTTPS monitoring
- API health checks
- Keyword and response validation
- TCP port monitoring
- Scheduled-job heartbeat monitoring
- SSL certificate expiry monitoring
- Third-party integration checks
- Email delivery monitoring
- Business workflow monitoring
- Incident creation and resolution
- Alert escalation
- Alert deduplication
- Maintenance windows
- Monitoring dashboards
- Historical reporting
- Multi-project support
- Multi-environment support
- Role-based access control

---

## 3. Recommended Technology Stack

### Backend

Use one of the following:

- Node.js with TypeScript and NestJS
- Python with FastAPI

Recommended:

```text
Node.js
TypeScript
NestJS
```

### Frontend

```text
React
TypeScript
Vite
Tailwind CSS
```

### Database

```text
PostgreSQL
```

Supabase may be used for:

- PostgreSQL database
- Authentication
- Row-level security
- Realtime dashboard updates
- File storage

### Job Scheduling

Use:

```text
BullMQ
Redis
```

Alternative:

```text
Temporal
```

BullMQ is simpler for the first version.

### Notifications

Use:

- Email: SendGrid, Resend, or Microsoft Graph
- SMS: Twilio
- WhatsApp: Twilio WhatsApp or Meta WhatsApp Cloud API
- Slack: Incoming webhook
- Microsoft Teams: Incoming webhook or Power Automate

### Hosting

Use:

- Render
- Railway
- Fly.io
- Azure
- AWS
- Google Cloud

The monitoring worker must run separately from the API and dashboard.

---

## 4. System Architecture

```text
Monitoring Dashboard
        |
        v
Monitoring API
        |
        +-------------------+
        |                   |
        v                   v
PostgreSQL             Redis Queue
                            |
                            v
                     Monitoring Workers
                            |
        +-------------------+--------------------+
        |                   |                    |
        v                   v                    v
    Websites              APIs               Ports
        |
        +-------------------+--------------------+
                            |
                            v
                      Incident Engine
                            |
                            v
                       Alert Engine
                            |
        +-------------------+--------------------+
        |                   |                    |
        v                   v                    v
      Email               SMS               WhatsApp
```

---

## 5. Project Phases

## Phase 1: Foundation

### Task 1.1: Create the Project Repository

Create a monorepo containing:

```text
/apps
    /api
    /dashboard
    /worker

/packages
    /shared
    /monitoring-sdk
    /config
```

#### Acceptance Criteria

- [ ] The API starts successfully
- [ ] The dashboard starts successfully
- [ ] The worker starts successfully
- [ ] Shared TypeScript types are reusable
- [ ] Environment variables are validated at startup
- [ ] Docker Compose can start the local development environment

---

### Task 1.2: Configure the Database

Create PostgreSQL migrations for:

- Users
- Organisations
- Projects
- Environments
- Monitors
- Monitor results
- Incidents
- Incident events
- Notification channels
- Alert rules
- Maintenance windows
- Heartbeat events
- Audit logs

#### Acceptance Criteria

- [ ] Migrations run successfully
- [ ] Foreign keys are enforced
- [ ] Timestamps are stored in UTC
- [ ] Soft deletion is supported where required
- [ ] Database indexes exist for frequently queried fields
- [ ] Each record is linked to an organisation

---

### Task 1.3: Implement Authentication

Implement:

- Email and password login
- Password reset
- Session management
- Organisation membership
- Role-based access

Roles:

```text
Owner
Administrator
Operator
Viewer
```

#### Acceptance Criteria

- [ ] Unauthenticated users cannot access the dashboard
- [ ] Users only see organisations they belong to
- [ ] Viewers cannot modify monitors
- [ ] Operators can acknowledge incidents
- [ ] Administrators can manage monitors
- [ ] Owners can manage organisation settings and users

---

## 6. Monitor Management

### Task 2.1: Build Monitor CRUD Functionality

Users must be able to:

- Create monitors
- Edit monitors
- Disable monitors
- Delete monitors
- Duplicate monitors
- Assign monitors to projects
- Assign monitors to environments
- Configure monitoring intervals

Supported intervals:

```text
1 minute
5 minutes
10 minutes
15 minutes
30 minutes
60 minutes
```

Monitor fields:

```text
name
description
monitor_type
project_id
environment_id
check_interval
timeout
retry_count
enabled
severity
tags
configuration
created_by
created_at
updated_at
```

#### Acceptance Criteria

- [ ] Monitors can be created from the dashboard
- [ ] Invalid configurations are rejected
- [ ] Disabled monitors are not scheduled
- [ ] Monitor changes are written to the audit log

---

## 7. HTTP and API Monitoring

### Task 3.1: Build HTTP Monitoring

Support:

- GET
- POST
- PUT
- PATCH
- DELETE
- HEAD

Configuration must include:

```text
URL
HTTP method
Headers
Query parameters
Request body
Authentication
Timeout
Expected status codes
Expected response time
```

Authentication methods:

```text
None
Basic authentication
Bearer token
API key header
Custom headers
```

#### Acceptance Criteria

- [ ] The worker sends the configured HTTP request
- [ ] Response status is recorded
- [ ] Response duration is recorded
- [ ] Timeout failures are detected
- [ ] DNS failures are detected
- [ ] TLS failures are detected
- [ ] Sensitive headers are encrypted
- [ ] Secrets are never returned to the frontend

---

### Task 3.2: Add Response Validation

Support:

- Expected status code
- Expected keyword
- Forbidden keyword
- JSON field validation
- JSON schema validation
- Maximum response duration

Example rule:

```text
status = 200
body.status = "healthy"
response_time < 2000 milliseconds
```

#### Acceptance Criteria

- [ ] A monitor fails when validation does not pass
- [ ] Validation failure reasons are stored
- [ ] Large response bodies are truncated
- [ ] Sensitive response data is not stored by default

---

## 8. Port Monitoring

### Task 4.1: Build TCP Port Monitoring

Configuration:

```text
Hostname
Port
Timeout
Optional expected banner
```

Examples:

```text
example.com:443
smtp.example.com:587
server.example.com:22
```

#### Acceptance Criteria

- [ ] The worker attempts a TCP connection
- [ ] Connection time is recorded
- [ ] Connection refusal is detected
- [ ] Timeout is detected
- [ ] DNS failure is detected
- [ ] Port monitors generate incidents

---

## 9. Heartbeat Monitoring

### Task 5.1: Build Heartbeat Monitors

Each heartbeat monitor must generate a unique URL.

Example:

```text
POST /api/heartbeats/{heartbeat-token}
```

The heartbeat must support:

```text
success
failure
started
completed
```

Optional metadata:

```json
{
  "jobName": "seven-day-reminder-job",
  "recordsProcessed": 420,
  "recordsFailed": 3,
  "durationMs": 124000
}
```

#### Acceptance Criteria

- [ ] Each monitor has a secure random token
- [ ] A heartbeat updates the last-seen timestamp
- [ ] Missing heartbeats generate incidents
- [ ] Failed heartbeat events generate incidents
- [ ] Tokens can be regenerated
- [ ] Heartbeat history is visible in the dashboard

---

### Task 5.2: Add Job Execution Tracking

Track:

```text
job name
start time
end time
duration
status
records processed
records succeeded
records failed
error message
metadata
```

#### Acceptance Criteria

- [ ] The system identifies long-running jobs
- [ ] The system identifies missed jobs
- [ ] The system identifies repeatedly failing jobs
- [ ] Job metrics can be graphed

---

## 10. SSL Monitoring

### Task 6.1: Build SSL Certificate Monitoring

Monitor:

- Certificate validity
- Expiry date
- Issuer
- Domain match
- Certificate chain
- Days remaining

Alert thresholds:

```text
30 days before expiry
14 days before expiry
7 days before expiry
1 day before expiry
```

#### Acceptance Criteria

- [ ] Expiry date is stored
- [ ] Invalid certificates generate incidents
- [ ] Hostname mismatch generates an incident
- [ ] Expiry warnings do not create duplicate incidents

---

## 11. Email Monitoring

### Task 7.1: Build Email-Provider Health Checks

Support:

- SMTP connectivity check
- Email API connectivity check
- Authentication verification

#### Acceptance Criteria

- [ ] SMTP connection failures are detected
- [ ] Invalid credentials are detected
- [ ] Provider response time is recorded
- [ ] Test credentials are securely encrypted

---

### Task 7.2: Build End-to-End Email Canary Monitoring

Workflow:

```text
Send test email
Generate unique tracking ID
Check monitoring inbox
Verify email arrival
Measure delivery latency
Mark monitor as successful
```

#### Acceptance Criteria

- [ ] Test messages use unique identifiers
- [ ] The system verifies message delivery
- [ ] Missing messages generate incidents
- [ ] Delivery latency is recorded
- [ ] Test emails are automatically cleaned up
- [ ] No client information is included in test emails

---

## 12. Third-Party Integration Monitoring

### Task 8.1: Build Generic API Integration Monitors

Support integrations such as:

- Insightly
- Supabase
- Microsoft Graph
- Zapier
- Vapi
- Twilio
- CRM systems
- Payment providers

Each integration monitor must support:

```text
Authentication test
Read test
Optional write test
Response-time tracking
Rate-limit detection
Permission-error detection
```

#### Acceptance Criteria

- [ ] Authentication failures are classified
- [ ] Permission failures are classified
- [ ] Rate limits are classified
- [ ] Timeout failures are classified
- [ ] Sensitive API responses are not stored
- [ ] Integration monitors use dedicated test records

---

### Task 8.2: Build Insightly Monitoring

Implement:

```text
Check authentication
Read a dedicated monitoring contact
Verify required fields
Measure response time
Detect permission errors
Detect rate limiting
```

Optional synthetic workflow:

```text
Create monitoring record
Verify record exists
Update record
Verify update
Delete or archive record
```

#### Acceptance Criteria

- [ ] Real client records are never used
- [ ] Monitoring records are clearly labelled
- [ ] Test records are cleaned up automatically
- [ ] Ownership and permission failures are clearly reported

---

## 13. Business Workflow Monitoring

### Task 9.1: Build a Synthetic Workflow Engine

The platform must support multi-step monitoring workflows.

Example:

```text
Step 1: Create test meeting
Step 2: Confirm database record exists
Step 3: Run reminder generation
Step 4: Confirm reminder is queued
Step 5: Confirm email is sent
Step 6: Delete test data
```

Each step must support:

```text
HTTP request
Database query
Delay
Assertion
Variable extraction
Conditional logic
Cleanup action
```

#### Acceptance Criteria

- [ ] Workflows can contain multiple steps
- [ ] Output from one step can be used by another
- [ ] Failed steps stop the workflow
- [ ] Cleanup runs after success or failure
- [ ] Step timings are recorded
- [ ] Workflow failures create incidents

---

## 14. Incident Engine

### Task 10.1: Build Incident Creation Logic

An incident must be created when:

- A monitor fails after configured retries
- A heartbeat is missed
- A performance threshold is exceeded
- A certificate is invalid
- A synthetic workflow fails

Incident fields:

```text
monitor_id
status
severity
title
summary
failure_reason
started_at
acknowledged_at
resolved_at
assigned_to
occurrence_count
last_occurrence_at
```

Statuses:

```text
Open
Acknowledged
Investigating
Resolved
Muted
```

#### Acceptance Criteria

- [ ] One failure does not automatically create an incident unless configured
- [ ] Repeated identical failures update the existing incident
- [ ] Recovery resolves the incident automatically
- [ ] A resolved incident is reopened if the failure returns within a configured window
- [ ] All incident changes are logged

---

### Task 10.2: Implement Alert Deduplication

Group failures using:

```text
organisation
monitor
error type
failure signature
time window
```

#### Acceptance Criteria

- [ ] One outage does not generate hundreds of incidents
- [ ] Repeated failures increment occurrence count
- [ ] New error types create separate incidents
- [ ] Deduplication behaviour is configurable

---

## 15. Alert Engine

### Task 11.1: Build Notification Channels

Support:

- Email
- SMS
- WhatsApp
- Slack
- Microsoft Teams
- Generic webhook

#### Acceptance Criteria

- [ ] Users can configure multiple channels
- [ ] Notification credentials are encrypted
- [ ] Test notifications can be sent
- [ ] Failed notifications are retried
- [ ] Notification attempts are logged

---

### Task 11.2: Build Alert Rules

Alert rules must support:

```text
Severity
Project
Environment
Monitor type
Time of day
Day of week
Failure duration
Number of failures
Notification channel
Escalation delay
```

Example:

```text
If production API is down for 3 minutes:
Send Teams alert

If still down after 10 minutes:
Send WhatsApp and SMS

If still down after 30 minutes:
Notify manager
```

#### Acceptance Criteria

- [ ] Rules can be created through the dashboard
- [ ] Rules execute in priority order
- [ ] Escalation stops when the incident resolves
- [ ] Alert rules support business hours
- [ ] Alert rules support weekends and public holidays

---

## 16. Maintenance Windows

### Task 12.1: Build Maintenance Windows

Support:

- One-time maintenance
- Recurring maintenance
- Project-level maintenance
- Monitor-level maintenance
- Environment-level maintenance

#### Acceptance Criteria

- [ ] Monitors continue collecting results during maintenance
- [ ] Incidents are not created during planned maintenance
- [ ] Existing incidents can optionally be muted
- [ ] Maintenance start and end events are logged

---

## 17. Dashboard

### Task 13.1: Build Overview Dashboard

Display:

```text
Overall system status
Active incidents
Healthy monitors
Failed monitors
Warning monitors
Average response time
Uptime percentage
Recent recoveries
Upcoming certificate expiries
Missed heartbeats
```

#### Acceptance Criteria

- [ ] Dashboard updates automatically
- [ ] Data can be filtered by organisation
- [ ] Data can be filtered by project
- [ ] Data can be filtered by environment
- [ ] Critical incidents appear first

---

### Task 13.2: Build Monitor Detail Page

Display:

```text
Current status
Uptime percentage
Response-time history
Recent checks
Failure history
Incident history
Configuration
Linked alert rules
```

#### Acceptance Criteria

- [ ] Historical data can be filtered by date
- [ ] Check details show failure reasons
- [ ] Sensitive configuration values are masked
- [ ] Users can manually run a test check

---

### Task 13.3: Build Incident Page

Display:

```text
Incident timeline
Failure reason
Affected monitor
Alert history
Acknowledgement
Assignee
Notes
Recovery details
```

#### Acceptance Criteria

- [ ] Operators can acknowledge incidents
- [ ] Operators can add notes
- [ ] Administrators can resolve incidents manually
- [ ] Incident history cannot be silently deleted

---

## 18. Reporting

### Task 14.1: Build Uptime Reports

Reports must include:

```text
Uptime percentage
Downtime duration
Number of incidents
Mean time to detect
Mean time to acknowledge
Mean time to resolve
Average response time
Slowest response
Missed jobs
Notification success rate
```

#### Acceptance Criteria

- [ ] Reports can be filtered by date
- [ ] Reports can be filtered by project
- [ ] Reports can be exported as CSV
- [ ] Reports can be generated weekly and monthly
- [ ] Reports can be emailed automatically

---

## 19. Anomaly Detection

### Task 15.1: Implement Basic Anomaly Rules

Start with rule-based anomaly detection:

```text
Response time increased by more than 100%
Failure rate exceeded baseline
Job duration exceeded normal duration
Queue size increased above threshold
Email delivery latency exceeded threshold
Record volume dropped unexpectedly
```

#### Acceptance Criteria

- [ ] Baselines use historical data
- [ ] Minimum historical data is required
- [ ] Users can configure sensitivity
- [ ] Anomaly alerts are marked separately from outages
- [ ] Anomaly alerts can be disabled per monitor

---

### Task 15.2: Implement Statistical Anomaly Detection

After enough data is collected, calculate:

```text
Rolling average
Standard deviation
Percentiles
Moving median
Median absolute deviation
Seasonal hourly baseline
Seasonal daily baseline
```

Example:

```text
Alert when current response time exceeds:
rolling median + 3 median absolute deviations
```

#### Acceptance Criteria

- [ ] The model does not run without sufficient data
- [ ] Detected anomalies include an explanation
- [ ] False positives can be marked
- [ ] User feedback can be stored for future tuning

---

## 20. Monitoring SDK

### Task 16.1: Build a Reusable Monitoring SDK

Create an SDK that applications can install.

Example package:

```text
@tumisang/monitoring-sdk
```

Required methods:

```typescript
monitoring.jobStarted()
monitoring.jobCompleted()
monitoring.jobFailed()
monitoring.recordMetric()
monitoring.sendHeartbeat()
monitoring.captureError()
monitoring.checkDependency()
```

Example:

```typescript
const job = await monitoring.jobStarted({
  jobName: "seven-day-reminders"
});

try {
  const result = await generateReminders();

  await monitoring.jobCompleted(job.id, {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed
  });
} catch (error) {
  await monitoring.jobFailed(job.id, {
    message: error.message
  });

  throw error;
}
```

#### Acceptance Criteria

- [ ] SDK works with Node.js applications
- [ ] SDK does not block application execution
- [ ] SDK retries failed monitoring calls
- [ ] SDK stores failed events temporarily
- [ ] SDK supports secure API keys
- [ ] SDK documentation includes examples

---

## 21. Security Requirements

### Task 17.1: Protect Secrets

Implement:

- Encryption at rest
- Masking in the dashboard
- Secret rotation
- Access logging
- Environment separation

#### Acceptance Criteria

- [ ] API keys are encrypted
- [ ] Passwords are never stored in plaintext
- [ ] Secrets are never included in logs
- [ ] Sensitive headers are removed from results
- [ ] Production credentials cannot be viewed by unauthorised users

---

### Task 17.2: Add Audit Logging

Record:

```text
User login
Monitor created
Monitor changed
Monitor deleted
Incident acknowledged
Incident resolved
Notification channel changed
Alert rule changed
Secret rotated
```

#### Acceptance Criteria

- [ ] Audit events include actor and timestamp
- [ ] Audit records cannot be edited
- [ ] Audit records can be filtered and exported

---

## 22. Reliability Requirements

### Task 18.1: Make the Monitoring Platform Highly Available

The monitoring system itself must be monitored.

Implement:

- Worker heartbeat
- API health endpoint
- Queue health check
- Database health check
- Notification provider health check
- Dead-letter queue
- Automatic worker restart

#### Acceptance Criteria

- [ ] Failed monitoring jobs are retried
- [ ] Permanently failed jobs enter a dead-letter queue
- [ ] The API exposes liveness and readiness endpoints
- [ ] The worker reports its own heartbeat
- [ ] A separate external monitor checks the platform

---

## 23. Testing Requirements

### Task 19.1: Build Automated Tests

Required:

```text
Unit tests
Integration tests
API tests
Database tests
Worker tests
Notification tests
End-to-end dashboard tests
```

Test scenarios:

- Successful HTTP check
- HTTP timeout
- DNS failure
- Invalid SSL certificate
- Missed heartbeat
- Failed notification
- Duplicate incident
- Recovery event
- Maintenance window
- Alert escalation
- Permission restriction

#### Acceptance Criteria

- [ ] Critical backend modules have automated tests
- [ ] Tests run in CI
- [ ] Failed tests block deployment
- [ ] Test fixtures do not contain real client data

---

## 24. Deployment Requirements

### Task 20.1: Create Deployment Pipeline

Pipeline stages:

```text
Install dependencies
Run linting
Run type checking
Run tests
Build applications
Run database migrations
Deploy API
Deploy worker
Deploy dashboard
Run smoke tests
```

#### Acceptance Criteria

- [ ] Deployment is automated
- [ ] Rollback is documented
- [ ] Migrations are version-controlled
- [ ] Production smoke tests run after deployment
- [ ] Deployment failures generate alerts

---

## 25. Minimum Viable Product

The first usable version should include:

- [ ] User authentication
- [ ] Organisations and projects
- [ ] HTTP monitoring
- [ ] API response validation
- [ ] TCP port monitoring
- [ ] Heartbeat monitoring
- [ ] SSL expiry monitoring
- [ ] Incident creation
- [ ] Email alerts
- [ ] Slack or Teams alerts
- [ ] Dashboard
- [ ] Response-time history
- [ ] Uptime reports
- [ ] Maintenance windows
- [ ] Audit logging

Do not include advanced machine-learning anomaly detection in the first release.

---

## 26. Suggested Implementation Order

### Sprint 1

- Project setup
- Database schema
- Authentication
- Organisations
- Projects
- Environments

### Sprint 2

- Monitor CRUD
- HTTP worker
- Check result storage
- Basic dashboard

### Sprint 3

- Retry logic
- Incident engine
- Recovery detection
- Email alerts

### Sprint 4

- Heartbeats
- Scheduled-job monitoring
- Job execution tracking

### Sprint 5

- TCP monitoring
- SSL monitoring
- Response validation

### Sprint 6

- Slack, Teams, SMS, and WhatsApp
- Alert escalation
- Alert deduplication

### Sprint 7

- Maintenance windows
- Reports
- Audit logs
- Role permissions

### Sprint 8

- Synthetic workflows
- Insightly monitoring
- Email canary monitoring

### Sprint 9

- Monitoring SDK
- Client integration documentation
- Deployment templates

### Sprint 10

- Statistical anomaly detection
- Performance optimisation
- Security review
- Production hardening

---

## 27. Definition of Done

The platform is ready for production when:

- [ ] Multiple projects can be monitored
- [ ] HTTP, ports, SSL, and heartbeats work reliably
- [ ] Incidents are created and resolved correctly
- [ ] Duplicate alerts are suppressed
- [ ] Email and Teams or Slack alerts work
- [ ] Escalation rules work
- [ ] Maintenance windows work
- [ ] Users can see uptime and response-time history
- [ ] Secrets are encrypted
- [ ] Roles and permissions are enforced
- [ ] Audit logs are available
- [ ] Automated tests pass
- [ ] Deployment is automated
- [ ] The monitoring system is externally monitored
- [ ] Documentation is complete
