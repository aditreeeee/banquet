# CLAUDE.md

# Enterprise Development Instructions
## Project Overview
## Project
This repository contains a production-grade Enterprise Banquet Hall Booking & Management System intended for real-world commercial deployment.
Build every feature with scalability, maintainability, security, performance, and clean architecture in mind.
The application must support:
- Multi-tenant architecture
- Multiple companies and branches
- 1000+ banquet halls
- Millions of bookings
- Hundreds of thousands of customers
- Thousands of concurrent users
- Future cloud deployment

# Technology Stack
## Frontend
- HTML5
- CSS3
- Bootstrap 5
- Tailwind CSS
- JavaScript (ES6+)
- AJAX
- Chart.js
- FullCalendar.js
## Backend
- Node.js
- Express.js
## Database
Microsoft SQL Server (MSSQL)
Use:
- Parameterized queries
- Stored procedures
- Views
- Transactions
- Foreign keys
- Indexes
- Constraints
Never generate SQL vulnerable to injection.

# Architecture
Follow Clean Architecture.
Separate responsibilities into:
- Routes
- Controllers
- Services
- Repositories
- Models
- Middleware
- Validators
- DTOs
- Utilities
- Configuration
Rules:
- Routes only call controllers.
- Controllers delegate to services.
- Services contain business logic.
- Repositories handle database access.
- Never place business logic inside routes.

# Development Standards
Write production-ready code. Follow:
- SOLID
- DRY
- KISS
- YAGNI
- Separation of Concerns
Always prefer maintainable and reusable solutions over shortcuts.
Use descriptive names and keep files focused on a single responsibility.

# Frontend Standards
Use:
- Semantic HTML5
- Responsive design
- Bootstrap components
- Tailwind utilities where appropriate
Every page should include, where applicable:
- Search
- Filters
- Pagination
- Loading state
- Empty state
- Error state
- Toast notifications
- Client-side validation
Create reusable components.
Avoid duplicate code.

# JavaScript
Use modern ES6+ syntax.
Prefer:
- const / let
- async/await
- Modules
- Event delegation
- Template literals
Avoid:
- var
- Callback hell
- Duplicate event listeners
- Deep nesting

# Database
Design for large-scale production.
Requirements:
- Normalized schema (3NF)
- Foreign keys
- Constraints
- Indexes
- Transactions
- Stored procedures where appropriate
Avoid:
- SELECT *
- Table scans
- Duplicate queries
- N+1 queries
Always use parameterized queries.

# Security
Follow OWASP best practices.
Always:
- Validate input
- Sanitize data
- Escape output
- Hash passwords
- Enforce RBAC
- Verify authentication & authorization
- Rate-limit APIs
Never expose stack traces or sensitive information.

# Authentication
Implement:
- JWT
- Refresh Tokens
- RBAC
- Password hashing
- Password reset
- OTP support
- Session management
Never hardcode permissions.

# Booking System
Prevent:
- Double bookings
- Race conditions
- Conflicting reservations
- Concurrent update issues
Availability must always be validated server-side.

# Performance
Optimize:
- Database queries
- API responses
- JavaScript
- Assets
Use:
- Pagination
- Lazy loading
- Compression
- Connection pooling
- Caching where appropriate
# Logging & Audit
Log:
- Authentication
- Administrative actions
- Bookings
- Payments
- Errors
- Security events
Support complete audit trails including user, timestamp, IP, action, previous value, and new value.
Never log passwords or secrets.
# Future Architecture
Design extensible services for future integration with:
- Payment gateways
- Email
- SMS
- WhatsApp
- Google Maps
- Google Calendar
- Mobile applications
- AI features
- QR check-in
Avoid tightly coupled implementations.
# Code Generation Rules
Always generate complete, production-ready implementations.
Never generate placeholder code or TODOs unless explicitly requested.
If changes span multiple files, update every required file.
Maintain consistency with the existing project architecture.
# Decision Making
When multiple solutions exist, choose the one that maximizes:
1. Correctness
2. Security
3. Scalability
4. Performance
5. Maintainability
6. Readability
7. Reusability

Never introduce unnecessary technical debt.
