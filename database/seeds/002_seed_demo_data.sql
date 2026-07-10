-- =============================================================================
-- SEED DATA: Demo Data (500+ records) — DEV/STAGING ONLY, NEVER PRODUCTION.
-- Run AFTER 001_seed_data.sql
-- Generates: 50 customers, 5 halls, 200+ bookings, payments, invoices, reviews
--
-- WARNING: every demo customer/user account inserted below shares one
-- identical bcrypt password hash — running this against a production
-- database would leave ~50 accounts unlockable with a single known
-- password. This file is not invoked by any app script (backend/scripts
-- /setup.js seeds its own demo data independently) — it exists only for
-- restoring a raw-SQL demo dataset by hand via sqlcmd, so the guard below
-- is the only thing standing between an operator and running it by mistake.
--
-- Run with the confirmation flag on a non-production database only:
--   sqlcmd -S <server> -d BanquetDB -v CONFIRM_DEMO_SEED="YES" -i 002_seed_demo_data.sql
-- =============================================================================
:on error exit
:setvar CONFIRM_DEMO_SEED "NO"
IF ('$(CONFIRM_DEMO_SEED)' <> 'YES')
BEGIN
    RAISERROR('Refusing to run 002_seed_demo_data.sql: pass -v CONFIRM_DEMO_SEED="YES" to confirm this is NOT a production database (see file header).', 16, 1);
END
GO

USE BanquetDB;
GO

SET NOCOUNT ON;
BEGIN TRY
    BEGIN TRANSACTION;

-- =============================================================================
-- ADDITIONAL BRANCHES & BANQUETS
-- =============================================================================
INSERT INTO branches (company_id, branch_name, branch_code, email, phone, address_line1, city_id, state_id, pincode, is_main_branch)
VALUES
    (1, 'Bandra Branch',  'BAN-002', 'bandra@grandevents.com',  '+91-9876543220', '12 Linking Road, Bandra West',    1, 1, '400050', 0),
    (1, 'Powai Branch',   'POW-003', 'powai@grandevents.com',   '+91-9876543221', '88 Hiranandani Gardens, Powai',   1, 1, '400076', 0);
GO

INSERT INTO banquets (company_id, branch_id, banquet_name, banquet_slug, description, short_description,
    address_line1, city_id, state_id, pincode, latitude, longitude,
    phone, email, gst_number, total_capacity, parking_capacity, has_valet,
    check_in_time, check_out_time, is_active, is_featured)
VALUES
    (1, 2, 'Royal Heritage Banquet', 'royal-heritage',
     'An exquisite heritage property with old-world charm and modern facilities. Perfect for royal weddings and grand celebrations.',
     'Heritage property with modern facilities',
     '12 Linking Road, Bandra West', 1, 1, '400050', 19.0596, 72.8295,
     '+91-9876543220', 'info@royalheritage.com', '27AAACG5678B1Z3',
     800, 150, 1, '07:00', '23:00', 1, 1),
    (1, 3, 'Emerald Convention Centre', 'emerald-convention',
     'State-of-the-art convention centre with latest AV technology, suitable for corporate events, conferences, and seminars.',
     'Modern convention centre for corporate events',
     '88 Hiranandani Gardens, Powai', 1, 1, '400076', 19.1196, 72.9069,
     '+91-9876543221', 'info@emeraldcc.com', '27AAACG9012C1Z1',
     600, 200, 1, '06:00', '23:59', 1, 0);
GO

-- Additional halls for new banquets
INSERT INTO halls (banquet_id, company_id, hall_name, hall_code, floor_number, hall_type,
    capacity_seated, capacity_standing, area_sqft, has_ac, has_power_backup, has_kitchen, has_stage, has_parking, has_washroom)
