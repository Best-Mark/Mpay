-- 业务系统：到账监控器上报专用 Token（供通知/短信转发类工具调用上报接口）
-- 幂等：重复执行安全（MySQL 8.0.13+ 支持 IF NOT EXISTS 的 ADD COLUMN 判断方式见下）
SET @exist := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_app'
    AND COLUMN_NAME = 'monitor_token'
);

SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `merchant_app` ADD COLUMN `monitor_token` VARCHAR(64) NULL, ADD UNIQUE KEY `uk_monitor_token` (`monitor_token`)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
