-- =============================================================================
-- STORED PROCEDURES: BANQUET, CUSTOMER, NOTIFICATIONS, SETTINGS
-- =============================================================================
USE BanquetDB;
GO

-- ═══════════════════════════════════════════════════════════════════
-- BANQUET MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════

-- =============================================================================
-- SP 1: Get Banquet List (with filters and pagination)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ListBanquets
    @company_id     INT = NULL,
    @city_id        INT = NULL,
    @is_active      BIT = 1,
    @min_capacity   INT = 0,
    @search         NVARCHAR(200) = NULL,
    @page           INT = 1,
    @limit          INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @offset INT = (@page - 1) * @limit;

    SELECT COUNT(*) AS total_count
    FROM banquets bq
    WHERE (@company_id IS NULL OR bq.company_id = @company_id)
      AND (@city_id    IS NULL OR bq.city_id    = @city_id)
      AND (bq.is_active = @is_active)
      AND (@min_capacity = 0 OR bq.total_capacity >= @min_capacity)
      AND (@search IS NULL OR bq.banquet_name LIKE '%' + @search + '%'
                           OR bq.address_line1 LIKE '%' + @search + '%');

    SELECT
        bq.banquet_id, bq.banquet_name, bq.banquet_slug, bq.short_description,
        bq.logo_url, bq.cover_image_url,
        bq.address_line1, ci.city_name, st.state_name,
        bq.phone, bq.email,
        bq.total_capacity, bq.total_halls, bq.parking_capacity,
        bq.has_valet, bq.average_rating, bq.total_reviews, bq.total_bookings,
        bq.is_featured, bq.is_active,
        c.company_name, br.branch_name
    FROM banquets bq
    INNER JOIN companies c ON c.company_id = bq.company_id
    INNER JOIN branches br ON br.branch_id = bq.branch_id
    LEFT JOIN cities ci ON ci.city_id = bq.city_id
    LEFT JOIN states st ON st.state_id = bq.state_id
    WHERE (@company_id IS NULL OR bq.company_id = @company_id)
      AND (@city_id    IS NULL OR bq.city_id    = @city_id)
      AND (bq.is_active = @is_active)
      AND (@min_capacity = 0 OR bq.total_capacity >= @min_capacity)
      AND (@search IS NULL OR bq.banquet_name LIKE '%' + @search + '%'
                           OR bq.address_line1 LIKE '%' + @search + '%')
    ORDER BY bq.is_featured DESC, bq.average_rating DESC, bq.banquet_id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 2: Get Banquet Detail (full profile)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetBanquetDetail
    @banquet_id INT,
    @company_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Banquet profile
    SELECT
        bq.*, ci.city_name, st.state_name, co.country_name,
        c.company_name, c.gst_number AS company_gst,
        br.branch_name
    FROM banquets bq
    INNER JOIN companies c ON c.company_id = bq.company_id
    INNER JOIN branches br ON br.branch_id = bq.branch_id
    LEFT JOIN cities ci ON ci.city_id = bq.city_id
    LEFT JOIN states st ON st.state_id = bq.state_id
    LEFT JOIN countries co ON co.country_id = c.country_id
    WHERE bq.banquet_id = @banquet_id
      AND (@company_id IS NULL OR bq.company_id = @company_id);

    -- Gallery
    SELECT gallery_id, media_type, media_url, thumbnail_url, caption, sort_order
    FROM banquet_gallery
    WHERE banquet_id = @banquet_id AND is_active = 1
    ORDER BY sort_order;

    -- Amenities
    SELECT at.amenity_type_id, at.amenity_name, at.icon_class, at.category, ba.notes
    FROM banquet_amenities ba
    INNER JOIN amenity_types at ON at.amenity_type_id = ba.amenity_type_id
    WHERE ba.banquet_id = @banquet_id
    ORDER BY at.category, at.amenity_name;

    -- Halls summary
    SELECT
        h.hall_id, h.hall_name, h.hall_code, h.hall_type,
        h.capacity_seated, h.capacity_standing, h.area_sqft,
        h.has_ac, h.has_stage, h.has_kitchen, h.has_power_backup,
        h.is_active, h.is_under_maintenance,
        hp.base_price, hp.pricing_type, hp.weekend_multiplier
    FROM halls h
    LEFT JOIN hall_pricing hp ON hp.hall_id = h.hall_id AND hp.is_active = 1
    WHERE h.banquet_id = @banquet_id
    ORDER BY h.capacity_seated DESC;

    -- Recent reviews (top 5)
    SELECT TOP 5
        r.review_id, r.rating, r.title, r.review_text,
        r.venue_rating, r.service_rating, r.catering_rating, r.value_rating,
        r.admin_response, r.created_at,
        u.first_name + ' ' + u.last_name AS reviewer_name,
        et.type_name AS event_type
    FROM reviews r
    INNER JOIN customers c ON c.customer_id = r.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    INNER JOIN bookings b ON b.booking_id = r.booking_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    WHERE r.banquet_id = @banquet_id AND r.is_approved = 1
    ORDER BY r.created_at DESC;
