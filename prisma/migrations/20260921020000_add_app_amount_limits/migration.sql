-- 业务系统：单日 / 单月累计限额（元，0 = 不限）
-- 用途：个人码 / 小微等高风险通道的护栏，超限时拒绝下单并提示升级资质
-- 幂等：列已存在时跳过，可重复执行

SET @exist_day := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_app'
    AND COLUMN_NAME = 'limit_daily'
);

SET @sql := IF(
  @exist_day = 0,
  'ALTER TABLE `merchant_app` ADD COLUMN `limit_daily` DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER `limit_per_order`',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist_month := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_app'
    AND COLUMN_NAME = 'limit_monthly'
);

SET @sql := IF(
  @exist_month = 0,
  'ALTER TABLE `merchant_app` ADD COLUMN `limit_monthly` DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER `limit_daily`',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