VALUES
    -- Royal Heritage Banquet
    (2, 1, 'Maharaja Hall',     'MH-001', 1, 'main_hall',   400, 650,  6500.00, 1, 1, 1, 1, 1, 1),
    (2, 1, 'Heritage Lawn',     'HL-001', 0, 'lawn',        300, 500,  8000.00, 0, 1, 1, 0, 1, 1),
    (2, 1, 'Rani Mahal Suite',  'RM-001', 2, 'conference',   60, 100,  1500.00, 1, 1, 0, 1, 0, 1),
    -- Emerald Convention Centre
    (3, 1, 'Diamond Hall',      'DH-001', 1, 'main_hall',   350, 600,  5500.00, 1, 1, 1, 1, 1, 1),
    (3, 1, 'Boardroom Alpha',   'BA-001', 3, 'conference',   50,  80,  1200.00, 1, 1, 0, 0, 0, 1),
    (3, 1, 'Sapphire Lawn',     'SL-001', 0, 'lawn',        250, 450,  7000.00, 0, 1, 1, 0, 1, 1);
GO

-- hall_pricing was dropped in migration 014 (pricing now lives directly on
-- Halls.base_price, already seeded above) — nothing to insert here anymore.

-- =============================================================================
-- 50 DEMO CUSTOMERS (realistic Indian names)
-- =============================================================================
-- NOTE: Customers is a standalone table (no user_id / FK to Users). We create
-- Users records here only so these customers also have login accounts; the
-- Customers rows below copy the contact fields directly rather than pointing
-- at users.user_id (that column does not exist on dbo.Customers).