END;
GO

-- =============================================================================
-- SP 3: Manage Hall (Create or Update)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_UpsertHall
    @hall_id            INT = NULL,   -- NULL = create new
    @banquet_id         INT,
    @company_id         INT,
    @hall_name          NVARCHAR(200),
    @hall_code          NVARCHAR(20),
    @hall_type          NVARCHAR(50),
    @floor_number       TINYINT = 1,
    @capacity_seated    INT,
    @capacity_standing  INT = 0,
    @capacity_theatre   INT = 0,
    @area_sqft          DECIMAL(10,2) = NULL,
    @has_ac             BIT = 0,
    @has_power_backup   BIT = 0,
    @has_kitchen        BIT = 0,
    @has_stage          BIT = 0,
    @description        NVARCHAR(MAX) = NULL,
    @operated_by        INT,
    @result_hall_id     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF @hall_id IS NULL
    BEGIN
        INSERT INTO halls (banquet_id, company_id, hall_name, hall_code, hall_type, floor_number,
            capacity_seated, capacity_standing, capacity_theatre, area_sqft,
            has_ac, has_power_backup, has_kitchen, has_stage, description, created_at, updated_at)
        VALUES (@banquet_id, @company_id, @hall_name, @hall_code, @hall_type, @floor_number,
            @capacity_seated, @capacity_standing, @capacity_theatre, @area_sqft,
            @has_ac, @has_power_backup, @has_kitchen, @has_stage, @description,
            GETUTCDATE(), GETUTCDATE());

        SET @result_hall_id = SCOPE_IDENTITY();

        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
        VALUES (@company_id, @operated_by, 'halls.create', 'hall', CAST(@result_hall_id AS NVARCHAR), GETUTCDATE());
    END
    ELSE
    BEGIN
        UPDATE halls SET
            hall_name           = @hall_name,
            hall_type           = @hall_type,
            floor_number        = @floor_number,
            capacity_seated     = @capacity_seated,
            capacity_standing   = @capacity_standing,
            capacity_theatre    = @capacity_theatre,
            area_sqft           = @area_sqft,
            has_ac              = @has_ac,
            has_power_backup    = @has_power_backup,
            has_kitchen         = @has_kitchen,
            has_stage           = @has_stage,
            description         = @description,
            updated_at          = GETUTCDATE()
        WHERE hall_id = @hall_id AND company_id = @company_id;

        SET @result_hall_id = @hall_id;

        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
        VALUES (@company_id, @operated_by, 'halls.update', 'hall', CAST(@hall_id AS NVARCHAR), GETUTCDATE());
    END;
END;
GO

-- =============================================================================
-- SP 4: Get Availability Calendar (month view)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetAvailabilityCalendar
    @hall_id        INT,
    @year           INT,
    @month          INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @start_date DATE = DATEFROMPARTS(@year, @month, 1);
    DECLARE @end_date   DATE = EOMONTH(@start_date);

    -- Booked dates
    SELECT
        b.booking_date,
        b.start_time,
        b.end_time,
        b.booking_status,
        b.booking_ref,
        et.type_name AS event_type,
        b.expected_guests
    FROM bookings b
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    WHERE b.hall_id = @hall_id
      AND b.booking_date BETWEEN @start_date AND @end_date
      AND b.booking_status NOT IN ('cancelled','draft')
    ORDER BY b.booking_date, b.start_time;

    -- Blocked dates
    SELECT blocked_date, start_time, end_time, reason
    FROM hall_blocked_dates
    WHERE hall_id = @hall_id
      AND blocked_date BETWEEN @start_date AND @end_date
    ORDER BY blocked_date;

    -- Special pricing for the month
    SELECT special_date, multiplier, flat_price, pricing_name
    FROM special_pricing
    WHERE hall_id = @hall_id OR hall_id IS NULL
      AND special_date BETWEEN @start_date AND @end_date
      AND is_active = 1;
END;
GO

-- ═══════════════════════════════════════════════════════════════════
-- CUSTOMER MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════

