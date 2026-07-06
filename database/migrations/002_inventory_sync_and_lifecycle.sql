-- =============================================================================
-- Migration 002 — Inventory synchronization + booking lifecycle widening
-- Run AFTER 001_create_schema.sql
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- ─── Widen Bookings status CHECK to include 'tentative' / 'archived' ─────────
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_booking_status')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = 'CHK_booking_status' AND definition LIKE '%tentative%'
   )
BEGIN
    ALTER TABLE Bookings DROP CONSTRAINT CHK_booking_status;
    ALTER TABLE Bookings ADD CONSTRAINT CHK_booking_status
        CHECK (status IN ('draft','tentative','confirmed','advance_paid','fully_paid','cancelled','completed','archived','no_show'));
END
GO

-- ─── Resources (shared inventory) ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Resources')
BEGIN
    CREATE TABLE Resources (
        resource_id         INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        branch_id           INT             NULL,
        resource_name       NVARCHAR(200)   NOT NULL,
        resource_type       NVARCHAR(100)   NULL,
        unit_price          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
        quantity_available  INT             NOT NULL DEFAULT 0,
        is_active           BIT             NOT NULL DEFAULT 1,
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_resources PRIMARY KEY (resource_id),
        CONSTRAINT FK_resources_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

-- ─── BookingResources (allocations — shared inventory reserved per booking) ──
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BookingResources')
BEGIN
    CREATE TABLE BookingResources (
        allocation_id       INT             NOT NULL IDENTITY(1,1),
        booking_id          BIGINT          NOT NULL,
        resource_id         INT             NOT NULL,
        quantity_allocated  INT             NOT NULL,
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_resources PRIMARY KEY (allocation_id),
        CONSTRAINT FK_br_booking  FOREIGN KEY (booking_id)  REFERENCES Bookings(booking_id),
        CONSTRAINT FK_br_resource FOREIGN KEY (resource_id) REFERENCES Resources(resource_id),
        CONSTRAINT UQ_br_booking_resource UNIQUE (booking_id, resource_id),
        CONSTRAINT CHK_br_qty CHECK (quantity_allocated > 0)
    );

    CREATE INDEX IX_br_resource ON BookingResources(resource_id, booking_id);
END
GO

-- ─── BookingContacts (Alternative Contacts on a booking) ─────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BookingContacts')
BEGIN
    CREATE TABLE BookingContacts (
        contact_id      INT             NOT NULL IDENTITY(1,1),
        booking_id      BIGINT          NOT NULL,
        contact_name    NVARCHAR(150)   NOT NULL,
        mobile          NVARCHAR(20)    NULL,
        email           NVARCHAR(150)   NULL,
        relationship    NVARCHAR(100)   NULL,
        notes           NVARCHAR(500)   NULL,
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_contacts PRIMARY KEY (contact_id),
        CONSTRAINT FK_bc_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id)
    );

    CREATE INDEX IX_bc_booking ON BookingContacts(booking_id);
END
GO

-- ─── Priority booking columns ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'is_priority')
BEGIN
    ALTER TABLE Bookings ADD is_priority BIT NOT NULL DEFAULT 0;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'priority_surcharge')
BEGIN
    ALTER TABLE Bookings ADD priority_surcharge DECIMAL(12,2) NOT NULL DEFAULT 0;
END
GO

-- ─── Bookings.created_at/updated_at defaults: GETDATE() -> GETUTCDATE() ──────
DECLARE @constraintName NVARCHAR(200);

SELECT @constraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('Bookings') AND c.name = 'created_at' AND dc.definition = '(getdate())';
IF @constraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE Bookings DROP CONSTRAINT ' + @constraintName);
    EXEC('ALTER TABLE Bookings ADD CONSTRAINT DF_bookings_created_at DEFAULT GETUTCDATE() FOR created_at');
END

SELECT @constraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('Bookings') AND c.name = 'updated_at' AND dc.definition = '(getdate())';
IF @constraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE Bookings DROP CONSTRAINT ' + @constraintName);
    EXEC('ALTER TABLE Bookings ADD CONSTRAINT DF_bookings_updated_at DEFAULT GETUTCDATE() FOR updated_at');
END
GO

-- ─── MenuItems tax/cost fields ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'tax_percent')
BEGIN
    ALTER TABLE MenuItems ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'unit_cost')
