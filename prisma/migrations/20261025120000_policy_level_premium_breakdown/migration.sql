ALTER TABLE "Policy"
  ADD COLUMN "premiumVatAmount" DECIMAL(65,30),
  ADD COLUMN "premiumIssuanceExpenseAmount" DECIMAL(65,30),
  ADD COLUMN "premiumSurchargeAmount" DECIMAL(65,30),
  ADD COLUMN "premiumDiscountAmount" DECIMAL(65,30);
