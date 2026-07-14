/**
 * BanquetPro — Database Setup Script
 * Creates banquet_booking database, imports schema, seeds essential data,
 * and creates the Super Administrator account.
 *
 * Usage:
 *   node scripts/setup.js
 *   node scripts/setup.js --reset   (drops and recreates the DB — DANGEROUS)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sql    = require('mssql');
const bcrypt = require('bcrypt');
const path   = require('path');
const fs     = require('fs');

const DB_NAME = process.env.DB_NAME || 'banquet_booking';
const RESET   = process.argv.includes('--reset');

// Connection used for server-level operations (CREATE/DROP DATABASE) —
// deliberately does not specify an initial `database` so it connects to master.
const masterConfig = {
    server:   process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 1433,
    user:     process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: 'master',
    options: {
        encrypt:                String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
};

// Connection used once the target database exists.
const dbConfig = {
    ...masterConfig,
    database: DB_NAME,
};

// ─── Logging ──────────────────────────────────────────────────────────────────
const log  = (msg)  => console.log(`  [INFO]  ${msg}`);
const ok   = (msg)  => console.log(`  [OK]    ${msg}`);
const warn = (msg)  => console.log(`  [WARN]  ${msg}`);
const fail = (msg)  => { console.error(`  [ERROR] ${msg}`); process.exit(1); };

/**
 * Run a batch of SQL. MSSQL requires each CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW
 * statement to be alone in its own batch, so scripts use `GO` as the batch
 * separator (not a T-SQL keyword — the mssql driver doesn't understand it,
 * so we split on it ourselves before executing).
 */
const runBatches = async (pool, script) => {
    const batches = script
        .split(/^\s*GO\s*$/im)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

    for (const batch of batches) {
        await pool.request().batch(batch);
    }
};

