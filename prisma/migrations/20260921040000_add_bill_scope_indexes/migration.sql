-- 账单表索引：按商户号判缺 + 按业务系统（项目）维度查账
-- 背景：主体隔离后同一渠道会挂多个商户号，账单遍历逐个按 (渠道, 商户号) 判缺；
--      同主体多项目共用一个商户号时，账目靠 app_id 拆分，故需要 app_id 维度的索引。
-- 幂等：索引已存在时跳过，可重复执行

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_bill' AND INDEX_NAME = 'idx_bill_date_mch'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE `channel_bill` ADD INDEX `idx_bill_date_mch` (`bill_date`, `channel`, `mch_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_bill' AND INDEX_NAME = 'idx_bill_app_date'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE `channel_bill` ADD INDEX `idx_bill_app_date` (`app_id`, `bill_date`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
