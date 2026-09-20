-- 法人主体表 + 通道 / 业务系统的主体与经营类目归属
-- 目的：跨主体收款属二清，用「主体 + 类目」两层归属把误配变成不可能发生
-- 幂等：表 / 列 / 索引已存在时跳过，可重复执行

CREATE TABLE IF NOT EXISTS `legal_entity` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `unified_code` VARCHAR(32) NULL,
  `contact` VARCHAR(64) NULL,
  `remark` VARCHAR(256) NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_unified_code` (`unified_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- channel_config.legal_entity_id ----------
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_config' AND COLUMN_NAME = 'legal_entity_id'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `channel_config` ADD COLUMN `legal_entity_id` BIGINT NULL AFTER `extra`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- channel_config.categories ----------
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_config' AND COLUMN_NAME = 'categories'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `channel_config` ADD COLUMN `categories` JSON NULL AFTER `legal_entity_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- merchant_app.legal_entity_id ----------
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_app' AND COLUMN_NAME = 'legal_entity_id'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `merchant_app` ADD COLUMN `legal_entity_id` BIGINT NULL AFTER `limit_monthly`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- merchant_app.category ----------
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_app' AND COLUMN_NAME = 'category'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `merchant_app` ADD COLUMN `category` VARCHAR(32) NULL AFTER `legal_entity_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 索引（MySQL 不支持 ADD INDEX IF NOT EXISTS，用统计表判断）----------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_config' AND INDEX_NAME = 'idx_channel_entity'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `channel_config` ADD INDEX `idx_channel_entity` (`legal_entity_id`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_app' AND INDEX_NAME = 'idx_app_entity'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `merchant_app` ADD INDEX `idx_app_entity` (`legal_entity_id`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