BEGIN
    ALTER TABLE MenuItems ADD unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;
END
GO

-- ─── Catering permissions (constants existed with no seeded rows) ────────────
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'catering:read')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('catering','read','catering:read','View menu items and catering packages');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'catering:create')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('catering','create','catering:create','Create menu items');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'catering:update')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('catering','update','catering:update','Edit menu items');
GO
INSERT INTO RolePermissions (role_id, permission_id)
SELECT 6, p.permission_id FROM Permissions p
WHERE p.permission_key IN ('catering:read','catering:create','catering:update')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = 6 AND rp.permission_id = p.permission_id);
GO

-- ─── Master Booking / Child Occupancy Slots ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'parent_booking_id')
BEGIN
    ALTER TABLE Bookings ADD parent_booking_id BIGINT NULL;
    ALTER TABLE Bookings ADD CONSTRAINT FK_bookings_parent FOREIGN KEY (parent_booking_id) REFERENCES Bookings(booking_id);
    CREATE INDEX IX_bookings_parent ON Bookings(parent_booking_id);
END
GO

-- ─── Event details expansion + multi-day + setup/cleanup/cool-off buffers ────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'theme')
    ALTER TABLE Bookings ADD theme NVARCHAR(200) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'decoration_notes')
    ALTER TABLE Bookings ADD decoration_notes NVARCHAR(1000) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'utilities')
    ALTER TABLE Bookings ADD utilities NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'staff_count')
    ALTER TABLE Bookings ADD staff_count INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'event_end_date')
    ALTER TABLE Bookings ADD event_end_date DATE NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'setup_minutes')
    ALTER TABLE Bookings ADD setup_minutes INT NOT NULL DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cleanup_minutes')
    ALTER TABLE Bookings ADD cleanup_minutes INT NOT NULL DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cooloff_minutes')
    ALTER TABLE Bookings ADD cooloff_minutes INT NOT NULL DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cleanup_charge')
    ALTER TABLE Bookings ADD cleanup_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'late_exit_charge')
    ALTER TABLE Bookings ADD late_exit_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO

-- ─── Owner overrides: block_type on HallBlockedDates ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('HallBlockedDates') AND name = 'block_type')
BEGIN
    ALTER TABLE HallBlockedDates ADD block_type NVARCHAR(30) NOT NULL DEFAULT 'maintenance';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_block_type')
BEGIN
    ALTER TABLE HallBlockedDates ADD CONSTRAINT CHK_block_type
        CHECK (block_type IN ('maintenance', 'vip_hold', 'emergency_closure', 'blackout'));
END
GO

