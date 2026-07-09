-- Drop schema scaffolding that was never wired to any application code and
-- has zero rows in production: BanquetAmenities, BanquetDocuments,
-- BanquetGallery, CustomerDocuments, HallGallery, HallPricing, PricingSlots,
-- SpecialPricing, TaxConfig, EmailTemplates. Confirmed via a full backend/src
-- grep — no repository/service/controller references any of them; the
-- features they'd support (banquet-level amenities, document uploads,
-- galleries, per-slot/special pricing, tax config, email templates) either
-- don't exist yet or are implemented differently elsewhere (e.g. hall-level
-- amenities via HallAmenities, which stays — it's actively used).
--
-- PricingSlots is dropped before HallPricing since it has an FK to it
-- (FK_slots_pricing). No other table references any of these ten.

IF OBJECT_ID('PricingSlots', 'U') IS NOT NULL DROP TABLE PricingSlots;
IF OBJECT_ID('HallPricing', 'U') IS NOT NULL DROP TABLE HallPricing;
IF OBJECT_ID('BanquetAmenities', 'U') IS NOT NULL DROP TABLE BanquetAmenities;
IF OBJECT_ID('BanquetDocuments', 'U') IS NOT NULL DROP TABLE BanquetDocuments;
IF OBJECT_ID('BanquetGallery', 'U') IS NOT NULL DROP TABLE BanquetGallery;
IF OBJECT_ID('CustomerDocuments', 'U') IS NOT NULL DROP TABLE CustomerDocuments;
IF OBJECT_ID('HallGallery', 'U') IS NOT NULL DROP TABLE HallGallery;
IF OBJECT_ID('SpecialPricing', 'U') IS NOT NULL DROP TABLE SpecialPricing;
IF OBJECT_ID('TaxConfig', 'U') IS NOT NULL DROP TABLE TaxConfig;
IF OBJECT_ID('EmailTemplates', 'U') IS NOT NULL DROP TABLE EmailTemplates;
