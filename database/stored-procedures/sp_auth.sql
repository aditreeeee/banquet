-- =============================================================================
-- STORED PROCEDURES: AUTHENTICATION & USER MANAGEMENT
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SP 1: Login — validate credentials, return user profile + permissions
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_Login
    @email          NVARCHAR(150),
    @ip_address     NVARCHAR(45)  = NULL,
    @user_agent     NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @user_id            INT;
    DECLARE @password_hash      NVARCHAR(255);
    DECLARE @is_active          BIT;
    DECLARE @is_email_verified  BIT;
    DECLARE @locked_until       DATETIME2;
    DECLARE @failed_count       TINYINT;
    DECLARE @role_slug          NVARCHAR(50);
    DECLARE @company_id         INT;
    DECLARE @branch_id          INT;

    -- Lookup user (case-insensitive email)
    SELECT
        @user_id            = u.user_id,
        @password_hash      = u.password_hash,
        @is_active          = u.is_active,
        @is_email_verified  = u.is_email_verified,
        @locked_until       = u.locked_until,
        @failed_count       = u.failed_login_count,
        @role_slug          = r.role_slug,
        @company_id         = u.company_id,
        @branch_id          = u.branch_id
    FROM users u
    INNER JOIN roles r ON r.role_id = u.role_id
    WHERE LOWER(u.email) = LOWER(@email);

    -- User not found
    IF @user_id IS NULL
    BEGIN
        SELECT 0 AS success, 'INVALID_CREDENTIALS' AS error_code, NULL AS user_id,
               NULL AS password_hash, NULL AS role_slug, NULL AS company_id, NULL AS branch_id;
        RETURN;
    END

    -- Account locked
    IF @locked_until IS NOT NULL AND @locked_until > GETUTCDATE()
    BEGIN
        SELECT 0 AS success, 'ACCOUNT_LOCKED' AS error_code,
               DATEDIFF(MINUTE, GETUTCDATE(), @locked_until) AS locked_minutes,
               NULL AS user_id, NULL AS password_hash, NULL AS role_slug, NULL AS company_id, NULL AS branch_id;
        RETURN;
    END

    -- Account inactive
    IF @is_active = 0
    BEGIN
        SELECT 0 AS success, 'ACCOUNT_DISABLED' AS error_code, NULL AS user_id,
               NULL AS password_hash, NULL AS role_slug, NULL AS company_id, NULL AS branch_id;
        RETURN;
    END

    -- Email not verified (allow super_admin to bypass)
    IF @is_email_verified = 0 AND @role_slug <> 'super_admin'
    BEGIN
        SELECT 0 AS success, 'EMAIL_NOT_VERIFIED' AS error_code, @user_id AS user_id,
               NULL AS password_hash, @role_slug AS role_slug, @company_id AS company_id, @branch_id AS branch_id;
        RETURN;
    END

    -- Return password hash + user info for bcrypt comparison in app layer
    SELECT
        1               AS success,
        'OK'            AS error_code,
        @user_id        AS user_id,
        @password_hash  AS password_hash,
        @role_slug      AS role_slug,
        @company_id     AS company_id,
        @branch_id      AS branch_id,
        @failed_count   AS failed_count;
END;
GO