-- ─── Sales pipeline: Leads table ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Leads')
BEGIN
    CREATE TABLE Leads (
        lead_id             INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        branch_id           INT             NULL,
        customer_id         INT             NULL,
        contact_name        NVARCHAR(150)   NOT NULL,
        contact_phone       NVARCHAR(20)    NULL,
        contact_email       NVARCHAR(150)   NULL,
        event_type          NVARCHAR(50)    NULL,
        preferred_date      DATE            NULL,
        guest_count         INT             NULL,
        estimated_budget    DECIMAL(14,2)   NULL,
        score               NVARCHAR(10)    NOT NULL DEFAULT 'low',
        source              NVARCHAR(50)    NULL,
        stage               NVARCHAR(20)    NOT NULL DEFAULT 'inquiry',
        assigned_to         INT             NULL,
        notes               NVARCHAR(2000)  NULL,
        lost_reason         NVARCHAR(500)   NULL,
        converted_booking_id BIGINT         NULL,
        created_by          INT             NOT NULL,
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_leads PRIMARY KEY (lead_id),
        CONSTRAINT FK_leads_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_leads_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        CONSTRAINT FK_leads_assigned FOREIGN KEY (assigned_to) REFERENCES Users(user_id),
        CONSTRAINT FK_leads_booking FOREIGN KEY (converted_booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_leads_creator FOREIGN KEY (created_by) REFERENCES Users(user_id),
        CONSTRAINT CHK_lead_stage CHECK (stage IN ('inquiry','lead','quotation','tentative','confirmed','completed','lost')),
        CONSTRAINT CHK_lead_score CHECK (score IN ('high','medium','low'))
    );

    CREATE INDEX IX_leads_company_stage ON Leads(company_id, stage);
    CREATE INDEX IX_leads_score ON Leads(company_id, score);
END
GO

-- ─── Sales pipeline permissions ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'leads:read')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('leads','read','leads:read','View sales pipeline / leads');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'leads:create')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('leads','create','leads:create','Create leads / inquiries');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'leads:update')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('leads','update','leads:update','Edit leads, advance pipeline stage');
GO
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM Permissions p
CROSS JOIN (SELECT 6 AS role_id UNION SELECT 8) r
WHERE p.permission_key IN ('leads:read','leads:create','leads:update')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- ─── Marketing Automation: MarketingCommunications table ─────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MarketingCommunications')
BEGIN
    CREATE TABLE MarketingCommunications (
        comm_id         INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        lead_id         INT             NULL,
        customer_id     INT             NULL,
        campaign_type   NVARCHAR(30)    NOT NULL,
        channel         NVARCHAR(20)    NOT NULL DEFAULT 'email',
        subject         NVARCHAR(200)   NULL,
        message         NVARCHAR(MAX)   NOT NULL,
        sent_to_email   NVARCHAR(150)   NULL,
        sent_to_phone   NVARCHAR(20)    NULL,
        delivery_status NVARCHAR(20)    NOT NULL DEFAULT 'sent',
        sent_by         INT             NOT NULL,
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_marketing_comm PRIMARY KEY (comm_id),
        CONSTRAINT FK_mktcomm_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_mktcomm_lead FOREIGN KEY (lead_id) REFERENCES Leads(lead_id),
        CONSTRAINT FK_mktcomm_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        CONSTRAINT FK_mktcomm_sentby FOREIGN KEY (sent_by) REFERENCES Users(user_id),
        CONSTRAINT CHK_mktcomm_campaign_type CHECK (campaign_type IN (
            'flyer','discount','festival_offer','wedding_package','anniversary_package','birthday_package'
        )),
        CONSTRAINT CHK_mktcomm_target CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL)
    );

    CREATE INDEX IX_mktcomm_lead ON MarketingCommunications(lead_id);
    CREATE INDEX IX_mktcomm_customer ON MarketingCommunications(customer_id);
END
GO

-- ─── Marketing automation permissions ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'marketing:read')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('marketing','read','marketing:read','View marketing communication history');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'marketing:send')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('marketing','send','marketing:send','Send promotional campaigns to leads/customers');
GO
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM Permissions p
CROSS JOIN (SELECT 6 AS role_id UNION SELECT 8) r
WHERE p.permission_key IN ('marketing:read','marketing:send')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- ─── Master Menu: CateringPackageItems ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CateringPackageItems')
BEGIN
    CREATE TABLE CateringPackageItems (
        package_item_id     INT             NOT NULL IDENTITY(1,1),
        package_id          INT             NOT NULL,
        item_id             INT             NOT NULL,
        quantity_per_plate  DECIMAL(6,2)    NOT NULL DEFAULT 1,
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_cpi PRIMARY KEY (package_item_id),
        CONSTRAINT FK_cpi_package FOREIGN KEY (package_id) REFERENCES CateringPackages(package_id),
        CONSTRAINT FK_cpi_item FOREIGN KEY (item_id) REFERENCES MenuItems(item_id),
        CONSTRAINT UQ_cpi_package_item UNIQUE (package_id, item_id)
    );
    CREATE INDEX IX_cpi_package ON CateringPackageItems(package_id);
END
GO

-- ─── Structured inventory: extend Resources ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'category')
    ALTER TABLE Resources ADD category NVARCHAR(30) NOT NULL DEFAULT 'custom';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'supplier')
    ALTER TABLE Resources ADD supplier NVARCHAR(150) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'cost_price')
    ALTER TABLE Resources ADD cost_price DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_resource_category')
BEGIN
    ALTER TABLE Resources ADD CONSTRAINT CHK_resource_category
        CHECK (category IN ('furniture','decor','lighting','audio','visual','signage','custom'));
END
GO