-- Create 50 customer users
INSERT INTO users (role_id, company_id, first_name, last_name, email, phone, password_hash, is_email_verified, is_active, created_at)
VALUES
(5, 1, 'Arjun',     'Sharma',       'arjun.sharma@gmail.com',       '+91-9811001001', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-350,GETDATE())),
(5, 1, 'Priya',     'Patel',        'priya.patel@gmail.com',        '+91-9811001002', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-320,GETDATE())),
(5, 1, 'Rahul',     'Gupta',        'rahul.gupta@yahoo.com',        '+91-9811001003', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-300,GETDATE())),
(5, 1, 'Anjali',    'Singh',        'anjali.singh@hotmail.com',     '+91-9811001004', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-280,GETDATE())),
(5, 1, 'Vikram',    'Mehta',        'vikram.mehta@gmail.com',       '+91-9811001005', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-260,GETDATE())),
(5, 1, 'Neha',      'Agarwal',      'neha.agarwal@gmail.com',       '+91-9811001006', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-250,GETDATE())),
(5, 1, 'Sanjay',    'Kumar',        'sanjay.kumar@gmail.com',       '+91-9811001007', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-240,GETDATE())),
(5, 1, 'Kavita',    'Joshi',        'kavita.joshi@rediffmail.com',  '+91-9811001008', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-230,GETDATE())),
(5, 1, 'Aditya',    'Verma',        'aditya.verma@gmail.com',       '+91-9811001009', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-220,GETDATE())),
(5, 1, 'Sunita',    'Rao',          'sunita.rao@gmail.com',         '+91-9811001010', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-210,GETDATE())),
(5, 1, 'Manish',    'Tiwari',       'manish.tiwari@gmail.com',      '+91-9811001011', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-200,GETDATE())),
(5, 1, 'Pooja',     'Nair',         'pooja.nair@gmail.com',         '+91-9811001012', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-195,GETDATE())),
(5, 1, 'Deepak',    'Chaudhary',    'deepak.chaudhary@gmail.com',   '+91-9811001013', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-190,GETDATE())),
(5, 1, 'Aarti',     'Saxena',       'aarti.saxena@gmail.com',       '+91-9811001014', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-185,GETDATE())),
(5, 1, 'Suresh',    'Iyer',         'suresh.iyer@gmail.com',        '+91-9811001015', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-180,GETDATE())),
(5, 1, 'Rekha',     'Mishra',       'rekha.mishra@gmail.com',       '+91-9811001016', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-175,GETDATE())),
(5, 1, 'Nikhil',    'Desai',        'nikhil.desai@gmail.com',       '+91-9811001017', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-170,GETDATE())),
(5, 1, 'Shweta',    'Kapoor',       'shweta.kapoor@gmail.com',      '+91-9811001018', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-165,GETDATE())),
(5, 1, 'Rajesh',    'Pandey',       'rajesh.pandey@yahoo.com',      '+91-9811001019', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-160,GETDATE())),
(5, 1, 'Lakshmi',   'Reddy',        'lakshmi.reddy@gmail.com',      '+91-9811001020', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-155,GETDATE())),
(5, 1, 'Amit',      'Bhatt',        'amit.bhatt@gmail.com',         '+91-9811001021', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-150,GETDATE())),
(5, 1, 'Ritu',      'Malhotra',     'ritu.malhotra@gmail.com',      '+91-9811001022', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-145,GETDATE())),
(5, 1, 'Vivek',     'Srivastava',   'vivek.srivastava@gmail.com',   '+91-9811001023', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-140,GETDATE())),
(5, 1, 'Ananya',    'Krishnan',     'ananya.krishnan@gmail.com',    '+91-9811001024', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-135,GETDATE())),
(5, 1, 'Mohit',     'Chauhan',      'mohit.chauhan@gmail.com',      '+91-9811001025', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-130,GETDATE())),
(5, 1, 'Divya',     'Pillai',       'divya.pillai@gmail.com',       '+91-9811001026', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-125,GETDATE())),
(5, 1, 'Ashish',    'Tripathi',     'ashish.tripathi@gmail.com',    '+91-9811001027', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-120,GETDATE())),
(5, 1, 'Meena',     'Gandhi',       'meena.gandhi@gmail.com',       '+91-9811001028', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-115,GETDATE())),
(5, 1, 'Rohan',     'Kulkarni',     'rohan.kulkarni@gmail.com',     '+91-9811001029', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-110,GETDATE())),
(5, 1, 'Seema',     'Bose',         'seema.bose@gmail.com',         '+91-9811001030', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-105,GETDATE())),
(5, 1, 'Kunal',     'Shah',         'kunal.shah@gmail.com',         '+91-9811001031', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-100,GETDATE())),
(5, 1, 'Padma',     'Venkatesh',    'padma.venkatesh@gmail.com',    '+91-9811001032', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-95,GETDATE())),
(5, 1, 'Naveen',    'Thakur',       'naveen.thakur@gmail.com',      '+91-9811001033', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-90,GETDATE())),
(5, 1, 'Geeta',     'Yadav',        'geeta.yadav@gmail.com',        '+91-9811001034', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-85,GETDATE())),
(5, 1, 'Saurabh',   'Bajaj',        'saurabh.bajaj@gmail.com',      '+91-9811001035', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-80,GETDATE())),
(5, 1, 'Pallavi',   'Ghosh',        'pallavi.ghosh@gmail.com',      '+91-9811001036', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-75,GETDATE())),
(5, 1, 'Tarun',     'Agnihotri',    'tarun.agnihotri@gmail.com',    '+91-9811001037', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-70,GETDATE())),
(5, 1, 'Smita',     'Deshpande',    'smita.deshpande@gmail.com',    '+91-9811001038', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-65,GETDATE())),
(5, 1, 'Harish',    'Goyal',        'harish.goyal@gmail.com',       '+91-9811001039', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-60,GETDATE())),
(5, 1, 'Usha',      'Rajan',        'usha.rajan@gmail.com',         '+91-9811001040', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-55,GETDATE())),
(5, 1, 'Kartik',    'Mathur',       'kartik.mathur@gmail.com',      '+91-9811001041', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-50,GETDATE())),
(5, 1, 'Nandita',   'Sen',          'nandita.sen@gmail.com',        '+91-9811001042', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-45,GETDATE())),
(5, 1, 'Yogesh',    'Dubey',        'yogesh.dubey@gmail.com',       '+91-9811001043', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-40,GETDATE())),
(5, 1, 'Farida',    'Khan',         'farida.khan@gmail.com',        '+91-9811001044', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-35,GETDATE())),
(5, 1, 'Rajan',     'Pillai',       'rajan.pillai@gmail.com',       '+91-9811001045', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-30,GETDATE())),
(5, 1, 'Malti',     'Soni',         'malti.soni@gmail.com',         '+91-9811001046', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-25,GETDATE())),
(5, 1, 'Dhruv',     'Rastogi',      'dhruv.rastogi@gmail.com',      '+91-9811001047', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-20,GETDATE())),
(5, 1, 'Swati',     'Banerjee',     'swati.banerjee@gmail.com',     '+91-9811001048', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-15,GETDATE())),
(5, 1, 'Gaurav',    'Wadhwa',       'gaurav.wadhwa@gmail.com',      '+91-9811001049', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY,-10,GETDATE())),
(5, 1, 'Tara',      'Bhattacharya', 'tara.bhattacharya@gmail.com',  '+91-9811001050', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1, DATEADD(DAY, -5,GETDATE()));
GO

