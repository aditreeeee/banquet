# System Architecture — Banquet Hall Booking & Management System

**Version:** 1.0.0  
**Last Updated:** 2026-06-30  
**Architect:** Enterprise Architecture Team  
**Deployment Target:** Windows Server 2019/2022 + IIS + MSSQL

---

## 1. Architecture Overview

The system follows a **Layered Clean Architecture** combined with **MVC** on the frontend and a **Repository Pattern + Service Layer** on the backend. It is designed as a **multi-tenant SaaS platform** supporting thousands of concurrent users across hundreds of companies and branches.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│   Browser (HTML5 / Bootstrap 5 / Tailwind / JS ES6+ / AJAX)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────┐
│                      IIS / REVERSE PROXY                        │
│            iisnode  |  SSL Termination  |  Static Files         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    API GATEWAY LAYER                            │
│         Rate Limiting | CORS | Request Logging | Auth Guard     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│               EXPRESS.JS APPLICATION LAYER                      │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │   Routes     │  │  Controllers │  │    Middleware       │   │
│  │  /api/v1/..  │→ │  (handlers)  │→ │ Auth|Valid|Limit   │   │
│  └──────────────┘  └──────┬───────┘  └────────────────────┘   │
│                           │                                     │
│                    ┌──────▼───────┐                            │
│                    │   Services   │  ← Business Logic          │
│                    └──────┬───────┘                            │
│                           │                                     │
│                    ┌──────▼───────┐                            │
│                    │ Repositories │  ← Data Access Layer       │
│                    └──────┬───────┘                            │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                   MICROSOFT SQL SERVER                          │
│  Tables | Stored Procedures | Views | Triggers | Indexes        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Tenant Architecture

The system uses a **Shared Database, Shared Schema** multi-tenant model with tenant isolation at the data layer via `company_id` and `branch_id` columns.

### Tenant Hierarchy
```
Super Admin (Platform Level)
└── Company (Tenant)
    ├── Branch 1
    │   ├── Banquet Hall A
    │   │   ├── Hall 1
    │   │   └── Hall 2
    │   └── Banquet Hall B
    └── Branch 2
        └── Banquet Hall C
```

### Tenant Isolation Strategy
- Every table that belongs to a tenant includes `company_id` (and `branch_id` where applicable)
- All repository queries automatically scope to the authenticated user's `company_id`
- Row-Level Security (RLS) enforced at both application and database level
- Super Admin bypasses tenant filters

---

## 3. Authentication & Authorization Architecture

### JWT Flow
```
[Login Request]
     ↓
[Validate Credentials] → [Generate Access Token (15min) + Refresh Token (7d)]
     ↓
[Store Refresh Token in DB (hashed)]
     ↓
[Return tokens to client]

[API Request]
     ↓
[Bearer token in Authorization header]
     ↓
[JWT Middleware] → [Verify signature + expiry]
     ↓
[Load user + roles + permissions from DB / cache]
     ↓
[RBAC middleware checks permission for route]
     ↓
[Pass req.user to controller]
```

### Token Strategy
| Token | Expiry | Storage | Purpose |
|-------|--------|---------|---------|
| Access Token | 15 minutes | Memory / JS variable | API authorization |
| Refresh Token | 7 days | HttpOnly Cookie + DB | Silent re-auth |
| OTP Token | 10 minutes | DB (hashed) | Email/SMS verification |
| Password Reset | 1 hour | DB (hashed) | Password recovery |

### RBAC Implementation
- Permissions stored in DB (`permissions` table)
- Roles have many-to-many relationship with permissions (`role_permissions`)
- Permission format: `module:action` (e.g., `bookings:create`, `reports:export`)
- Cached in-memory per role for performance (TTL: 5 minutes)

---

## 4. API Design

### Versioning Strategy
All APIs are prefixed with version: `/api/v1/`

Future versions: `/api/v2/` — old versions remain active for backward compatibility.

### REST Convention
```
GET    /api/v1/bookings          → List bookings (paginated)
POST   /api/v1/bookings          → Create booking
GET    /api/v1/bookings/:id      → Get single booking
PUT    /api/v1/bookings/:id      → Full update
PATCH  /api/v1/bookings/:id      → Partial update
DELETE /api/v1/bookings/:id      → Soft delete
```

### Standard API Response Envelope
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Bookings retrieved successfully",
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 4583,
    "totalPages": 230
  },
  "timestamp": "2026-06-30T10:30:00Z"
}
```

### Error Response
```json
{
  "success": false,
  "statusCode": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ],
  "timestamp": "2026-06-30T10:30:00Z"
}
```

---

## 5. Core Module Architecture

### Booking Engine
The booking engine is the most critical component. It handles:

1. **Availability Check** — Real-time hall availability query (with row-level locking)
2. **Conflict Detection** — Overlapping booking detection
3. **Price Calculation** — Dynamic pricing engine (base + peak + festival + discounts)
4. **Multi-step Wizard State** — Booking draft saved at each step
5. **Payment Hold** — Booking held for 15 minutes during payment
6. **Confirmation** — Atomic booking confirmation with invoice generation

```
BookingController
    → BookingService
        → AvailabilityRepository (check conflicts)
        → PricingService (calculate total)
        → BookingRepository (create draft)
        → PaymentService (process payment)
        → InvoiceService (generate invoice)
        → NotificationService (send confirmation)
        → AuditService (log action)
```

### Pricing Engine
```
BasePrice
  + PeakSurcharge (weekend/season multiplier)
  + FestivalSurcharge
  + ServiceCharge
  + Decoration Add-ons
  + Catering (per plate × headcount)
  + Technical Add-ons
  − CouponDiscount
  + GST (CGST + SGST or IGST)
  = GrandTotal