-- =============================================================================
-- SP 2: Record Successful Login — update last login stats
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_RecordSuccessfulLogin
    @user_id        INT,
    @ip_address     NVARCHAR(45)  = NULL,
    @user_agent     NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET
        last_login_at       = GETUTCDATE(),
        last_login_ip       = @ip_address,
        failed_login_count  = 0,
        locked_until        = NULL,
        updated_at          = GETUTCDATE()
    WHERE user_id = @user_id;

    -- Log to audit
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
    VALUES (@user_id, 'auth.login', 'user', CAST(@user_id AS NVARCHAR), @ip_address, @user_agent, GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 3: Record Failed Login — increment counter, lock if threshold exceeded
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_RecordFailedLogin
    @email      NVARCHAR(150),
    @ip_address NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @user_id    INT;
    DECLARE @new_count  TINYINT;
    DECLARE @max_attempts TINYINT = 5;

    SELECT @user_id = user_id FROM users WHERE LOWER(email) = LOWER(@email);
    IF @user_id IS NULL RETURN;

    UPDATE users
    SET failed_login_count = failed_login_count + 1,
        updated_at = GETUTCDATE()
    WHERE user_id = @user_id;

    SELECT @new_count = failed_login_count FROM users WHERE user_id = @user_id;

    -- Lock account for 30 mins after 5 failures
    IF @new_count >= @max_attempts
    BEGIN
        UPDATE users
        SET locked_until = DATEADD(MINUTE, 30, GETUTCDATE()),
            updated_at   = GETUTCDATE()
        WHERE user_id = @user_id;
    END;

    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
    VALUES (@user_id, 'auth.login_failed', 'user', CAST(@user_id AS NVARCHAR), @ip_address, GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 4: Store Refresh Token
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_StoreRefreshToken
    @user_id        INT,
    @token_hash     NVARCHAR(255),
    @device_info    NVARCHAR(500) = NULL,
    @ip_address     NVARCHAR(45)  = NULL,
    @user_agent     NVARCHAR(500) = NULL,
    @expires_days   INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    -- Revoke old tokens for this device (prevent token accumulation)
    UPDATE refresh_tokens
    SET is_revoked = 1, revoked_at = GETUTCDATE()
    WHERE user_id = @user_id
      AND device_info = @device_info
      AND is_revoked = 0;

    -- Store new token
    INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, user_agent, expires_at, created_at)
    VALUES (@user_id, @token_hash, @device_info, @ip_address, @user_agent,
            DATEADD(DAY, @expires_days, GETUTCDATE()), GETUTCDATE());

    SELECT SCOPE_IDENTITY() AS token_id;
END;
GO

-- =============================================================================
-- SP 5: Validate Refresh Token
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ValidateRefreshToken
    @token_hash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        rt.token_id,
        rt.user_id,
        rt.expires_at,
        rt.is_revoked,
        u.is_active,
        u.role_id,
        r.role_slug,
        u.company_id,
        u.branch_id,
        u.email,
        u.first_name,
        u.last_name
    FROM refresh_tokens rt
    INNER JOIN users u ON u.user_id = rt.user_id
    INNER JOIN roles r ON r.role_id = u.role_id
    WHERE rt.token_hash = @token_hash
      AND rt.is_revoked = 0
      AND rt.expires_at > GETUTCDATE()
      AND u.is_active = 1;
END;
GO

-- =============================================================================
-- SP 6: Revoke Refresh Token (Logout)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_RevokeRefreshToken
    @token_hash NVARCHAR(255),
    @user_id    INT = NULL  -- if NULL, revoke by hash only
AS
BEGIN
    SET NOCOUNT ON;

    IF @user_id IS NOT NULL
    BEGIN
        -- Logout all devices
        UPDATE refresh_tokens
        SET is_revoked = 1, revoked_at = GETUTCDATE()
        WHERE user_id = @user_id AND is_revoked = 0;
    END
    ELSE
    BEGIN
        -- Logout single device
        UPDATE refresh_tokens
        SET is_revoked = 1, revoked_at = GETUTCDATE()
        WHERE token_hash = @token_hash;
    END;

    SELECT @@ROWCOUNT AS revoked_count;
END;
GO

-- =============================================================================
-- SP 7: Generate OTP (stores hashed OTP, returns plain OTP for sending)
-- Note: App layer must hash the OTP before storing, and send plain to user
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GenerateOTP
    @user_id    INT         = NULL,
    @email      NVARCHAR(150) = NULL,
    @phone      NVARCHAR(20)  = NULL,
    @purpose    NVARCHAR(50),   -- 'email_verify','phone_verify','password_reset','login_2fa'
    @otp_hash   NVARCHAR(255),  -- bcrypt hash of the OTP, computed in app layer
    @expiry_mins INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    -- Invalidate any existing active OTPs for same purpose+target
    UPDATE otp_verifications
    SET is_used = 1, used_at = GETUTCDATE()
    WHERE (user_id = @user_id OR email = @email OR phone = @phone)
      AND purpose = @purpose
      AND is_used = 0
      AND expires_at > GETUTCDATE();

    -- Insert new OTP record
    INSERT INTO otp_verifications (user_id, email, phone, otp_hash, purpose, expires_at, created_at)
    VALUES (@user_id, @email, @phone, @otp_hash, @purpose,
            DATEADD(MINUTE, @expiry_mins, GETUTCDATE()), GETUTCDATE());

    SELECT SCOPE_IDENTITY() AS otp_id;
END;
GO

-- =============================================================================
-- SP 8: Verify OTP
-- Returns the OTP record for bcrypt comparison in app layer
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_VerifyOTP
    @user_id    INT         = NULL,
    @email      NVARCHAR(150) = NULL,
    @phone      NVARCHAR(20)  = NULL,
    @purpose    NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT otp_id, otp_hash, expires_at, is_used, attempts
    FROM otp_verifications
    WHERE (user_id = @user_id OR email = @email OR phone = @phone)
      AND purpose  = @purpose
      AND is_used  = 0
      AND expires_at > GETUTCDATE()
    ORDER BY created_at DESC
    OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 9: Mark OTP as Used
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_MarkOTPUsed
    @otp_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE otp_verifications
    SET is_used = 1, used_at = GETUTCDATE()
    WHERE otp_id = @otp_id;
END;
GO

-- =============================================================================
-- SP 10: Increment OTP Attempt
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_IncrementOTPAttempt
    @otp_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE otp_verifications SET attempts = attempts + 1 WHERE otp_id = @otp_id;
    SELECT attempts FROM otp_verifications WHERE otp_id = @otp_id;
END;
GO

-- =============================================================================
-- SP 11: Reset Password
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ResetPassword
    @user_id        INT,
    @new_hash       NVARCHAR(255),
    @ip_address     NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET password_hash       = @new_hash,
        password_reset_at   = GETUTCDATE(),
        failed_login_count  = 0,
        locked_until        = NULL,
        updated_at          = GETUTCDATE()
    WHERE user_id = @user_id;

    -- Revoke all refresh tokens (force re-login everywhere)
    UPDATE refresh_tokens
    SET is_revoked = 1, revoked_at = GETUTCDATE()
    WHERE user_id = @user_id AND is_revoked = 0;

    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, created_at)
    VALUES (@user_id, 'auth.password_reset', 'user', CAST(@user_id AS NVARCHAR), @ip_address, GETUTCDATE());

    SELECT 1 AS success;