-- =============================================================================
-- SP 5: Search Customers
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_SearchCustomers
    @company_id INT,
    @search     NVARCHAR(200) = NULL,
    @source     NVARCHAR(50)  = NULL,
    @from_date  DATE          = NULL,
    @to_date    DATE          = NULL,
    @page       INT = 1,
    @limit      INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @offset INT = (@page - 1) * @limit;

    SELECT COUNT(*) AS total_count
    FROM customers c
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE c.company_id = @company_id
      AND (@source    IS NULL OR c.source = @source)
      AND (@from_date IS NULL OR CAST(c.created_at AS DATE) >= @from_date)
      AND (@to_date   IS NULL OR CAST(c.created_at AS DATE) <= @to_date)
      AND (@search    IS NULL OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%'
                              OR u.email LIKE '%' + @search + '%'
                              OR u.phone LIKE '%' + @search + '%'
                              OR c.customer_code LIKE '%' + @search + '%');

    SELECT
        c.customer_id, c.customer_code, c.total_bookings, c.total_spend,
        c.loyalty_points, c.source, c.preferred_event, c.created_at AS customer_since,
        u.first_name, u.last_name, u.email, u.phone, u.avatar_url, u.is_active,
        u.last_login_at
    FROM customers c
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE c.company_id = @company_id
      AND (@source    IS NULL OR c.source = @source)
      AND (@from_date IS NULL OR CAST(c.created_at AS DATE) >= @from_date)
      AND (@to_date   IS NULL OR CAST(c.created_at AS DATE) <= @to_date)
      AND (@search    IS NULL OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%'
                              OR u.email LIKE '%' + @search + '%'
                              OR u.phone LIKE '%' + @search + '%'
                              OR c.customer_code LIKE '%' + @search + '%')
    ORDER BY c.total_spend DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 6: Get Customer Full Profile
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetCustomerProfile
    @customer_id INT,
    @company_id  INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Profile
    SELECT
        c.customer_id, c.customer_code, c.preferred_language, c.anniversary_date,
        c.spouse_name, c.preferred_event, c.notes, c.loyalty_points,
        c.total_bookings, c.total_spend, c.referral_code, c.source, c.created_at,
        u.user_id, u.first_name, u.last_name, u.email, u.phone,
        u.alternate_phone, u.avatar_url, u.date_of_birth, u.gender,
        u.is_email_verified, u.is_phone_verified, u.is_active, u.last_login_at
    FROM customers c
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE c.customer_id = @customer_id AND c.company_id = @company_id;

    -- Booking history (last 10)
    SELECT TOP 10
        b.booking_id, b.booking_ref, b.booking_date, b.booking_status,
        b.grand_total, b.advance_paid, b.balance_due,
        et.type_name AS event_type, b.event_name,
        h.hall_name, bq.banquet_name
    FROM bookings b
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    INNER JOIN halls h ON h.hall_id = b.hall_id
    INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
    WHERE b.customer_id = @customer_id AND b.company_id = @company_id
    ORDER BY b.booking_date DESC;

    -- Documents
    SELECT doc_id, doc_type, doc_number, file_url, uploaded_at
    FROM customer_documents
    WHERE customer_id = @customer_id;

    -- Wishlist
    SELECT w.banquet_id, bq.banquet_name, bq.cover_image_url, bq.average_rating, w.added_at
    FROM wishlist w
    INNER JOIN banquets bq ON bq.banquet_id = w.banquet_id
    WHERE w.customer_id = @customer_id;
END;
GO

-- =============================================================================
-- SP 7: Submit Review
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_SubmitReview
    @banquet_id     INT,
    @customer_id    INT,
    @booking_id     BIGINT,
    @rating         TINYINT,
    @title          NVARCHAR(200) = NULL,
    @review_text    NVARCHAR(MAX) = NULL,
    @venue_rating   TINYINT = NULL,
    @service_rating TINYINT = NULL,
    @catering_rating TINYINT = NULL,
    @value_rating   TINYINT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Check booking is completed and belongs to this customer
    IF NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE booking_id = @booking_id AND customer_id = @customer_id
          AND booking_status = 'completed'
    )
    BEGIN
        SELECT 0 AS success, 'Review can only be submitted for completed bookings' AS message;
        RETURN;
    END;

    -- Check duplicate review
    IF EXISTS (SELECT 1 FROM reviews WHERE booking_id = @booking_id AND customer_id = @customer_id)
    BEGIN
        SELECT 0 AS success, 'Review already submitted for this booking' AS message;
        RETURN;
    END;

    INSERT INTO reviews (
        banquet_id, customer_id, booking_id, rating, title, review_text,
        venue_rating, service_rating, catering_rating, value_rating,
        is_approved, created_at
    )
    VALUES (
        @banquet_id, @customer_id, @booking_id, @rating, @title, @review_text,
        @venue_rating, @service_rating, @catering_rating, @value_rating,
        0, GETUTCDATE()
    );

    SELECT 1 AS success, 'Review submitted successfully. It will appear after moderation.' AS message,
           SCOPE_IDENTITY() AS review_id;
