-- 个人收款码（personal_qr 渠道）：无商户号的用户上传自己的收款码即可收款
CREATE TABLE IF NOT EXISTS `personal_qr_code` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` VARCHAR(32) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `image_url` VARCHAR(255) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `idx_qr_app_type` (`app_id`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 历史库补齐：早期由自建 runner 建表的库缺少该列（新库执行时会因已存在而跳过）
SET @qr_has_col := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'merchant_user' AND column_name = 'pay_notify_url'
);
SET @qr_sql := IF(@qr_has_col = 0,
    'ALTER TABLE `merchant_user` ADD COLUMN `pay_notify_url` VARCHAR(256) NULL',
    'DO 0');
PREPARE qr_stmt FROM @qr_sql;
EXECUTE qr_stmt;
DEALLOCATE PREPARE qr_stmt;
