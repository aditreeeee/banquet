-- =============================================================================
-- Migration 010 — Quotations module
-- Run AFTER 001..009
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- "quotation" was already a Leads.stage value with no backing entity — this
-- gives it one. A quotation can originate from a lead (lead_id) and/or an
-- existing customer (customer_id); accepting one and converting it creates a
-- real Booking (see quotation.service.js convertToBooking), so Reports/
-- Dashboard need no separate changes — they already read Bookings/Invoices.
IF OBJECT_ID(N'dbo.Quotations', N'U') IS NULL
BEGIN
    CREATE TABLE Quotations (
        quotation_id        BIGINT          NOT NULL IDENTITY(1,1),
        company_id           INT             NOT NULL,
        branch_id            INT             NULL,
        lead_id              INT             NULL,
        customer_id          INT             NULL,
        quotation_number     NVARCHAR(30)    NOT NULL,
        status               NVARCHAR(20)    NOT NULL DEFAULT 'draft',
        revision             INT             NOT NULL DEFAULT 1,
        parent_quotation_id  BIGINT          NULL, -- links a revision back to the quotation it superseded
        event_name           NVARCHAR(200)   NULL,
        event_type           NVARCHAR(50)    NULL,
        event_date           DATE            NULL,
        guest_count          INT             NULL,
        hall_id              INT             NULL,
        subtotal             DECIMAL(14,2)   NOT NULL DEFAULT 0,
        discount_amount      DECIMAL(14,2)   NOT NULL DEFAULT 0,
        tax_amount           DECIMAL(14,2)   NOT NULL DEFAULT 0,
        grand_total          DECIMAL(14,2)   NOT NULL DEFAULT 0,
        notes                NVARCHAR(2000)  NULL,
        expiry_date          DATE            NULL,
        accepted_at          DATETIME2       NULL,
        accept_token         NVARCHAR(64)    NULL, -- customer-facing acceptance link, mirrors the password-reset token pattern
        converted_booking_id BIGINT          NULL,
        created_by           INT             NOT NULL,
        created_at           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_quotations PRIMARY KEY (quotation_id),
        CONSTRAINT UQ_quotation_number UNIQUE (quotation_number),
        CONSTRAINT FK_quotations_company  FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_quotations_lead     FOREIGN KEY (lead_id) REFERENCES Leads(lead_id),
        CONSTRAINT FK_quotations_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        CONSTRAINT FK_quotations_hall     FOREIGN KEY (hall_id) REFERENCES Halls(hall_id),
        CONSTRAINT FK_quotations_booking  FOREIGN KEY (converted_booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_quotations_parent   FOREIGN KEY (parent_quotation_id) REFERENCES Quotations(quotation_id),
        CONSTRAINT FK_quotations_creator  FOREIGN KEY (created_by) REFERENCES Users(user_id),
        CONSTRAINT CHK_quotation_status CHECK (status IN ('draft','sent','accepted','rejected','expired','converted'))
    );
    CREATE INDEX IX_quotations_company ON Quotations(company_id, status);
    CREATE INDEX IX_quotations_lead    ON Quotations(lead_id);
END
GO

IF OBJECT_ID(N'dbo.QuotationItems', N'U') IS NULL
BEGIN
    CREATE TABLE QuotationItems (
        item_row_id     BIGINT          NOT NULL IDENTITY(1,1),
        quotation_id    BIGINT          NOT NULL,
        description     NVARCHAR(200)   NOT NULL,
        quantity        DECIMAL(10,2)   NOT NULL DEFAULT 1,
        unit_price      DECIMAL(12,2)   NOT NULL DEFAULT 0,
        tax_percent     DECIMAL(5,2)    NOT NULL DEFAULT 0,
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_quotation_items PRIMARY KEY (item_row_id),
        CONSTRAINT FK_qi_quotation FOREIGN KEY (quotation_id) REFERENCES Quotations(quotation_id)
    );
    CREATE INDEX IX_qi_quotation ON QuotationItems(quotation_id);
END
GO

-- Seed the Quotations permissions (module already referenced 'quotation' as a
-- lead pipeline stage, but no permission rows existed for the module itself).
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:read')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','read','quotations:read','View quotations');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:create')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','create','quotations:create','Create/revise quotations');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:update')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','update','quotations:update','Edit quotations');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:approve')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','approve','quotations:approve','Approve/accept quotations and convert to bookings');
GO

-- Grant the new permissions to roles whose existing permission set already
-- covers analogous modules (Sales Manager: leads/coupons; Finance Manager:
-- invoices/payments) — everyone else with a wildcard-style grant (Super
-- Admin, Company Admin, Business Owner) already inherits them via their
-- `NOT IN (...)`/`SELECT * FROM permissions` seed queries.
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM Roles r
CROSS JOIN Permissions p
WHERE r.role_slug IN ('sales_manager', 'finance_manager')
  AND p.permission_key IN ('quotations:read','quotations:create','quotations:update','quotations:approve')
  AND NOT EXISTS (
      SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
  );
GO
