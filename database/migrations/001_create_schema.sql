-- =============================================================================
-- BANQUET HALL BOOKING & MANAGEMENT SYSTEM
-- Database: Microsoft SQL Server 2019+
-- Schema Version: 1.0.0
-- Migration: 001_create_schema.sql
-- =============================================================================

IF DB_ID(N'BanquetDB') IS NULL
BEGIN
    CREATE DATABASE BanquetDB;
END
GO

USE BanquetDB;
GO

-- SQL Server provides snapshot isolation (READ_COMMITTED_SNAPSHOT / SNAPSHOT) when enabled at the DB level.
-- Consider: ALTER DATABASE BanquetDB SET READ_COMMITTED_SNAPSHOT ON;

-- =============================================================================
-- SECTION 1: LOOKUP / REFERENCE TABLES
-- =============================================================================

IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
BEGIN
    CREATE TABLE Roles (
        role_id         INT             NOT NULL IDENTITY(1,1),
        role_name       NVARCHAR(50)    NOT NULL,
        role_slug       NVARCHAR(50)    NOT NULL,
        description     NVARCHAR(255)   NULL,
        is_system       BIT             NOT NULL DEFAULT 1,
        is_active       BIT             NOT NULL DEFAULT 1,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_roles PRIMARY KEY (role_id),
        CONSTRAINT UQ_roles_slug UNIQUE (role_slug)
    );
END
GO

IF OBJECT_ID(N'dbo.Permissions', N'U') IS NULL
BEGIN
    CREATE TABLE Permissions (
        permission_id   INT             NOT NULL IDENTITY(1,1),
        module          NVARCHAR(50)    NOT NULL,
        action          NVARCHAR(50)    NOT NULL,
        permission_key  NVARCHAR(100)   NOT NULL,
        description     NVARCHAR(255)   NULL,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_permissions PRIMARY KEY (permission_id),
        CONSTRAINT UQ_permissions_key UNIQUE (permission_key)
    );
END
GO

IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NULL
BEGIN
    CREATE TABLE RolePermissions (
        role_id         INT             NOT NULL,
        permission_id   INT             NOT NULL,
        granted_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        granted_by      INT             NULL,
        CONSTRAINT PK_role_permissions PRIMARY KEY (role_id, permission_id),
        CONSTRAINT FK_rp_role FOREIGN KEY (role_id) REFERENCES Roles(role_id) ON DELETE CASCADE,
        CONSTRAINT FK_rp_permission FOREIGN KEY (permission_id) REFERENCES Permissions(permission_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.Countries', N'U') IS NULL
BEGIN
    CREATE TABLE Countries (
        country_id      INT             NOT NULL IDENTITY(1,1),
        country_name    NVARCHAR(100)   NOT NULL,
        country_code    NCHAR(2)        NOT NULL,
        phone_code      NVARCHAR(10)    NOT NULL,
        currency_code   NCHAR(3)        NOT NULL,
        currency_symbol NVARCHAR(5)     NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        CONSTRAINT PK_countries PRIMARY KEY (country_id),
        CONSTRAINT UQ_countries_code UNIQUE (country_code)
    );
END
GO

IF OBJECT_ID(N'dbo.States', N'U') IS NULL
BEGIN
    CREATE TABLE States (
        state_id        INT             NOT NULL IDENTITY(1,1),
        country_id      INT             NOT NULL,
        state_name      NVARCHAR(100)   NOT NULL,
        state_code      NVARCHAR(10)    NOT NULL,
        CONSTRAINT PK_states PRIMARY KEY (state_id),
        CONSTRAINT FK_states_country FOREIGN KEY (country_id) REFERENCES Countries(country_id)
    );
END
GO

IF OBJECT_ID(N'dbo.Cities', N'U') IS NULL
BEGIN
    CREATE TABLE Cities (
        city_id         INT             NOT NULL IDENTITY(1,1),
        state_id        INT             NOT NULL,
        city_name       NVARCHAR(100)   NOT NULL,
        CONSTRAINT PK_cities PRIMARY KEY (city_id),
        CONSTRAINT FK_cities_state FOREIGN KEY (state_id) REFERENCES States(state_id)
    );
END
GO

IF OBJECT_ID(N'dbo.EventTypes', N'U') IS NULL
BEGIN
    CREATE TABLE EventTypes (
        event_type_id   INT             NOT NULL IDENTITY(1,1),
        type_name       NVARCHAR(100)   NOT NULL,
        type_slug       NVARCHAR(100)   NOT NULL,
        icon_class      NVARCHAR(100)   NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        sort_order      INT             NOT NULL DEFAULT 0,
        CONSTRAINT PK_event_types PRIMARY KEY (event_type_id),
        CONSTRAINT UQ_event_types_slug UNIQUE (type_slug)
    );
END
GO

IF OBJECT_ID(N'dbo.AmenityTypes', N'U') IS NULL
BEGIN
    CREATE TABLE AmenityTypes (
        amenity_type_id INT             NOT NULL IDENTITY(1,1),
        amenity_name    NVARCHAR(100)   NOT NULL,
        icon_class      NVARCHAR(100)   NULL,
        category        NVARCHAR(50)    NOT NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        CONSTRAINT PK_amenity_types PRIMARY KEY (amenity_type_id)
    );
END
GO

-- =============================================================================
-- SECTION 2: TENANT / COMPANY TABLES
-- =============================================================================

IF OBJECT_ID(N'dbo.Companies', N'U') IS NULL
BEGIN
    CREATE TABLE Companies (
        company_id          INT             NOT NULL IDENTITY(1,1),
        company_name        NVARCHAR(200)   NOT NULL,
        company_slug        NVARCHAR(200)   NOT NULL,
        legal_name          NVARCHAR(200)   NULL,
        gst_number          NVARCHAR(20)    NULL,
        pan_number          NVARCHAR(20)    NULL,
        registration_no     NVARCHAR(50)    NULL,
        logo_url            NVARCHAR(500)   NULL,
        website             NVARCHAR(255)   NULL,
        email               NVARCHAR(150)   NOT NULL,
        phone               NVARCHAR(20)    NOT NULL,
        alternate_phone     NVARCHAR(20)    NULL,
        address_line1       NVARCHAR(255)   NOT NULL,
        address_line2       NVARCHAR(255)   NULL,
        city_id             INT             NULL,
        state_id            INT             NULL,
        country_id          INT             NOT NULL DEFAULT 1,
        pincode             NVARCHAR(10)    NULL,
        currency_code       NCHAR(3)        NOT NULL DEFAULT 'INR',
        timezone            NVARCHAR(50)    NOT NULL DEFAULT 'Asia/Kolkata',
        date_format         NVARCHAR(20)    NOT NULL DEFAULT 'DD/MM/YYYY',
        subscription_plan   NVARCHAR(50)    NOT NULL DEFAULT 'basic',
        subscription_expiry DATE            NULL,
        max_branches        INT             NOT NULL DEFAULT 1,
        max_banquets        INT             NOT NULL DEFAULT 5,
        is_active           BIT             NOT NULL DEFAULT 1,
        is_verified         BIT             NOT NULL DEFAULT 0,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by          INT             NULL,
        CONSTRAINT PK_companies PRIMARY KEY (company_id),
        CONSTRAINT UQ_companies_slug UNIQUE (company_slug),
        CONSTRAINT FK_companies_city FOREIGN KEY (city_id) REFERENCES Cities(city_id),
        CONSTRAINT FK_companies_state FOREIGN KEY (state_id) REFERENCES States(state_id),
        CONSTRAINT FK_companies_country FOREIGN KEY (country_id) REFERENCES Countries(country_id)
    );
END
GO

IF OBJECT_ID(N'dbo.Branches', N'U') IS NULL
BEGIN
    CREATE TABLE Branches (
        branch_id           INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        branch_name         NVARCHAR(200)   NOT NULL,
        branch_code         NVARCHAR(20)    NOT NULL,
        email               NVARCHAR(150)   NULL,
        phone               NVARCHAR(20)    NULL,
        address_line1       NVARCHAR(255)   NOT NULL,
        address_line2       NVARCHAR(255)   NULL,
        city_id             INT             NULL,
        state_id            INT             NULL,
        pincode             NVARCHAR(10)    NULL,
        latitude            DECIMAL(10, 8)  NULL,
        longitude           DECIMAL(11, 8)  NULL,
        is_main_branch      BIT             NOT NULL DEFAULT 0,
        is_active           BIT             NOT NULL DEFAULT 1,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by          INT             NULL,
        CONSTRAINT PK_branches PRIMARY KEY (branch_id),
        CONSTRAINT UQ_branch_code UNIQUE (company_id, branch_code),
        CONSTRAINT FK_branches_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_branches_city FOREIGN KEY (city_id) REFERENCES Cities(city_id),
        CONSTRAINT FK_branches_state FOREIGN KEY (state_id) REFERENCES States(state_id)
    );
END
GO

-- =============================================================================
-- SECTION 3: USER MANAGEMENT
-- =============================================================================

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE Users (
        user_id                 INT             NOT NULL IDENTITY(1,1),
        company_id              INT             NULL,
        branch_id               INT             NULL,
        role_id                 INT             NOT NULL,
        first_name              NVARCHAR(100)   NOT NULL,
        last_name               NVARCHAR(100)   NOT NULL,
        email                   NVARCHAR(150)   NOT NULL,
        phone                   NVARCHAR(20)    NULL,
        alternate_phone         NVARCHAR(20)    NULL,
        password_hash           NVARCHAR(255)   NOT NULL,
        avatar_url              NVARCHAR(500)   NULL,
        date_of_birth           DATE            NULL,
        gender                  NVARCHAR(10)    NULL,
        address_line1           NVARCHAR(255)   NULL,
        city_id                 INT             NULL,
        state_id                INT             NULL,
        pincode                 NVARCHAR(10)    NULL,
        is_email_verified       BIT             NOT NULL DEFAULT 0,
        is_phone_verified       BIT             NOT NULL DEFAULT 0,
        is_two_factor           BIT             NOT NULL DEFAULT 0,
        two_factor_secret       NVARCHAR(255)   NULL,
        is_active               BIT             NOT NULL DEFAULT 1,
        last_login_at           DATETIME         NULL,
        last_login_ip           NVARCHAR(45)    NULL,
        failed_login_attempts   TINYINT         NOT NULL DEFAULT 0,
        account_locked_until    DATETIME         NULL,
        password_reset_at       DATETIME         NULL,
        timezone                NVARCHAR(50)    NOT NULL DEFAULT 'Asia/Kolkata',
        created_at              DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at              DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by              INT             NULL,
        CONSTRAINT PK_users PRIMARY KEY (user_id),
        CONSTRAINT UQ_users_email UNIQUE (email),
        CONSTRAINT FK_users_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_users_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
        CONSTRAINT FK_users_role FOREIGN KEY (role_id) REFERENCES Roles(role_id),
        CONSTRAINT FK_users_city FOREIGN KEY (city_id) REFERENCES Cities(city_id)
    );
END
GO

IF OBJECT_ID(N'dbo.RefreshTokens', N'U') IS NULL
BEGIN
    CREATE TABLE RefreshTokens (
        id              BIGINT          NOT NULL IDENTITY(1,1),
        user_id         INT             NOT NULL,
        token_hash      NVARCHAR(255)   NOT NULL,
        device_info     NVARCHAR(500)   NULL,
        ip_address      NVARCHAR(45)    NULL,
        user_agent      NVARCHAR(500)   NULL,
        expires_at      DATETIME         NOT NULL,
        is_revoked      BIT             NOT NULL DEFAULT 0,
        revoked_at      DATETIME         NULL,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_refresh_tokens PRIMARY KEY (id),
        CONSTRAINT FK_rt_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.PasswordResetTokens', N'U') IS NULL
BEGIN
    CREATE TABLE PasswordResetTokens (
        id              BIGINT          NOT NULL IDENTITY(1,1),
        user_id         INT             NOT NULL,
        token_hash      NVARCHAR(255)   NOT NULL,
        expires_at      DATETIME         NOT NULL,
        is_used         BIT             NOT NULL DEFAULT 0,
        used_at         DATETIME         NULL,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_password_reset_tokens PRIMARY KEY (id),
        CONSTRAINT FK_prt_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.OtpVerifications', N'U') IS NULL
BEGIN
    CREATE TABLE OtpVerifications (
        otp_id          BIGINT          NOT NULL IDENTITY(1,1),
        user_id         INT             NULL,
        email           NVARCHAR(150)   NULL,
        phone           NVARCHAR(20)    NULL,
        otp_hash        NVARCHAR(255)   NOT NULL,
        purpose         NVARCHAR(50)    NOT NULL,
        expires_at      DATETIME         NOT NULL,
        is_used         BIT             NOT NULL DEFAULT 0,
        used_at         DATETIME         NULL,
        attempts        TINYINT         NOT NULL DEFAULT 0,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_otp PRIMARY KEY (otp_id)
    );
END
GO

-- =============================================================================
-- SECTION 4: BANQUET & HALL MANAGEMENT
-- =============================================================================

IF OBJECT_ID(N'dbo.Banquets', N'U') IS NULL
BEGIN
    CREATE TABLE Banquets (
        banquet_id          INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        branch_id           INT             NOT NULL,
        banquet_name        NVARCHAR(200)   NOT NULL,
        banquet_slug        NVARCHAR(200)   NOT NULL,
        description         NVARCHAR(MAX)   NULL,
        short_description   NVARCHAR(500)   NULL,
        logo_url            NVARCHAR(500)   NULL,
        cover_image_url     NVARCHAR(500)   NULL,
        address_line1       NVARCHAR(255)   NOT NULL,
        address_line2       NVARCHAR(255)   NULL,
        city_id             INT             NULL,
        state_id            INT             NULL,
        pincode             NVARCHAR(10)    NULL,
        latitude            DECIMAL(10, 8)  NULL,
        longitude           DECIMAL(11, 8)  NULL,
        google_maps_url     NVARCHAR(500)   NULL,
        phone               NVARCHAR(20)    NULL,
        email               NVARCHAR(150)   NULL,
        whatsapp            NVARCHAR(20)    NULL,
        gst_number          NVARCHAR(20)    NULL,
        address             NVARCHAR(500)   NULL,
        city                NVARCHAR(100)   NULL,
        state               NVARCHAR(100)   NULL,
        total_capacity      INT             NOT NULL DEFAULT 0,
        parking_capacity    INT             NOT NULL DEFAULT 0,
        has_valet           BIT             NOT NULL DEFAULT 0,
        total_halls         INT             NOT NULL DEFAULT 0,
        check_in_time       TIME            NOT NULL DEFAULT '08:00:00',
        check_out_time      TIME            NOT NULL DEFAULT '23:00:00',
        cancellation_policy NVARCHAR(MAX)   NULL,
        booking_policy      NVARCHAR(MAX)   NULL,
        is_active           BIT             NOT NULL DEFAULT 1,
        is_featured         BIT             NOT NULL DEFAULT 0,
        average_rating      DECIMAL(3, 2)   NOT NULL DEFAULT 0.00,
        total_reviews       INT             NOT NULL DEFAULT 0,
        total_bookings      INT             NOT NULL DEFAULT 0,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by          INT             NULL,
        CONSTRAINT PK_banquets PRIMARY KEY (banquet_id),
        CONSTRAINT UQ_banquet_slug UNIQUE (company_id, banquet_slug),
        CONSTRAINT FK_banquets_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_banquets_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
        CONSTRAINT FK_banquets_city FOREIGN KEY (city_id) REFERENCES Cities(city_id)
    );
END
GO

IF OBJECT_ID(N'dbo.BanquetGallery', N'U') IS NULL
BEGIN
    CREATE TABLE BanquetGallery (
        gallery_id      INT             NOT NULL IDENTITY(1,1),
        banquet_id      INT             NOT NULL,
        media_type      NVARCHAR(10)    NOT NULL DEFAULT 'image',
        media_url       NVARCHAR(500)   NOT NULL,
        thumbnail_url   NVARCHAR(500)   NULL,
        caption         NVARCHAR(255)   NULL,
        sort_order      INT             NOT NULL DEFAULT 0,
        is_active       BIT             NOT NULL DEFAULT 1,
        uploaded_at     DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_banquet_gallery PRIMARY KEY (gallery_id),
        CONSTRAINT FK_gallery_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.BanquetAmenities', N'U') IS NULL
BEGIN
    CREATE TABLE BanquetAmenities (
        banquet_id      INT             NOT NULL,
        amenity_type_id INT             NOT NULL,
        notes           NVARCHAR(255)   NULL,
        CONSTRAINT PK_banquet_amenities PRIMARY KEY (banquet_id, amenity_type_id),
        CONSTRAINT FK_ba_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE,
        CONSTRAINT FK_ba_amenity FOREIGN KEY (amenity_type_id) REFERENCES AmenityTypes(amenity_type_id)
    );
END
GO

IF OBJECT_ID(N'dbo.BanquetDocuments', N'U') IS NULL
BEGIN
    CREATE TABLE BanquetDocuments (
        document_id     INT             NOT NULL IDENTITY(1,1),
        banquet_id      INT             NOT NULL,
        document_type   NVARCHAR(100)   NOT NULL,
        document_name   NVARCHAR(255)   NOT NULL,
        file_url        NVARCHAR(500)   NOT NULL,
        expiry_date     DATE            NULL,
        is_verified     BIT             NOT NULL DEFAULT 0,
        uploaded_at     DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_banquet_documents PRIMARY KEY (document_id),
        CONSTRAINT FK_bd_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.Halls', N'U') IS NULL
BEGIN
    CREATE TABLE Halls (
        hall_id             INT             NOT NULL IDENTITY(1,1),
        banquet_id          INT             NOT NULL,
        company_id          INT             NOT NULL,
        branch_id           INT             NULL,
        hall_name           NVARCHAR(200)   NOT NULL,
        hall_code           NVARCHAR(20)    NOT NULL,
        floor_number        TINYINT         NOT NULL DEFAULT 1,
        hall_type           NVARCHAR(50)    NOT NULL DEFAULT 'main_hall',
        capacity            INT             NOT NULL DEFAULT 0,
        capacity_seated     INT             NOT NULL DEFAULT 0,
        capacity_standing   INT             NOT NULL DEFAULT 0,
        capacity_theatre    INT             NOT NULL DEFAULT 0,
        area_sqft           DECIMAL(10, 2)  NULL,
        length_ft           DECIMAL(8, 2)   NULL,
        width_ft            DECIMAL(8, 2)   NULL,
        height_ft           DECIMAL(8, 2)   NULL,
        base_price          DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,
        weekend_surcharge_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
        has_ac              BIT             NOT NULL DEFAULT 0,
        has_power_backup    BIT             NOT NULL DEFAULT 0,
        has_kitchen         BIT             NOT NULL DEFAULT 0,
        has_stage           BIT             NOT NULL DEFAULT 0,
        has_parking         BIT             NOT NULL DEFAULT 0,
        has_washroom        BIT             NOT NULL DEFAULT 0,
        has_green_room      BIT             NOT NULL DEFAULT 0,
        has_bridal_room     BIT             NOT NULL DEFAULT 0,
        description         NVARCHAR(MAX)   NULL,
        is_active           BIT             NOT NULL DEFAULT 1,
        is_under_maintenance BIT            NOT NULL DEFAULT 0,
        maintenance_note    NVARCHAR(500)   NULL,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_halls PRIMARY KEY (hall_id),
        CONSTRAINT UQ_hall_code UNIQUE (banquet_id, hall_code),
        CONSTRAINT FK_halls_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id),
        CONSTRAINT FK_halls_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

IF OBJECT_ID(N'dbo.HallAmenities', N'U') IS NULL
BEGIN
    CREATE TABLE HallAmenities (
        hall_id         INT             NOT NULL,
        amenity_type_id INT             NOT NULL,
        notes           NVARCHAR(255)   NULL,
        CONSTRAINT PK_hall_amenities PRIMARY KEY (hall_id, amenity_type_id),
        CONSTRAINT FK_ha_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE,
        CONSTRAINT FK_ha_amenity FOREIGN KEY (amenity_type_id) REFERENCES AmenityTypes(amenity_type_id)
    );
END
GO

IF OBJECT_ID(N'dbo.HallGallery', N'U') IS NULL
BEGIN
    CREATE TABLE HallGallery (
        gallery_id      INT             NOT NULL IDENTITY(1,1),
        hall_id         INT             NOT NULL,
        image_url       NVARCHAR(500)   NOT NULL,
        sort_order      INT             NOT NULL DEFAULT 0,
        CONSTRAINT PK_hall_gallery PRIMARY KEY (gallery_id),
        CONSTRAINT FK_hg_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE
    );
END
GO

-- =============================================================================
-- SECTION 5: PRICING ENGINE
-- =============================================================================

IF OBJECT_ID(N'dbo.HallPricing', N'U') IS NULL
BEGIN
    CREATE TABLE HallPricing (
        pricing_id          INT             NOT NULL IDENTITY(1,1),
        hall_id             INT             NOT NULL,
        pricing_name        NVARCHAR(100)   NOT NULL,
        pricing_type        NVARCHAR(50)    NOT NULL,
        base_price          DECIMAL(12, 2)  NOT NULL,
        weekend_multiplier  DECIMAL(5, 2)   NOT NULL DEFAULT 1.00,
        peak_multiplier     DECIMAL(5, 2)   NOT NULL DEFAULT 1.00,
        min_booking_hours   TINYINT         NOT NULL DEFAULT 4,
        max_booking_hours   TINYINT         NULL,
        advance_amount      DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,
        advance_percentage  DECIMAL(5, 2)   NOT NULL DEFAULT 25.00,
        valid_from          DATE            NULL,
        valid_to            DATE            NULL,
        is_active           BIT             NOT NULL DEFAULT 1,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_hall_pricing PRIMARY KEY (pricing_id),
        CONSTRAINT FK_pricing_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.PricingSlots', N'U') IS NULL
BEGIN
    CREATE TABLE PricingSlots (
        slot_id         INT             NOT NULL IDENTITY(1,1),
        pricing_id      INT             NOT NULL,
        slot_name       NVARCHAR(50)    NOT NULL,
        start_time      TIME            NOT NULL,
        end_time        TIME            NOT NULL,
        slot_price      DECIMAL(12, 2)  NOT NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        CONSTRAINT PK_pricing_slots PRIMARY KEY (slot_id),
        CONSTRAINT FK_slots_pricing FOREIGN KEY (pricing_id) REFERENCES HallPricing(pricing_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.SpecialPricing', N'U') IS NULL
BEGIN
    CREATE TABLE SpecialPricing (
        special_id      INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        hall_id         INT             NULL,
        pricing_name    NVARCHAR(100)   NOT NULL,
        special_date    DATE            NOT NULL,
        multiplier      DECIMAL(5, 2)   NOT NULL DEFAULT 1.50,
        flat_price      DECIMAL(12, 2)  NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_special_pricing PRIMARY KEY (special_id),
        CONSTRAINT FK_sp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_sp_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id)
    );
END
GO

IF OBJECT_ID(N'dbo.Coupons', N'U') IS NULL
BEGIN
    CREATE TABLE Coupons (
        coupon_id           INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        coupon_code         NVARCHAR(50)    NOT NULL,
        coupon_name         NVARCHAR(100)   NOT NULL,
        description         NVARCHAR(255)   NULL,
        discount_type       NVARCHAR(20)    NOT NULL,
        discount_value      DECIMAL(10, 2)  NOT NULL,
        max_discount_amount DECIMAL(10, 2)  NULL,
        min_booking_amount  DECIMAL(10, 2)  NOT NULL DEFAULT 0,
        usage_limit         INT             NULL,
        usage_per_user      TINYINT         NOT NULL DEFAULT 1,
        used_count          INT             NOT NULL DEFAULT 0,
        valid_from          DATETIME         NOT NULL,
        valid_to            DATETIME         NOT NULL,
        applicable_halls    NVARCHAR(MAX)   NULL,
        applicable_events   NVARCHAR(MAX)   NULL,
        is_active           BIT             NOT NULL DEFAULT 1,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by          INT             NULL,
        CONSTRAINT PK_coupons PRIMARY KEY (coupon_id),
        CONSTRAINT UQ_coupon_code UNIQUE (company_id, coupon_code),
        CONSTRAINT FK_coupons_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

IF OBJECT_ID(N'dbo.TaxConfig', N'U') IS NULL
BEGIN
    CREATE TABLE TaxConfig (
        tax_id          INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        tax_name        NVARCHAR(100)   NOT NULL,
        tax_type        NVARCHAR(20)    NOT NULL,
        rate            DECIMAL(5, 2)   NOT NULL,
        applies_to      NVARCHAR(50)    NOT NULL DEFAULT 'all',
        is_compound     BIT             NOT NULL DEFAULT 0,
        is_active       BIT             NOT NULL DEFAULT 1,
        effective_from  DATE            NOT NULL,
        effective_to    DATE            NULL,
        CONSTRAINT PK_tax_config PRIMARY KEY (tax_id),
        CONSTRAINT FK_tax_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

-- =============================================================================
-- SECTION 6: CUSTOMER MANAGEMENT
-- =============================================================================

IF OBJECT_ID(N'dbo.Customers', N'U') IS NULL
BEGIN
    CREATE TABLE Customers (
        customer_id         INT             NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        branch_id           INT             NULL,
        first_name          NVARCHAR(100)   NOT NULL,
        last_name           NVARCHAR(100)   NULL,
        email               NVARCHAR(150)   NULL,
        phone               NVARCHAR(20)    NOT NULL,
        alternate_phone     NVARCHAR(20)    NULL,
        address             NVARCHAR(500)   NULL,
        city                NVARCHAR(100)   NULL,
        state               NVARCHAR(100)   NULL,
        notes               NVARCHAR(MAX)   NULL,
        customer_code       NVARCHAR(20)    NULL,
        preferred_language  NVARCHAR(10)    NOT NULL DEFAULT 'en',
        anniversary_date    DATE            NULL,
        loyalty_points      INT             NOT NULL DEFAULT 0,
        referral_code       NVARCHAR(20)    NULL,
        referred_by         INT             NULL,
        source              NVARCHAR(50)    NULL,
        is_active           BIT             NOT NULL DEFAULT 1,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_customers PRIMARY KEY (customer_id),
        CONSTRAINT FK_customers_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_customers_referrer FOREIGN KEY (referred_by) REFERENCES Customers(customer_id)
    );
END
GO

IF OBJECT_ID(N'dbo.CustomerDocuments', N'U') IS NULL
BEGIN
    CREATE TABLE CustomerDocuments (
        doc_id          INT             NOT NULL IDENTITY(1,1),
        customer_id     INT             NOT NULL,
        doc_type        NVARCHAR(50)    NOT NULL,
        doc_number      NVARCHAR(50)    NULL,
        file_url        NVARCHAR(500)   NOT NULL,
        uploaded_at     DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_customer_docs PRIMARY KEY (doc_id),
        CONSTRAINT FK_cd_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id) ON DELETE CASCADE
    );
END
GO

-- =============================================================================
-- SECTION 7: BOOKING ENGINE
-- =============================================================================

IF OBJECT_ID(N'dbo.Bookings', N'U') IS NULL
BEGIN
    CREATE TABLE Bookings (
        booking_id          BIGINT          NOT NULL IDENTITY(1,1),
        booking_ref         NVARCHAR(30)    NOT NULL,
        company_id          INT             NOT NULL,
        branch_id           INT             NOT NULL,
        hall_id             INT             NOT NULL,
        customer_id         INT             NOT NULL,
        event_name          NVARCHAR(200)   NULL,
        event_type          NVARCHAR(50)    NULL,
        event_date          DATE            NOT NULL,
        event_time_start    TIME            NOT NULL,
        event_time_end      TIME            NOT NULL,
        guest_count         INT             NULL,
        status              NVARCHAR(30)    NOT NULL DEFAULT 'draft',
        total_amount        DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        advance_paid        DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        amount_paid         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        discount_amount     DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        notes               NVARCHAR(MAX)   NULL,
        special_requests    NVARCHAR(MAX)   NULL,
        internal_notes      NVARCHAR(MAX)   NULL,
        cancellation_reason NVARCHAR(500)   NULL,
        cancelled_at        DATETIME         NULL,
        cancelled_by        INT             NULL,
        confirmed_at        DATETIME         NULL,
        created_by          INT             NOT NULL,
        updated_by          INT             NULL,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_bookings PRIMARY KEY (booking_id),
        CONSTRAINT UQ_booking_ref UNIQUE (booking_ref),
        CONSTRAINT FK_bookings_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_bookings_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
        CONSTRAINT FK_bookings_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id),
        CONSTRAINT FK_bookings_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        CONSTRAINT CHK_booking_status CHECK (status IN ('draft','confirmed','advance_paid','fully_paid','cancelled','completed','no_show'))
    );

    CREATE INDEX IX_bookings_date_hall      ON Bookings(event_date, hall_id);
    CREATE INDEX IX_bookings_customer       ON Bookings(customer_id, event_date);
    CREATE INDEX IX_bookings_company_date   ON Bookings(company_id, event_date);
    CREATE INDEX IX_bookings_status         ON Bookings(status, company_id, event_date);
END
GO

IF OBJECT_ID(N'dbo.HallBlockedDates', N'U') IS NULL
BEGIN
    CREATE TABLE HallBlockedDates (
        block_id        INT             NOT NULL IDENTITY(1,1),
        hall_id         INT             NOT NULL,
        company_id      INT             NOT NULL,
        blocked_date    DATE            NOT NULL,
        start_time      TIME            NULL,
        end_time        TIME            NULL,
        reason          NVARCHAR(200)   NULL,
        blocked_by      INT             NOT NULL,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_blocked_dates PRIMARY KEY (block_id),
        CONSTRAINT UQ_block UNIQUE (hall_id, blocked_date, start_time),
        CONSTRAINT FK_block_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id),
        CONSTRAINT FK_block_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );

    CREATE INDEX IX_blocked_dates_hall_date ON HallBlockedDates(hall_id, blocked_date);
END
GO

-- =============================================================================
-- SECTION 8: CATERING MANAGEMENT
-- =============================================================================

IF OBJECT_ID(N'dbo.MenuCategories', N'U') IS NULL
BEGIN
    CREATE TABLE MenuCategories (
        category_id     INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        category_name   NVARCHAR(100)   NOT NULL,
        food_type       NVARCHAR(10)    NOT NULL,
        sort_order      INT             NOT NULL DEFAULT 0,
        is_active       BIT             NOT NULL DEFAULT 1,
        CONSTRAINT PK_menu_categories PRIMARY KEY (category_id),
        CONSTRAINT FK_mc_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

IF OBJECT_ID(N'dbo.MenuItems', N'U') IS NULL
BEGIN
    CREATE TABLE MenuItems (
        item_id         INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        category_id     INT             NOT NULL,
        item_name       NVARCHAR(200)   NOT NULL,
        description     NVARCHAR(500)   NULL,
        food_type       NVARCHAR(10)    NOT NULL,
        unit            NVARCHAR(20)    NOT NULL DEFAULT 'plate',
        base_price      DECIMAL(10, 2)  NOT NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_menu_items PRIMARY KEY (item_id),
        CONSTRAINT FK_mi_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_mi_category FOREIGN KEY (category_id) REFERENCES MenuCategories(category_id)
    );
END
GO

IF OBJECT_ID(N'dbo.CateringPackages', N'U') IS NULL
BEGIN
    CREATE TABLE CateringPackages (
        package_id      INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        package_name    NVARCHAR(200)   NOT NULL,
        package_type    NVARCHAR(20)    NOT NULL,
        price_per_plate DECIMAL(10, 2)  NOT NULL,
        min_plates      INT             NOT NULL DEFAULT 50,
        description     NVARCHAR(MAX)   NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_catering_packages PRIMARY KEY (package_id),
        CONSTRAINT FK_cp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

-- =============================================================================
-- SECTION 9: PAYMENT & INVOICE MODULE
-- =============================================================================

IF OBJECT_ID(N'dbo.Invoices', N'U') IS NULL
BEGIN
    CREATE TABLE Invoices (
        invoice_id          BIGINT          NOT NULL IDENTITY(1,1),
        invoice_number      NVARCHAR(30)    NOT NULL,
        company_id          INT             NOT NULL,
        booking_id          BIGINT          NOT NULL,
        customer_id         INT             NOT NULL,
        invoice_date        DATE            NOT NULL,
        due_date            DATE            NOT NULL,
        invoice_type        NVARCHAR(20)    NOT NULL DEFAULT 'tax_invoice',
        subtotal            DECIMAL(14, 2)  NOT NULL,
        discount_amount     DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        taxable_amount      DECIMAL(14, 2)  NOT NULL,
        cgst_rate           DECIMAL(5, 2)   NOT NULL DEFAULT 0,
        cgst_amount         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        sgst_rate           DECIMAL(5, 2)   NOT NULL DEFAULT 0,
        sgst_amount         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        igst_rate           DECIMAL(5, 2)   NOT NULL DEFAULT 0,
        igst_amount         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        total_tax           DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        grand_total         DECIMAL(14, 2)  NOT NULL,
        amount_paid         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
        balance_due         DECIMAL(14, 2)  NOT NULL,
        payment_status      NVARCHAR(20)    NOT NULL DEFAULT 'pending',
        notes               NVARCHAR(MAX)   NULL,
        terms               NVARCHAR(MAX)   NULL,
        pdf_url             NVARCHAR(500)   NULL,
        is_cancelled        BIT             NOT NULL DEFAULT 0,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        created_by          INT             NOT NULL,
        CONSTRAINT PK_invoices PRIMARY KEY (invoice_id),
        CONSTRAINT UQ_invoice_number UNIQUE (company_id, invoice_number),
        CONSTRAINT FK_invoices_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_invoices_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_invoices_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)
    );
END
GO

IF OBJECT_ID(N'dbo.Payments', N'U') IS NULL
BEGIN
    CREATE TABLE Payments (
        payment_id          BIGINT          NOT NULL IDENTITY(1,1),
        payment_ref         NVARCHAR(30)    NULL,
        company_id          INT             NOT NULL,
        booking_id          BIGINT          NOT NULL,
        invoice_id          BIGINT          NULL,
        customer_id         INT             NULL,
        payment_type        NVARCHAR(30)    NOT NULL,
        payment_method      NVARCHAR(30)    NOT NULL,
        amount              DECIMAL(14, 2)  NOT NULL,
        currency            NCHAR(3)        NOT NULL DEFAULT 'INR',
        transaction_id      NVARCHAR(200)   NULL,
        gateway_name        NVARCHAR(50)    NULL,
        gateway_response    NVARCHAR(MAX)   NULL,
        status              NVARCHAR(20)    NOT NULL DEFAULT 'pending',
        payment_date        DATE            NOT NULL DEFAULT (CAST(GETDATE() AS DATE)),
        notes               NVARCHAR(500)   NULL,
        reference_number    NVARCHAR(100)   NULL,
        cheque_number       NVARCHAR(50)    NULL,
        cheque_date         DATE            NULL,
        bank_name           NVARCHAR(100)   NULL,
        receipt_url         NVARCHAR(500)   NULL,
        created_by          INT             NOT NULL,
        verified_by         INT             NULL,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_payments PRIMARY KEY (payment_id),
        CONSTRAINT FK_payments_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_payments_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_payments_invoice FOREIGN KEY (invoice_id) REFERENCES Invoices(invoice_id)
    );

    CREATE INDEX IX_payments_booking      ON Payments(booking_id, payment_date);
    CREATE INDEX IX_payments_company_date ON Payments(company_id, payment_date);
END
GO

IF OBJECT_ID(N'dbo.Refunds', N'U') IS NULL
BEGIN
    CREATE TABLE Refunds (
        refund_id           BIGINT          NOT NULL IDENTITY(1,1),
        payment_id          BIGINT          NOT NULL,
        booking_id          BIGINT          NOT NULL,
        company_id          INT             NOT NULL,
        refund_amount       DECIMAL(14, 2)  NOT NULL,
        refund_reason       NVARCHAR(500)   NOT NULL,
        refund_method       NVARCHAR(30)    NOT NULL,
        transaction_id      NVARCHAR(200)   NULL,
        refund_status       NVARCHAR(20)    NOT NULL DEFAULT 'pending',
        requested_by        INT             NOT NULL,
        approved_by         INT             NULL,
        processed_at        DATETIME         NULL,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_refunds PRIMARY KEY (refund_id),
        CONSTRAINT FK_refunds_payment FOREIGN KEY (payment_id) REFERENCES Payments(payment_id),
        CONSTRAINT FK_refunds_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_refunds_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
END
GO

-- =============================================================================
-- SECTION 10: REVIEWS & NOTIFICATIONS
-- =============================================================================

IF OBJECT_ID(N'dbo.Reviews', N'U') IS NULL
BEGIN
    CREATE TABLE Reviews (
        review_id           INT             NOT NULL IDENTITY(1,1),
        banquet_id          INT             NOT NULL,
        customer_id         INT             NOT NULL,
        booking_id          BIGINT          NOT NULL,
        rating              TINYINT         NOT NULL,
        title               NVARCHAR(200)   NULL,
        review_text         NVARCHAR(MAX)   NULL,
        venue_rating        TINYINT         NULL,
        service_rating      TINYINT         NULL,
        catering_rating     TINYINT         NULL,
        value_rating        TINYINT         NULL,
        is_approved         BIT             NOT NULL DEFAULT 0,
        is_featured         BIT             NOT NULL DEFAULT 0,
        admin_response      NVARCHAR(MAX)   NULL,
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_reviews PRIMARY KEY (review_id),
        CONSTRAINT UQ_review_booking UNIQUE (booking_id, customer_id),
        CONSTRAINT FK_reviews_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id),
        CONSTRAINT FK_reviews_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        CONSTRAINT FK_reviews_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT CHK_rating CHECK (rating BETWEEN 1 AND 5)
    );
END
GO

IF OBJECT_ID(N'dbo.Notifications', N'U') IS NULL
BEGIN
    CREATE TABLE Notifications (
        notification_id     BIGINT          NOT NULL IDENTITY(1,1),
        company_id          INT             NOT NULL,
        user_id             INT             NULL,
        notification_type   NVARCHAR(50)    NOT NULL,
        channel              NVARCHAR(20)    NOT NULL,
        title               NVARCHAR(200)   NOT NULL,
        body                NVARCHAR(MAX)   NOT NULL,
        reference_type      NVARCHAR(50)    NULL,
        reference_id        BIGINT          NULL,
        is_read             BIT             NOT NULL DEFAULT 0,
        read_at             DATETIME         NULL,
        sent_at             DATETIME         NULL,
        delivery_status     NVARCHAR(20)    NOT NULL DEFAULT 'pending',
        created_at          DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_notifications PRIMARY KEY (notification_id),
        CONSTRAINT FK_notif_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT FK_notif_user FOREIGN KEY (user_id) REFERENCES Users(user_id)
    );

    CREATE INDEX IX_notifications_user ON Notifications(user_id, is_read, created_at);
END
GO

-- =============================================================================
-- SECTION 11: AUDIT LOGS
-- =============================================================================

IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE AuditLogs (
        log_id          BIGINT          NOT NULL IDENTITY(1,1),
        company_id      INT             NULL,
        user_id         INT             NULL,
        user_email      NVARCHAR(150)   NULL,
        user_role       NVARCHAR(50)    NULL,
        action          NVARCHAR(100)   NOT NULL,
        entity_type     NVARCHAR(50)    NOT NULL,
        entity_id       NVARCHAR(50)    NULL,
        description     NVARCHAR(500)   NULL,
        old_values      NVARCHAR(MAX)   NULL,
        new_values      NVARCHAR(MAX)   NULL,
        ip_address      NVARCHAR(45)    NULL,
        user_agent      NVARCHAR(500)   NULL,
        browser         NVARCHAR(100)   NULL,
        device          NVARCHAR(100)   NULL,
        os              NVARCHAR(100)   NULL,
        request_id      NVARCHAR(50)    NULL,
        notes           NVARCHAR(500)   NULL,
        created_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_audit_logs PRIMARY KEY (log_id)
    );

    CREATE INDEX IX_audit_company_date ON AuditLogs(company_id, created_at);
    CREATE INDEX IX_audit_user_date    ON AuditLogs(user_id, created_at);
    CREATE INDEX IX_audit_entity       ON AuditLogs(entity_type, entity_id);
END
GO

-- =============================================================================
-- SECTION 12: SYSTEM SETTINGS
-- =============================================================================

IF OBJECT_ID(N'dbo.CompanySettings', N'U') IS NULL
BEGIN
    CREATE TABLE CompanySettings (
        setting_id      INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NOT NULL,
        setting_key     NVARCHAR(100)   NOT NULL,
        setting_value   NVARCHAR(MAX)   NULL,
        setting_group   NVARCHAR(50)    NOT NULL DEFAULT 'general',
        updated_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        updated_by      INT             NULL,
        CONSTRAINT PK_company_settings PRIMARY KEY (setting_id),
        CONSTRAINT UQ_company_setting UNIQUE (company_id, setting_key),
        CONSTRAINT FK_cs_company FOREIGN KEY (company_id) REFERENCES Companies(company_id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.EmailTemplates', N'U') IS NULL
BEGIN
    CREATE TABLE EmailTemplates (
        template_id     INT             NOT NULL IDENTITY(1,1),
        company_id      INT             NULL,
        template_name   NVARCHAR(100)   NOT NULL,
        template_slug   NVARCHAR(100)   NOT NULL,
        subject         NVARCHAR(255)   NOT NULL,
        body_html       NVARCHAR(MAX)   NOT NULL,
        body_text       NVARCHAR(MAX)   NULL,
        variables       NVARCHAR(MAX)   NULL,
        is_active       BIT             NOT NULL DEFAULT 1,
        updated_at      DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_email_templates PRIMARY KEY (template_id),
        CONSTRAINT UQ_email_template_slug UNIQUE (company_id, template_slug)
    );
END
GO

PRINT 'Schema 001 created successfully.';
GO
