# Banquet Hall Booking & Management System
### Enterprise-Grade SaaS Platform | Phase 1

---

## Project Overview

A production-ready, multi-tenant Banquet Hall Booking & Management System designed to support 1000+ banquet halls, hundreds of thousands of customers, and millions of booking records with high concurrent traffic.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Bootstrap 5, Tailwind CSS, JavaScript ES6+, AJAX |
| Backend | Node.js, Express.js |
| Database | Microsoft SQL Server (MSSQL) |
| Auth | JWT, Refresh Tokens, RBAC |
| Deployment | Windows Server + IIS (iisnode) |

## Phase Roadmap

- [x] **Phase 1** — Architecture, Folder Structure, DB Design, ER Diagram, Roles & Permissions
- [ ] **Phase 2** — Complete MSSQL Database (Tables, SPs, Views, Triggers, Seeds)
- [ ] **Phase 3** — Production Frontend (Dashboard, Forms, Tables, Calendar, Charts)
- [ ] **Phase 4** — Node.js + Express Backend (REST APIs, Auth, Booking Engine)
- [ ] **Phase 5** — Testing, Security Hardening, Performance, Deployment Guide

## Project Structure

```
banquet-booking-system/
├── backend/                    # Node.js + Express API
│   ├── src/
│   │   ├── api/v1/            # Versioned REST API
│   │   │   ├── routes/        # Express route definitions
│   │   │   ├── controllers/   # Request handlers
│   │   │   ├── middleware/    # Auth, rate-limit, validation
│   │   │   └── validators/    # Joi/express-validator schemas
│   │   ├── services/          # Business logic layer
│   │   ├── repositories/      # Data access layer (DB queries)
│   │   ├── models/            # Data models / DTOs
│   │   ├── utils/             # Shared utilities
│   │   ├── helpers/           # Formatting, PDF, email helpers
│   │   ├── jobs/              # Cron jobs (reminders, cleanup)
│   │   ├── events/            # Event emitters (booking events)
│   │   ├── config/            # App configuration
│   │   ├── constants/         # Enums, status codes, messages
│   │   ├── cache/             # Redis/in-memory cache layer
│   │   └── types/             # TypeScript-style JSDoc types
│   ├── uploads/               # User file uploads
│   ├── logs/                  # Application logs
│   └── tests/                 # Unit, integration, e2e tests
│
├── frontend/                   # HTML5 + Bootstrap 5 + Tailwind
│   ├── public/
│   │   └── assets/            # CSS, JS, images, fonts, vendors
│   └── src/
│       ├── components/        # Reusable UI components
│       ├── layouts/           # Page layouts (admin, auth, public)
│       ├── pages/             # Full page views
│       ├── services/          # API call helpers (AJAX)
│       ├── utils/             # Frontend utilities
│       └── store/             # Client-side state management
│
├── database/                   # MSSQL scripts
│   ├── migrations/            # Ordered schema migration scripts
│   ├── stored-procedures/     # All stored procedures
│   ├── views/                 # Database views
│   ├── triggers/              # DB triggers
│   ├── functions/             # Scalar & table-valued functions
│   ├── indexes/               # Index creation scripts
│   └── seeds/                 # Sample / seed data
│
├── docs/                       # Project documentation
│   ├── architecture/          # Architecture decisions
│   ├── api/                   # API reference
│   ├── database/              # ER diagrams, schema docs
│   └── deployment/            # IIS setup, environment guide
│
├── config/                     # Root environment configs
├── scripts/                    # Utility / deployment scripts
└── logs/                       # Root-level logs
```

## Quick Start (Development)

```bash
# 1. Clone and install dependencies
git clone https://github.com/aditreeeee/banquet.git
cd banquet-booking-system/backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MSSQL credentials

# 3. Run database migrations
npm run db:migrate

# 4. Seed sample data
npm run db:seed

# 5. Start development server
npm run dev
```

## Documentation

- [System Architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)
- [Database Schema](docs/database/SCHEMA.md)
- [Roles & Permissions](docs/architecture/ROLES_PERMISSIONS.md)
- [API Reference](docs/api/API_REFERENCE.md)
- [Deployment Guide](docs/deployment/IIS_DEPLOYMENT.md)