```

---

## 6. Database Architecture

### Connection Pooling
```javascript
{
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  pool: {
    max: 20,      // max connections
    min: 5,       // min idle connections
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 15000
  },
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
}
```

### Query Strategy
- **Simple CRUD** — Parameterized queries via `mssql` package
- **Complex business logic** — Stored Procedures
- **Reporting** — Views + optimized SELECT with indexes
- **Transactions** — Multi-step operations wrapped in explicit transactions

---

## 7. Security Architecture

### Defense in Depth
```
Layer 1: IIS / Network  → HTTPS, IP filtering, DDoS protection
Layer 2: Application    → Rate limiting, CORS, CSRF tokens
Layer 3: API            → JWT auth, RBAC, input validation
Layer 4: Database       → Parameterized queries, SP-only access, least privilege
Layer 5: Data           → Encryption at rest, PII masking in logs
```

### Key Security Controls
| Control | Implementation |
|---------|---------------|
| SQL Injection | Parameterized queries + Stored Procedures only |
| XSS | DOMPurify on frontend, helmet.js on backend, CSP headers |
| CSRF | CSRF tokens for state-changing requests |
| Rate Limiting | express-rate-limit (100 req/min per IP) |
| Password Hashing | bcrypt (cost factor 12) |
| Sensitive Data | AES-256 encryption for PII fields |
| Audit Trail | Every write operation logged with user/IP/timestamp |
| Session Security | HttpOnly + Secure + SameSite cookies |

---

## 8. Performance Architecture

### Caching Strategy
```
L1: In-Memory Cache (node-cache)
    → Permissions per role (TTL: 5min)
    → Hall availability (TTL: 30sec)
    → Pricing config (TTL: 10min)

L2: Application-level Result Cache
    → Dashboard KPIs (TTL: 1min)
    → Report aggregations (TTL: 5min)
```

### Database Performance
- Composite indexes on high-frequency queries (bookings by date+hall, customers by company)
- Covering indexes for report queries
- Partitioning on `bookings` table by `booking_date` (yearly)
- Read replicas for reporting queries (Phase 5)

### Frontend Performance
- Assets served from IIS static file handler (fast)
- Bootstrap + Tailwind minified in production
- Lazy loading for images and non-critical JS
- Virtual scroll for large data tables (10,000+ rows)
- Skeleton loading screens for perceived performance

---

## 9. Deployment Architecture (Windows Server + IIS)

```
Internet
    ↓
Windows Firewall (ports 80, 443 only)
    ↓
IIS 10 (SSL Termination, static files, URL rewrite)
    ↓ (via iisnode)
Node.js Process (port 3000, managed by iisnode)
    ↓
MSSQL Server (port 1433, local or same network)
```

### IIS Configuration
- **iisnode** module routes Node.js requests
- **URL Rewrite** module for SPA routing and API proxy
- **Static file handler** for `/frontend/public/`
- **SSL certificate** via Let's Encrypt or internal CA
- **Application Pool** — No Managed Code, 64-bit

### Process Management
- iisnode handles process recycling and crash recovery
- Log rotation via iisnode `loggingEnabled` + logrotate equivalent
- Health check endpoint: `GET /api/v1/health`

---

## 10. Future Integration Points

The architecture is designed to accommodate these future integrations without major refactoring:

| Integration | Approach |
|-------------|----------|
| Payment Gateways (Razorpay, Stripe) | `PaymentService` with strategy pattern — add new provider |
| WhatsApp / SMS | `NotificationService` with channel abstraction |
| Email (SendGrid, SES) | `EmailService` with provider interface |
| Mobile App (iOS/Android) | Same REST API, add Firebase push notification channel |
| AI Recommendations | New `/api/v1/recommendations` module using ML service |
| Google Calendar | OAuth2 integration in `CalendarService` |
| Multi-Currency | `CurrencyService` with exchange rate cache |
| Multi-Language | i18n middleware + translation tables in DB |
| CDN | Configure IIS to serve `/assets/` from CDN URL |
| Redis Cache | Swap `node-cache` with `ioredis` in cache layer |

---

## 11. Logging & Monitoring

```
Application Logs → /backend/logs/
  app-YYYY-MM-DD.log     (info, warn, error)
  access-YYYY-MM-DD.log  (HTTP request log)
  audit-YYYY-MM-DD.log   (user actions)
  error-YYYY-MM-DD.log   (errors only)

Log Format (JSON):
{
  "timestamp": "2026-06-30T10:30:00Z",
  "level": "info",
  "message": "Booking created",
  "userId": 1234,
  "companyId": 5,
  "requestId": "uuid-v4",
  "ip": "192.168.1.1",
  "duration": "45ms"
}
```

Logger: **Winston** with daily rotate file transport.

---

## 12. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM vs Raw SQL | Raw SQL + Stored Procedures | Performance, security, complex queries |
| Session vs JWT | JWT + Refresh Tokens | Stateless, scalable, mobile-ready |
| Monolith vs Microservices | Modular Monolith | Easier deployment, can extract to services later |
| Multi-tenant model | Shared DB + Shared Schema | Cost-effective, simpler for Phase 1 |
| Frontend SPA vs MPA | MPA with AJAX enhancement | No build step needed, progressive enhancement |
| Cache | In-memory (node-cache) | Simple, no extra infrastructure for Phase 1 |
| File storage | Local disk (IIS static) | Simple for Phase 1; add Azure Blob / S3 in future |
