# Roles & Permissions Matrix
### Banquet Hall Booking & Management System

**Version:** 1.0.0  
**Last Updated:** 2026-06-30

---

## Role Hierarchy

```
Platform Level
└── Super Admin (SA)            — Full system control. No restrictions.
    │
Tenant Level
    └── Company Admin (CA)      — Controls everything within their company.
        │
Branch Level
        └── Branch Manager (BM) — Controls their branch's daily operations.
            │
Operational Level
            └── Booking Executive (BE) — Creates/manages bookings and customers.
                │
End-User Level
            └── Customer (CU)   — Books halls, manages own profile.
```

---

## Permission Format

All permissions follow `module:action` naming:

```
bookings:create    → Create a new booking
bookings:read      → View booking details
bookings:update    → Modify booking
bookings:cancel    → Cancel booking
bookings:confirm   → Confirm/approve booking
reports:export     → Export reports to PDF/Excel
```

Data scope is enforced at API level:
- **SA** → All companies, all data
- **CA** → Own company only
- **BM** → Own branch only
- **BE** → Own branch, assigned records
- **CU** → Own profile, own bookings only

---

## Full Permission Matrix

| Module | Permission | Super Admin | Company Admin | Branch Manager | Booking Exec | Customer |
|--------|-----------|:-----------:|:-------------:|:--------------:|:------------:|:--------:|
| **Dashboard** | View KPIs & Analytics | ✅ | ✅ | ✅ (branch) | ✅ (limited) | ❌ |
| | View Revenue Reports | ✅ | ✅ | ✅ (branch) | ❌ | ❌ |
| **Companies** | Create Company | ✅ | ❌ | ❌ | ❌ | ❌ |
| | View Companies | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| | Update Company | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| | Delete Company | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Branches** | Create Branch | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Branches | ✅ | ✅ | ✅ (own) | ✅ (own) | ❌ |
| | Update Branch | ✅ | ✅ | ✅ (own) | ❌ | ❌ |
| | Delete Branch | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Banquets** | Create Banquet | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Banquets | ✅ | ✅ | ✅ | ✅ | ✅ (public) |
| | Update Banquet | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Delete Banquet | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Halls** | Create Hall | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Halls | ✅ | ✅ | ✅ | ✅ | ✅ (public) |
| | Update Hall | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Delete Hall | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Block Hall Dates | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Bookings** | Create Booking | ✅ | ✅ | ✅ | ✅ | ✅ (self) |
| | View All Bookings | ✅ | ✅ | ✅ (branch) | ✅ (branch) | ✅ (own) |
| | Update Booking | ✅ | ✅ | ✅ | ✅ | ❌ |
| | Confirm Booking | ✅ | ✅ | ✅ | ✅ | ❌ |
| | Cancel Booking | ✅ | ✅ | ✅ | ✅ | ✅ (own, within policy) |
| | View Draft Bookings | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| **Customers** | Create Customer | ✅ | ✅ | ✅ | ✅ | ✅ (self-register) |
| | View Customers | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| | Update Customer | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| | Delete Customer | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Contact Details | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| **Payments** | Record Payment | ✅ | ✅ | ✅ | ✅ | ❌ |
| | View Payments | ✅ | ✅ | ✅ (branch) | ✅ (branch) | ✅ (own) |
| | Process Refund | ✅ | ✅ | ✅ | ❌ | ❌ |
| | Approve Refund | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Invoices** | Generate Invoice | ✅ | ✅ | ✅ | ✅ | ❌ |
| | View Invoice | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| | Email Invoice | ✅ | ✅ | ✅ | ✅ | ❌ |
| | Download Invoice PDF | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| **Pricing** | Create Pricing Rules | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Pricing | ✅ | ✅ | ✅ | ✅ | ✅ (public rates) |
| | Update Pricing | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Manage Special Pricing | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Coupons** | Create Coupon | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Coupons | ✅ | ✅ | ✅ | ✅ | ❌ |
| | Update/Deactivate | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Apply Coupon | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Reports** | View Revenue Report | ✅ | ✅ | ✅ (branch) | ❌ | ❌ |
| | View Booking Report | ✅ | ✅ | ✅ (branch) | ✅ (limited) | ❌ |
| | View Occupancy Report | ✅ | ✅ | ✅ (branch) | ❌ | ❌ |
| | View Customer Report | ✅ | ✅ | ✅ (branch) | ❌ | ❌ |
| | Export Reports | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Users** | Create User | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Users | ✅ | ✅ | ✅ (branch) | ❌ | ❌ |
| | Update User | ✅ | ✅ | ✅ (branch, lower roles) | ❌ | ✅ (own) |
| | Deactivate User | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Manage Roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Resources** | Add Resource | ✅ | ✅ | ✅ | ❌ | ❌ |
| | View Resources | ✅ | ✅ | ✅ | ✅ | ❌ |
| | Update Resource | ✅ | ✅ | ✅ | ❌ | ❌ |
| | Allocate Resource | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Catering** | Manage Menus | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Manage Packages | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View Menu | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Notifications** | Send Notifications | ✅ | ✅ | ✅ | ❌ | ❌ |
| | View Own Notifications | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Manage Templates | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings** | Company Settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Branch Settings | ✅ | ✅ | ✅ (own) | ❌ | ❌ |
| | Tax Settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Email Templates | ✅ | ✅ | ❌ | ❌ | ❌ |
| | SMS Templates | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Booking Rules | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Audit Logs** | View Audit Trail | ✅ | ❌ | ❌ | ❌ | ❌ |
| | View Own Activity | ✅ | ✅ | ✅ | ✅ | ✅ |
| **System** | Backup / Restore | ✅ | ❌ | ❌ | ❌ | ❌ |
| | System Health | ✅ | ❌ | ❌ | ❌ | ❌ |
| | Manage Subscriptions | ✅ | ❌ | ❌ | ❌ | ❌ |

**Legend:** ✅ = Allowed | ❌ = Denied | (own) = Only own records | (branch) = Branch-scoped only

---

## Customer Portal Capabilities

The Customer role has a dedicated portal with the following features:

| Feature | Available |
|---------|-----------|
| Register / Login | ✅ |
| Browse Banquets & Halls | ✅ |
| Check Hall Availability | ✅ |
| Multi-step Booking Wizard | ✅ |
| Pay Online (future) | ✅ |
| View Booking History | ✅ |
| Download Invoice PDF | ✅ |
| Cancel Booking (within policy) | ✅ |
| Write Review | ✅ (after event) |
| Add to Wishlist | ✅ |
| Update Profile | ✅ |
| Change Password | ✅ |
| Enable 2FA | ✅ |

---

## API Authorization Flow

```
HTTP Request → JWT Middleware → Load user.role → RBAC Check → Execute
```

Middleware implementation:
```javascript
// Middleware: requirePermission('bookings:create')
const requirePermission = (permission) => (req, res, next) => {
    const { user } = req;
    if (!user.permissions.includes(permission)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied: insufficient permissions'
        });
    }
    next();
};
```

Tenant scoping (all repository queries auto-scope):
```javascript
// All queries include company_id filter
WHERE company_id = req.user.company_id
```

---

## Security Notes

1. **Privilege Escalation** — Users cannot assign roles higher than their own
2. **Cross-Tenant** — Company Admin cannot access other companies' data (enforced at DB + API)
3. **Soft Deletes** — Data is never hard-deleted; `is_active = 0` is used
4. **Audit Trail** — All permission-guarded write operations are logged
5. **Token Revocation** — Refresh tokens are stored + can be revoked on logout/security event
