-- =============================================================================
-- Migration 017 — Staff profile fields
-- Run AFTER 001..016
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Staff are Users with a role (no separate Staff table — see user.repository.js)
-- gain production-ready HR fields: identity (employee code), org placement
-- (department/designation/property), availability/employment state, and
-- scheduling metadata (skills/certifications/emergency contact/joining date).
-- "Current Assignment" and "Weekly Schedule" are deliberately NOT stored
-- columns — they're derived live from BookingStaffAssignments/Bookings the
-- same way Resources.getInventorySnapshot() derives reserved/available, so
-- they can never drift out of sync with actual assignments.
-- =============================================================================
USE BanquetDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'employee_code')
    ALTER TABLE Users ADD employee_code NVARCHAR(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_users_employee_code')
    CREATE UNIQUE INDEX UQ_users_employee_code ON Users(company_id, employee_code) WHERE employee_code IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'department')
    ALTER TABLE Users ADD department NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'designation')
    ALTER TABLE Users ADD designation NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'property_id')
    ALTER TABLE Users ADD property_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_users_property')
    ALTER TABLE Users ADD CONSTRAINT FK_users_property FOREIGN KEY (property_id) REFERENCES Banquets(banquet_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'availability_status')
    ALTER TABLE Users ADD availability_status NVARCHAR(20) NOT NULL DEFAULT 'available';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_users_availability_status')
    ALTER TABLE Users ADD CONSTRAINT CHK_users_availability_status
        CHECK (availability_status IN ('available','on_duty','on_leave','off_duty'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'employment_status')
    ALTER TABLE Users ADD employment_status NVARCHAR(20) NOT NULL DEFAULT 'active';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_users_employment_status')
    ALTER TABLE Users ADD CONSTRAINT CHK_users_employment_status
        CHECK (employment_status IN ('active','on_leave','resigned','terminated'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'joining_date')
    ALTER TABLE Users ADD joining_date DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'skills')
    ALTER TABLE Users ADD skills NVARCHAR(500) NULL; -- comma-separated tags
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'certifications')
    ALTER TABLE Users ADD certifications NVARCHAR(500) NULL; -- comma-separated tags
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'emergency_contact_name')
    ALTER TABLE Users ADD emergency_contact_name NVARCHAR(150) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'emergency_contact_phone')
    ALTER TABLE Users ADD emergency_contact_phone NVARCHAR(20) NULL;
GO