-- Create customer records for the 50 users just created above.
-- dbo.Customers has no user_id column, so contact fields are copied directly
-- from dbo.Users instead of being linked by FK.
INSERT INTO customers (company_id, first_name, last_name, email, phone, customer_code, source, created_at)
SELECT
    1,
    u.first_name,
    u.last_name,
    u.email,
    u.phone,
    'CUST' + RIGHT('000000' + CAST(ROW_NUMBER() OVER (ORDER BY u.user_id) AS NVARCHAR(6)), 6),
    CASE (u.user_id % 4)
        WHEN 0 THEN 'website'
        WHEN 1 THEN 'walkin'
        WHEN 2 THEN 'referral'
        ELSE        'social'
    END,
    u.created_at
FROM users u
WHERE u.company_id = 1 AND u.role_id = 5
ORDER BY u.user_id;
GO

-- =============================================================================
-- 200+ BOOKINGS over last 12 months
-- =============================================================================

-- Helper: get customer IDs
DECLARE @cust_base INT = (SELECT MIN(customer_id) FROM customers WHERE company_id = 1);

-- INSERT BOOKINGS using a numbers trick across 12 months
-- We generate 210 bookings by cycling through halls, customers, event types
-- dbo.Bookings has no banquet_id/pricing_id/event_type_id/expected_guests/
-- subtotal/catering_total/decoration_total/services_total/tax_amount/
-- balance_due/booked_by/step_completed columns; only the columns below exist.

