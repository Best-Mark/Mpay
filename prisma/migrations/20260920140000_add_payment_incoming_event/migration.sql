-- 个人收款码「监控器」入站到账事件表
-- 幂等：重复执行安全（CREATE TABLE IF NOT EXISTS）
CREATE TABLE IF NOT EXISTS `payment_incoming_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `app_id` VARCHAR(32) NOT NULL,
  `account_type` VARCHAR(16) NOT NULL,
  `amount` DECIMAL(18, 2) NOT NULL,
  `serial` VARCHAR(64) NOT NULL,
  `remark` VARCHAR(64) NULL,
  `payer_account` VARCHAR(64) NULL,
  `paid_at` DATETIME(3) NOT NULL,
  `match_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `pay_order_no` VARCHAR(32) NULL,
  `raw` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_event_app_serial` (`app_id`, `serial`),
  KEY `idx_event_match` (`app_id`, `match_status`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
