-- =============================================================================
-- BANQUET HALL BOOKING & MANAGEMENT SYSTEM
-- Database: MySQL 8.0+
-- Schema Version: 1.0.0
-- Migration: 001_create_schema.sql
-- =============================================================================

CREATE DATABASE IF NOT EXISTS BanquetDB
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE BanquetDB;

-- InnoDB provides MVCC (snapshot isolation) by default — no extra config needed.

-- =============================================================================
-- SECTION 1: LOOKUP / REFERENCE TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS Roles (
    role_id         INT             NOT NULL AUTO_INCREMENT,
    role_name       VARCHAR(50)     NOT NULL,
    role_slug       VARCHAR(50)     NOT NULL,
    description     VARCHAR(255)    NULL,
    is_system       TINYINT(1)      NOT NULL DEFAULT 1,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_roles PRIMARY KEY (role_id),
    CONSTRAINT UQ_roles_slug UNIQUE (role_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Permissions (
    permission_id   INT             NOT NULL AUTO_INCREMENT,
    module          VARCHAR(50)     NOT NULL,
    action          VARCHAR(50)     NOT NULL,
    permission_key  VARCHAR(100)    NOT NULL,
    description     VARCHAR(255)    NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_permissions PRIMARY KEY (permission_id),
    CONSTRAINT UQ_permissions_key UNIQUE (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS RolePermissions (
    role_id         INT             NOT NULL,
    permission_id   INT             NOT NULL,
    granted_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by      INT             NULL,
    CONSTRAINT PK_role_permissions PRIMARY KEY (role_id, permission_id),
    CONSTRAINT FK_rp_role FOREIGN KEY (role_id) REFERENCES Roles(role_id) ON DELETE CASCADE,
    CONSTRAINT FK_rp_permission FOREIGN KEY (permission_id) REFERENCES Permissions(permission_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Countries (
    country_id      INT             NOT NULL AUTO_INCREMENT,
    country_name    VARCHAR(100)    NOT NULL,
    country_code    CHAR(2)         NOT NULL,
    phone_code      VARCHAR(10)     NOT NULL,
    currency_code   CHAR(3)         NOT NULL,
    currency_symbol VARCHAR(5)      NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    CONSTRAINT PK_countries PRIMARY KEY (country_id),
    CONSTRAINT UQ_countries_code UNIQUE (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS States (
    state_id        INT             NOT NULL AUTO_INCREMENT,
    country_id      INT             NOT NULL,
    state_name      VARCHAR(100)    NOT NULL,
    state_code      VARCHAR(10)     NOT NULL,
    CONSTRAINT PK_states PRIMARY KEY (state_id),
    CONSTRAINT FK_states_country FOREIGN KEY (country_id) REFERENCES Countries(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Cities (
    city_id         INT             NOT NULL AUTO_INCREMENT,
    state_id        INT             NOT NULL,
    city_name       VARCHAR(100)    NOT NULL,
    CONSTRAINT PK_cities PRIMARY KEY (city_id),
    CONSTRAINT FK_cities_state FOREIGN KEY (state_id) REFERENCES States(state_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS EventTypes (
    event_type_id   INT             NOT NULL AUTO_INCREMENT,
    type_name       VARCHAR(100)    NOT NULL,
    type_slug       VARCHAR(100)    NOT NULL,
    icon_class      VARCHAR(100)    NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    sort_order      INT             NOT NULL DEFAULT 0,
    CONSTRAINT PK_event_types PRIMARY KEY (event_type_id),
    CONSTRAINT UQ_event_types_slug UNIQUE (type_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AmenityTypes (
    amenity_type_id INT             NOT NULL AUTO_INCREMENT,
    amenity_name    VARCHAR(100)    NOT NULL,
    icon_class      VARCHAR(100)    NULL,
    category        VARCHAR(50)     NOT NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    CONSTRAINT PK_amenity_types PRIMARY KEY (amenity_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 2: TENANT / COMPANY TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS Companies (
    company_id          INT             NOT NULL AUTO_INCREMENT,
    company_name        VARCHAR(200)    NOT NULL,
    company_slug        VARCHAR(200)    NOT NULL,
    legal_name          VARCHAR(200)    NULL,
    gst_number          VARCHAR(20)     NULL,
    pan_number          VARCHAR(20)     NULL,
    registration_no     VARCHAR(50)     NULL,
    logo_url            VARCHAR(500)    NULL,
    website             VARCHAR(255)    NULL,
    email               VARCHAR(150)    NOT NULL,
    phone               VARCHAR(20)     NOT NULL,
    alternate_phone     VARCHAR(20)     NULL,
    address_line1       VARCHAR(255)    NOT NULL,
    address_line2       VARCHAR(255)    NULL,
    city_id             INT             NULL,
    state_id            INT             NULL,
    country_id          INT             NOT NULL DEFAULT 1,
    pincode             VARCHAR(10)     NULL,
    currency_code       CHAR(3)         NOT NULL DEFAULT 'INR',
    timezone            VARCHAR(50)     NOT NULL DEFAULT 'Asia/Kolkata',
    date_format         VARCHAR(20)     NOT NULL DEFAULT 'DD/MM/YYYY',
    subscription_plan   VARCHAR(50)     NOT NULL DEFAULT 'basic',
    subscription_expiry DATE            NULL,
    max_branches        INT             NOT NULL DEFAULT 1,
    max_banquets        INT             NOT NULL DEFAULT 5,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    is_verified         TINYINT(1)      NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by          INT             NULL,
    CONSTRAINT PK_companies PRIMARY KEY (company_id),
    CONSTRAINT UQ_companies_slug UNIQUE (company_slug),
    CONSTRAINT FK_companies_city FOREIGN KEY (city_id) REFERENCES Cities(city_id),
    CONSTRAINT FK_companies_state FOREIGN KEY (state_id) REFERENCES States(state_id),
    CONSTRAINT FK_companies_country FOREIGN KEY (country_id) REFERENCES Countries(country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Branches (
    branch_id           INT             NOT NULL AUTO_INCREMENT,
    company_id          INT             NOT NULL,
    branch_name         VARCHAR(200)    NOT NULL,
    branch_code         VARCHAR(20)     NOT NULL,
    email               VARCHAR(150)    NULL,
    phone               VARCHAR(20)     NULL,
    address_line1       VARCHAR(255)    NOT NULL,
    address_line2       VARCHAR(255)    NULL,
    city_id             INT             NULL,
    state_id            INT             NULL,
    pincode             VARCHAR(10)     NULL,
    latitude            DECIMAL(10, 8)  NULL,
    longitude           DECIMAL(11, 8)  NULL,
    is_main_branch      TINYINT(1)      NOT NULL DEFAULT 0,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by          INT             NULL,
    CONSTRAINT PK_branches PRIMARY KEY (branch_id),
    CONSTRAINT UQ_branch_code UNIQUE (company_id, branch_code),
    CONSTRAINT FK_branches_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_branches_city FOREIGN KEY (city_id) REFERENCES Cities(city_id),
    CONSTRAINT FK_branches_state FOREIGN KEY (state_id) REFERENCES States(state_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 3: USER MANAGEMENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS Users (
    user_id                 INT             NOT NULL AUTO_INCREMENT,
    company_id              INT             NULL,
    branch_id               INT             NULL,
    role_id                 INT             NOT NULL,
    first_name              VARCHAR(100)    NOT NULL,
    last_name               VARCHAR(100)    NOT NULL,
    email                   VARCHAR(150)    NOT NULL,
    phone                   VARCHAR(20)     NULL,
    alternate_phone         VARCHAR(20)     NULL,
    password_hash           VARCHAR(255)    NOT NULL,
    avatar_url              VARCHAR(500)    NULL,
    date_of_birth           DATE            NULL,
    gender                  VARCHAR(10)     NULL,
    address_line1           VARCHAR(255)    NULL,
    city_id                 INT             NULL,
    state_id                INT             NULL,
    pincode                 VARCHAR(10)     NULL,
    is_email_verified       TINYINT(1)      NOT NULL DEFAULT 0,
    is_phone_verified       TINYINT(1)      NOT NULL DEFAULT 0,
    is_two_factor           TINYINT(1)      NOT NULL DEFAULT 0,
    two_factor_secret       VARCHAR(255)    NULL,
    is_active               TINYINT(1)      NOT NULL DEFAULT 1,
    last_login_at           DATETIME        NULL,
    last_login_ip           VARCHAR(45)     NULL,
    failed_login_attempts   TINYINT         NOT NULL DEFAULT 0,
    account_locked_until    DATETIME        NULL,
    password_reset_at       DATETIME        NULL,
    timezone                VARCHAR(50)     NOT NULL DEFAULT 'Asia/Kolkata',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by              INT             NULL,
    CONSTRAINT PK_users PRIMARY KEY (user_id),
    CONSTRAINT UQ_users_email UNIQUE (email),
    CONSTRAINT FK_users_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_users_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
    CONSTRAINT FK_users_role FOREIGN KEY (role_id) REFERENCES Roles(role_id),
    CONSTRAINT FK_users_city FOREIGN KEY (city_id) REFERENCES Cities(city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS RefreshTokens (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    user_id         INT             NOT NULL,
    token_hash      VARCHAR(255)    NOT NULL,
    device_info     VARCHAR(500)    NULL,
    ip_address      VARCHAR(45)     NULL,
    user_agent      VARCHAR(500)    NULL,
    expires_at      DATETIME        NOT NULL,
    is_revoked      TINYINT(1)      NOT NULL DEFAULT 0,
    revoked_at      DATETIME        NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_refresh_tokens PRIMARY KEY (id),
    CONSTRAINT FK_rt_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PasswordResetTokens (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    user_id         INT             NOT NULL,
    token_hash      VARCHAR(255)    NOT NULL,
    expires_at      DATETIME        NOT NULL,
    is_used         TINYINT(1)      NOT NULL DEFAULT 0,
    used_at         DATETIME        NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_password_reset_tokens PRIMARY KEY (id),
    CONSTRAINT FK_prt_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS OtpVerifications (
    otp_id          BIGINT          NOT NULL AUTO_INCREMENT,
    user_id         INT             NULL,
    email           VARCHAR(150)    NULL,
    phone           VARCHAR(20)     NULL,
    otp_hash        VARCHAR(255)    NOT NULL,
    purpose         VARCHAR(50)     NOT NULL,
    expires_at      DATETIME        NOT NULL,
    is_used         TINYINT(1)      NOT NULL DEFAULT 0,
    used_at         DATETIME        NULL,
    attempts        TINYINT         NOT NULL DEFAULT 0,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_otp PRIMARY KEY (otp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 4: BANQUET & HALL MANAGEMENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS Banquets (
    banquet_id          INT             NOT NULL AUTO_INCREMENT,
    company_id          INT             NOT NULL,
    branch_id           INT             NOT NULL,
    banquet_name        VARCHAR(200)    NOT NULL,
    banquet_slug        VARCHAR(200)    NOT NULL,
    description         TEXT            NULL,
    short_description   VARCHAR(500)    NULL,
    logo_url            VARCHAR(500)    NULL,
    cover_image_url     VARCHAR(500)    NULL,
    address_line1       VARCHAR(255)    NOT NULL,
    address_line2       VARCHAR(255)    NULL,
    city_id             INT             NULL,
    state_id            INT             NULL,
    pincode             VARCHAR(10)     NULL,
    latitude            DECIMAL(10, 8)  NULL,
    longitude           DECIMAL(11, 8)  NULL,
    google_maps_url     VARCHAR(500)    NULL,
    phone               VARCHAR(20)     NULL,
    email               VARCHAR(150)    NULL,
    whatsapp            VARCHAR(20)     NULL,
    gst_number          VARCHAR(20)     NULL,
    address             VARCHAR(500)    NULL,
    city                VARCHAR(100)    NULL,
    state               VARCHAR(100)    NULL,
    total_capacity      INT             NOT NULL DEFAULT 0,
    parking_capacity    INT             NOT NULL DEFAULT 0,
    has_valet           TINYINT(1)      NOT NULL DEFAULT 0,
    total_halls         INT             NOT NULL DEFAULT 0,
    check_in_time       TIME            NOT NULL DEFAULT '08:00:00',
    check_out_time      TIME            NOT NULL DEFAULT '23:00:00',
    cancellation_policy TEXT            NULL,
    booking_policy      TEXT            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    is_featured         TINYINT(1)      NOT NULL DEFAULT 0,
    average_rating      DECIMAL(3, 2)   NOT NULL DEFAULT 0.00,
    total_reviews       INT             NOT NULL DEFAULT 0,
    total_bookings      INT             NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by          INT             NULL,
    CONSTRAINT PK_banquets PRIMARY KEY (banquet_id),
    CONSTRAINT UQ_banquet_slug UNIQUE (company_id, banquet_slug),
    CONSTRAINT FK_banquets_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_banquets_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
    CONSTRAINT FK_banquets_city FOREIGN KEY (city_id) REFERENCES Cities(city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BanquetGallery (
    gallery_id      INT             NOT NULL AUTO_INCREMENT,
    banquet_id      INT             NOT NULL,
    media_type      VARCHAR(10)     NOT NULL DEFAULT 'image',
    media_url       VARCHAR(500)    NOT NULL,
    thumbnail_url   VARCHAR(500)    NULL,
    caption         VARCHAR(255)    NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    uploaded_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_banquet_gallery PRIMARY KEY (gallery_id),
    CONSTRAINT FK_gallery_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BanquetAmenities (
    banquet_id      INT             NOT NULL,
    amenity_type_id INT             NOT NULL,
    notes           VARCHAR(255)    NULL,
    CONSTRAINT PK_banquet_amenities PRIMARY KEY (banquet_id, amenity_type_id),
    CONSTRAINT FK_ba_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE,
    CONSTRAINT FK_ba_amenity FOREIGN KEY (amenity_type_id) REFERENCES AmenityTypes(amenity_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BanquetDocuments (
    document_id     INT             NOT NULL AUTO_INCREMENT,
    banquet_id      INT             NOT NULL,
    document_type   VARCHAR(100)    NOT NULL,
    document_name   VARCHAR(255)    NOT NULL,
    file_url        VARCHAR(500)    NOT NULL,
    expiry_date     DATE            NULL,
    is_verified     TINYINT(1)      NOT NULL DEFAULT 0,
    uploaded_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_banquet_documents PRIMARY KEY (document_id),
    CONSTRAINT FK_bd_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Halls (
    hall_id             INT             NOT NULL AUTO_INCREMENT,
    banquet_id          INT             NOT NULL,
    company_id          INT             NOT NULL,
    branch_id           INT             NULL,
    hall_name           VARCHAR(200)    NOT NULL,
    hall_code           VARCHAR(20)     NOT NULL,
    floor_number        TINYINT         NOT NULL DEFAULT 1,
    hall_type           VARCHAR(50)     NOT NULL DEFAULT 'main_hall',
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
    has_ac              TINYINT(1)      NOT NULL DEFAULT 0,
    has_power_backup    TINYINT(1)      NOT NULL DEFAULT 0,
    has_kitchen         TINYINT(1)      NOT NULL DEFAULT 0,
    has_stage           TINYINT(1)      NOT NULL DEFAULT 0,
    has_parking         TINYINT(1)      NOT NULL DEFAULT 0,
    has_washroom        TINYINT(1)      NOT NULL DEFAULT 0,
    has_green_room      TINYINT(1)      NOT NULL DEFAULT 0,
    has_bridal_room     TINYINT(1)      NOT NULL DEFAULT 0,
    description         TEXT            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    is_under_maintenance TINYINT(1)     NOT NULL DEFAULT 0,
    maintenance_note    VARCHAR(500)    NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_halls PRIMARY KEY (hall_id),
    CONSTRAINT UQ_hall_code UNIQUE (banquet_id, hall_code),
    CONSTRAINT FK_halls_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id),
    CONSTRAINT FK_halls_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS HallAmenities (
    hall_id         INT             NOT NULL,
    amenity_type_id INT             NOT NULL,
    notes           VARCHAR(255)    NULL,
    CONSTRAINT PK_hall_amenities PRIMARY KEY (hall_id, amenity_type_id),
    CONSTRAINT FK_ha_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE,
    CONSTRAINT FK_ha_amenity FOREIGN KEY (amenity_type_id) REFERENCES AmenityTypes(amenity_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS HallGallery (
    gallery_id      INT             NOT NULL AUTO_INCREMENT,
    hall_id         INT             NOT NULL,
    image_url       VARCHAR(500)    NOT NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    CONSTRAINT PK_hall_gallery PRIMARY KEY (gallery_id),
    CONSTRAINT FK_hg_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 5: PRICING ENGINE
-- =============================================================================

CREATE TABLE IF NOT EXISTS HallPricing (
    pricing_id          INT             NOT NULL AUTO_INCREMENT,
    hall_id             INT             NOT NULL,
    pricing_name        VARCHAR(100)    NOT NULL,
    pricing_type        VARCHAR(50)     NOT NULL,
    base_price          DECIMAL(12, 2)  NOT NULL,
    weekend_multiplier  DECIMAL(5, 2)   NOT NULL DEFAULT 1.00,
    peak_multiplier     DECIMAL(5, 2)   NOT NULL DEFAULT 1.00,
    min_booking_hours   TINYINT         NOT NULL DEFAULT 4,
    max_booking_hours   TINYINT         NULL,
    advance_amount      DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,
    advance_percentage  DECIMAL(5, 2)   NOT NULL DEFAULT 25.00,
    valid_from          DATE            NULL,
    valid_to            DATE            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_hall_pricing PRIMARY KEY (pricing_id),
    CONSTRAINT FK_pricing_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PricingSlots (
    slot_id         INT             NOT NULL AUTO_INCREMENT,
    pricing_id      INT             NOT NULL,
    slot_name       VARCHAR(50)     NOT NULL,
    start_time      TIME            NOT NULL,
    end_time        TIME            NOT NULL,
    slot_price      DECIMAL(12, 2)  NOT NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    CONSTRAINT PK_pricing_slots PRIMARY KEY (slot_id),
    CONSTRAINT FK_slots_pricing FOREIGN KEY (pricing_id) REFERENCES HallPricing(pricing_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SpecialPricing (
    special_id      INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    hall_id         INT             NULL,
    pricing_name    VARCHAR(100)    NOT NULL,
    special_date    DATE            NOT NULL,
    multiplier      DECIMAL(5, 2)   NOT NULL DEFAULT 1.50,
    flat_price      DECIMAL(12, 2)  NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_special_pricing PRIMARY KEY (special_id),
    CONSTRAINT FK_sp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_sp_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Coupons (
    coupon_id           INT             NOT NULL AUTO_INCREMENT,
    company_id          INT             NOT NULL,
    coupon_code         VARCHAR(50)     NOT NULL,
    coupon_name         VARCHAR(100)    NOT NULL,
    description         VARCHAR(255)    NULL,
    discount_type       VARCHAR(20)     NOT NULL,
    discount_value      DECIMAL(10, 2)  NOT NULL,
    max_discount_amount DECIMAL(10, 2)  NULL,
    min_booking_amount  DECIMAL(10, 2)  NOT NULL DEFAULT 0,
    usage_limit         INT             NULL,
    usage_per_user      TINYINT         NOT NULL DEFAULT 1,
    used_count          INT             NOT NULL DEFAULT 0,
    valid_from          DATETIME        NOT NULL,
    valid_to            DATETIME        NOT NULL,
    applicable_halls    TEXT            NULL,
    applicable_events   TEXT            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          INT             NULL,
    CONSTRAINT PK_coupons PRIMARY KEY (coupon_id),
    CONSTRAINT UQ_coupon_code UNIQUE (company_id, coupon_code),
    CONSTRAINT FK_coupons_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TaxConfig (
    tax_id          INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    tax_name        VARCHAR(100)    NOT NULL,
    tax_type        VARCHAR(20)     NOT NULL,
    rate            DECIMAL(5, 2)   NOT NULL,
    applies_to      VARCHAR(50)     NOT NULL DEFAULT 'all',
    is_compound     TINYINT(1)      NOT NULL DEFAULT 0,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    effective_from  DATE            NOT NULL,
    effective_to    DATE            NULL,
    CONSTRAINT PK_tax_config PRIMARY KEY (tax_id),
    CONSTRAINT FK_tax_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 6: CUSTOMER MANAGEMENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS Customers (
    customer_id         INT             NOT NULL AUTO_INCREMENT,
    company_id          INT             NOT NULL,
    branch_id           INT             NULL,
    first_name          VARCHAR(100)    NOT NULL,
    last_name           VARCHAR(100)    NULL,
    email               VARCHAR(150)    NULL,
    phone               VARCHAR(20)     NOT NULL,
    alternate_phone     VARCHAR(20)     NULL,
    address             VARCHAR(500)    NULL,
    city                VARCHAR(100)    NULL,
    state               VARCHAR(100)    NULL,
    notes               TEXT            NULL,
    customer_code       VARCHAR(20)     NULL,
    preferred_language  VARCHAR(10)     NOT NULL DEFAULT 'en',
    anniversary_date    DATE            NULL,
    loyalty_points      INT             NOT NULL DEFAULT 0,
    referral_code       VARCHAR(20)     NULL,
    referred_by         INT             NULL,
    source              VARCHAR(50)     NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_customers PRIMARY KEY (customer_id),
    CONSTRAINT FK_customers_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_customers_referrer FOREIGN KEY (referred_by) REFERENCES Customers(customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS CustomerDocuments (
    doc_id          INT             NOT NULL AUTO_INCREMENT,
    customer_id     INT             NOT NULL,
    doc_type        VARCHAR(50)     NOT NULL,
    doc_number      VARCHAR(50)     NULL,
    file_url        VARCHAR(500)    NOT NULL,
    uploaded_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_customer_docs PRIMARY KEY (doc_id),
    CONSTRAINT FK_cd_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 7: BOOKING ENGINE
-- =============================================================================

CREATE TABLE IF NOT EXISTS Bookings (
    booking_id          BIGINT          NOT NULL AUTO_INCREMENT,
    booking_ref         VARCHAR(30)     NOT NULL,
    company_id          INT             NOT NULL,
    branch_id           INT             NOT NULL,
    hall_id             INT             NOT NULL,
    customer_id         INT             NOT NULL,
    event_name          VARCHAR(200)    NULL,
    event_type          VARCHAR(50)     NULL,
    event_date          DATE            NOT NULL,
    event_time_start    TIME            NOT NULL,
    event_time_end      TIME            NOT NULL,
    guest_count         INT             NULL,
    status              VARCHAR(30)     NOT NULL DEFAULT 'draft',
    total_amount        DECIMAL(14, 2)  NOT NULL DEFAULT 0,
    advance_paid        DECIMAL(14, 2)  NOT NULL DEFAULT 0,
    amount_paid         DECIMAL(14, 2)  NOT NULL DEFAULT 0,
    discount_amount     DECIMAL(14, 2)  NOT NULL DEFAULT 0,
    notes               TEXT            NULL,
    special_requests    TEXT            NULL,
    internal_notes      TEXT            NULL,
    cancellation_reason VARCHAR(500)    NULL,
    cancelled_at        DATETIME        NULL,
    cancelled_by        INT             NULL,
    confirmed_at        DATETIME        NULL,
    created_by          INT             NOT NULL,
    updated_by          INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_bookings PRIMARY KEY (booking_id),
    CONSTRAINT UQ_booking_ref UNIQUE (booking_ref),
    CONSTRAINT FK_bookings_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_bookings_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
    CONSTRAINT FK_bookings_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id),
    CONSTRAINT FK_bookings_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    CONSTRAINT CHK_booking_status CHECK (status IN ('draft','confirmed','advance_paid','fully_paid','cancelled','completed','no_show'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IX_bookings_date_hall      ON Bookings(event_date, hall_id);
CREATE INDEX IX_bookings_customer       ON Bookings(customer_id, event_date);
CREATE INDEX IX_bookings_company_date   ON Bookings(company_id, event_date);
CREATE INDEX IX_bookings_status         ON Bookings(status, company_id, event_date);

CREATE TABLE IF NOT EXISTS HallBlockedDates (
    block_id        INT             NOT NULL AUTO_INCREMENT,
    hall_id         INT             NOT NULL,
    company_id      INT             NOT NULL,
    blocked_date    DATE            NOT NULL,
    start_time      TIME            NULL,
    end_time        TIME            NULL,
    reason          VARCHAR(200)    NULL,
    blocked_by      INT             NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_blocked_dates PRIMARY KEY (block_id),
    CONSTRAINT UQ_block UNIQUE (hall_id, blocked_date, start_time),
    CONSTRAINT FK_block_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id),
    CONSTRAINT FK_block_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IX_blocked_dates_hall_date ON HallBlockedDates(hall_id, blocked_date);

-- =============================================================================
-- SECTION 8: CATERING MANAGEMENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS MenuCategories (
    category_id     INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    category_name   VARCHAR(100)    NOT NULL,
    food_type       VARCHAR(10)     NOT NULL,
    sort_order      INT             NOT NULL DEFAULT 0,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    CONSTRAINT PK_menu_categories PRIMARY KEY (category_id),
    CONSTRAINT FK_mc_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MenuItems (
    item_id         INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    category_id     INT             NOT NULL,
    item_name       VARCHAR(200)    NOT NULL,
    description     VARCHAR(500)    NULL,
    food_type       VARCHAR(10)     NOT NULL,
    unit            VARCHAR(20)     NOT NULL DEFAULT 'plate',
    base_price      DECIMAL(10, 2)  NOT NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_menu_items PRIMARY KEY (item_id),
    CONSTRAINT FK_mi_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_mi_category FOREIGN KEY (category_id) REFERENCES MenuCategories(category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS CateringPackages (
    package_id      INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    package_name    VARCHAR(200)    NOT NULL,
    package_type    VARCHAR(20)     NOT NULL,
    price_per_plate DECIMAL(10, 2)  NOT NULL,
    min_plates      INT             NOT NULL DEFAULT 50,
    description     TEXT            NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_catering_packages PRIMARY KEY (package_id),
    CONSTRAINT FK_cp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 9: PAYMENT & INVOICE MODULE
-- =============================================================================

CREATE TABLE IF NOT EXISTS Invoices (
    invoice_id          BIGINT          NOT NULL AUTO_INCREMENT,
    invoice_number      VARCHAR(30)     NOT NULL,
    company_id          INT             NOT NULL,
    booking_id          BIGINT          NOT NULL,
    customer_id         INT             NOT NULL,
    invoice_date        DATE            NOT NULL,
    due_date            DATE            NOT NULL,
    invoice_type        VARCHAR(20)     NOT NULL DEFAULT 'tax_invoice',
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
    payment_status      VARCHAR(20)     NOT NULL DEFAULT 'pending',
    notes               TEXT            NULL,
    terms               TEXT            NULL,
    pdf_url             VARCHAR(500)    NULL,
    is_cancelled        TINYINT(1)      NOT NULL DEFAULT 0,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          INT             NOT NULL,
    CONSTRAINT PK_invoices PRIMARY KEY (invoice_id),
    CONSTRAINT UQ_invoice_number UNIQUE (company_id, invoice_number),
    CONSTRAINT FK_invoices_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_invoices_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT FK_invoices_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Payments (
    payment_id          BIGINT          NOT NULL AUTO_INCREMENT,
    payment_ref         VARCHAR(30)     NULL,
    company_id          INT             NOT NULL,
    booking_id          BIGINT          NOT NULL,
    invoice_id          BIGINT          NULL,
    customer_id         INT             NULL,
    payment_type        VARCHAR(30)     NOT NULL,
    payment_method      VARCHAR(30)     NOT NULL,
    amount              DECIMAL(14, 2)  NOT NULL,
    currency            CHAR(3)         NOT NULL DEFAULT 'INR',
    transaction_id      VARCHAR(200)    NULL,
    gateway_name        VARCHAR(50)     NULL,
    gateway_response    TEXT            NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending',
    payment_date        DATE            NOT NULL DEFAULT (CURRENT_DATE),
    notes               VARCHAR(500)    NULL,
    reference_number    VARCHAR(100)    NULL,
    cheque_number       VARCHAR(50)     NULL,
    cheque_date         DATE            NULL,
    bank_name           VARCHAR(100)    NULL,
    receipt_url         VARCHAR(500)    NULL,
    created_by          INT             NOT NULL,
    verified_by         INT             NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_payments PRIMARY KEY (payment_id),
    CONSTRAINT FK_payments_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_payments_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT FK_payments_invoice FOREIGN KEY (invoice_id) REFERENCES Invoices(invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IX_payments_booking      ON Payments(booking_id, payment_date);
CREATE INDEX IX_payments_company_date ON Payments(company_id, payment_date);

CREATE TABLE IF NOT EXISTS Refunds (
    refund_id           BIGINT          NOT NULL AUTO_INCREMENT,
    payment_id          BIGINT          NOT NULL,
    booking_id          BIGINT          NOT NULL,
    company_id          INT             NOT NULL,
    refund_amount       DECIMAL(14, 2)  NOT NULL,
    refund_reason       VARCHAR(500)    NOT NULL,
    refund_method       VARCHAR(30)     NOT NULL,
    transaction_id      VARCHAR(200)    NULL,
    refund_status       VARCHAR(20)     NOT NULL DEFAULT 'pending',
    requested_by        INT             NOT NULL,
    approved_by         INT             NULL,
    processed_at        DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_refunds PRIMARY KEY (refund_id),
    CONSTRAINT FK_refunds_payment FOREIGN KEY (payment_id) REFERENCES Payments(payment_id),
    CONSTRAINT FK_refunds_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT FK_refunds_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SECTION 10: REVIEWS & NOTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS Reviews (
    review_id           INT             NOT NULL AUTO_INCREMENT,
    banquet_id          INT             NOT NULL,
    customer_id         INT             NOT NULL,
    booking_id          BIGINT          NOT NULL,
    rating              TINYINT         NOT NULL,
    title               VARCHAR(200)    NULL,
    review_text         TEXT            NULL,
    venue_rating        TINYINT         NULL,
    service_rating      TINYINT         NULL,
    catering_rating     TINYINT         NULL,
    value_rating        TINYINT         NULL,
    is_approved         TINYINT(1)      NOT NULL DEFAULT 0,
    is_featured         TINYINT(1)      NOT NULL DEFAULT 0,
    admin_response      TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_reviews PRIMARY KEY (review_id),
    CONSTRAINT UQ_review_booking UNIQUE (booking_id, customer_id),
    CONSTRAINT FK_reviews_banquet FOREIGN KEY (banquet_id) REFERENCES Banquets(banquet_id),
    CONSTRAINT FK_reviews_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    CONSTRAINT FK_reviews_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    CONSTRAINT CHK_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Notifications (
    notification_id     BIGINT          NOT NULL AUTO_INCREMENT,
    company_id          INT             NOT NULL,
    user_id             INT             NULL,
    notification_type   VARCHAR(50)     NOT NULL,
    channel             VARCHAR(20)     NOT NULL,
    title               VARCHAR(200)    NOT NULL,
    body                TEXT            NOT NULL,
    reference_type      VARCHAR(50)     NULL,
    reference_id        BIGINT          NULL,
    is_read             TINYINT(1)      NOT NULL DEFAULT 0,
    read_at             DATETIME        NULL,
    sent_at             DATETIME        NULL,
    delivery_status     VARCHAR(20)     NOT NULL DEFAULT 'pending',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_notifications PRIMARY KEY (notification_id),
    CONSTRAINT FK_notif_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
    CONSTRAINT FK_notif_user FOREIGN KEY (user_id) REFERENCES Users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IX_notifications_user ON Notifications(user_id, is_read, created_at);

-- =============================================================================
-- SECTION 11: AUDIT LOGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS AuditLogs (
    log_id          BIGINT          NOT NULL AUTO_INCREMENT,
    company_id      INT             NULL,
    user_id         INT             NULL,
    user_email      VARCHAR(150)    NULL,
    user_role       VARCHAR(50)     NULL,
    action          VARCHAR(100)    NOT NULL,
    entity_type     VARCHAR(50)     NOT NULL,
    entity_id       VARCHAR(50)     NULL,
    description     VARCHAR(500)    NULL,
    old_values      TEXT            NULL,
    new_values      TEXT            NULL,
    ip_address      VARCHAR(45)     NULL,
    user_agent      VARCHAR(500)    NULL,
    browser         VARCHAR(100)    NULL,
    device          VARCHAR(100)    NULL,
    os              VARCHAR(100)    NULL,
    request_id      VARCHAR(50)     NULL,
    notes           VARCHAR(500)    NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_audit_logs PRIMARY KEY (log_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IX_audit_company_date ON AuditLogs(company_id, created_at);
CREATE INDEX IX_audit_user_date    ON AuditLogs(user_id, created_at);
CREATE INDEX IX_audit_entity       ON AuditLogs(entity_type, entity_id);

-- =============================================================================
-- SECTION 12: SYSTEM SETTINGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS CompanySettings (
    setting_id      INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NOT NULL,
    setting_key     VARCHAR(100)    NOT NULL,
    setting_value   TEXT            NULL,
    setting_group   VARCHAR(50)     NOT NULL DEFAULT 'general',
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by      INT             NULL,
    CONSTRAINT PK_company_settings PRIMARY KEY (setting_id),
    CONSTRAINT UQ_company_setting UNIQUE (company_id, setting_key),
    CONSTRAINT FK_cs_company FOREIGN KEY (company_id) REFERENCES Companies(company_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS EmailTemplates (
    template_id     INT             NOT NULL AUTO_INCREMENT,
    company_id      INT             NULL,
    template_name   VARCHAR(100)    NOT NULL,
    template_slug   VARCHAR(100)    NOT NULL,
    subject         VARCHAR(255)    NOT NULL,
    body_html       TEXT            NOT NULL,
    body_text       TEXT            NULL,
    variables       TEXT            NULL,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_email_templates PRIMARY KEY (template_id),
    CONSTRAINT UQ_email_template_slug UNIQUE (company_id, template_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Schema 001 created successfully.' AS message;