INSERT INTO bookings (
    booking_ref, company_id, branch_id, hall_id,
    customer_id, event_name, event_type,
    status, event_date, event_time_start, event_time_end,
    guest_count, discount_amount, total_amount, advance_paid, amount_paid,
    created_by, updated_by, created_at, updated_at
)
SELECT
    'BNQ-' + CAST(YEAR(DATEADD(DAY, -n.num * 1.7, GETDATE())) AS NVARCHAR(4)) + '-' +
        RIGHT('000000' + CAST(n.num AS NVARCHAR(6)), 6) AS booking_ref,
    1 AS company_id,
    -- Branch/banquet derived from the hall so the FK chain stays consistent:
    -- halls 1-5 => banquet 1 / branch 1, halls 6-8 => banquet 2 / branch 2,
    -- halls 9-11 => banquet 3 / branch 3
    CASE
        WHEN ((n.num - 1) % 11) + 1 <= 5 THEN 1
        WHEN ((n.num - 1) % 11) + 1 <= 8 THEN 2
        ELSE 3
    END AS branch_id,
    -- Cycle through halls 1-11
    ((n.num - 1) % 11) + 1 AS hall_id,
    -- Cycle through customers
    @cust_base + ((n.num - 1) % 50) AS customer_id,
    -- Event names based on type
    CASE ((n.num - 1) % 15) + 1
        WHEN 1  THEN 'Wedding Ceremony — ' + CAST(n.num AS NVARCHAR)
        WHEN 2  THEN 'Reception Dinner'
        WHEN 3  THEN 'Birthday Celebration'
        WHEN 4  THEN 'Annual Gala Night'
        WHEN 5  THEN 'Tech Summit ' + CAST(YEAR(GETDATE()) AS NVARCHAR)
        WHEN 6  THEN 'Leadership Seminar'
        WHEN 7  THEN 'Silver Anniversary'
        WHEN 8  THEN 'Baby Shower'
        WHEN 9  THEN 'Engagement Ceremony'
        WHEN 10 THEN 'Navratri Celebration'
        WHEN 11 THEN 'Farewell Party'
        WHEN 12 THEN 'Classical Dance Show'
        WHEN 13 THEN 'Excellence Awards'
        WHEN 14 THEN 'Product Launch Event'
        ELSE         'Special Occasion'
    END AS event_name,
    -- event_type is a plain string column on Bookings (not a FK) — use the
    -- same type_name values inserted into dbo.EventTypes by 001_seed_data.sql
    CASE ((n.num - 1) % 15) + 1
        WHEN 1  THEN 'Wedding'
        WHEN 2  THEN 'Reception'
        WHEN 3  THEN 'Birthday Party'
        WHEN 4  THEN 'Corporate Event'
        WHEN 5  THEN 'Conference'
        WHEN 6  THEN 'Seminar'
        WHEN 7  THEN 'Anniversary'
        WHEN 8  THEN 'Baby Shower'
        WHEN 9  THEN 'Engagement'
        WHEN 10 THEN 'Religious Event'
        WHEN 11 THEN 'Private Party'
        WHEN 12 THEN 'Cultural Event'
        WHEN 13 THEN 'Award Ceremony'
        WHEN 14 THEN 'Product Launch'
        ELSE         'Custom Event'
    END AS event_type,
    CASE
        WHEN n.num <= 170 THEN
            CASE (n.num % 6)
                WHEN 0 THEN 'completed'
                WHEN 1 THEN 'fully_paid'
                WHEN 2 THEN 'advance_paid'
                WHEN 3 THEN 'confirmed'
                WHEN 4 THEN 'completed'
                ELSE        'cancelled'
            END
        ELSE 'confirmed'
    END AS status,
    CAST(DATEADD(DAY, -CAST(n.num * 1.7 AS INT) + 30, GETDATE()) AS DATE) AS event_date,
    CASE (n.num % 3)
        WHEN 0 THEN '08:00'
        WHEN 1 THEN '12:00'
        ELSE        '18:00'
    END AS event_time_start,
    CASE (n.num % 3)
        WHEN 0 THEN '13:00'
        WHEN 1 THEN '17:00'
        ELSE        '23:00'
    END AS event_time_end,
    -- Guests: 80 to 600
    50 + (n.num % 23) * 23 AS guest_count,
    -- Discount (10% of bookings have discount)
    CASE WHEN n.num % 10 = 0 THEN 5000 ELSE 0 END AS discount_amount,
    -- Total amount (subtotal + catering + decoration + services + 18% GST - discount)
    ROUND(
        (CASE ((n.num - 1) % 11) + 1
            WHEN 1  THEN 150000 + (n.num % 10) * 5000
            WHEN 2  THEN  90000 + (n.num % 10) * 3000
            WHEN 3  THEN 100000 + (n.num % 10) * 4000
            WHEN 4  THEN  35000 + (n.num % 10) * 1500
            WHEN 5  THEN  45000 + (n.num % 10) * 2000
            WHEN 6  THEN 120000 + (n.num % 10) * 4500
            WHEN 7  THEN  80000 + (n.num % 10) * 3500
            WHEN 8  THEN  25000 + (n.num % 10) * 1000
            WHEN 9  THEN  95000 + (n.num % 10) * 4000
            WHEN 10 THEN  20000 + (n.num % 10) *  800
            ELSE         65000 + (n.num % 10) * 2500
        END +
        CASE WHEN n.num % 5 <> 0 THEN (50 + (n.num % 23) * 23) * 500 ELSE 0 END +
        CASE WHEN n.num % 3 = 0 THEN 15000 + (n.num % 5) * 2000 ELSE 5000 END +
        CASE WHEN n.num % 4 = 0 THEN 25000 ELSE 10000 END -
        CASE WHEN n.num % 10 = 0 THEN 5000 ELSE 0 END
        ) * 1.18, 0) AS total_amount,
    -- Advance paid (25% for non-cancelled)
    CASE
        WHEN n.num % 6 = 5 THEN 0  -- cancelled
        ELSE ROUND((
            (CASE ((n.num - 1) % 11) + 1
                WHEN 1 THEN 150000 + (n.num % 10) * 5000
                ELSE       80000
            END) * 1.18
        ) * 0.25, 0)
    END AS advance_paid,
    -- Amount actually collected so far: full total for fully_paid/completed,
    -- the advance-only amount for advance_paid, nothing yet for confirmed/cancelled
    CASE
        WHEN n.num <= 170 AND n.num % 6 IN (0, 1, 4) THEN
            ROUND(
                (CASE ((n.num - 1) % 11) + 1
                    WHEN 1  THEN 150000 + (n.num % 10) * 5000
                    WHEN 2  THEN  90000 + (n.num % 10) * 3000
                    WHEN 3  THEN 100000 + (n.num % 10) * 4000
                    WHEN 4  THEN  35000 + (n.num % 10) * 1500
                    WHEN 5  THEN  45000 + (n.num % 10) * 2000
                    WHEN 6  THEN 120000 + (n.num % 10) * 4500
                    WHEN 7  THEN  80000 + (n.num % 10) * 3500
                    WHEN 8  THEN  25000 + (n.num % 10) * 1000
                    WHEN 9  THEN  95000 + (n.num % 10) * 4000
                    WHEN 10 THEN  20000 + (n.num % 10) *  800
                    ELSE         65000 + (n.num % 10) * 2500
                END +
                CASE WHEN n.num % 5 <> 0 THEN (50 + (n.num % 23) * 23) * 500 ELSE 0 END +
                CASE WHEN n.num % 3 = 0 THEN 15000 + (n.num % 5) * 2000 ELSE 5000 END +
                CASE WHEN n.num % 4 = 0 THEN 25000 ELSE 10000 END -
                CASE WHEN n.num % 10 = 0 THEN 5000 ELSE 0 END
                ) * 1.18, 0)
        WHEN n.num <= 170 AND n.num % 6 = 2 THEN
            ROUND((
                (CASE ((n.num - 1) % 11) + 1
                    WHEN 1 THEN 150000 + (n.num % 10) * 5000
                    ELSE       80000
                END) * 1.18
            ) * 0.25, 0)
        ELSE 0
    END AS amount_paid,
    4 AS created_by,  -- booking executive user_id
    4 AS updated_by,
    DATEADD(DAY, -CAST(n.num * 1.7 AS INT) - 10, GETDATE()) AS created_at,
    DATEADD(DAY, -CAST(n.num * 1.7 AS INT) - 10, GETDATE()) AS updated_at