END;
GO

-- =============================================================================
-- SP 12: Get Full User Profile
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetUserProfile
    @user_id    INT,
    @company_id INT = NULL  -- for tenant scoping
AS
BEGIN
    SET NOCOUNT ON;

    -- User details
    SELECT
        u.user_id,
        u.company_id,
        u.branch_id,
        u.role_id,
        r.role_name,
        r.role_slug,
        u.first_name,
        u.last_name,
        u.first_name + ' ' + u.last_name AS full_name,
        u.email,
        u.phone,
        u.alternate_phone,
        u.avatar_url,
        u.date_of_birth,
        u.gender,
        u.is_email_verified,
        u.is_phone_verified,
        u.is_two_factor,
        u.is_active,
        u.last_login_at,
        u.created_at,
        c.company_name,
        c.company_slug,
        b.branch_name,
        b.branch_code
    FROM users u
    INNER JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN companies c ON c.company_id = u.company_id
    LEFT JOIN branches b ON b.branch_id = u.branch_id
    WHERE u.user_id = @user_id
      AND (@company_id IS NULL OR u.company_id = @company_id OR r.role_slug = 'super_admin');

    -- Permissions
    SELECT p.permission_key, p.module, p.action
    FROM role_permissions rp
    INNER JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE rp.role_id = (SELECT role_id FROM users WHERE user_id = @user_id);