END;
GO

-- =============================================================================
-- SP 8: Toggle Wishlist
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ToggleWishlist
    @customer_id INT,
    @banquet_id  INT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM wishlist WHERE customer_id = @customer_id AND banquet_id = @banquet_id)
    BEGIN
        DELETE FROM wishlist WHERE customer_id = @customer_id AND banquet_id = @banquet_id;
        SELECT 0 AS is_wishlisted, 'Removed from wishlist' AS message;
    END
    ELSE
    BEGIN
        INSERT INTO wishlist (customer_id, banquet_id, added_at) VALUES (@customer_id, @banquet_id, GETUTCDATE());
        SELECT 1 AS is_wishlisted, 'Added to wishlist' AS message;
    END;
END;
GO

-- ═══════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════

-- =============================================================================
-- SP 9: Create Notification
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CreateNotification
    @company_id         INT,
    @user_id            INT = NULL,
    @notification_type  NVARCHAR(50),
    @channel            NVARCHAR(20),
    @title              NVARCHAR(200),
    @body               NVARCHAR(MAX),
    @reference_type     NVARCHAR(50) = NULL,
    @reference_id       BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO notifications (
        company_id, user_id, notification_type, channel,
        title, body, reference_type, reference_id,
        delivery_status, created_at
    )
    VALUES (
        @company_id, @user_id, @notification_type, @channel,
        @title, @body, @reference_type, @reference_id,
        'pending', GETUTCDATE()
    );

    SELECT SCOPE_IDENTITY() AS notification_id;
END;
GO

-- =============================================================================
-- SP 10: Get Unread Notifications
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetUnreadNotifications
    @user_id    INT,
    @company_id INT,
    @limit      INT = 20
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        notification_id, notification_type, channel,
        title, body, reference_type, reference_id,
        is_read, created_at, delivery_status
    FROM notifications
    WHERE (user_id = @user_id OR (user_id IS NULL AND company_id = @company_id))
      AND is_read = 0
    ORDER BY created_at DESC
    OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY;

    SELECT COUNT(*) AS unread_count
    FROM notifications
    WHERE (user_id = @user_id OR (user_id IS NULL AND company_id = @company_id))
      AND is_read = 0;
END;
GO

-- =============================================================================
-- SP 11: Mark Notifications Read
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_MarkNotificationsRead
    @user_id    INT,
    @notification_ids NVARCHAR(MAX) = NULL  -- comma-separated IDs, NULL = mark all
AS
BEGIN
    SET NOCOUNT ON;

    IF @notification_ids IS NULL
    BEGIN
        UPDATE notifications SET is_read = 1, read_at = GETUTCDATE()
        WHERE user_id = @user_id AND is_read = 0;
    END
    ELSE
    BEGIN
        UPDATE notifications SET is_read = 1, read_at = GETUTCDATE()
        WHERE user_id = @user_id
          AND CAST(notification_id AS NVARCHAR) IN (
              SELECT value FROM STRING_SPLIT(@notification_ids, ',')
          );
    END;

    SELECT @@ROWCOUNT AS updated_count;
END;
GO

-- =============================================================================
-- SP 12: Update Notification Delivery Status (called by notification job)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_UpdateNotificationStatus
    @notification_id BIGINT,
    @status          NVARCHAR(20),  -- 'sent','delivered','failed'
    @sent_at         DATETIME2 = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE notifications
    SET delivery_status = @status,
        sent_at = ISNULL(@sent_at, CASE WHEN @status = 'sent' THEN GETUTCDATE() ELSE sent_at END)
    WHERE notification_id = @notification_id;
END;
GO

-- ═══════════════════════════════════════════════════════════════════
-- SETTINGS
-- ═══════════════════════════════════════════════════════════════════

-- =============================================================================
-- SP 13: Get Company Settings (by group or all)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetCompanySettings
    @company_id     INT,
    @setting_group  NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT setting_key, setting_value, setting_group, updated_at
    FROM company_settings
    WHERE company_id = @company_id
      AND (@setting_group IS NULL OR setting_group = @setting_group)
    ORDER BY setting_group, setting_key;