FROM (
    SELECT TOP 210 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS num
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
) n;
GO

-- =============================================================================
-- PAYMENTS for completed/paid bookings
-- =============================================================================
INSERT INTO payments (
    payment_ref, company_id, booking_id, customer_id,
    payment_type, payment_method, amount, currency,
    status, payment_date, created_by, created_at, updated_at
)
SELECT
    'PAY-' + CAST(YEAR(b.created_at) AS NVARCHAR(4)) + '-'
        + RIGHT('000000' + CAST(b.booking_id AS NVARCHAR(6)), 6),
    b.company_id,
    b.booking_id,
    b.customer_id,
    'advance',
    CASE (b.booking_id % 5)
        WHEN 0 THEN 'upi'
        WHEN 1 THEN 'card'
        WHEN 2 THEN 'cash'
        WHEN 3 THEN 'bank_transfer'
        ELSE        'online'
    END,
    b.advance_paid,
    'INR',
    'completed',
    CAST(DATEADD(DAY, -1, b.event_date) AS DATE),
    4,  -- created by booking executive
    b.created_at,
    b.created_at
FROM bookings b
WHERE b.status NOT IN ('draft', 'cancelled')
  AND b.advance_paid > 0
  AND b.company_id = 1;
GO

-- Full payment for fully paid / completed bookings
INSERT INTO payments (
    payment_ref, company_id, booking_id, customer_id,
    payment_type, payment_method, amount, currency,
    status, payment_date, created_by, created_at, updated_at
)
SELECT
    'PAY-' + CAST(YEAR(b.event_date) AS NVARCHAR(4)) + '-F'
        + RIGHT('000000' + CAST(b.booking_id AS NVARCHAR(6)), 6),
    b.company_id,
    b.booking_id,
    b.customer_id,
    'full',
    CASE (b.booking_id % 4)
        WHEN 0 THEN 'cash'
        WHEN 1 THEN 'upi'
        WHEN 2 THEN 'card'
        ELSE        'bank_transfer'
    END,
    b.total_amount - b.advance_paid,
    'INR',
    'completed',
    CAST(b.event_date AS DATE),
    4,
    DATEADD(DAY, -5, b.event_date),
    DATEADD(DAY, -5, b.event_date)
