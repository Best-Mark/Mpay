-- 运行时配置 / 商户注册 / 邮箱验证码 / 上传文件
-- 设计原则：后台可改的项一律落库，改完即生效，不必重启收单进程

-- 1. 业务系统归属商户账号（自助注册审核通过后绑定）
ALTER TABLE `merchant_app` ADD COLUMN `user_id` BIGINT NULL;
CREATE INDEX `idx_user` ON `merchant_app`(`user_id`);

-- 2. 系统运行时配置
CREATE TABLE `system_config` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `group` VARCHAR(32) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NULL,
    `secret` BOOLEAN NOT NULL DEFAULT false,
    `remark` VARCHAR(128) NULL,
    `updated_by` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `system_config_key_key`(`key`),
    INDEX `idx_group`(`group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. 商户账号
CREATE TABLE `merchant_user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(128) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `company_name` VARCHAR(128) NOT NULL,
    `contact_name` VARCHAR(64) NULL,
    `contact_phone` VARCHAR(32) NULL,
    `website` VARCHAR(255) NULL,
    `pay_notify_url` VARCHAR(256) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `reject_reason` VARCHAR(255) NULL,
    `email_verified_at` DATETIME(3) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reviewer` VARCHAR(64) NULL,
    `last_login_at` DATETIME(3) NULL,
    `last_login_ip` VARCHAR(64) NULL,
    `remark` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_user_email_key`(`email`),
    INDEX `idx_status_created`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. 邮箱验证码
CREATE TABLE `email_verify_code` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(128) NOT NULL,
    `scene` VARCHAR(20) NOT NULL DEFAULT 'REGISTER',
    `code` VARCHAR(8) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expire_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_email_scene`(`email`, `scene`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. 上传文件记录
CREATE TABLE `upload_file` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scene` VARCHAR(20) NOT NULL DEFAULT 'image',
    `original_name` VARCHAR(255) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(64) NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `uploaded_by` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_scene_created`(`scene`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