END;
GO

-- =============================================================================
-- SP 13: Create User
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CreateUser
    @company_id     INT = NULL,
    @branch_id      INT = NULL,
    @role_id        INT,
    @first_name     NVARCHAR(100),
    @last_name      NVARCHAR(100),
    @email          NVARCHAR(150),
    @phone          NVARCHAR(20) = NULL,
    @password_hash  NVARCHAR(255),
    @created_by     INT,
    @user_id        INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Check email uniqueness
        IF EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER(@email))
        BEGIN
            ROLLBACK;
            SELECT 0 AS success, 'EMAIL_EXISTS' AS error_code;
            RETURN;
        END

        INSERT INTO users (company_id, branch_id, role_id, first_name, last_name, email, phone, password_hash, created_by, created_at, updated_at)
        VALUES (@company_id, @branch_id, @role_id, @first_name, @last_name, @email, @phone, @password_hash, @created_by, GETUTCDATE(), GETUTCDATE());

        SET @user_id = SCOPE_IDENTITY();

        -- Auto-create customer record if role is 'customer'
        IF EXISTS (SELECT 1 FROM roles WHERE role_id = @role_id AND role_slug = 'customer')
        BEGIN
            DECLARE @customer_code NVARCHAR(20) = 'CUST' + RIGHT('000000' + CAST(@user_id AS NVARCHAR(6)), 6);
            INSERT INTO customers (user_id, company_id, customer_code, created_at)
            VALUES (@user_id, @company_id, @customer_code, GETUTCDATE());
        END;

        -- Auto-create employee record if role is staff
        IF EXISTS (SELECT 1 FROM roles WHERE role_id = @role_id AND role_slug IN ('company_admin','branch_manager','booking_executive'))
        BEGIN
            DECLARE @emp_code NVARCHAR(20) = 'EMP' + RIGHT('000000' + CAST(@user_id AS NVARCHAR(6)), 6);
            INSERT INTO employees (user_id, company_id, branch_id, employee_code, created_at)
            VALUES (@user_id, @company_id, @branch_id, @emp_code, GETUTCDATE());
        END;

        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
        VALUES (@company_id, @created_by, 'users.create', 'user', CAST(@user_id AS NVARCHAR), GETUTCDATE());

        COMMIT TRANSACTION;
        SELECT 1 AS success, 'OK' AS error_code;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 14: Update User Profile
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_UpdateUserProfile
    @user_id        INT,
    @first_name     NVARCHAR(100) = NULL,
    @last_name      NVARCHAR(100) = NULL,
    @phone          NVARCHAR(20)  = NULL,
    @alternate_phone NVARCHAR(20) = NULL,
    @date_of_birth  DATE          = NULL,
    @gender         NVARCHAR(10)  = NULL,
    @avatar_url     NVARCHAR(500) = NULL,
    @updated_by     INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET
        first_name      = ISNULL(@first_name,      first_name),
        last_name       = ISNULL(@last_name,       last_name),
        phone           = ISNULL(@phone,           phone),
        alternate_phone = ISNULL(@alternate_phone, alternate_phone),
        date_of_birth   = ISNULL(@date_of_birth,   date_of_birth),
        gender          = ISNULL(@gender,          gender),
        avatar_url      = ISNULL(@avatar_url,      avatar_url),
        updated_at      = GETUTCDATE()
    WHERE user_id = @user_id;

    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, created_at)
    VALUES (@updated_by, 'users.update', 'user', CAST(@user_id AS NVARCHAR), GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 15: List Users (paginated, filtered)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ListUsers
    @company_id     INT = NULL,
    @branch_id      INT = NULL,
    @role_id        INT = NULL,
    @is_active      BIT = NULL,
    @search         NVARCHAR(200) = NULL,
    @page           INT = 1,
    @limit          INT = 20
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @offset INT = (@page - 1) * @limit;

    -- Total count
    SELECT COUNT(*) AS total_count
    FROM users u
    INNER JOIN roles r ON r.role_id = u.role_id
    WHERE (@company_id IS NULL OR u.company_id = @company_id)
      AND (@branch_id  IS NULL OR u.branch_id  = @branch_id)
      AND (@role_id    IS NULL OR u.role_id    = @role_id)
      AND (@is_active  IS NULL OR u.is_active  = @is_active)
      AND (@search     IS NULL OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%'
                               OR u.email LIKE '%' + @search + '%'
                               OR u.phone LIKE '%' + @search + '%');

    -- Paged results
    SELECT
        u.user_id, u.first_name, u.last_name, u.email, u.phone,
        u.is_active, u.is_email_verified, u.last_login_at, u.created_at,
        r.role_name, r.role_slug, b.branch_name
    FROM users u
    INNER JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN branches b ON b.branch_id = u.branch_id
    WHERE (@company_id IS NULL OR u.company_id = @company_id)
      AND (@branch_id  IS NULL OR u.branch_id  = @branch_id)
      AND (@role_id    IS NULL OR u.role_id    = @role_id)
      AND (@is_active  IS NULL OR u.is_active  = @is_active)
      AND (@search     IS NULL OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%'
                               OR u.email LIKE '%' + @search + '%'
                               OR u.phone LIKE '%' + @search + '%')
    ORDER BY u.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 16: Toggle User Active Status
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ToggleUserStatus
    @user_id        INT,
    @is_active      BIT,
    @updated_by     INT,
    @company_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE users
    SET is_active = @is_active, updated_at = GETUTCDATE()
    WHERE user_id = @user_id
      AND (@company_id IS NULL OR company_id = @company_id);

    -- If deactivating, revoke all refresh tokens
    IF @is_active = 0
    BEGIN
        UPDATE refresh_tokens
        SET is_revoked = 1, revoked_at = GETUTCDATE()
        WHERE user_id = @user_id AND is_revoked = 0;
    END;

    INSERT INTO audit_logs (user_id, action, entity_type, entity_id,
        new_values, created_at)
    VALUES (@updated_by,
            CASE WHEN @is_active = 1 THEN 'users.activate' ELSE 'users.deactivate' END,
            'user', CAST(@user_id AS NVARCHAR),
            '{"is_active":' + CAST(@is_active AS NVARCHAR) + '}',
            GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 17: Verify Email
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_VerifyEmail
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE users
    SET is_email_verified = 1, updated_at = GETUTCDATE()
    WHERE user_id = @user_id;

    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, created_at)
    VALUES (@user_id, 'auth.email_verified', 'user', CAST(@user_id AS NVARCHAR), GETUTCDATE());
END;
GO

-- =============================================================================
-- SP 18: Clean up expired tokens / OTPs (run as scheduled job)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CleanupExpiredTokens
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @deleted_tokens INT, @deleted_otps INT;

    -- Delete expired refresh tokens
    DELETE FROM refresh_tokens
    WHERE expires_at < DATEADD(DAY, -1, GETUTCDATE())
       OR (is_revoked = 1 AND revoked_at < DATEADD(DAY, -7, GETUTCDATE()));

    SET @deleted_tokens = @@ROWCOUNT;

    -- Delete used/expired OTPs
    DELETE FROM otp_verifications
    WHERE expires_at < DATEADD(HOUR, -1, GETUTCDATE())
       OR (is_used = 1 AND used_at < DATEADD(DAY, -1, GETUTCDATE()));

    SET @deleted_otps = @@ROWCOUNT;

    SELECT @deleted_tokens AS deleted_tokens, @deleted_otps AS deleted_otps;
END;
GO

PRINT 'Auth stored procedures created successfully.';
GO