END;
GO

-- =============================================================================
-- SP 14: Upsert Company Setting
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_UpsertCompanySetting
    @company_id     INT,
    @setting_key    NVARCHAR(100),
    @setting_value  NVARCHAR(MAX),
    @setting_group  NVARCHAR(50) = 'general',
    @updated_by     INT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM company_settings WHERE company_id = @company_id AND setting_key = @setting_key)
    BEGIN
        UPDATE company_settings
        SET setting_value = @setting_value, updated_at = GETUTCDATE(), updated_by = @updated_by
        WHERE company_id = @company_id AND setting_key = @setting_key;
    END
    ELSE
    BEGIN
        INSERT INTO company_settings (company_id, setting_key, setting_value, setting_group, updated_at, updated_by)
        VALUES (@company_id, @setting_key, @setting_value, @setting_group, GETUTCDATE(), @updated_by);
    END;

    INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id,
        new_values, created_at)
    VALUES (@company_id, @updated_by, 'settings.update', 'setting', @setting_key,
        '{"value":"' + ISNULL(@setting_value, '') + '"}', GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 15: Bulk Upsert Company Settings
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_BulkUpsertSettings
    @company_id INT,
    @settings   NVARCHAR(MAX),  -- JSON: [{"key":"x","value":"y","group":"g"}, ...]
    @updated_by INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Parse JSON settings array and upsert each
    DECLARE @key   NVARCHAR(100);
    DECLARE @value NVARCHAR(MAX);
    DECLARE @group NVARCHAR(50);

    SELECT
        @key   = JSON_VALUE(s.value, '$.key'),
        @value = JSON_VALUE(s.value, '$.value'),
        @group = ISNULL(JSON_VALUE(s.value, '$.group'), 'general')
    FROM OPENJSON(@settings) s;

    MERGE company_settings AS target
    USING (
        SELECT
            JSON_VALUE(s.value, '$.key')                   AS setting_key,
            JSON_VALUE(s.value, '$.value')                 AS setting_value,
            ISNULL(JSON_VALUE(s.value, '$.group'), 'general') AS setting_group
        FROM OPENJSON(@settings) s
    ) AS source ON target.company_id = @company_id AND target.setting_key = source.setting_key
    WHEN MATCHED THEN
        UPDATE SET setting_value = source.setting_value, updated_at = GETUTCDATE(), updated_by = @updated_by
    WHEN NOT MATCHED THEN
        INSERT (company_id, setting_key, setting_value, setting_group, updated_at, updated_by)
        VALUES (@company_id, source.setting_key, source.setting_value, source.setting_group, GETUTCDATE(), @updated_by);

    INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
    VALUES (@company_id, @updated_by, 'settings.bulk_update', 'settings', 'bulk', GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 16: Get Audit Logs (paginated with filters)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetAuditLogs
    @company_id     INT,
    @user_id        INT  = NULL,
    @entity_type    NVARCHAR(50) = NULL,
    @action         NVARCHAR(100) = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL,
    @page           INT = 1,
    @limit          INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @offset INT = (@page - 1) * @limit;

    SELECT COUNT(*) AS total_count
    FROM audit_logs
    WHERE (company_id = @company_id OR @company_id IS NULL)
      AND (@user_id      IS NULL OR user_id      = @user_id)
      AND (@entity_type  IS NULL OR entity_type  = @entity_type)
      AND (@action       IS NULL OR action       LIKE '%' + @action + '%')
      AND (@from_date    IS NULL OR CAST(created_at AS DATE) >= @from_date)
      AND (@to_date      IS NULL OR CAST(created_at AS DATE) <= @to_date);

    SELECT
        log_id, user_id, user_email, user_role, action, entity_type, entity_id,
        old_values, new_values, ip_address, browser, device, created_at
    FROM audit_logs
    WHERE (company_id = @company_id OR @company_id IS NULL)
      AND (@user_id      IS NULL OR user_id      = @user_id)
      AND (@entity_type  IS NULL OR entity_type  = @entity_type)
      AND (@action       IS NULL OR action       LIKE '%' + @action + '%')
      AND (@from_date    IS NULL OR CAST(created_at AS DATE) >= @from_date)
      AND (@to_date      IS NULL OR CAST(created_at AS DATE) <= @to_date)
    ORDER BY created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

PRINT 'Banquet, Customer, Notification, Settings stored procedures created.';
GO
