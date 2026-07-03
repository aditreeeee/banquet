# CLAUDE.md

# Enterprise Development Instructions

## Project Overview

This repository contains a **production-grade Enterprise Banquet Hall Booking & Management System**. The application is intended for real-world commercial deployment and must be developed with enterprise software engineering standards. This is **not** a prototype, demo, MVP, or proof of concept.

Every implementation should prioritize scalability, maintainability, security, modularity, performance, and clean architecture.

---

# Project Scale

The application must support:

- 1000+ Banquet Halls
- Multi-Tenant Architecture
- Multiple Companies
- Multiple Branches
- Millions of Bookings
- Hundreds of Thousands of Customers
- Thousands of Concurrent Users
- Large MSSQL Databases
- Future Cloud Deployment

Every architectural decision should assume continuous growth.

---

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

- Parameterized Queries
- Stored Procedures
- Views
- Transactions
- Foreign Keys
- Indexes
- Composite Indexes
- Constraints

Never generate raw SQL queries vulnerable to SQL Injection.

---

# Development Philosophy

Always write code as if another senior engineer will maintain it for the next 10 years.

Every solution should be:

- Production Ready
- Modular
- Maintainable
- Reusable
- Secure
- Tested
- Optimized

Never sacrifice long-term maintainability for short-term convenience.

---

# Architecture

Follow Clean Architecture.

Separate concerns into:

```
Controllers
Routes
Services
Repositories
Middleware
Models
Utilities
Configuration
Validators
DTOs
Components
Layouts
Assets
Public
Views
Database
Documentation
```

Business logic must never exist inside routes.

Routes should only call controllers.

Controllers should delegate work to services.

Services should communicate with repositories.

Repositories should handle database operations.

---

# Coding Standards

Always follow:

- SOLID Principles
- DRY
- KISS
- YAGNI
- Clean Code
- Separation of Concerns
- Dependency Injection where appropriate

Never duplicate code.

Extract reusable functions.

Use descriptive naming.

Keep files focused on a single responsibility.

---

# JavaScript Standards

Use modern ES6+ syntax.

Prefer:

- const
- let
- async/await
- template literals
- arrow functions (where appropriate)
- modules

Avoid:

- var
- callback hell
- deeply nested conditions
- duplicated event listeners

Use event delegation when possible.

---

# HTML Standards

Generate semantic HTML5.

Always include:

- Proper headings
- Labels
- Accessible forms
- ARIA attributes where appropriate
- Mobile responsiveness

Avoid unnecessary wrappers.

---

# CSS Standards

Use:

Bootstrap for layout.

Tailwind for utility styling where beneficial.

Custom CSS only when required.

Avoid inline CSS.

Organize styles logically.

Follow:

- Mobile First
- Responsive Design
- Reusable Components
- Design Tokens
- CSS Variables

---

# UI Standards

Every screen must have:

- Responsive Layout
- Breadcrumbs
- Search
- Filters
- Pagination
- Loading State
- Empty State
- Error State
- Success Messages
- Toast Notifications
- Form Validation

Maintain consistent spacing and typography.

---

# Component Rules

Create reusable components.

Never duplicate:

- Cards
- Tables
- Forms
- Buttons
- Modals
- Sidebars
- Navigation
- Alerts
- Pagination
- Filters

If similar code exists, reuse it.

---

# Database Standards

Microsoft SQL Server only.

Design:

- Fully Normalized (3NF)
- Foreign Keys
- Constraints
- Indexes
- Composite Indexes
- Views
- Stored Procedures

Optimize for millions of records.

Always use transactions where data consistency matters.

---

# Query Standards

Prefer:

Stored Procedures

Parameterized Queries

Indexed Searches

Pagination

Avoid:

SELECT *

Table scans

N+1 Queries

Duplicate Queries

Repeated Database Calls

---

# Authentication

Implement:

JWT

Refresh Tokens

Role-Based Access Control

Secure Password Hashing

Session Management

Account Lockout

Password Reset

OTP

Email Verification

---

# Authorization

Never hardcode permissions.

Use RBAC.

Every API should verify:

Authentication

Authorization

Permission

Company

Branch

Ownership

---

# Validation

Always validate:

Frontend

Backend

Database

Never trust client-side input.

Validate:

Email

Phone

Dates

Amounts

IDs

Uploads

File Types

File Sizes

---

# Security

Follow OWASP Top 10.

Prevent:

SQL Injection

XSS

CSRF

Clickjacking

Broken Authentication

Sensitive Data Exposure

Always:

Sanitize Input

Validate Output

Escape HTML

Hash Passwords

Use HTTPS

Rate Limit APIs

Log Security Events

---

# Error Handling

Never expose stack traces.

Use:

Structured Error Responses

Meaningful Messages

Logging

Graceful Recovery

---

# Logging

Log:

Authentication

Bookings

Payments

Errors

Warnings

Security Events

API Calls

Administrative Actions

Never log passwords or sensitive secrets.

---

# Performance

Optimize:

Database Queries

JavaScript

Images

Assets

API Responses

Use:

Lazy Loading

Pagination

Caching

Compression

Connection Pooling

Debouncing

Throttling

Virtual Tables

---

# Booking Engine

The booking system must prevent:

Double Booking

Race Conditions

Conflicting Reservations

Timezone Issues

Concurrent Updates

Availability should always be verified server-side before confirmation.

---

# Payment Module

Payment gateways will be integrated later.

For now implement:

Pending Payments

Advance Payments

Partial Payments

Refund Workflow

Payment Status

Transaction History

Invoice Generation

The architecture should make adding Razorpay, Stripe, PayPal, or other providers straightforward without major refactoring.

---

# Reporting

Reports should support:

Daily

Weekly

Monthly

Quarterly

Yearly

Custom Date Range

Export:

Excel

PDF

CSV

---

# Audit Trail

Track:

User

Date

Time

IP Address

Browser

Old Value

New Value

Action

Every critical change must be auditable.

---

# Notifications

Support future integrations:

Email

SMS

WhatsApp

Push Notifications

Notifications should be abstracted behind a service layer.

---

# Future Integrations

Design with extension points for:

Payment Gateways

Google Maps

Google Calendar

Outlook Calendar

SMS Providers

WhatsApp Business API

Email Providers

AI Recommendations

Mobile Applications

QR Check-In

Biometric Attendance

Third-Party Vendors

---

# Git Standards

Write meaningful commit messages.

Separate features into logical commits.

Never commit:

node_modules

.env

Credentials

API Keys

Generated Files

---

# Documentation

Every module should include:

Purpose

Dependencies

Usage

Configuration

API Endpoints

Expected Inputs

Outputs

---

# Code Generation Rules

When generating code:

Always generate complete implementations.

Do not leave TODO placeholders unless explicitly requested.

Do not generate pseudo-code.

Generate production-ready code.

If an implementation spans multiple files, produce every required file.

Maintain consistency across the project.

---

# Decision Making

Whenever multiple implementation options exist:

Choose the one that provides:

- Better scalability
- Better security
- Better maintainability
- Better readability
- Better long-term performance

Do not choose shortcuts that increase future technical debt.

---

# General Rules

Always think like an Enterprise Software Architect before writing code.

Prioritize:

1. Correctness
2. Security
3. Scalability
4. Performance
5. Maintainability
6. Readability
7. Reusability

Every piece of code should be suitable for deployment in a production environment without requiring significant rewrites.