FROM bookings b
WHERE b.status IN ('fully_paid', 'completed')
  AND b.company_id = 1;
GO

-- =============================================================================
-- REVIEWS for completed bookings
-- =============================================================================
INSERT INTO reviews (
    banquet_id, customer_id, booking_id, rating,
    title, review_text, venue_rating, service_rating, catering_rating, value_rating,
    is_approved, created_at
)
SELECT
    h.banquet_id,
    b.customer_id,
    b.booking_id,
    CASE (b.booking_id % 5)
        WHEN 0 THEN 5
        WHEN 1 THEN 5
        WHEN 2 THEN 4
        WHEN 3 THEN 4
        ELSE        3
    END,
    CASE (b.booking_id % 5)
        WHEN 0 THEN 'Absolutely Spectacular Experience!'
        WHEN 1 THEN 'Perfect Venue for Our Wedding'
        WHEN 2 THEN 'Great Ambiance and Professional Staff'
        WHEN 3 THEN 'Beautiful Hall, Excellent Catering'
        ELSE        'Good Venue, Minor Issues'
    END,
    CASE (b.booking_id % 5)
        WHEN 0 THEN 'We had our wedding here and it was nothing short of magical. The staff was incredibly professional, the decoration was stunning, and the catering was delicious. Highly recommend!'
        WHEN 1 THEN 'The venue exceeded all our expectations. From the moment we booked to the last moment of the event, every detail was taken care of perfectly.'
        WHEN 2 THEN 'Beautiful halls with great lighting. The team was very cooperative and the food quality was excellent. Will definitely book again.'
        WHEN 3 THEN 'Very spacious and well-maintained venue. AC worked perfectly, parking was ample, and the catering team served excellent quality food.'
        ELSE        'Overall good experience but there were some minor coordination issues during setup. The venue itself is beautiful though.'
    END,
    CASE (b.booking_id % 5) WHEN 0 THEN 5 WHEN 1 THEN 5 WHEN 2 THEN 4 WHEN 3 THEN 4 ELSE 3 END,  -- venue
    CASE (b.booking_id % 5) WHEN 0 THEN 5 WHEN 1 THEN 5 WHEN 2 THEN 4 WHEN 3 THEN 3 ELSE 3 END,  -- service
    CASE (b.booking_id % 5) WHEN 0 THEN 5 WHEN 1 THEN 4 WHEN 2 THEN 4 WHEN 3 THEN 5 ELSE 4 END,  -- catering
    CASE (b.booking_id % 5) WHEN 0 THEN 4 WHEN 1 THEN 5 WHEN 2 THEN 4 WHEN 3 THEN 4 ELSE 3 END,  -- value
    1,  -- auto-approve demo reviews
    DATEADD(DAY, 2, b.event_date)
FROM bookings b
INNER JOIN halls h ON h.hall_id = b.hall_id
WHERE b.status = 'completed'
  AND b.company_id = 1;
GO

-- =============================================================================
-- CATERING for bookings
-- =============================================================================
-- NOTE: The schema (001_create_schema.sql) has no per-booking catering
-- junction table (no dbo.BookingCatering / dbo.booking_catering). Only
-- dbo.CateringPackages (company-level catering package definitions) exists,
-- with no table linking a booking to plate counts/pricing. This block has
-- been removed rather than pointed at a non-existent table.