// ─── Extended demo data (employees, bookings, payments, invoices, leads) ───────
// Kept as its own function (rather than inline in main()) so the financial
// math for Payments/Invoices can be computed once from each booking's real
// total_amount/amount_paid — every downstream number is derived, not hand
// typed twice, so it can't drift out of sync with the booking it describes.
const seedExtendedDemoData = async (pool) => {
    const exists = async (table, idCol, id) => {
        const rows = await pool.request().query(`SELECT 1 AS x FROM ${table} WHERE ${idCol} = ${id}`);
        return rows.recordset.length > 0;
    };

    // ── Employees (Users 3-10) — one per role in the extended hierarchy ──────
    if (!(await exists('Users', 'user_id', 3))) {
        const empHash = await bcrypt.hash('Employee@123', 12);
        const employees = [
            { id: 3,  role: 3,  first: 'Neha',   last: 'Kulkarni',   email: 'neha.kulkarni@banquetpro.com' },
            { id: 4,  role: 4,  first: 'Arjun',   last: 'Verma',      email: 'arjun.verma@banquetpro.com' },
            { id: 5,  role: 6,  first: 'Kavya',   last: 'Reddy',      email: 'kavya.reddy@banquetpro.com' },
            { id: 6,  role: 7,  first: 'Rohan',   last: 'Desai',      email: 'rohan.desai@banquetpro.com' },
            { id: 7,  role: 8,  first: 'Ishita',  last: 'Bhatt',      email: 'ishita.bhatt@banquetpro.com' },
            { id: 8,  role: 9,  first: 'Suresh',  last: 'Iyer',       email: 'suresh.iyer@banquetpro.com' },
            { id: 9,  role: 10, first: 'Pooja',   last: 'Nair',       email: 'pooja.nair@banquetpro.com' },
            { id: 10, role: 11, first: 'Karan',   last: 'Malhotra',   email: 'karan.malhotra@banquetpro.com' },
        ];
        for (const e of employees) {
            await pool.request()
                .input('email', sql.NVarChar, e.email)
                .input('hash', sql.NVarChar, empHash)
                .query(`
                    SET IDENTITY_INSERT Users ON;
                    INSERT INTO Users (user_id, company_id, branch_id, role_id, first_name, last_name, email, password_hash, is_active, is_email_verified, created_at, updated_at)
                    VALUES (${e.id}, 1, 1, ${e.role}, N'${e.first}', N'${e.last}', @email, @hash, 1, 1, GETUTCDATE(), GETUTCDATE());
                    SET IDENTITY_INSERT Users OFF;
                `);
        }
        ok('Employee accounts seeded (branch manager, booking exec, owner, ops, sales, finance, staff, receptionist — password Employee@123).');
    }

    // ── More customers (9-15) ────────────────────────────────────────────────
    if (!(await exists('Customers', 'customer_id', 9))) {
        await pool.request().batch(`
            SET IDENTITY_INSERT Customers ON;
            INSERT INTO Customers (customer_id, company_id, branch_id, first_name, last_name, email, phone, city, state, source, is_active) VALUES
                (9,  1, 1, N'Rohit',   N'Malviya',      'rohit.malviya@email.com',      '+91-9900112233', N'Delhi',      N'Delhi',       'direct',   1),
                (10, 1, 1, N'Divya',   N'Choudhary',    'divya.choudhary@email.com',    '+91-9900223344', N'Jaipur',     N'Rajasthan',   'referral', 1),
                (11, 1, 1, N'Amit',    N'Trivedi',       'amit.trivedi@email.com',       '+91-9900334455', N'Surat',      N'Gujarat',     'online',   1),
                (12, 1, 1, N'Sunita',  N'Rao',           'sunita.rao@email.com',         '+91-9900445566', N'Hyderabad',  N'Telangana',   'direct',   1),
                (13, 1, 1, N'Farhan',  N'Sheikh',        'farhan.sheikh@email.com',      '+91-9900556677', N'Mumbai',     N'Maharashtra', 'referral', 1),
                (14, 1, 1, N'Meera',   N'Pillai',        'meera.pillai@email.com',       '+91-9900667788', N'Chennai',    N'Tamil Nadu',  'online',   1),
                (15, 1, 1, N'Karthik', N'Subramaniam',   'karthik.subramaniam@email.com','+91-9900778899', N'Bengaluru',  N'Karnataka',   'direct',   1);
            SET IDENTITY_INSERT Customers OFF;
        `);
        ok('Additional customers seeded.');
    }

    // ── More bookings (9-32): historical (Jan-Jun 2026, mostly completed) +
    // upcoming (Aug-Nov 2026, mixed pipeline stages) — "today" is 2026-07-06,
    // so completed bookings truthfully sit in the past and open ones in the future. ──
    if (!(await exists('Bookings', 'booking_id', 9))) {
        const HALL_CAP = { 1: 1200, 2: 600, 3: 300, 4: 800, 5: 80 };
        const newBookings = [
            { id:9,  ref:'BKG-2026-00009', hall:2, cust:9,  name:'Malviya Wedding Sangeet',      type:'wedding',       date:'2026-01-18', start:'17:00:00', end:'23:00:00', guests:400, status:'completed', total:165000, priority:0 },
            { id:10, ref:'BKG-2026-00010', hall:4, cust:10, name:'Choudhary Reception',          type:'reception',     date:'2026-02-05', start:'18:00:00', end:'23:00:00', guests:550, status:'completed', total:210000, priority:0 },
            { id:11, ref:'BKG-2026-00011', hall:1, cust:11, name:'Trivedi Corporate Gala',       type:'corporate',     date:'2026-02-20', start:'10:00:00', end:'22:00:00', guests:700, status:'completed', total:285000, priority:0 },
            { id:12, ref:'BKG-2026-00012', hall:3, cust:12, name:'Rao Baby Shower',              type:'baby_shower',   date:'2026-03-02', start:'11:00:00', end:'15:00:00', guests:90,  status:'completed', total:32000,  priority:0 },
            { id:13, ref:'BKG-2026-00013', hall:5, cust:13, name:'Sheikh Product Launch',        type:'corporate',     date:'2026-03-14', start:'09:00:00', end:'13:00:00', guests:60,  status:'completed', total:45000,  priority:0 },
            { id:14, ref:'BKG-2026-00014', hall:2, cust:14, name:'Pillai Engagement',             type:'engagement',    date:'2026-03-29', start:'18:00:00', end:'22:00:00', guests:250, status:'completed', total:98000,  priority:0 },
            { id:15, ref:'BKG-2026-00015', hall:1, cust:15, name:'Subramaniam Wedding',           type:'wedding',       date:'2026-04-10', start:'17:00:00', end:'23:00:00', guests:900, status:'completed', total:320000, priority:1 },
            { id:16, ref:'BKG-2026-00016', hall:4, cust:1,  name:'Sharma Family Reunion',         type:'private_party', date:'2026-04-22', start:'12:00:00', end:'18:00:00', guests:180, status:'completed', total:68000,  priority:0 },
            { id:17, ref:'BKG-2026-00017', hall:3, cust:2,  name:'Mehta Anniversary',             type:'anniversary',   date:'2026-05-03', start:'19:00:00', end:'23:00:00', guests:130, status:'completed', total:54000,  priority:0 },
            { id:18, ref:'BKG-2026-00018', hall:2, cust:5,  name:'Singh Corporate Offsite',       type:'corporate',     date:'2026-05-16', start:'09:00:00', end:'17:00:00', guests:220, status:'cancelled', total:88000,  priority:0, cancelReason:'Company budget cuts postponed the offsite indefinitely' },
            { id:19, ref:'BKG-2026-00019', hall:5, cust:9,  name:'Malviya Investor Conference',   type:'conference',    date:'2026-05-28', start:'10:00:00', end:'16:00:00', guests:70,  status:'completed', total:40000,  priority:0 },
            { id:20, ref:'BKG-2026-00020', hall:1, cust:3,  name:'Gupta Wedding Reception',       type:'reception',     date:'2026-06-08', start:'18:00:00', end:'23:30:00', guests:750, status:'completed', total:260000, priority:0 },
            { id:21, ref:'BKG-2026-00021', hall:4, cust:11, name:'Trivedi Golden Jubilee',        type:'anniversary',   date:'2026-06-19', start:'18:00:00', end:'23:00:00', guests:400, status:'cancelled', total:145000, priority:0, cancelReason:'Postponed indefinitely by customer due to a family emergency' },
            { id:22, ref:'BKG-2026-00022', hall:2, cust:14, name:'Pillai Birthday Bash',          type:'birthday',      date:'2026-06-27', start:'19:00:00', end:'23:00:00', guests:150, status:'completed', total:62000,  priority:0 },
            { id:23, ref:'BKG-2026-00023', hall:1, cust:4,  name:'Patel Wedding',                 type:'wedding',       date:'2026-08-08', start:'17:00:00', end:'23:30:00', guests:850, status:'confirmed',    total:310000, priority:1 },
            { id:24, ref:'BKG-2026-00024', hall:3, cust:6,  name:'Joshi Corporate Retreat',       type:'corporate',     date:'2026-08-19', start:'09:00:00', end:'18:00:00', guests:200, status:'tentative',    total:78000,  priority:0 },
            { id:25, ref:'BKG-2026-00025', hall:2, cust:7,  name:'Agarwal Engagement',            type:'engagement',    date:'2026-08-25', start:'18:00:00', end:'22:00:00', guests:260, status:'advance_paid', total:110000, priority:0 },
            { id:26, ref:'BKG-2026-00026', hall:5, cust:12, name:'Rao Conference',                type:'conference',    date:'2026-09-02', start:'10:00:00', end:'16:00:00', guests:70,  status:'confirmed',    total:48000,  priority:0 },
            { id:27, ref:'BKG-2026-00027', hall:4, cust:10, name:'Choudhary Reception Round Two',type:'reception',     date:'2026-09-14', start:'18:00:00', end:'23:00:00', guests:500, status:'tentative',    total:190000, priority:0 },
            { id:28, ref:'BKG-2026-00028', hall:1, cust:13, name:'Sheikh Wedding',                type:'wedding',       date:'2026-09-27', start:'17:00:00', end:'23:30:00', guests:950, status:'advance_paid', total:340000, priority:1 },
            { id:29, ref:'BKG-2026-00029', hall:3, cust:15, name:'Subramaniam Baby Shower',       type:'baby_shower',   date:'2026-10-05', start:'11:00:00', end:'15:00:00', guests:100, status:'confirmed',    total:36000,  priority:0 },
            { id:30, ref:'BKG-2026-00030', hall:2, cust:8,  name:'Nair Anniversary',              type:'anniversary',   date:'2026-10-20', start:'19:00:00', end:'23:00:00', guests:180, status:'tentative',    total:72000,  priority:0 },
            { id:31, ref:'BKG-2026-00031', hall:5, cust:1,  name:'Sharma Board Meeting',          type:'conference',    date:'2026-11-03', start:'09:00:00', end:'13:00:00', guests:40,  status:'confirmed',    total:22000,  priority:0 },
            { id:32, ref:'BKG-2026-00032', hall:4, cust:2,  name:'Mehta Festive Gala',            type:'private_party', date:'2026-11-15', start:'18:00:00', end:'23:00:00', guests:300, status:'draft',        total:115000, priority:0 },
        ];

        for (const b of newBookings) {
            if (b.guests > HALL_CAP[b.hall]) throw new Error(`Seed data error: booking ${b.id} guests exceed hall ${b.hall} capacity`);
            const advancePct = 0.5;
            let amountPaid;
            if (b.status === 'completed') amountPaid = b.total;
            else if (b.status === 'cancelled' || b.status === 'tentative' || b.status === 'draft') amountPaid = 0;
            else amountPaid = Math.round(b.total * advancePct); // confirmed / advance_paid
            const advancePaid = Math.round(b.total * advancePct);

            await pool.request().query(`
                SET IDENTITY_INSERT Bookings ON;
                INSERT INTO Bookings
                    (booking_id, booking_ref, company_id, branch_id, hall_id, customer_id,
                     event_name, event_type, event_date, event_time_start, event_time_end,
                     guest_count, status, total_amount, advance_paid, amount_paid,
                     is_priority, setup_minutes, cleanup_minutes, cooloff_minutes,
                     cancellation_reason, cancelled_at,
                     created_by, created_at)
                VALUES
                    (${b.id}, '${b.ref}', 1, 1, ${b.hall}, ${b.cust},
                     N'${b.name.replace(/'/g, "''")}', '${b.type}', '${b.date}', '${b.start}', '${b.end}',
                     ${b.guests}, '${b.status}', ${b.total}, ${advancePaid}, ${amountPaid},
                     ${b.priority}, ${b.priority ? 60 : 30}, ${b.priority ? 60 : 30}, ${b.priority ? 30 : 0},
                     ${b.cancelReason ? `N'${b.cancelReason.replace(/'/g, "''")}'` : 'NULL'}, ${b.status === 'cancelled' ? 'GETUTCDATE()' : 'NULL'},
                     2, GETUTCDATE());
                SET IDENTITY_INSERT Bookings OFF;
            `);
        }
        ok('Additional bookings seeded (historical completed/cancelled + upcoming pipeline).');

        // ── Payments matching each booking's real amount_paid ────────────────
        const methods = ['upi', 'bank_transfer', 'cash', 'cheque'];
        let paymentId = 9; // 1-8 already exist
        for (const b of newBookings) {
            const amountPaid = b.status === 'completed' ? b.total
                : (b.status === 'confirmed' || b.status === 'advance_paid') ? Math.round(b.total * 0.5)
                : 0;
            if (amountPaid <= 0) continue;
            const isFull = amountPaid >= b.total;
            const payDate = b.date; // paid on/around the booking date for simplicity of the demo timeline
            await pool.request().query(`
                SET IDENTITY_INSERT Payments ON;
                INSERT INTO Payments (payment_id, payment_ref, company_id, booking_id, customer_id, payment_type, payment_method, amount, status, payment_date, created_by, created_at)
                VALUES (${paymentId}, 'PAY-2026-${String(paymentId).padStart(5,'0')}', 1, ${b.id}, ${b.cust}, '${isFull ? 'full' : 'advance'}', '${methods[paymentId % methods.length]}', ${amountPaid}, 'completed', '${payDate}', 2, GETUTCDATE());
                SET IDENTITY_INSERT Payments OFF;
            `);
            paymentId++;
        }
        ok('Payments for additional bookings seeded.');
    }

    // ── Invoices for every booking (original 1-8 + new 9-32) — GST math is
    // derived from each booking's own total_amount/amount_paid, never re-typed. ──
    if (!(await exists('Invoices', 'invoice_id', 1))) {
        const bookingRows = (await pool.request().query(`
            SELECT booking_id, booking_ref, customer_id, event_date, total_amount, amount_paid, status
            FROM Bookings WHERE company_id = 1 AND status <> 'draft' ORDER BY booking_id
        `)).recordset;

        let invoiceId = 1;
        for (const b of bookingRows) {
            const grandTotal = Number(b.total_amount);
            const subtotal = Math.round((grandTotal / 1.18) * 100) / 100;
            const cgst = Math.round(subtotal * 0.09 * 100) / 100;
            const sgst = Math.round(subtotal * 0.09 * 100) / 100;
            const totalTax = Math.round((cgst + sgst) * 100) / 100;
            const amountPaid = Number(b.amount_paid);
            const balanceDue = Math.round((grandTotal - amountPaid) * 100) / 100;
            const paymentStatus = b.status === 'cancelled' ? 'cancelled' : balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';
            const invoiceDate = new Date(b.event_date);
            invoiceDate.setDate(invoiceDate.getDate() - 3); // invoiced a few days before the event
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + 15);

            await pool.request().query(`
                SET IDENTITY_INSERT Invoices ON;
                INSERT INTO Invoices
                    (invoice_id, invoice_number, company_id, booking_id, customer_id, invoice_date, due_date, invoice_type,
                     subtotal, discount_amount, taxable_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
                     total_tax, grand_total, amount_paid, balance_due, payment_status, is_cancelled, created_by, created_at)
                VALUES
                    (${invoiceId}, 'INV-2026-${String(invoiceId).padStart(6,'0')}', 1, ${b.booking_id}, ${b.customer_id},
                     '${invoiceDate.toISOString().slice(0,10)}', '${dueDate.toISOString().slice(0,10)}', 'tax_invoice',
                     ${subtotal}, 0, ${subtotal}, 9.00, ${cgst}, 9.00, ${sgst},
                     ${totalTax}, ${grandTotal}, ${amountPaid}, ${balanceDue}, '${paymentStatus}', ${b.status === 'cancelled' ? 1 : 0}, 2, GETUTCDATE());
                SET IDENTITY_INSERT Invoices OFF;
            `);
            invoiceId++;
        }
        ok(`Invoices seeded for all ${bookingRows.length} non-draft bookings.`);
    }

    // ── Sales pipeline leads — mix of fresh prospects and leads that map onto
    // the bookings above, so the pipeline and the booking list tell one story. ──
    if (!(await exists('Leads', 'lead_id', 1))) {
        const leads = [
            { name:'Ritu Kapoor',              phone:'+91-9911002233', email:'ritu.kapoor@email.com',            type:'wedding',      date:'2026-12-05', guests:400, budget:250000, score:'high',   source:'website',   stage:'inquiry',   assigned:7, notes:'Interested in Crystal Ballroom for a December wedding.' },
            { name:'Vivek Menon',              phone:'+91-9911003344', email:'vivek.menon@email.com',            type:'corporate',    date:'2026-09-20', guests:150, budget:60000,  score:'medium', source:'referral',  stage:'lead',      assigned:4, notes:'Follow up on venue shortlist sent last week.' },
            { customerId:6,  name:'Kavita Joshi',   phone:'+91-9834567890', email:'kavita.joshi@email.com',    type:'reception',    date:'2026-11-08', guests:300, budget:150000, score:'high',   source:'direct',    stage:'quotation', assigned:7, notes:'Sent quotation for Diamond Hall, awaiting confirmation.' },
            { customerId:6,  name:'Kavita Joshi',   phone:'+91-9834567890', email:'kavita.joshi@email.com',    type:'corporate',    date:'2026-08-19', guests:200, budget:78000,  score:'medium', source:'direct',    stage:'tentative', assigned:4, convertedBookingId:24, notes:'Corporate retreat — tentative hold on Pearl Terrace.' },
            { customerId:4,  name:'Sneha Patel',    phone:'+91-9845671234', email:'sneha.patel@email.com',     type:'wedding',      date:'2026-08-08', guests:850, budget:310000, score:'high',   source:'direct',    stage:'confirmed', assigned:7, convertedBookingId:23, notes:'Confirmed — Crystal Ballroom, priority booking.' },
            { customerId:13, name:'Farhan Sheikh',  phone:'+91-9900556677', email:'farhan.sheikh@email.com',   type:'wedding',      date:'2026-09-27', guests:950, budget:340000, score:'high',   source:'referral',  stage:'confirmed', assigned:7, convertedBookingId:28, notes:'Confirmed — Crystal Ballroom, largest wedding this quarter.' },
            { customerId:3,  name:'Rahul Gupta',    phone:'+91-9856781234', email:'rahul.gupta@email.com',     type:'reception',    date:'2026-06-08', guests:750, budget:260000, score:'high',   source:'online',    stage:'completed', assigned:4, convertedBookingId:20, notes:'Event completed successfully, full payment received.' },
            { name:'Anand Bhosale',            phone:'+91-9911004455', email:'anand.bhosale@email.com',          type:'birthday',     date:'2026-08-01', guests:100, budget:45000,  score:'low',    source:'cold_call', stage:'lost',      assigned:10, lostReason:'Chose a competitor venue closer to their home.' },
            { name:'Priyanka Iyer',            phone:'+91-9911005566', email:'priyanka.iyer@email.com',          type:'engagement',   date:'2026-12-20', guests:180, budget:130000, score:'medium', source:'instagram', stage:'inquiry',   assigned:7, notes:'Asked for pricing on Garden Arena.' },
            { customerId:8,  name:'Anjali Nair',   phone:'+91-9812367890', email:'anjali.nair@email.com',     type:'anniversary',   date:'2026-10-20', guests:180, budget:72000,  score:'medium', source:'online',    stage:'tentative', assigned:4, convertedBookingId:30, notes:'Tentative hold pending guest count confirmation.' },
            { name:'Devendra Rao',             phone:'+91-9911006677', email:'devendra.rao@email.com',           type:'corporate',    date:'2027-01-15', guests:120, budget:95000,  score:'medium', source:'direct',    stage:'quotation', assigned:7, notes:'Awaiting board approval on quotation.' },
            { customerId:5,  name:'Vikram Singh',  phone:'+91-9867453210', email:'vikram.singh@email.com',    type:'corporate',    date:'2026-05-16', guests:220, budget:88000,  score:'low',    source:'direct',    stage:'lost',      assigned:6, lostReason:'Company budget cuts postponed the offsite indefinitely.' },
            { name:'Meenal Kulshreshtha',      phone:'+91-9911007788', email:'meenal.kulshreshtha@email.com',    type:'baby_shower',  date:'2027-02-10', guests:80,  budget:40000,  score:'low',    source:'walk_in',   stage:'inquiry',   assigned:10, notes:'Walk-in inquiry, requested callback.' },
            { customerId:11, name:'Amit Trivedi', phone:'+91-9900334455', email:'amit.trivedi@email.com',    type:'anniversary',   date:'2026-06-19', guests:400, budget:145000, score:'medium', source:'referral',  stage:'lost',      assigned:4, lostReason:'Postponed indefinitely by customer due to a family emergency.' },
        ];

        let leadId = 1;
        for (const l of leads) {
            await pool.request().query(`
                SET IDENTITY_INSERT Leads ON;
                INSERT INTO Leads
                    (lead_id, company_id, branch_id, customer_id, contact_name, contact_phone, contact_email,
                     event_type, preferred_date, guest_count, estimated_budget, score, source, stage,
                     assigned_to, notes, lost_reason, converted_booking_id, created_by, created_at, updated_at)
                VALUES
                    (${leadId}, 1, 1, ${l.customerId || 'NULL'}, N'${l.name.replace(/'/g, "''")}', '${l.phone}', '${l.email}',
                     '${l.type}', '${l.date}', ${l.guests}, ${l.budget}, '${l.score}', '${l.source}', '${l.stage}',
                     ${l.assigned}, N'${(l.notes || '').replace(/'/g, "''")}',
                     ${l.lostReason ? `N'${l.lostReason.replace(/'/g, "''")}'` : 'NULL'},
                     ${l.convertedBookingId || 'NULL'}, ${l.assigned}, GETUTCDATE(), GETUTCDATE());
                SET IDENTITY_INSERT Leads OFF;
            `);
            leadId++;
        }
        ok('Sales pipeline leads seeded (interconnected with existing customers/bookings).');
    }

    // ── Staff assignments on a few upcoming bookings (Command Center "Staff" panel) ──
    if (!(await exists('BookingStaffAssignments', 'assignment_id', 1))) {
        const assignments = [
            { booking:23, user:6, role:'Operations lead for the wedding' },
            { booking:23, user:9, role:'Floor staff coordinator' },
            { booking:25, user:9, role:'Floor staff coordinator' },
            { booking:28, user:6, role:'Operations lead for the wedding' },
            { booking:28, user:4, role:'Booking executive on-site contact' },
            { booking:26, user:9, role:'Floor staff coordinator' },
        ];
        for (const a of assignments) {
            await pool.request().query(`
                INSERT INTO BookingStaffAssignments (booking_id, user_id, role_note, status, created_at)
                VALUES (${a.booking}, ${a.user}, N'${a.role.replace(/'/g, "''")}', 'assigned', SYSUTCDATETIME());
            `);
        }
        ok('Staff assignments seeded for upcoming bookings.');
    }

    // ── Resource allocations on a few bookings (Command Center "Inventory" panel) ──
    if (!(await exists('BookingResources', 'allocation_id', 1))) {
        const allocations = [
            { booking:23, resource:5, qty:60 },  // Tables (Round) for Patel Wedding
            { booking:23, resource:6, qty:850 }, // Chairs for Patel Wedding
            { booking:23, resource:3, qty:1 },   // Flower Decoration
            { booking:28, resource:5, qty:70 },
            { booking:28, resource:6, qty:950 },
            { booking:28, resource:2, qty:1 },   // LED Video Wall
            { booking:15, resource:5, qty:65 },
            { booking:15, resource:6, qty:900 },
        ];
        for (const a of allocations) {
            await pool.request().query(`
                INSERT INTO BookingResources (booking_id, resource_id, quantity_allocated, created_at)
                VALUES (${a.booking}, ${a.resource}, ${a.qty}, SYSUTCDATETIME());
            `);
        }
        ok('Resource allocations seeded for a few large bookings.');
    }

    // ── Master Menu: more categories + items, linked into the existing
    // Catering Packages so "package price computed from Master Menu" has
    // real, varied items behind it instead of just one test row. ──
    if (!(await exists('MenuCategories', 'category_id', 5))) {
        await pool.request().batch(`
            SET IDENTITY_INSERT MenuCategories ON;
            INSERT INTO MenuCategories (category_id, company_id, category_name, food_type, sort_order, is_active) VALUES
                (5, 1, N'Non-Veg Specialties', 'non_veg', 5, 1),
                (6, 1, N'Live Counters',       'mixed',   6, 1);
            SET IDENTITY_INSERT MenuCategories OFF;
        `);
        ok('Additional Master Menu categories seeded.');
    }

    if (!(await exists('MenuItems', 'item_id', 1))) {
        const items = [
            { name:'Paneer Tikka',            cat:1, food:'veg',     unit:'plate', price:150, tax:5,  cost:60  },
            { name:'Veg Spring Rolls',        cat:1, food:'veg',     unit:'plate', price:120, tax:5,  cost:45  },
            { name:'Hara Bhara Kebab',        cat:1, food:'veg',     unit:'plate', price:110, tax:5,  cost:40  },
            { name:'Dal Makhani',             cat:2, food:'veg',     unit:'plate', price:140, tax:5,  cost:50  },
            { name:'Paneer Butter Masala',    cat:2, food:'veg',     unit:'plate', price:180, tax:5,  cost:70  },
            { name:'Veg Biryani',             cat:2, food:'veg',     unit:'plate', price:160, tax:5,  cost:65  },
            { name:'Jain Kofta Curry',        cat:2, food:'jain',    unit:'plate', price:170, tax:5,  cost:68  },
            { name:'Gulab Jamun',             cat:3, food:'veg',     unit:'piece', price:40,  tax:5,  cost:12  },
            { name:'Rasmalai',                cat:3, food:'veg',     unit:'piece', price:50,  tax:5,  cost:18  },
            { name:'Live Chocolate Fountain', cat:3, food:'veg',     unit:'plate', price:90,  tax:5,  cost:35  },
            { name:'Masala Chaas',            cat:4, food:'vegan',   unit:'glass', price:35,  tax:5,  cost:10  },
            { name:'Fresh Lime Soda',         cat:4, food:'vegan',   unit:'glass', price:30,  tax:5,  cost:8   },
            { name:'Butter Chicken',          cat:5, food:'non_veg', unit:'plate', price:220, tax:5,  cost:95  },
            { name:'Mutton Rogan Josh',       cat:5, food:'non_veg', unit:'plate', price:280, tax:5,  cost:120 },
            { name:'Tandoori Chicken',        cat:5, food:'non_veg', unit:'plate', price:210, tax:5,  cost:85  },
            { name:'Live Pasta Counter',      cat:6, food:'veg',     unit:'plate', price:130, tax:5,  cost:50  },
            { name:'Live Dosa Counter',       cat:6, food:'veg',     unit:'plate', price:100, tax:5,  cost:38  },
        ];
        let itemId = 1;
        for (const i of items) {
            await pool.request().query(`
                SET IDENTITY_INSERT MenuItems ON;
                INSERT INTO MenuItems (item_id, company_id, category_id, item_name, description, food_type, unit, base_price, tax_percent, unit_cost, is_active, created_at)
                VALUES (${itemId}, 1, ${i.cat}, N'${i.name.replace(/'/g, "''")}', NULL, '${i.food}', '${i.unit}', ${i.price}, ${i.tax}, ${i.cost}, 1, GETUTCDATE());
                SET IDENTITY_INSERT MenuItems OFF;
            `);
            itemId++;
        }
        ok('Master Menu items seeded across all categories.');

        // Link a representative subset of items into the existing Catering Packages
        // so each package's price is genuinely computed from the Master Menu.
        const packageLinks = [
            // Classic Veg Menu (package 1)
            { pkg:1, item:1, qty:1 }, { pkg:1, item:4, qty:1 }, { pkg:1, item:8, qty:1 }, { pkg:1, item:11, qty:1 },
            // Premium Veg Menu (package 2)
            { pkg:2, item:1, qty:1 }, { pkg:2, item:5, qty:1 }, { pkg:2, item:6, qty:1 }, { pkg:2, item:9, qty:1 }, { pkg:2, item:10, qty:1 },
            // Non-Veg Standard (package 3)
            { pkg:3, item:2, qty:1 }, { pkg:3, item:13, qty:1 }, { pkg:3, item:4, qty:1 }, { pkg:3, item:8, qty:1 },
            // Non-Veg Premium (package 4)
            { pkg:4, item:3, qty:1 }, { pkg:4, item:13, qty:1 }, { pkg:4, item:14, qty:1 }, { pkg:4, item:15, qty:1 }, { pkg:4, item:9, qty:1 },
            // Jain Special Menu (package 5)
            { pkg:5, item:7, qty:1 }, { pkg:5, item:1, qty:1 }, { pkg:5, item:8, qty:1 },
            // Fusion Buffet (package 6)
            { pkg:6, item:16, qty:1 }, { pkg:6, item:17, qty:1 }, { pkg:6, item:13, qty:1 }, { pkg:6, item:10, qty:1 }, { pkg:6, item:12, qty:1 },
        ];
        for (const l of packageLinks) {
            await pool.request().query(`
                INSERT INTO CateringPackageItems (package_id, item_id, quantity_per_plate, created_at)
                VALUES (${l.pkg}, ${l.item}, ${l.qty}, SYSUTCDATETIME());
            `);
        }
        // Recompute each package's stored price_per_plate from its linked Master Menu items.
        await pool.request().query(`
            UPDATE cp
            SET cp.price_per_plate = ISNULL(sub.computed, cp.price_per_plate)
            FROM CateringPackages cp
            OUTER APPLY (
                SELECT SUM(mi.base_price * (1 + mi.tax_percent / 100) * cpi.quantity_per_plate) AS computed
                FROM CateringPackageItems cpi
                JOIN MenuItems mi ON mi.item_id = cpi.item_id
                WHERE cpi.package_id = cp.package_id
            ) sub
            WHERE cp.company_id = 1;
        `);
        ok('Catering packages linked to Master Menu items with computed pricing.');
    }

    // ── More structured inventory across every category ─────────────────────
    if (!(await exists('Resources', 'resource_id', 9))) {
        const resources = [
            { name:'Banquet Sofa Set',        type:'seating',    cat:'furniture', supplier:'EventFurn Co',          price:1200, cost:500,  qty:30  },
            { name:'Cocktail Tables',         type:'seating',    cat:'furniture', supplier:'EventFurn Co',          price:300,  cost:120,  qty:60  },
            { name:'Backdrop Wall (Floral)',  type:'decor',      cat:'decor',     supplier:'Bloom Decorators',      price:18000,cost:7500, qty:6   },
            { name:'Fairy Light Curtain',     type:'lighting',   cat:'lighting',  supplier:'GlowScape Lighting',    price:3500, cost:1400, qty:20  },
            { name:'Uplighting Set (RGB)',    type:'lighting',   cat:'lighting',  supplier:'GlowScape Lighting',    price:4500, cost:1800, qty:15  },
            { name:'Wireless Mic Set (x4)',   type:'audio',      cat:'audio',     supplier:'SoundWave Rentals',     price:6000, cost:2500, qty:8   },
            { name:'Confetti Cannon',         type:'visual',     cat:'visual',    supplier:'Candid Moments Co',     price:2500, cost:900,  qty:12  },
            { name:'Digital Welcome Signage', type:'signage',    cat:'signage',   supplier:'BrightTech Rentals',    price:5000, cost:2000, qty:5   },
            { name:'Nameplate & Seating Chart', type:'signage',  cat:'signage',   supplier:'PrintCraft Studio',     price:800,  cost:250,  qty:40  },
        ];
        for (const r of resources) {
            await pool.request().query(`
                INSERT INTO Resources (company_id, resource_name, resource_type, category, supplier, unit_price, cost_price, quantity_available, is_active, created_at, updated_at)
                VALUES (1, N'${r.name.replace(/'/g, "''")}', '${r.type}', '${r.cat}', N'${r.supplier.replace(/'/g, "''")}', ${r.price}, ${r.cost}, ${r.qty}, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
            `);
        }
        ok('Additional structured inventory items seeded across all categories.');
    }
};

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n=============================================================');
    console.log('  BanquetPro — Database Setup');
    console.log('=============================================================\n');

    let masterPool;
    try {
        masterPool = await new sql.ConnectionPool(masterConfig).connect();
        log(`Connected to MSSQL at ${masterConfig.server}:${masterConfig.port}`);
    } catch (err) {
        fail(`Cannot connect to MSSQL: ${err.message}\n  Check .env credentials (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).`);
        return;
    }

    // ── 1. Create / reset database ───────────────────────────────────────────
    if (RESET) {
        // --reset unconditionally drops the database — if NODE_ENV is ever
        // production (or unset, since an unset env in a real deployment is
        // itself a misconfiguration we don't want to silently treat as safe),
        // refuse rather than risk destroying live data from a mistyped command
        // or a stale deploy script.
        if (process.env.NODE_ENV !== 'development') {
            fail(`Refusing to run --reset: NODE_ENV is "${process.env.NODE_ENV || '(unset)'}", not "development". ` +
                 `Set NODE_ENV=development explicitly if you really mean to drop "${DB_NAME}".`);
            return;
        }
        warn(`--reset flag detected. Dropping database "${DB_NAME}" …`);
        await masterPool.request().batch(`
            IF DB_ID(N'${DB_NAME}') IS NOT NULL
            BEGIN
                ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE [${DB_NAME}];
            END
        `);
        ok(`Database "${DB_NAME}" dropped.`);
    }

    await masterPool.request().batch(`
        IF DB_ID(N'${DB_NAME}') IS NULL
        BEGIN
            CREATE DATABASE [${DB_NAME}];
        END
    `);
    ok(`Database "${DB_NAME}" ready.`);

    await masterPool.close();

    const pool = await new sql.ConnectionPool(dbConfig).connect();

    // ── 2. Import schema ─────────────────────────────────────────────────────
    const schemaPath = path.resolve(__dirname, '../../database/migrations/001_create_schema.sql');
    if (fs.existsSync(schemaPath)) {
        log('Importing schema …');
        let schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // Remove CREATE DATABASE / USE directives — we already selected the DB.
        // Strip the whole guarding IF/BEGIN...END block, not just the CREATE DATABASE
        // statement inside it — an empty BEGIN...END is a T-SQL syntax error.
        schemaSql = schemaSql
            .replace(/IF\s+DB_ID\([^)]*\)\s+IS\s+NULL\s*\r?\n\s*BEGIN\b[\s\S]*?CREATE\s+DATABASE[^;]+;[\s\S]*?\bEND\b/gi, '')
            .replace(/CREATE\s+DATABASE[^;]+;/gi, '')
            .replace(/^\s*USE\s+\[?\w+\]?\s*;?\s*$/gim, '');
        await runBatches(pool, schemaSql);
        ok('Schema imported.');
    } else {
        warn(`Schema file not found at ${schemaPath} — skipping.`);
    }

    // ── 2b. Widen Bookings status CHECK to include 'tentative' / 'archived' ──
    await pool.request().batch(`
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
    `);
    ok('Bookings status constraint ensured (tentative/archived).');

    // ── 2c. Seed Roles early — later steps grant permissions to role IDs 6-11,
    // so those rows must exist before any of the "3x" patches below run. This
    // used to live in the "Seeding reference data" phase (much later in this
    // script), which meant a truly fresh --reset failed with a FK violation
    // the very first time it was exercised end-to-end.
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Roles WHERE role_id = 1)
        BEGIN
            SET IDENTITY_INSERT Roles ON;
            INSERT INTO Roles (role_id, role_name, role_slug, description, is_system) VALUES
                (1, N'Super Admin',       'super_admin',       N'Full platform control. Manages all companies and tenants.', 1),
                (2, N'Company Admin',     'company_admin',     N'Manages a single company: branches, banquets, staff, reports.', 1),
                (3, N'Branch Manager',    'branch_manager',    N'Manages daily operations of a specific branch.', 1),
                (4, N'Booking Executive', 'booking_executive', N'Creates and manages bookings, customers, invoices.', 1),
                (5, N'Customer',          'customer',          N'End-user who searches, books, and manages their bookings.', 1);
            SET IDENTITY_INSERT Roles OFF;
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Roles WHERE role_id = 6)
        BEGIN
            SET IDENTITY_INSERT Roles ON;
            INSERT INTO Roles (role_id, role_name, role_slug, description, is_system) VALUES
                (6,  N'Business Owner',      'business_owner',      N'Owns the company: bookings, halls, customers, inventory, staff, analytics, reports.', 1),
                (7,  N'Operations Manager',  'operations_manager',  N'Manages daily operations: bookings, scheduling, occupancy, event planning.', 1),
                (8,  N'Sales Manager',       'sales_manager',       N'Manages inquiries, quotations, follow-ups, promotional campaigns, customers.', 1),
                (9,  N'Finance Manager',     'finance_manager',     N'Manages invoices, payments, refunds, taxes, deposits.', 1),
                (10, N'Staff',               'staff',               N'Read-only operational dashboard, assigned events only.', 1),
                (11, N'Receptionist',        'receptionist',        N'Creates inquiries/bookings, edits customer details. Cannot delete bookings.', 1);
            SET IDENTITY_INSERT Roles OFF;
        END
    `);
    ok('Roles seeded early (before permission grants that reference them).');

    // ── 2d. Seed Countries + demo Company/Branch early too — later patches
    // (e.g. demo MenuCategories) insert rows scoped to company_id=1, so that
    // company (and the Countries row its country_id FK needs) must exist first.
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Countries WHERE country_id = 1)
        BEGIN
            SET IDENTITY_INSERT Countries ON;
            INSERT INTO Countries (country_id, country_name, country_code, phone_code, currency_code, currency_symbol)
            VALUES
                (1, N'India', 'IN', '+91', 'INR', N'₹'),
                (2, N'United States', 'US', '+1', 'USD', N'$'),
                (3, N'United Arab Emirates', 'AE', '+971', 'AED', N'د.إ');
            SET IDENTITY_INSERT Countries OFF;
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Companies WHERE company_id = 1)
        BEGIN
            SET IDENTITY_INSERT Companies ON;
            INSERT INTO Companies
                (company_id, company_name, company_slug, email, phone, address_line1,
                 country_id, currency_code, timezone, is_active, is_verified, subscription_plan)
            VALUES
                (1, N'BanquetPro Demo', 'banquetpro-demo',
                 'admin@banquetpro.com', '+91-9876543210',
                 N'101, Corporate Tower, Bandra Kurla Complex',
                 1, 'INR', 'Asia/Kolkata', 1, 1, 'enterprise');
            SET IDENTITY_INSERT Companies OFF;
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Branches WHERE branch_id = 1)
        BEGIN
            SET IDENTITY_INSERT Branches ON;
            INSERT INTO Branches
                (branch_id, company_id, branch_name, branch_code, address_line1, is_main_branch, is_active)
            VALUES
                (1, 1, N'Mumbai Head Office', 'MUM-HQ', N'101, Corporate Tower, BKC, Mumbai', 1, 1);
            SET IDENTITY_INSERT Branches OFF;
        END
    `);
    ok('Countries + demo Company/Branch seeded early.');

    // ── 3. Add Resources table (if not in main schema) ───────────────────────
    await pool.request().batch(`
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
    `);
    ok('Resources table ensured.');

    // ── 3b. Add BookingResources table (shared inventory allocation) ────────
    await pool.request().batch(`
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
    `);
    ok('BookingResources table ensured.');

    // ── 3b2. Add UserRoles table (multi-role support) + backfill from Users.role_id ──
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserRoles')
        BEGIN
            CREATE TABLE UserRoles (
                user_id     INT             NOT NULL,
                role_id     INT             NOT NULL,
                assigned_by INT             NULL,
                assigned_at DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id),
                CONSTRAINT FK_ur_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
                CONSTRAINT FK_ur_role FOREIGN KEY (role_id) REFERENCES Roles(role_id)
            );
        END
    `);
    await pool.request().batch(`
        INSERT INTO UserRoles (user_id, role_id)
        SELECT u.user_id, u.role_id FROM Users u
        WHERE NOT EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.user_id = u.user_id AND ur.role_id = u.role_id);
    `);
    ok('UserRoles table ensured and backfilled from Users.role_id.');

    // ── 3b3. Add RolePermissionScopes table (branch/hall scoped grants) ──────
    // Foundation for future multi-location deployments: a role+permission grant
    // is tenant-wide unless scope rows exist here, in which case it's restricted
    // to the listed branches/halls. No rows = unrestricted (non-breaking).
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RolePermissionScopes')
        BEGIN
            CREATE TABLE RolePermissionScopes (
                scope_id      INT             NOT NULL IDENTITY(1,1),
                role_id       INT             NOT NULL,
                permission_id INT             NOT NULL,
                branch_id     INT             NULL,
                hall_id       INT             NULL,
                created_at    DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_role_permission_scopes PRIMARY KEY (scope_id),
                CONSTRAINT FK_rps_role FOREIGN KEY (role_id) REFERENCES Roles(role_id) ON DELETE CASCADE,
                CONSTRAINT FK_rps_permission FOREIGN KEY (permission_id) REFERENCES Permissions(permission_id) ON DELETE CASCADE,
                CONSTRAINT FK_rps_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
                CONSTRAINT FK_rps_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id)
            );
            CREATE INDEX IX_rps_lookup ON RolePermissionScopes(role_id, permission_id);
        END
    `);
    ok('RolePermissionScopes table ensured.');

    // ── 3c. Add BookingContacts table (Alternative Contacts) ────────────────
    await pool.request().batch(`
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
    `);
    ok('BookingContacts table ensured.');

    // ── 3d. Add priority-booking columns to Bookings ─────────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'is_priority')
        BEGIN
            ALTER TABLE Bookings ADD is_priority BIT NOT NULL DEFAULT 0;
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'priority_surcharge')
        BEGIN
            ALTER TABLE Bookings ADD priority_surcharge DECIMAL(12,2) NOT NULL DEFAULT 0;
        END
    `);
    ok('Priority booking columns ensured.');

    // ── 3d2. Session-timeout system: RefreshTokens needs to remember whether a
    // token was issued under "Keep Me Signed In" (so the extended expiry
    // survives token rotation on /auth/refresh instead of degrading back to
    // the short-lived default) and when the session actually started (so
    // absolute session lifetime is measured from first login, not reset by
    // every refresh the way idle-timeout activity resets the idle timer). ──
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RefreshTokens') AND name = 'is_extended')
        BEGIN
            ALTER TABLE RefreshTokens ADD is_extended BIT NOT NULL DEFAULT 0;
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RefreshTokens') AND name = 'session_started_at')
        BEGIN
            ALTER TABLE RefreshTokens ADD session_started_at DATETIME2 NULL;
        END
    `);
    // Backfill: any existing (pre-migration) tokens treat their own creation
    // time as the session start, so the absolute-lifetime check has a sane
    // value instead of NULL until they next rotate.
    await pool.request().batch(`
        UPDATE RefreshTokens SET session_started_at = created_at WHERE session_started_at IS NULL;
    `);
    ok('Session-timeout columns on RefreshTokens ensured.');

    // ── 3e. Bookings.created_at/updated_at defaults: GETDATE() -> GETUTCDATE() ──
    // The app always supplies GETUTCDATE() explicitly on insert/update, but the
    // column DEFAULT (used by raw inserts / seed data) still used local server
    // time, which is inconsistent with the rest of the UTC-only schema.
    await pool.request().batch(`
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
    `);
    ok('Bookings UTC timestamp defaults ensured.');

    // Same GETDATE() -> GETUTCDATE() fix for Invoices.created_at (found while
    // seeding invoice demo data — it had the identical latent bug as Bookings).
    await pool.request().batch(`
        DECLARE @constraintName NVARCHAR(200);
        SELECT @constraintName = dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('Invoices') AND c.name = 'created_at' AND dc.definition = '(getdate())';
        IF @constraintName IS NOT NULL
        BEGIN
            EXEC('ALTER TABLE Invoices DROP CONSTRAINT ' + @constraintName);
            EXEC('ALTER TABLE Invoices ADD CONSTRAINT DF_invoices_created_at DEFAULT GETUTCDATE() FOR created_at');
        END
    `);
    ok('Invoices UTC timestamp default ensured.');

    // Systemic fix: the ORIGINAL schema (001_create_schema.sql) defaults nearly
    // every created_at/updated_at/date column to local-server-time GETDATE()
    // across 30+ tables. App code mostly supplies GETUTCDATE() explicitly on
    // INSERT, but any INSERT that omits one of these columns (e.g. Payments.
    // updated_at, never set on create()) silently falls back to local time —
    // found via a real 5.5-hour timestamp skew during a full application audit.
    // Rather than patch tables one at a time as each gets discovered, sweep
    // every remaining plain-GETDATE()/CAST(GETDATE() AS DATE) default in one pass.
    await pool.request().batch(`
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
    `);
    ok('All remaining GETDATE() column defaults swept to GETUTCDATE() across the schema.');

    // ── 3f. Add MenuItems tax/cost fields ────────────────────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'tax_percent')
        BEGIN
            ALTER TABLE MenuItems ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'unit_cost')
        BEGIN
            ALTER TABLE MenuItems ADD unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'hsn_sac_code')
        BEGIN
            ALTER TABLE MenuItems ADD hsn_sac_code NVARCHAR(15) NULL;
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'tax_type')
        BEGIN
            ALTER TABLE MenuItems ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_mi_tax_type CHECK (tax_type IN ('hsn','sac'));
        END
    `);
    ok('MenuItems tax/HSN/cost columns ensured.');

    // ── 3f2. Add HSN/SAC code + tax_type to CateringPackages, Resources,
    // BookingPackages, DecorationItems, QuotationItems, Invoices — replaces
    // the hardcoded 18% GST assumption with a per-item configurable rate +
    // tax classification (HSN = goods, SAC = services). ──────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'hsn_sac_code')
            ALTER TABLE CateringPackages ADD hsn_sac_code NVARCHAR(15) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'tax_type')
            ALTER TABLE CateringPackages ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_cp_tax_type CHECK (tax_type IN ('hsn','sac'));
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'tax_percent')
            ALTER TABLE CateringPackages ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
    `);
    ok('CateringPackages tax/HSN columns ensured.');

    // ── 3g. Seed catering:* permissions (existing constant keys had no rows) ─
    const cateringPerms = [
        ['catering', 'read',   'catering:read',   'View menu items and catering packages'],
        ['catering', 'create', 'catering:create', 'Create menu items'],
        ['catering', 'update', 'catering:update', 'Edit menu items'],
    ];
    for (const [module_, action, key, desc] of cateringPerms) {
        await pool.request()
            .input('module', sql.NVarChar, module_)
            .input('action', sql.NVarChar, action)
            .input('key', sql.NVarChar, key)
            .input('desc', sql.NVarChar, desc)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = @key)
                INSERT INTO Permissions (module, action, permission_key, description)
                VALUES (@module, @action, @key, @desc);
            `);
    }
    // Grant to Business Owner (role 6) — covers menu/catering management
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 6, p.permission_id FROM Permissions p
        WHERE p.permission_key IN ('catering:read','catering:create','catering:update')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = 6 AND rp.permission_id = p.permission_id
          );
    `);
    ok('Catering permissions ensured.');

    // ── 3h. Seed demo MenuCategories (needed for MenuItems FK) ───────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM MenuCategories WHERE company_id = 1)
        BEGIN
            INSERT INTO MenuCategories (company_id, category_name, food_type, sort_order, is_active) VALUES
                (1, N'Starters',    'veg',     1, 1),
                (1, N'Main Course', 'veg',     2, 1),
                (1, N'Desserts',    'veg',     3, 1),
                (1, N'Beverages',   'veg',     4, 1);
        END
    `);
    ok('Demo menu categories seeded.');

    // ── 3i. Add parent_booking_id (Master Booking / Child Occupancy Slots) ───
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'parent_booking_id')
        BEGIN
            ALTER TABLE Bookings ADD parent_booking_id BIGINT NULL;
            ALTER TABLE Bookings ADD CONSTRAINT FK_bookings_parent FOREIGN KEY (parent_booking_id) REFERENCES Bookings(booking_id);
            CREATE INDEX IX_bookings_parent ON Bookings(parent_booking_id);
        END
    `);
    ok('Master/child booking column ensured.');

    // ── 3j. Event details expansion + multi-day + cool-off/setup/cleanup buffers ──
    await pool.request().batch(`
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
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'setup_charge')
            ALTER TABLE Bookings ADD setup_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'decoration_charge')
            ALTER TABLE Bookings ADD decoration_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cleaning_charge')
            ALTER TABLE Bookings ADD cleaning_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'extended_usage_charge')
            ALTER TABLE Bookings ADD extended_usage_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cooloff_charge')
            ALTER TABLE Bookings ADD cooloff_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
    `);
    ok('Event details / multi-day / buffer columns ensured.');

    // ── 3l. Soft delete — distinct from is_active (Halls/Banquets/Users) ────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Halls') AND name = 'deleted_at')
            ALTER TABLE Halls ADD deleted_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Banquets') AND name = 'deleted_at')
            ALTER TABLE Banquets ADD deleted_at DATETIME2 NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'deleted_at')
            ALTER TABLE Users ADD deleted_at DATETIME2 NULL;
    `);
    ok('Soft-delete (deleted_at) columns ensured.');

    // ── 3m. Per-booking catering plans (multi-session) ──────────────────────
    await pool.request().batch(`
        IF OBJECT_ID(N'dbo.BookingCateringSessions', N'U') IS NULL
        BEGIN
            CREATE TABLE BookingCateringSessions (
                session_id      BIGINT          NOT NULL IDENTITY(1,1),
                booking_id      BIGINT          NOT NULL,
                company_id      INT             NOT NULL,
                session_type    NVARCHAR(50)    NOT NULL,
                serving_time    TIME            NULL,
                guest_count     INT             NULL,
                notes           NVARCHAR(500)   NULL,
                created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_booking_catering_sessions PRIMARY KEY (session_id),
                CONSTRAINT FK_bcs_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
                CONSTRAINT FK_bcs_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
            );
            CREATE INDEX IX_bcs_booking ON BookingCateringSessions(booking_id);
        END
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingCateringSessions') AND name = 'serving_date')
            -- Multi-day bookings (event_date..event_end_date) previously had
            -- no way to say which day a session belonged to — serving_time
            -- alone is ambiguous once an event spans more than one day.
            -- NULL means "the booking's (start) event_date", so existing
            -- single-day sessions don't need backfilling.
            ALTER TABLE BookingCateringSessions ADD serving_date DATE NULL;
    `);
    await pool.request().batch(`
        IF OBJECT_ID(N'dbo.BookingCateringItems', N'U') IS NULL
        BEGIN
            CREATE TABLE BookingCateringItems (
                item_row_id     BIGINT          NOT NULL IDENTITY(1,1),
                session_id      BIGINT          NOT NULL,
                item_id         INT             NULL,
                item_name       NVARCHAR(200)   NOT NULL,
                quantity        DECIMAL(10,2)   NOT NULL DEFAULT 1,
                unit_price      DECIMAL(10,2)   NOT NULL DEFAULT 0,
                tax_percent     DECIMAL(5,2)    NOT NULL DEFAULT 0,
                created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_booking_catering_items PRIMARY KEY (item_row_id),
                CONSTRAINT FK_bci_session FOREIGN KEY (session_id) REFERENCES BookingCateringSessions(session_id),
                CONSTRAINT FK_bci_item FOREIGN KEY (item_id) REFERENCES MenuItems(item_id)
            );
            CREATE INDEX IX_bci_session ON BookingCateringItems(session_id);
        END
    `);
    ok('Per-booking catering session/item tables ensured.');

    // ── 3n. Quotations module ────────────────────────────────────────────────
    await pool.request().batch(`
        IF OBJECT_ID(N'dbo.Quotations', N'U') IS NULL
        BEGIN
            CREATE TABLE Quotations (
                quotation_id         BIGINT          NOT NULL IDENTITY(1,1),
                company_id           INT             NOT NULL,
                branch_id            INT             NULL,
                lead_id              INT             NULL,
                customer_id          INT             NULL,
                quotation_number     NVARCHAR(30)    NOT NULL,
                status               NVARCHAR(20)    NOT NULL DEFAULT 'draft',
                revision             INT             NOT NULL DEFAULT 1,
                parent_quotation_id  BIGINT          NULL,
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
                accept_token         NVARCHAR(64)    NULL,
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
    `);
    await pool.request().batch(`
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
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:read')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','read','quotations:read','View quotations');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:create')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','create','quotations:create','Create/revise quotations');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:update')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','update','quotations:update','Edit quotations');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'quotations:approve')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('quotations','approve','quotations:approve','Approve/accept quotations and convert to bookings');
    `);
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id
        FROM Roles r
        CROSS JOIN Permissions p
        WHERE r.role_slug IN ('sales_manager', 'finance_manager')
          AND p.permission_key IN ('quotations:read','quotations:create','quotations:update','quotations:approve')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
          );
    `);
    ok('Quotations module (tables + permissions) ensured.');

    // ── 3o. Company (tenant) hardening — soft delete + platform permissions ──
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Companies') AND name = 'deleted_at')
            ALTER TABLE Companies ADD deleted_at DATETIME2 NULL;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:create')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','create','companies:create','Create tenant companies (platform)');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:read')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','read','companies:read','View tenant companies (platform)');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:update')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','update','companies:update','Edit/suspend/activate tenant companies (platform)');
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:delete')
            INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','delete','companies:delete','Delete tenant companies (platform)');
    `);
    await pool.request().batch(`
        DELETE rp FROM RolePermissions rp
        JOIN Roles r ON r.role_id = rp.role_id
        JOIN Permissions p ON p.permission_id = rp.permission_id
        WHERE r.role_slug <> 'super_admin' AND p.permission_key LIKE 'companies:%';

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id
        FROM Roles r
        CROSS JOIN Permissions p
        WHERE r.role_slug = 'super_admin'
          AND p.permission_key IN ('companies:create','companies:read','companies:update','companies:delete')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
          );
    `);
    ok('Company (tenant) soft-delete + platform permissions ensured.');

    // ── 3p. RBAC permission repair — every non-super_admin role was found to
    // be severely under-provisioned vs. the seed file's documented intent.
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'company_admin'
          AND p.permission_key NOT IN ('companies:create','companies:read','companies:update','companies:delete','audit_logs:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'branch_manager'
          AND p.permission_key IN (
            'dashboard:read', 'banquets:read', 'halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'reports:read','reports:export', 'pricing:read',
            'availability:manage','availability:read',
            'resources:create','resources:read','resources:update', 'settings:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'booking_executive'
          AND p.permission_key IN (
            'dashboard:read', 'banquets:read', 'halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'availability:read', 'coupons:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'customer'
          AND p.permission_key IN (
            'banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:cancel',
            'invoices:read','payments:read','availability:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'business_owner'
          AND p.permission_key NOT IN ('companies:create','companies:read','companies:update','companies:delete','audit_logs:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'operations_manager'
          AND p.permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
            'customers:read','customers:update',
            'availability:manage','availability:read',
            'resources:create','resources:read','resources:update', 'reports:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'sales_manager'
          AND p.permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update',
            'customers:create','customers:read','customers:update',
            'coupons:create','coupons:read','coupons:update',
            'availability:read','reports:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'finance_manager'
          AND p.permission_key IN (
            'dashboard:read','bookings:read',
            'payments:create','payments:read','payments:refund',
            'invoices:create','invoices:read','invoices:send',
            'reports:read','reports:export')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'staff'
          AND p.permission_key IN ('dashboard:read','bookings:read','banquets:read','halls:read','availability:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
        WHERE r.role_slug = 'receptionist'
          AND p.permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update',
            'customers:create','customers:read','customers:update','availability:read')
          AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
    `);
    ok('RBAC permission repair applied (all roles match seed intent).');

    // ── 3q. Booking duration packages ────────────────────────────────────────
    await pool.request().batch(`
        IF OBJECT_ID(N'dbo.BookingPackages', N'U') IS NULL
        BEGIN
            CREATE TABLE BookingPackages (
                package_id              INT             NOT NULL IDENTITY(1,1),
                company_id              INT             NOT NULL,
                package_name            NVARCHAR(200)   NOT NULL,
                package_category        NVARCHAR(20)    NOT NULL,
                calc_type               NVARCHAR(20)    NOT NULL,
                included_hours          DECIMAL(5,2)    NULL,
                base_price              DECIMAL(12,2)   NOT NULL DEFAULT 0,
                overtime_rate_per_hour  DECIMAL(10,2)   NOT NULL DEFAULT 0,
                max_extension_hours     DECIMAL(5,2)    NOT NULL DEFAULT 0,
                default_setup_minutes   INT             NOT NULL DEFAULT 0,
                default_cleanup_minutes INT             NOT NULL DEFAULT 0,
                default_cooloff_minutes INT             NOT NULL DEFAULT 0,
                description             NVARCHAR(500)   NULL,
                is_active               BIT             NOT NULL DEFAULT 1,
                created_at              DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at              DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_booking_packages PRIMARY KEY (package_id),
                CONSTRAINT FK_bp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
                CONSTRAINT CHK_bp_category CHECK (package_category IN ('corporate','social')),
                CONSTRAINT CHK_bp_calc_type CHECK (calc_type IN ('hourly','half_day','full_day','fixed_session'))
            );
            CREATE INDEX IX_bp_company ON BookingPackages(company_id, is_active);
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_id')
            ALTER TABLE Bookings ADD package_id INT NULL;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_bookings_package')
            ALTER TABLE Bookings ADD CONSTRAINT FK_bookings_package FOREIGN KEY (package_id) REFERENCES BookingPackages(package_id);
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_overtime_rate')
            ALTER TABLE Bookings ADD package_overtime_rate DECIMAL(10,2) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_max_extension_hours')
            ALTER TABLE Bookings ADD package_max_extension_hours DECIMAL(5,2) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_base_price')
            ALTER TABLE Bookings ADD package_base_price DECIMAL(12,2) NULL;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'deleted_at')
            ALTER TABLE BookingPackages ADD deleted_at DATETIME2 NULL;
    `);
    ok('Booking packages table + Bookings.package_id ensured.');

    // ── 3k. Owner overrides: block_type on HallBlockedDates ──────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('HallBlockedDates') AND name = 'block_type')
        BEGIN
            ALTER TABLE HallBlockedDates ADD block_type NVARCHAR(30) NOT NULL DEFAULT 'maintenance';
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_block_type')
        BEGIN
            ALTER TABLE HallBlockedDates ADD CONSTRAINT CHK_block_type
                CHECK (block_type IN ('maintenance', 'vip_hold', 'emergency_closure', 'blackout'));
        END
    `);
    ok('Owner override (block_type) column ensured.');

    // ── 3l. Sales pipeline: Leads table ───────────────────────────────────────
    await pool.request().batch(`
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
    `);
    ok('Leads (sales pipeline) table ensured.');

    // ── 3m. Seed leads:* permissions ──────────────────────────────────────────
    const leadPerms = [
        ['leads', 'read',   'leads:read',   'View sales pipeline / leads'],
        ['leads', 'create', 'leads:create', 'Create leads / inquiries'],
        ['leads', 'update', 'leads:update', 'Edit leads, advance pipeline stage'],
    ];
    for (const [module_, action, key, desc] of leadPerms) {
        await pool.request()
            .input('module', sql.NVarChar, module_)
            .input('action', sql.NVarChar, action)
            .input('key', sql.NVarChar, key)
            .input('desc', sql.NVarChar, desc)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = @key)
                INSERT INTO Permissions (module, action, permission_key, description)
                VALUES (@module, @action, @key, @desc);
            `);
    }
    // Grant to Business Owner (6) and Sales Manager (8)
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id
        FROM Permissions p
        CROSS JOIN (SELECT 6 AS role_id UNION SELECT 8) r
        WHERE p.permission_key IN ('leads:read','leads:create','leads:update')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
          );
    `);
    ok('Sales pipeline permissions ensured.');

    // ── 3n. Marketing Automation: MarketingCommunications table ──────────────
    await pool.request().batch(`
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
    `);
    ok('Marketing communications table ensured.');

    // ── 3o. Seed marketing:* permissions ─────────────────────────────────────
    const marketingPerms = [
        ['marketing', 'read', 'marketing:read', 'View marketing communication history'],
        ['marketing', 'send', 'marketing:send', 'Send promotional campaigns to leads/customers'],
    ];
    for (const [module_, action, key, desc] of marketingPerms) {
        await pool.request()
            .input('module', sql.NVarChar, module_)
            .input('action', sql.NVarChar, action)
            .input('key', sql.NVarChar, key)
            .input('desc', sql.NVarChar, desc)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = @key)
                INSERT INTO Permissions (module, action, permission_key, description)
                VALUES (@module, @action, @key, @desc);
            `);
    }
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id
        FROM Permissions p
        CROSS JOIN (SELECT 6 AS role_id UNION SELECT 8) r
        WHERE p.permission_key IN ('marketing:read','marketing:send')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
          );
    `);
    ok('Marketing automation permissions ensured.');

    // ── 3p. Master Menu: CateringPackageItems (packages reference MenuItems) ──
    await pool.request().batch(`
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
    `);
    ok('Master Menu (CateringPackageItems) table ensured.');

    // ── 3p2. Decorations catalog — cloned from the Resources/BookingResources
    // pattern (not Catering) since decoration items are finite, quantity-bound
    // stock exactly like inventory, not a per-plate calculation. Categories are
    // a real lookup table (not a CHECK constraint like Resources.category) so
    // admins can add their own, per spec. ─────────────────────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DecorationCategories')
        BEGIN
            CREATE TABLE DecorationCategories (
                category_id     INT             NOT NULL IDENTITY(1,1),
                company_id      INT             NOT NULL,
                category_name   NVARCHAR(100)   NOT NULL,
                sort_order      INT             NOT NULL DEFAULT 0,
                is_active       BIT             NOT NULL DEFAULT 1,
                created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_decoration_categories PRIMARY KEY (category_id),
                CONSTRAINT FK_dc_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
                CONSTRAINT UQ_dc_company_name UNIQUE (company_id, category_name)
            );
        END
    `);
    ok('DecorationCategories table ensured.');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DecorationItems')
        BEGIN
            CREATE TABLE DecorationItems (
                decoration_id       INT             NOT NULL IDENTITY(1,1),
                company_id          INT             NOT NULL,
                category_id         INT             NULL,
                decoration_code     NVARCHAR(20)    NOT NULL,
                decoration_name     NVARCHAR(200)   NOT NULL,
                description         NVARCHAR(500)   NULL,
                theme               NVARCHAR(100)   NULL,
                color_scheme        NVARCHAR(100)   NULL,
                vendor              NVARCHAR(150)   NULL,
                unit                NVARCHAR(20)    NOT NULL DEFAULT 'piece',
                quantity_available  INT             NOT NULL DEFAULT 0,
                unit_cost           DECIMAL(12,2)   NOT NULL DEFAULT 0,
                rental_price        DECIMAL(12,2)   NOT NULL DEFAULT 0,
                installation_cost   DECIMAL(12,2)   NOT NULL DEFAULT 0,
                removal_cost        DECIMAL(12,2)   NOT NULL DEFAULT 0,
                tax_percent         DECIMAL(5,2)    NOT NULL DEFAULT 0,
                discount_percent    DECIMAL(5,2)    NOT NULL DEFAULT 0,
                images              NVARCHAR(MAX)   NULL, -- JSON array of image URLs
                notes               NVARCHAR(500)   NULL,
                is_active           BIT             NOT NULL DEFAULT 1,
                created_by          INT             NULL,
                created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_decoration_items PRIMARY KEY (decoration_id),
                CONSTRAINT FK_di_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
                CONSTRAINT FK_di_category FOREIGN KEY (category_id) REFERENCES DecorationCategories(category_id),
                CONSTRAINT UQ_di_company_code UNIQUE (company_id, decoration_code)
            );
            CREATE INDEX IX_di_company ON DecorationItems(company_id, is_active);
        END
    `);
    ok('DecorationItems table ensured.');

    // Quantity Reserved/Allocated (per spec) are deliberately NOT stored columns
    // here — they're derived live from BookingDecorations the same way
    // Resources.getInventorySnapshot() computes reserved/available for a given
    // date, so they can never drift out of sync with actual allocations.
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DecorationPackages')
        BEGIN
            CREATE TABLE DecorationPackages (
                package_id      INT             NOT NULL IDENTITY(1,1),
                company_id      INT             NOT NULL,
                package_name    NVARCHAR(200)   NOT NULL,
                package_type    NVARCHAR(50)    NULL, -- e.g. Classic Wedding, Royal Wedding, Corporate...
                description     NVARCHAR(MAX)   NULL,
                flat_price      DECIMAL(12,2)   NULL, -- NULL = computed live from linked items; set = admin override ("Save as Template" price)
                is_active       BIT             NOT NULL DEFAULT 1,
                created_by      INT             NULL,
                created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_decoration_packages PRIMARY KEY (package_id),
                CONSTRAINT FK_dp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
            );
        END
    `);
    ok('DecorationPackages table ensured.');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DecorationPackageItems')
        BEGIN
            CREATE TABLE DecorationPackageItems (
                package_item_id     INT             NOT NULL IDENTITY(1,1),
                package_id          INT             NOT NULL,
                decoration_id       INT             NOT NULL,
                quantity            INT             NOT NULL DEFAULT 1,
                created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_dpi PRIMARY KEY (package_item_id),
                CONSTRAINT FK_dpi_package FOREIGN KEY (package_id) REFERENCES DecorationPackages(package_id),
                CONSTRAINT FK_dpi_item FOREIGN KEY (decoration_id) REFERENCES DecorationItems(decoration_id),
                CONSTRAINT UQ_dpi_package_item UNIQUE (package_id, decoration_id),
                CONSTRAINT CHK_dpi_qty CHECK (quantity > 0)
            );
            CREATE INDEX IX_dpi_package ON DecorationPackageItems(package_id);
        END
    `);
    ok('DecorationPackageItems table ensured.');

    // Allocation table — same shape/semantics as BookingResources (release-on-
    // cancel is implicit via the booking's own status, never an explicit
    // delete; see resource.repository.js and booking.service.js:cancel's
    // comment on why no separate release step exists).
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BookingDecorations')
        BEGIN
            CREATE TABLE BookingDecorations (
                allocation_id       INT             NOT NULL IDENTITY(1,1),
                booking_id          BIGINT          NOT NULL,
                decoration_id       INT             NOT NULL,
                package_id          INT             NULL, -- which package this line came from, if any (traceability only)
                quantity_allocated  INT             NOT NULL,
                installation_at     DATETIME2       NULL,
                removal_at          DATETIME2       NULL,
                notes               NVARCHAR(500)   NULL,
                created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_booking_decorations PRIMARY KEY (allocation_id),
                CONSTRAINT FK_bd_booking     FOREIGN KEY (booking_id)     REFERENCES Bookings(booking_id),
                CONSTRAINT FK_bd_decoration  FOREIGN KEY (decoration_id) REFERENCES DecorationItems(decoration_id),
                CONSTRAINT FK_bd_package     FOREIGN KEY (package_id)     REFERENCES DecorationPackages(package_id),
                CONSTRAINT UQ_bd_booking_decoration UNIQUE (booking_id, decoration_id),
                CONSTRAINT CHK_bd_qty CHECK (quantity_allocated > 0)
            );
            CREATE INDEX IX_bd_decoration ON BookingDecorations(decoration_id, booking_id);
        END
    `);
    ok('BookingDecorations table ensured.');

    // ── 3p2b. BookingServices — Step 7 "Additional Services" (Sound System,
    // Photography, DJ, etc.) with negotiated pricing. catalog_price is the
    // original list price at selection time, frozen forever for audit/
    // comparison; negotiated_price/discount_amount are separately editable,
    // final_price = negotiated_price - discount_amount is what's billed. ────
    await pool.request().batch(`
        IF OBJECT_ID(N'dbo.BookingServices', N'U') IS NULL
        BEGIN
            CREATE TABLE BookingServices (
                booking_service_id  INT             NOT NULL IDENTITY(1,1),
                booking_id          BIGINT          NOT NULL,
                service_key         NVARCHAR(50)    NULL,
                service_name        NVARCHAR(150)   NOT NULL,
                catalog_price       DECIMAL(12,2)   NOT NULL,
                negotiated_price    DECIMAL(12,2)   NOT NULL,
                discount_amount     DECIMAL(12,2)   NOT NULL DEFAULT 0,
                final_price         DECIMAL(12,2)   NOT NULL,
                created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_booking_services PRIMARY KEY (booking_service_id),
                CONSTRAINT FK_bs_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
                CONSTRAINT CHK_bs_final_price CHECK (final_price >= 0)
            );
            CREATE INDEX IX_bs_booking ON BookingServices(booking_id);
        END
    `);
    ok('BookingServices table ensured.');

    // ── 3p3. Seed decorations:* permissions, granted to the same roles as
    // resources:* (Super Admin=1, Company Admin=2, Branch Manager=3, Business
    // Owner=6, Operations Manager=7) — decorations are operational inventory,
    // same audience as the existing Inventory module. ─────────────────────────
    const decorationPerms = [
        ['decorations', 'read',   'decorations:read',   'View decoration items and packages'],
        ['decorations', 'create', 'decorations:create', 'Create decoration items and packages'],
        ['decorations', 'update', 'decorations:update', 'Edit decoration items and packages'],
    ];
    for (const [module_, action, key, desc] of decorationPerms) {
        await pool.request()
            .input('module', sql.NVarChar, module_)
            .input('action', sql.NVarChar, action)
            .input('key', sql.NVarChar, key)
            .input('desc', sql.NVarChar, desc)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = @key)
                INSERT INTO Permissions (module, action, permission_key, description)
                VALUES (@module, @action, @key, @desc);
            `);
    }
    await pool.request().batch(`
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id
        FROM Permissions p
        CROSS JOIN (SELECT 1 AS role_id UNION SELECT 2 UNION SELECT 3 UNION SELECT 6 UNION SELECT 7) r
        WHERE p.permission_key IN ('decorations:read','decorations:create','decorations:update')
          AND NOT EXISTS (
              SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
          );
    `);
    ok('Decorations permissions ensured.');

    // ── 3p4. Seed demo DecorationCategories (needed for DecorationItems FK) ──
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM DecorationCategories WHERE company_id = 1)
        BEGIN
            INSERT INTO DecorationCategories (company_id, category_name, sort_order, is_active) VALUES
                (1, N'Stage Decoration',          1, 1),
                (1, N'Floral Decoration',         2, 1),
                (1, N'Wedding Mandap',             3, 1),
                (1, N'Reception Backdrop',         4, 1),
                (1, N'Entrance Decoration',        5, 1),
                (1, N'Lighting',                   6, 1),
                (1, N'Balloon Decoration',         7, 1),
                (1, N'Theme Decoration',           8, 1),
                (1, N'Ceiling Decoration',         9, 1),
                (1, N'Table Decoration',          10, 1),
                (1, N'Chair Decoration',          11, 1),
                (1, N'Walkway Decoration',        12, 1),
                (1, N'Photo Booth',               13, 1),
                (1, N'LED Wall & Screens',        14, 1),
                (1, N'Signage & Welcome Boards',  15, 1),
                (1, N'Custom Decoration',         16, 1);
        END
    `);
    ok('Demo DecorationCategories seeded.');

    // ── 3p5. Seed demo DecorationItems (one per category, realistic pricing) ──
    // Guarded on the specific demo code (not "any row exists") so ad-hoc
    // items created via the UI/API during testing can't block this from
    // ever seeding the actual demo catalog.
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM DecorationItems WHERE company_id = 1 AND decoration_code = 'DEMO-0001')
        BEGIN
            DECLARE @cat TABLE (category_name NVARCHAR(100), category_id INT);
            INSERT INTO @cat SELECT category_name, category_id FROM DecorationCategories WHERE company_id = 1;

            INSERT INTO DecorationItems
                (company_id, category_id, decoration_code, decoration_name, description, theme, color_scheme,
                 vendor, unit, quantity_available, unit_cost, rental_price, installation_cost, removal_cost,
                 tax_percent, discount_percent, notes, is_active, created_at, updated_at)
            SELECT 1, c.category_id, v.code, v.name, v.description, v.theme, v.color_scheme, v.vendor, v.unit,
                   v.qty, v.unit_cost, v.rental_price, v.install_cost, v.removal_cost, v.tax_pct, 0, NULL, 1,
                   SYSUTCDATETIME(), SYSUTCDATETIME()
            FROM (VALUES
                ('DEMO-0001', N'Grand Stage with LED Backdrop',       N'Elevated stage with programmable LED backdrop panel', N'Royal',        N'Gold & White',   N'Shaan Decorators',    'set',   4, 8000,  25000, 3000, 1500, 18, 'Stage Decoration'),
                ('DEMO-0002', N'Fresh Floral Arch',                   N'Fresh flower entrance/mandap arch',                    N'Classic',      N'Red & White',    N'Bloom Florists',      'piece', 6, 4000,  12000, 1500, 800,  12, 'Floral Decoration'),
                ('DEMO-0003', N'Royal Wedding Mandap',                N'Traditional 4-pillar mandap with drapery',             N'Royal Wedding',N'Maroon & Gold',  N'Shaan Decorators',    'set',   3, 15000, 45000, 5000, 2500, 18, 'Wedding Mandap'),
                ('DEMO-0004', N'Reception Backdrop Panel',            N'Fabric backdrop with couple monogram',                 N'Elegant',      N'Blush Pink',     N'Bloom Florists',      'set',   5, 5000,  18000, 2000, 1000, 12, 'Reception Backdrop'),
                ('DEMO-0005', N'Grand Entrance Floral Gate',          N'Walk-through floral entrance gate',                    N'Classic',      N'White & Green',  N'Bloom Florists',      'set',   4, 6000,  20000, 2500, 1200, 12, 'Entrance Decoration'),
                ('DEMO-0006', N'Warm White Fairy Light Curtain',      N'10x10 ft LED fairy light curtain backdrop',            N'Modern',       N'Warm White',     N'GlowTech Lighting',   'set',   10, 1500, 5000,  500,  300,  18, 'Lighting'),
                ('DEMO-0007', N'Balloon Arch (100 balloons)',         N'Custom colour balloon arch',                           N'Festive',      N'Pastel Mix',     N'Party Bazaar',        'set',   8, 1200,  4000,  600,  300,  12, 'Balloon Decoration'),
                ('DEMO-0008', N'Bollywood Theme Set',                 N'Cutouts, props and backdrop for Bollywood theme',      N'Bollywood',    N'Multicolour',    N'Party Bazaar',        'set',   3, 7000,  22000, 3000, 1500, 18, 'Theme Decoration'),
                ('DEMO-0009', N'Draped Ceiling Canopy',                N'Fabric ceiling drape for indoor halls',                N'Elegant',      N'Ivory',          N'Shaan Decorators',    'set',   4, 6000,  18000, 3500, 1800, 18, 'Ceiling Decoration'),
                ('DEMO-0010', N'Floral Table Centerpiece',            N'Fresh flower centerpiece per table',                   N'Classic',      N'Seasonal Mix',   N'Bloom Florists',      'piece', 40, 400,  1200,  0,    0,    12, 'Table Decoration'),
                ('DEMO-0011', N'Chiavari Chair Sash & Cover',         N'Chair cover with satin sash',                          N'Elegant',      N'Gold',           N'Party Bazaar',        'piece', 300, 40,   150,   0,    0,    12, 'Chair Decoration'),
                ('DEMO-0012', N'Petal & Lantern Walkway',              N'Rose petal path with hanging lanterns',                N'Romantic',     N'Red & Gold',     N'Bloom Florists',      'set',   3, 5000,  15000, 2000, 1000, 12, 'Walkway Decoration'),
                ('DEMO-0013', N'Photo Booth with Props',              N'Branded backdrop, frame and prop kit',                 N'Fun',          N'Multicolour',    N'Party Bazaar',        'set',   3, 6000,  20000, 1500, 800,  18, 'Photo Booth'),
                ('DEMO-0014', N'LED Video Wall 10x8ft',               N'Rental LED screen with operator',                      N'Modern',       N'—',              N'GlowTech Lighting',   'set',   2, 25000, 60000, 5000, 3000, 18, 'LED Wall & Screens'),
                ('DEMO-0015', N'Personalised Welcome Signage',        N'Standee welcome board with names',                     N'Elegant',      N'Gold & White',   N'Shaan Decorators',    'piece', 5, 1500,  4500,  0,    0,    18, 'Signage & Welcome Boards')
            ) AS v(code, name, description, theme, color_scheme, vendor, unit, qty, unit_cost, rental_price, install_cost, removal_cost, tax_pct, category_name)
            JOIN @cat c ON c.category_name = v.category_name;
        END
    `);
    ok('Demo DecorationItems seeded.');

    // ── 3p6. Seed demo DecorationPackages + link items (per the module spec's
    // example package list — a representative subset, not all twelve) ──────
    await pool.request().batch(`
        IF NOT EXISTS (
            SELECT 1 FROM DecorationPackageItems dpi
            JOIN DecorationItems di ON di.decoration_id = dpi.decoration_id
            WHERE di.decoration_code = 'DEMO-0001'
        )
        BEGIN
            INSERT INTO DecorationPackages (company_id, package_name, package_type, description, flat_price, is_active, created_at, updated_at) VALUES
                (1, N'Classic Wedding',      N'Wedding',      N'Floral arch, mandap, reception backdrop and table centerpieces', NULL, 1, SYSUTCDATETIME(), SYSUTCDATETIME()),
                (1, N'Royal Wedding',        N'Wedding',      N'Grand stage, royal mandap, ceiling canopy and premium lighting',  NULL, 1, SYSUTCDATETIME(), SYSUTCDATETIME()),
                (1, N'Birthday Party',       N'Birthday',     N'Balloon arch, theme set and photo booth',                         NULL, 1, SYSUTCDATETIME(), SYSUTCDATETIME()),
                (1, N'Corporate Conference', N'Corporate',    N'LED video wall and welcome signage',                              NULL, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
        END
    `);
    await pool.request().batch(`
        IF NOT EXISTS (
            SELECT 1 FROM DecorationPackageItems dpi
            JOIN DecorationItems di ON di.decoration_id = dpi.decoration_id
            WHERE di.decoration_code = 'DEMO-0001'
        )
        BEGIN
            -- Only the just-inserted demo packages (created_at within the last
            -- minute) — excludes any older same-named package a tenant may
            -- have created independently, so this never links demo items onto
            -- an unrelated package that merely happens to share a name.
            DECLARE @pkg TABLE (package_name NVARCHAR(200), package_id INT);
            INSERT INTO @pkg SELECT package_name, package_id FROM DecorationPackages
                WHERE company_id = 1 AND created_at >= DATEADD(MINUTE, -1, SYSUTCDATETIME());
            DECLARE @item TABLE (decoration_code NVARCHAR(20), decoration_id INT);
            INSERT INTO @item SELECT decoration_code, decoration_id FROM DecorationItems WHERE company_id = 1;

            INSERT INTO DecorationPackageItems (package_id, decoration_id, quantity, created_at)
            SELECT p.package_id, i.decoration_id, v.qty, SYSUTCDATETIME()
            FROM (VALUES
                (N'Classic Wedding',      N'DEMO-0002', 1),
                (N'Classic Wedding',      N'DEMO-0003', 1),
                (N'Classic Wedding',      N'DEMO-0004', 1),
                (N'Classic Wedding',      N'DEMO-0010', 20),
                (N'Royal Wedding',        N'DEMO-0001', 1),
                (N'Royal Wedding',        N'DEMO-0003', 1),
                (N'Royal Wedding',        N'DEMO-0009', 1),
                (N'Royal Wedding',        N'DEMO-0006', 2),
                (N'Birthday Party',       N'DEMO-0007', 2),
                (N'Birthday Party',       N'DEMO-0008', 1),
                (N'Birthday Party',       N'DEMO-0013', 1),
                (N'Corporate Conference', N'DEMO-0014', 1),
                (N'Corporate Conference', N'DEMO-0015', 1)
            ) AS v(package_name, decoration_code, qty)
            JOIN @pkg p ON p.package_name = v.package_name
            JOIN @item i ON i.decoration_code = v.decoration_code;
        END
    `);
    ok('Demo DecorationPackages seeded and linked to items.');

    // ── 3q. Structured inventory: extend Resources with category/supplier/cost ─
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'category')
            ALTER TABLE Resources ADD category NVARCHAR(30) NOT NULL DEFAULT 'custom';
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'supplier')
            ALTER TABLE Resources ADD supplier NVARCHAR(150) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'cost_price')
            ALTER TABLE Resources ADD cost_price DECIMAL(12,2) NOT NULL DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'is_billable')
            -- Inventory pricing strategy: OFF by default (internal operational cost, matching
            -- current/prior behavior for every existing item). A manager can opt individual
            -- premium/consumable items into being billed to the customer — see inventory/index.html.
            ALTER TABLE Resources ADD is_billable BIT NOT NULL DEFAULT 0;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_resource_category')
        BEGIN
            ALTER TABLE Resources ADD CONSTRAINT CHK_resource_category
                CHECK (category IN ('furniture','decor','lighting','audio','visual','signage','custom'));
        END
    `);
    ok('Structured inventory columns ensured.');

    // ── 3q1b. HSN/SAC code + tax fields for Resources (inventory), BookingPackages
    // (services), DecorationItems (goods) and QuotationItems (traceability) —
    // replaces the hardcoded 18% GST assumption with configurable per-item tax. ─
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'hsn_sac_code')
            ALTER TABLE Resources ADD hsn_sac_code NVARCHAR(15) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'tax_type')
            ALTER TABLE Resources ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_res_tax_type CHECK (tax_type IN ('hsn','sac'));
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'tax_percent')
            ALTER TABLE Resources ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'hsn_sac_code')
            ALTER TABLE BookingPackages ADD hsn_sac_code NVARCHAR(15) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'tax_type')
            ALTER TABLE BookingPackages ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'sac' CONSTRAINT CHK_bp_tax_type CHECK (tax_type IN ('hsn','sac'));
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'tax_percent')
            ALTER TABLE BookingPackages ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
    `);
    if ((await pool.request().query(`SELECT 1 AS x WHERE OBJECT_ID('dbo.DecorationItems', 'U') IS NOT NULL`)).recordset.length) {
        await pool.request().batch(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DecorationItems') AND name = 'hsn_sac_code')
                ALTER TABLE DecorationItems ADD hsn_sac_code NVARCHAR(15) NULL;
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DecorationItems') AND name = 'tax_type')
                ALTER TABLE DecorationItems ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_di_tax_type CHECK (tax_type IN ('hsn','sac'));
        `);
    }
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('QuotationItems') AND name = 'hsn_sac_code')
            ALTER TABLE QuotationItems ADD hsn_sac_code NVARCHAR(15) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('QuotationItems') AND name = 'tax_type')
            ALTER TABLE QuotationItems ADD tax_type NVARCHAR(10) NULL CONSTRAINT CHK_qi_tax_type CHECK (tax_type IN ('hsn','sac') OR tax_type IS NULL);
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Invoices') AND name = 'hsn_sac_breakdown')
            ALTER TABLE Invoices ADD hsn_sac_breakdown NVARCHAR(MAX) NULL;
    `);
    ok('HSN/SAC + tax_percent columns ensured on Resources, BookingPackages, DecorationItems, QuotationItems, Invoices.');

    // ── 3q2. User registration approval workflow ──────────────────────────────
    // Separate from is_active (which stays the "disabled" toggle for already-
    // approved accounts) — default 'approved' so every existing user is
    // unaffected; self-registered users are inserted with 'pending' explicitly.
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'approval_status')
            ALTER TABLE Users ADD approval_status NVARCHAR(20) NOT NULL DEFAULT 'approved';
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_user_approval_status')
        BEGIN
            ALTER TABLE Users ADD CONSTRAINT CHK_user_approval_status
                CHECK (approval_status IN ('pending','approved','rejected'));
        END
    `);
    ok('User registration approval_status column ensured.');

    // ── 3q3. Staff profile fields — Users are staff when given an operational
    // role (no separate Staff table). "Current Assignment"/"Weekly Schedule"
    // are deliberately NOT stored — derived live from BookingStaffAssignments/
    // Bookings so they never drift out of sync with actual assignments. ──────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'employee_code')
            ALTER TABLE Users ADD employee_code NVARCHAR(20) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'department')
            ALTER TABLE Users ADD department NVARCHAR(50) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'designation')
            ALTER TABLE Users ADD designation NVARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'property_id')
            ALTER TABLE Users ADD property_id INT NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'availability_status')
            ALTER TABLE Users ADD availability_status NVARCHAR(20) NOT NULL DEFAULT 'available';
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'employment_status')
            ALTER TABLE Users ADD employment_status NVARCHAR(20) NOT NULL DEFAULT 'active';
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'joining_date')
            ALTER TABLE Users ADD joining_date DATE NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'skills')
            ALTER TABLE Users ADD skills NVARCHAR(500) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'certifications')
            ALTER TABLE Users ADD certifications NVARCHAR(500) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'emergency_contact_name')
            ALTER TABLE Users ADD emergency_contact_name NVARCHAR(150) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'emergency_contact_phone')
            ALTER TABLE Users ADD emergency_contact_phone NVARCHAR(20) NULL;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_users_employee_code')
            CREATE UNIQUE INDEX UQ_users_employee_code ON Users(company_id, employee_code) WHERE employee_code IS NOT NULL;
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_users_property')
            ALTER TABLE Users ADD CONSTRAINT FK_users_property FOREIGN KEY (property_id) REFERENCES Banquets(banquet_id);
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_users_availability_status')
            ALTER TABLE Users ADD CONSTRAINT CHK_users_availability_status
                CHECK (availability_status IN ('available','on_duty','on_leave','off_duty'));
    `);
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_users_employment_status')
            ALTER TABLE Users ADD CONSTRAINT CHK_users_employment_status
                CHECK (employment_status IN ('active','on_leave','resigned','terminated'));
    `);
    ok('Staff profile columns ensured on Users.');

    // ── 3r. Configurable Operational Charges ──────────────────────────────────
    await pool.request().batch(`
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
    `);
    ok('Operational charge config table ensured.');

    // ── Missing indexes on Invoices — every list/lookup query filters by
    // company_id and/or booking_id, but the table only had PK + unique
    // invoice_number (found during a full application audit). ──
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_company_date')
            CREATE INDEX IX_invoices_company_date ON Invoices(company_id, invoice_date);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_booking')
            CREATE INDEX IX_invoices_booking ON Invoices(booking_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Invoices') AND name = 'IX_invoices_customer')
            CREATE INDEX IX_invoices_customer ON Invoices(customer_id);
    `);
    ok('Invoices indexes ensured.');

    // ── 3s. Command Center: staff assignment per booking ─────────────────────
    await pool.request().batch(`
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
    `);
    ok('Booking staff assignments table ensured.');

    // ── 4. Seed reference / lookup data ─────────────────────────────────────
    log('Seeding reference data …');

    // Helper: MERGE-based "insert if not exists" for seed rows with explicit IDs.
    const insertIfNotExists = async (table, idCol, rowsSql) => {
        await pool.request().batch(`
            SET IDENTITY_INSERT ${table} ON;
            MERGE INTO ${table} AS target
            USING (VALUES ${rowsSql}) AS src(${idCol})
            ON target.${idCol} = src.${idCol}
            WHEN NOT MATCHED THEN
                INSERT DEFAULT VALUES;
            SET IDENTITY_INSERT ${table} OFF;
        `);
    };

    // States
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM States WHERE state_id = 1)
        BEGIN
            SET IDENTITY_INSERT States ON;
            INSERT INTO States (state_id, country_id, state_name, state_code) VALUES
                (1, 1, N'Maharashtra', 'MH'),
                (2, 1, N'Delhi', 'DL'),
                (3, 1, N'Karnataka', 'KA'),
                (4, 1, N'Tamil Nadu', 'TN'),
                (5, 1, N'Gujarat', 'GJ'),
                (6, 1, N'Rajasthan', 'RJ'),
                (7, 1, N'Uttar Pradesh', 'UP'),
                (8, 1, N'Telangana', 'TS');
            SET IDENTITY_INSERT States OFF;
        END
    `);

    // Cities
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Cities WHERE city_id = 1)
        BEGIN
            SET IDENTITY_INSERT Cities ON;
            INSERT INTO Cities (city_id, state_id, city_name) VALUES
                (1,  1, N'Mumbai'),  (2,  1, N'Pune'),      (3,  1, N'Nagpur'),
                (4,  2, N'New Delhi'),(5,  2, N'Noida'),    (6,  2, N'Gurugram'),
                (7,  3, N'Bengaluru'),(8,  3, N'Mysuru'),
                (9,  4, N'Chennai'), (10, 4, N'Coimbatore'),
                (11, 5, N'Ahmedabad'),(12, 5, N'Surat'),
                (13, 6, N'Jaipur'),  (14, 6, N'Udaipur'),
                (15, 7, N'Lucknow'), (16, 7, N'Agra'),
                (17, 8, N'Hyderabad'),(18, 8, N'Warangal');
            SET IDENTITY_INSERT Cities OFF;
        END
    `);

    // Permissions
    // NOTE: this must be idempotent per-row, NOT gated on "table is empty" —
    // the catering/leads/marketing permission patches above (3g/3m/3o) insert
    // into this same table earlier in the script, so an empty-table guard here
    // would silently skip this entire canonical list on every fresh install
    // (found during a full application audit: role_id=2 had only 8 permissions
    // total instead of the ~45 below, because this block never ran).
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'dashboard:read')
        BEGIN
            INSERT INTO Permissions (module, action, permission_key, description) VALUES
                ('dashboard',    'read',   'dashboard:read',    N'View dashboard and KPIs'),
                ('companies',    'create', 'companies:create',  N'Create new company'),
                ('companies',    'read',   'companies:read',    N'View companies'),
                ('companies',    'update', 'companies:update',  N'Update company details'),
                ('companies',    'delete', 'companies:delete',  N'Delete company'),
                ('branches',     'create', 'branches:create',   N'Create branch'),
                ('branches',     'read',   'branches:read',     N'View branches'),
                ('branches',     'update', 'branches:update',   N'Update branch'),
                ('branches',     'delete', 'branches:delete',   N'Delete branch'),
                ('banquets',     'create', 'banquets:create',   N'Create banquet hall'),
                ('banquets',     'read',   'banquets:read',     N'View banquet halls'),
                ('banquets',     'update', 'banquets:update',   N'Update banquet details'),
                ('banquets',     'delete', 'banquets:delete',   N'Delete banquet'),
                ('halls',        'create', 'halls:create',      N'Create hall'),
                ('halls',        'read',   'halls:read',        N'View halls'),
                ('halls',        'update', 'halls:update',      N'Update hall'),
                ('halls',        'delete', 'halls:delete',      N'Delete hall'),
                ('bookings',     'create', 'bookings:create',   N'Create new booking'),
                ('bookings',     'read',   'bookings:read',     N'View bookings'),
                ('bookings',     'update', 'bookings:update',   N'Modify booking'),
                ('bookings',     'cancel', 'bookings:cancel',   N'Cancel booking'),
                ('bookings',     'confirm','bookings:confirm',  N'Confirm booking'),
                ('customers',    'create', 'customers:create',  N'Add customer'),
                ('customers',    'read',   'customers:read',    N'View customers'),
                ('customers',    'update', 'customers:update',  N'Edit customer'),
                ('customers',    'delete', 'customers:delete',  N'Delete customer'),
                ('payments',     'create', 'payments:create',   N'Record payment'),
                ('payments',     'read',   'payments:read',     N'View payments'),
                ('payments',     'refund', 'payments:refund',   N'Process refund'),
                ('invoices',     'create', 'invoices:create',   N'Generate invoice'),
                ('invoices',     'read',   'invoices:read',     N'View invoices'),
                ('invoices',     'send',   'invoices:send',     N'Email invoice to customer'),
                ('reports',      'read',   'reports:read',      N'View reports'),
                ('reports',      'export', 'reports:export',    N'Export reports (PDF/Excel)'),
                ('pricing',      'create', 'pricing:create',    N'Create pricing rules'),
                ('pricing',      'read',   'pricing:read',      N'View pricing'),
                ('pricing',      'update', 'pricing:update',    N'Update pricing'),
                ('users',        'create', 'users:create',      N'Add user'),
                ('users',        'read',   'users:read',        N'View users'),
                ('users',        'update', 'users:update',      N'Edit user'),
                ('users',        'delete', 'users:delete',      N'Deactivate user'),
                ('settings',     'read',   'settings:read',     N'View settings'),
                ('settings',     'update', 'settings:update',   N'Update settings'),
                ('audit_logs',   'read',   'audit_logs:read',   N'View audit trail'),
                ('coupons',      'create', 'coupons:create',    N'Create coupons'),
                ('coupons',      'read',   'coupons:read',      N'View coupons'),
                ('coupons',      'update', 'coupons:update',    N'Edit coupons'),
                ('availability', 'manage', 'availability:manage',N'Block/unblock dates'),
                ('availability', 'read',   'availability:read', N'View availability calendar'),
                ('resources',    'create', 'resources:create',  N'Add resource/inventory'),
                ('resources',    'read',   'resources:read',    N'View resources'),
                ('resources',    'update', 'resources:update',  N'Update resources');
        END
    `);

    // Role → Permission mappings
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 1)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 1, permission_id FROM Permissions;
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 2)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 2, permission_id FROM Permissions
        WHERE permission_key NOT IN ('companies:create','companies:delete','audit_logs:read');
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 3)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 3, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'reports:read','reports:export','pricing:read',
            'availability:manage','availability:read',
            'resources:create','resources:read','resources:update',
            'settings:read'
        );
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 4)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 4, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'availability:read','coupons:read'
        );
    `);

    // Business Owner (role 6): everything except platform-level admin actions
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 6)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 6, permission_id FROM Permissions
        WHERE permission_key NOT IN ('companies:create','companies:delete','audit_logs:read');
    `);

    // Operations Manager (role 7): daily ops — bookings, scheduling, occupancy, resources
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 7)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 7, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
            'customers:read','customers:update',
            'availability:manage','availability:read',
            'resources:create','resources:read','resources:update',
            'reports:read'
        );
    `);

    // Sales Manager (role 8): inquiries, quotations, follow-ups, campaigns, customers
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 8)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 8, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update',
            'customers:create','customers:read','customers:update',
            'coupons:create','coupons:read','coupons:update',
            'availability:read','reports:read'
        );
    `);

    // Finance Manager (role 9): invoices, payments, refunds, taxes, deposits
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 9)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 9, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','bookings:read',
            'payments:create','payments:read','payments:refund',
            'invoices:create','invoices:read','invoices:send',
            'reports:read','reports:export'
        );
    `);

    // Staff (role 10): read-only operational dashboard
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 10)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 10, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','bookings:read','banquets:read','halls:read','availability:read'
        );
    `);

    // Receptionist (role 11): create inquiry/booking, edit customers — no cancel/delete
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 11)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 11, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update',
            'customers:create','customers:read','customers:update',
            'availability:read'
        );
    `);

    // Event types
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM EventTypes WHERE event_type_id = 1)
        BEGIN
            SET IDENTITY_INSERT EventTypes ON;
            INSERT INTO EventTypes (event_type_id, type_name, type_slug, sort_order) VALUES
                (1,  N'Wedding',         'wedding',         1),
                (2,  N'Reception',       'reception',       2),
                (3,  N'Birthday Party',  'birthday',        3),
                (4,  N'Corporate Event', 'corporate',       4),
                (5,  N'Conference',      'conference',      5),
                (6,  N'Anniversary',     'anniversary',     6),
                (7,  N'Engagement',      'engagement',      7),
                (8,  N'Baby Shower',     'baby_shower',     8),
                (9,  N'Religious Event', 'religious',       9),
                (10, N'Private Party',   'private_party',   10);
            SET IDENTITY_INSERT EventTypes OFF;
        END
    `);

    // Amenity types
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM AmenityTypes WHERE amenity_type_id = 1)
        BEGIN
            SET IDENTITY_INSERT AmenityTypes ON;
            INSERT INTO AmenityTypes (amenity_type_id, amenity_name, category, is_active) VALUES
                (1,  N'Air Conditioning',   'comfort',     1),
                (2,  N'Power Backup',       'utilities',   1),
                (3,  N'Parking',            'facilities',  1),
                (4,  N'Catering Kitchen',   'catering',    1),
                (5,  N'Stage',              'events',      1),
                (6,  N'Bridal Room',        'rooms',       1),
                (7,  N'Green Room',         'rooms',       1),
                (8,  N'Valet Parking',      'facilities',  1),
                (9,  N'WiFi',               'utilities',   1),
                (10, N'Audio/Visual System','events',      1);
            SET IDENTITY_INSERT AmenityTypes OFF;
        END
    `);

    ok('Reference data seeded.');
    ok('Demo company and branch created.');

    // ── 6. Super Admin user ──────────────────────────────────────────────────
    log('Creating Super Admin account …');
    const SUPER_ADMIN_EMAIL    = 'superadmin@banquetpro.com';
    const SUPER_ADMIN_PASSWORD = 'Admin@123456';
    const SALT_ROUNDS = 12;

    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);

    await pool.request()
        .input('email', sql.NVarChar, SUPER_ADMIN_EMAIL)
        .input('passwordHash', sql.NVarChar, passwordHash)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM Users WHERE user_id = 1)
            BEGIN
                SET IDENTITY_INSERT Users ON;
                INSERT INTO Users
                    (user_id, company_id, branch_id, role_id,
                     first_name, last_name, email,
                     password_hash, is_active, is_email_verified, created_at, updated_at)
                VALUES
                    (1, NULL, NULL, 1,
                     N'Super', N'Admin', @email,
                     @passwordHash, 1, 1, GETUTCDATE(), GETUTCDATE());
                SET IDENTITY_INSERT Users OFF;
            END
        `);

    ok('Super Admin account created.');

    // ── 7. Company Admin user ────────────────────────────────────────────────
    log('Creating Company Admin account …');
    const COMPANY_ADMIN_EMAIL    = 'admin@banquetpro.com';
    const COMPANY_ADMIN_PASSWORD = 'Manager@123';
    const caHash = await bcrypt.hash(COMPANY_ADMIN_PASSWORD, SALT_ROUNDS);

    await pool.request()
        .input('email', sql.NVarChar, COMPANY_ADMIN_EMAIL)
        .input('passwordHash', sql.NVarChar, caHash)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM Users WHERE user_id = 2)
            BEGIN
                SET IDENTITY_INSERT Users ON;
                INSERT INTO Users
                    (user_id, company_id, branch_id, role_id,
                     first_name, last_name, email,
                     password_hash, is_active, is_email_verified, created_at, updated_at)
                VALUES
                    (2, 1, 1, 2,
                     N'Rajesh', N'Kumar', @email,
                     @passwordHash, 1, 1, GETUTCDATE(), GETUTCDATE());
                SET IDENTITY_INSERT Users OFF;
            END
        `);

    ok('Company Admin account created.');

    // ── 8. Demo banquet + halls ──────────────────────────────────────────────
    log('Seeding demo banquet and halls …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Banquets WHERE banquet_id = 1)
        BEGIN
            SET IDENTITY_INSERT Banquets ON;
            INSERT INTO Banquets
                (banquet_id, company_id, branch_id, banquet_name, banquet_slug,
                 address_line1, city, state, phone, email,
                 total_capacity, parking_capacity, has_valet, is_active, is_featured)
            VALUES
                (1, 1, 1, N'The Grand Pavilion', 'the-grand-pavilion',
                 N'Plot 42, Linking Road, Bandra West', N'Mumbai', N'Maharashtra',
                 '+91-22-66001234', 'info@grandpavilion.com',
                 2500, 300, 1, 1, 1),
                (2, 1, 1, N'Royal Garden Banquet', 'royal-garden-banquet',
                 N'Sector 17, Vashi, Navi Mumbai', N'Mumbai', N'Maharashtra',
                 '+91-22-77001234', 'info@royalgarden.com',
                 1200, 150, 0, 1, 0);
            SET IDENTITY_INSERT Banquets OFF;
        END
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Halls WHERE hall_id = 1)
        BEGIN
            SET IDENTITY_INSERT Halls ON;
            INSERT INTO Halls
                (hall_id, banquet_id, company_id, branch_id,
                 hall_name, hall_code, capacity, capacity_seated, base_price,
                 weekend_surcharge_pct, has_ac, has_power_backup, has_stage,
                 has_kitchen, has_parking, is_active)
            VALUES
                (1, 1, 1, 1, N'Crystal Ballroom',   'CB-001', 1200, 1000, 150000.00, 15.00, 1, 1, 1, 1, 1, 1),
                (2, 1, 1, 1, N'Diamond Hall',        'DH-001',  600,  500,  85000.00, 10.00, 1, 1, 1, 1, 1, 1),
                (3, 1, 1, 1, N'Pearl Terrace',       'PT-001',  300,  250,  45000.00, 10.00, 1, 1, 0, 0, 1, 1),
                (4, 2, 1, 1, N'Garden Arena',        'GA-001',  800,  700,  75000.00, 12.00, 0, 1, 1, 1, 1, 1),
                (5, 2, 1, 1, N'Conference Suite A',  'CSA-001',  80,   70,  18000.00,  0.00, 1, 1, 0, 0, 0, 1);
            SET IDENTITY_INSERT Halls OFF;
        END
    `);

    ok('Demo banquets and halls seeded.');

    // ── 9. Demo customers ────────────────────────────────────────────────────
    log('Seeding demo customers …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Customers WHERE customer_id = 1)
        BEGIN
            SET IDENTITY_INSERT Customers ON;
            INSERT INTO Customers
                (customer_id, company_id, branch_id, first_name, last_name,
                 email, phone, city, state, source, is_active)
            VALUES
                (1, 1, 1, N'Aditya',   N'Sharma',   'aditya.sharma@email.com',   '+91-9823456789', N'Mumbai',    N'Maharashtra', 'direct',   1),
                (2, 1, 1, N'Priya',    N'Mehta',    'priya.mehta@email.com',     '+91-9812345678', N'Pune',      N'Maharashtra', 'referral', 1),
                (3, 1, 1, N'Rahul',    N'Gupta',    'rahul.gupta@email.com',     '+91-9856781234', N'Mumbai',    N'Maharashtra', 'online',   1),
                (4, 1, 1, N'Sneha',    N'Patel',    'sneha.patel@email.com',     '+91-9845671234', N'Ahmedabad', N'Gujarat',     'direct',   1),
                (5, 1, 1, N'Vikram',   N'Singh',    'vikram.singh@email.com',    '+91-9867453210', N'Mumbai',    N'Maharashtra', 'online',   1),
                (6, 1, 1, N'Kavita',   N'Joshi',    'kavita.joshi@email.com',    '+91-9834567890', N'Nashik',    N'Maharashtra', 'direct',   1),
                (7, 1, 1, N'Manish',   N'Agarwal',  'manish.agarwal@email.com',  '+91-9876543100', N'Mumbai',    N'Maharashtra', 'referral', 1),
                (8, 1, 1, N'Anjali',   N'Nair',     'anjali.nair@email.com',     '+91-9812367890', N'Bengaluru', N'Karnataka',   'online',   1);
            SET IDENTITY_INSERT Customers OFF;
        END
    `);

    ok('Demo customers seeded.');

    // ── 10. Demo bookings ────────────────────────────────────────────────────
    log('Seeding demo bookings …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Bookings WHERE booking_id = 1)
        BEGIN
            SET IDENTITY_INSERT Bookings ON;
            INSERT INTO Bookings
                (booking_id, booking_ref, company_id, branch_id, hall_id, customer_id,
                 event_name, event_type, event_date, event_time_start, event_time_end,
                 guest_count, status, total_amount, advance_paid, amount_paid,
                 created_by, created_at)
            VALUES
                (1,  'BKG-2026-00001', 1, 1, 1, 1, N'Sharma-Mehta Wedding Reception', 'wedding',
                 '2026-08-15', '18:00:00', '23:00:00', 850, 'fully_paid',
                 175000.00, 87500.00, 175000.00, 2, GETUTCDATE()),
                (2,  'BKG-2026-00002', 1, 1, 2, 2, N'Priya Birthday Celebration',    'birthday',
                 '2026-07-20', '19:00:00', '23:00:00', 200, 'confirmed',
                  95000.00, 47500.00, 47500.00, 2, GETUTCDATE()),
                (3,  'BKG-2026-00003', 1, 1, 1, 3, N'Gupta Engagement Ceremony',     'engagement',
                 '2026-08-28', '10:00:00', '15:00:00', 300, 'advance_paid',
                 158500.00, 79250.00, 79250.00, 2, GETUTCDATE()),
                (4,  'BKG-2026-00004', 1, 1, 3, 4, N'TechCorp Annual Meet',          'corporate',
                 '2026-07-25', '09:00:00', '18:00:00', 250, 'confirmed',
                  52000.00, 26000.00, 26000.00, 2, GETUTCDATE()),
                (5,  'BKG-2026-00005', 1, 1, 4, 5, N'Singh-Kapoor Reception',        'reception',
                 '2026-09-05', '18:00:00', '23:00:00', 600, 'confirmed',
                  86000.00, 43000.00, 43000.00, 2, GETUTCDATE()),
                (6,  'BKG-2026-00006', 1, 1, 2, 6, N'Joshi Anniversary Dinner',      'anniversary',
                 '2026-07-10', '20:00:00', '23:00:00', 120, 'completed',
                  97750.00, 97750.00, 97750.00, 2, GETUTCDATE()),
                (7,  'BKG-2026-00007', 1, 1, 5, 7, N'Agarwal Investor Meet',         'conference',
                 '2026-07-18', '10:00:00', '17:00:00',  60, 'completed',
                  18000.00, 18000.00, 18000.00, 2, GETUTCDATE()),
                (8,  'BKG-2026-00008', 1, 1, 1, 8, N'Nair Golden Jubilee',           'anniversary',
                 '2026-10-12', '18:00:00', '23:00:00', 500, 'draft',
                 165000.00, 0.00, 0.00, 2, GETUTCDATE());
            SET IDENTITY_INSERT Bookings OFF;
        END
    `);

    ok('Demo bookings seeded.');

    // ── 11. Demo payments ────────────────────────────────────────────────────
    log('Seeding demo payments …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Payments WHERE payment_id = 1)
        BEGIN
            SET IDENTITY_INSERT Payments ON;
            INSERT INTO Payments
                (payment_id, payment_ref, company_id, booking_id, customer_id,
                 payment_type, payment_method, amount, status, payment_date, created_by, created_at)
            VALUES
                (1,  'PAY-2026-00001', 1, 1, 1, 'advance', 'upi',           87500.00, 'completed', '2026-06-15', 2, GETUTCDATE()),
                (2,  'PAY-2026-00002', 1, 1, 1, 'full',    'bank_transfer',  87500.00, 'completed', '2026-07-01', 2, GETUTCDATE()),
                (3,  'PAY-2026-00003', 1, 2, 2, 'advance', 'cash',           47500.00, 'completed', '2026-06-20', 2, GETUTCDATE()),
                (4,  'PAY-2026-00004', 1, 3, 3, 'advance', 'cheque',         79250.00, 'completed', '2026-06-25', 2, GETUTCDATE()),
                (5,  'PAY-2026-00005', 1, 4, 4, 'advance', 'upi',            26000.00, 'completed', '2026-06-10', 2, GETUTCDATE()),
                (6,  'PAY-2026-00006', 1, 5, 5, 'advance', 'bank_transfer',  43000.00, 'completed', '2026-06-30', 2, GETUTCDATE()),
                (7,  'PAY-2026-00007', 1, 6, 6, 'full',    'upi',            97750.00, 'completed', '2026-07-05', 2, GETUTCDATE()),
                (8,  'PAY-2026-00008', 1, 7, 7, 'full',    'cash',           18000.00, 'completed', '2026-07-15', 2, GETUTCDATE());
            SET IDENTITY_INSERT Payments OFF;
        END
    `);

    ok('Demo payments seeded.');

    // ── 12. Catering packages ────────────────────────────────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM CateringPackages WHERE package_id = 1)
        BEGIN
            SET IDENTITY_INSERT CateringPackages ON;
            INSERT INTO CateringPackages
                (package_id, company_id, package_name, package_type, price_per_plate, min_plates, is_active)
            VALUES
                (1, 1, N'Classic Veg Menu',    'veg',     750.00,  100, 1),
                (2, 1, N'Premium Veg Menu',    'veg',    1100.00,  100, 1),
                (3, 1, N'Non-Veg Standard',    'non_veg',  950.00,  100, 1),
                (4, 1, N'Non-Veg Premium',     'non_veg', 1400.00,  100, 1),
                (5, 1, N'Jain Special Menu',   'jain',     850.00,   50, 1),
                (6, 1, N'Fusion Buffet',       'mixed',   1250.00,  150, 1);
            SET IDENTITY_INSERT CateringPackages OFF;
        END
    `);

    // Resources
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Resources WHERE resource_id = 1)
        BEGIN
            SET IDENTITY_INSERT Resources ON;
            INSERT INTO Resources
                (resource_id, company_id, resource_name, resource_type, category, supplier, unit_price, cost_price, quantity_available, is_active)
            VALUES
                (1, 1, N'PA Sound System',   'audio',      'audio',     N'SoundWave Rentals',    5000.00, 2200.00, 5, 1),
                (2, 1, N'LED Video Wall',    'visual',     'visual',    N'BrightTech Rentals',   15000.00, 7000.00, 2, 1),
                (3, 1, N'Flower Decoration', 'decor',      'decor',     N'Bloom Decorators',     25000.00, 11000.00, 10, 1),
                (4, 1, N'Generator 100KVA',  'power',      'custom',    N'PowerGen Solutions',    8000.00, 3500.00, 3, 1),
                (5, 1, N'Tables (Round)',    'furniture',  'furniture', N'EventFurn Co',           200.00,   80.00, 200, 1),
                (6, 1, N'Chairs (Banquet)',  'furniture',  'furniture', N'EventFurn Co',            50.00,   20.00, 2000, 1),
                (7, 1, N'Projector + Screen','visual',     'visual',    N'BrightTech Rentals',    3500.00, 1500.00, 5, 1),
                (8, 1, N'Photo Booth',       'entertainment','custom',  N'Candid Moments Co',     8000.00, 3200.00, 2, 1);
            SET IDENTITY_INSERT Resources OFF;
        END
        ELSE
        BEGIN
            -- Backfill category/supplier/cost for pre-existing rows from before these columns existed
            UPDATE Resources SET category='audio',     supplier=N'SoundWave Rentals',  cost_price=2200.00  WHERE resource_id=1 AND supplier IS NULL;
            UPDATE Resources SET category='visual',    supplier=N'BrightTech Rentals', cost_price=7000.00  WHERE resource_id=2 AND supplier IS NULL;
            UPDATE Resources SET category='decor',     supplier=N'Bloom Decorators',   cost_price=11000.00 WHERE resource_id=3 AND supplier IS NULL;
            UPDATE Resources SET category='custom',    supplier=N'PowerGen Solutions', cost_price=3500.00  WHERE resource_id=4 AND supplier IS NULL;
            UPDATE Resources SET category='furniture', supplier=N'EventFurn Co',       cost_price=80.00    WHERE resource_id=5 AND supplier IS NULL;
            UPDATE Resources SET category='furniture', supplier=N'EventFurn Co',       cost_price=20.00    WHERE resource_id=6 AND supplier IS NULL;
            UPDATE Resources SET category='visual',    supplier=N'BrightTech Rentals', cost_price=1500.00  WHERE resource_id=7 AND supplier IS NULL;
            UPDATE Resources SET category='custom',    supplier=N'Candid Moments Co',  cost_price=3200.00  WHERE resource_id=8 AND supplier IS NULL;
        END
    `);

    // Company Settings
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM CompanySettings WHERE company_id = 1 AND setting_key = 'currency')
        INSERT INTO CompanySettings (company_id, setting_key, setting_value, setting_group)
        VALUES
            (1, 'currency',         'INR',              'general'),
            (1, 'timezone',         'Asia/Kolkata',     'general'),
            (1, 'date_format',      'DD/MM/YYYY',       'general'),
            (1, 'advance_pct',      '50',               'booking'),
            (1, 'cancellation_hrs', '72',               'booking'),
            (1, 'gst_rate',         '18',               'tax'),
            (1, 'invoice_prefix',   'INV',              'invoice'),
            (1, 'booking_prefix',   'BKG',              'booking');
    `);

    ok('Demo data seeded (catering, resources, settings).');

    // ── 13. Extended demo data: employees, more customers/bookings, payments,
    // invoices, sales pipeline leads, staff assignments — all cross-referencing
    // each other so Invoices/Command Center/Sales Pipeline/Owner Analytics/Users
    // tell one consistent story instead of disconnected demo rows.
    await seedExtendedDemoData(pool);

    // ── Done ─────────────────────────────────────────────────────────────────
    await pool.close();

    console.log('\n=============================================================');
    console.log('  Setup Complete!');
    console.log('=============================================================');
    console.log('');
    console.log('  Database : banquet_booking');
    console.log(`  Host     : ${dbConfig.server}:${dbConfig.port}`);
    console.log('');
    console.log('  Super Admin Account');
    console.log(`  Email    : ${SUPER_ADMIN_EMAIL}`);
    console.log(`  Password : ${SUPER_ADMIN_PASSWORD}`);
    console.log('');
    console.log('  Company Admin Account');
    console.log(`  Email    : ${COMPANY_ADMIN_EMAIL}`);
    console.log(`  Password : ${COMPANY_ADMIN_PASSWORD}`);
    console.log('');
    console.log('  Start Backend  :  cd backend && node server.js');
    console.log('  Frontend       :  Open frontend/src/pages/auth/login.html');
    console.log('  API Health     :  http://localhost:3000/api/v1/health');
    console.log('');

})().catch((err) => {
    console.error('\n[FATAL]', err.message);
    process.exit(1);
});