-- ─── Configurable Operational Charges ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'OperationalChargeConfig')
BEGIN
    CREATE TABLE OperationalChargeConfig (
        config_id       INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        charge_type     NVARCHAR(30)    NOT NULL,
        calc_method     NVARCHAR(20)    NOT NULL DEFAULT 'complimentary',
        rate_value      DECIMAL(12,2)   NOT NULL DEFAULT 0,
        is_active       BIT             NOT NULL DEFAULT 1,
        updated_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_opcharge PRIMARY KEY (config_id),
        CONSTRAINT FK_opcharge_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT UQ_opcharge_company_type UNIQUE (company_id, charge_type),
        CONSTRAINT CHK_opcharge_type CHECK (charge_type IN (
            'setup','decoration','cleanup','cleaning','late_exit','extended_usage','cooloff'
        )),
        CONSTRAINT CHK_opcharge_method CHECK (calc_method IN ('fixed','hourly','percentage','complimentary'))
    );
END
GO

-- ─── Command Center: staff assignment per booking ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BookingStaffAssignments')
BEGIN
    CREATE TABLE BookingStaffAssignments (
        assignment_id   INT             NOT NULL IDENTITY(1,1),
        booking_id      BIGINT          NOT NULL,
        user_id         INT             NOT NULL,
        role_note       NVARCHAR(150)   NULL,
        status          NVARCHAR(20)    NOT NULL DEFAULT 'assigned',
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_bsa PRIMARY KEY (assignment_id),
        CONSTRAINT FK_bsa_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_bsa_user FOREIGN KEY (user_id) REFERENCES Users(user_id),
        CONSTRAINT CHK_bsa_status CHECK (status IN ('assigned','confirmed','completed','no_show')),
        CONSTRAINT UQ_bsa_booking_user UNIQUE (booking_id, user_id)
    );
    CREATE INDEX IX_bsa_booking ON BookingStaffAssignments(booking_id);
END
GO

-- ─── Fix Invoices.created_at default: GETDATE() -> GETUTCDATE() ──────────────
DECLARE @invCreatedAtConstraint NVARCHAR(200);
SELECT @invCreatedAtConstraint = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('Invoices') AND c.name = 'created_at' AND dc.definition = '(getdate())';
IF @invCreatedAtConstraint IS NOT NULL
BEGIN
    EXEC('ALTER TABLE Invoices DROP CONSTRAINT ' + @invCreatedAtConstraint);
    EXEC('ALTER TABLE Invoices ADD CONSTRAINT DF_invoices_created_at DEFAULT GETUTCDATE() FOR created_at');
END
GO

-- ─── Missing indexes on Invoices ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_company_date')
    CREATE INDEX IX_invoices_company_date ON Invoices(company_id, invoice_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_booking')
    CREATE INDEX IX_invoices_booking ON Invoices(booking_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_customer')
    CREATE INDEX IX_invoices_customer ON Invoices(customer_id);
GO

-- ─── Systemic fix: sweep every remaining GETDATE()-based column default to
-- GETUTCDATE(), since the app is UTC-only throughout (found via a real
-- 5.5-hour timestamp skew on Payments.updated_at during a full audit) ───────
DECLARE @tbl NVARCHAR(128), @col NVARCHAR(128), @cname NVARCHAR(200), @isDateOnly BIT;
DECLARE cur CURSOR FOR
    SELECT t.name, c.name, dc.name,
           CASE WHEN dc.definition LIKE '%CONVERT([date]%' THEN 1 ELSE 0 END
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    JOIN sys.tables t ON t.object_id = dc.parent_object_id
    WHERE dc.definition LIKE '%getdate%';
OPEN cur;
FETCH NEXT FROM cur INTO @tbl, @col, @cname, @isDateOnly;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC('ALTER TABLE ' + @tbl + ' DROP CONSTRAINT ' + @cname);
    IF @isDateOnly = 1
        EXEC('ALTER TABLE ' + @tbl + ' ADD CONSTRAINT DF_' + @tbl + '_' + @col + ' DEFAULT CAST(GETUTCDATE() AS DATE) FOR ' + @col);
    ELSE
        EXEC('ALTER TABLE ' + @tbl + ' ADD CONSTRAINT DF_' + @tbl + '_' + @col + ' DEFAULT GETUTCDATE() FOR ' + @col);
    FETCH NEXT FROM cur INTO @tbl, @col, @cname, @isDateOnly;
END
CLOSE cur;
DEALLOCATE cur;
GO