-- =============================================================================
-- NOTIFICATIONS (booking confirmations)
-- =============================================================================
-- NOTE: dbo.Notifications.user_id is a nullable FK to dbo.Users, and
-- dbo.Customers has no link to dbo.Users, so we cannot join through a
-- customer to a Users row here. Customer name/event type are read directly
-- from dbo.Customers / dbo.Bookings.event_type (a plain string column, not a
-- FK to dbo.EventTypes) and the notification is not tied to a specific user.
INSERT INTO notifications (
    company_id, user_id, notification_type, channel,
    title, body, reference_type, reference_id,
    is_read, delivery_status, sent_at, created_at
)
SELECT TOP 100
    b.company_id,
    NULL,
    'booking_confirmation',
    'email',
    'Booking Confirmed — ' + b.booking_ref,
    'Dear ' + cu.first_name + ', your booking ' + b.booking_ref + ' for ' + b.event_type +
    ' on ' + FORMAT(b.event_date, 'dd MMM yyyy') + ' has been confirmed. Total: Rs.' +
    FORMAT(b.total_amount, 'N0') + '. Advance paid: Rs.' + FORMAT(b.advance_paid, 'N0') + '.',
    'booking',
    b.booking_id,
    CASE WHEN b.booking_id % 3 = 0 THEN 1 ELSE 0 END,
    'delivered',
    DATEADD(MINUTE, 5, b.created_at),
    b.created_at
FROM bookings b
INNER JOIN customers cu ON cu.customer_id = b.customer_id
WHERE b.status <> 'draft'
  AND b.company_id = 1
ORDER BY b.booking_id;
GO

-- =============================================================================
-- AUDIT LOG ENTRIES (sample)
-- =============================================================================
INSERT INTO audit_logs (company_id, user_id, user_email, user_role, action, entity_type, entity_id, ip_address, browser, created_at)
SELECT TOP 200
    b.company_id,
    4,
    'executive@grandevents.com',
    'booking_executive',
    'booking.create',
    'booking',
    CAST(b.booking_id AS NVARCHAR),
    '192.168.' + CAST((b.booking_id % 255) AS NVARCHAR) + '.1',
    CASE (b.booking_id % 3) WHEN 0 THEN 'Chrome/124' WHEN 1 THEN 'Firefox/126' ELSE 'Edge/124' END,
    b.created_at
FROM bookings b
WHERE b.company_id = 1
ORDER BY b.booking_id;
GO

-- =============================================================================
-- UPDATE CUSTOMER STATS
-- =============================================================================
-- NOTE: dbo.Customers has no total_bookings / total_spend columns (see
-- 001_create_schema.sql, SECTION 6). There is no equivalent column to sync
-- these aggregates into, so this update has been removed rather than
-- rewritten against nonexistent columns. loyalty_points exists but represents
-- a different concept and is intentionally left untouched by demo seeding.

-- =============================================================================
-- UPDATE BANQUET STATS (sync booking counts and average ratings)
-- =============================================================================
UPDATE bq
SET
    bq.total_bookings  = ISNULL(stats.booking_count, 0),
    bq.average_rating  = ISNULL(stats.avg_rating, 0),
    bq.total_reviews   = ISNULL(stats.review_count, 0),
    bq.updated_at      = GETDATE()
FROM banquets bq
LEFT JOIN (
    SELECT
        h.banquet_id,
        COUNT(DISTINCT b.booking_id) AS booking_count,
        AVG(CAST(r.rating AS DECIMAL(3,2))) AS avg_rating,
        COUNT(r.review_id) AS review_count
    FROM bookings b
    INNER JOIN halls h ON h.hall_id = b.hall_id
    LEFT JOIN reviews r ON r.banquet_id = h.banquet_id AND r.is_approved = 1
    WHERE b.status NOT IN ('cancelled','draft')
    GROUP BY h.banquet_id
) stats ON stats.banquet_id = bq.banquet_id
WHERE bq.company_id = 1;
GO

    COMMIT TRANSACTION;
    PRINT 'Demo seed data inserted successfully.';
    PRINT '';
    PRINT 'Summary:';
    PRINT '  Customers:  50 new customer accounts';
    PRINT '  Branches:   2 additional branches (total 3)';
    PRINT '  Banquets:   2 additional banquets (total 3)';
    PRINT '  Halls:      6 additional halls (total 11)';
    PRINT '  Bookings:   ~210 bookings over 12 months';
    PRINT '  Payments:   ~340 payment records';
    PRINT '  Reviews:    ~35 approved customer reviews';
    PRINT '  Notifications: 100 booking confirmation notifications';
    PRINT '  Audit Logs: 200 audit entries';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'ERROR: ' + ERROR_MESSAGE();
    THROW;
END CATCH;
GO
