-- CreateTable
CREATE TABLE `pay_order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `pay_order_no` VARCHAR(32) NOT NULL,
    `app_id` VARCHAR(32) NOT NULL,
    `merchant_order_no` VARCHAR(64) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `channel_mch_id` VARCHAR(64) NULL,
    `channel_sub_mch_id` VARCHAR(64) NULL,
    `trade_type` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `refunded_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `paid_amount` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `subject` VARCHAR(256) NOT NULL,
    `body` VARCHAR(1024) NULL,
    `attach` VARCHAR(512) NULL,
    `client_ip` VARCHAR(64) NULL,
    `payer_id` VARCHAR(64) NULL,
    `channel_txn_id` VARCHAR(64) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    `paid_at` DATETIME(3) NULL,
    `expire_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `notify_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `notify_count` INTEGER NOT NULL DEFAULT 0,
    `pay_params` JSON NULL,
    `channel_raw` JSON NULL,
    `extra` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_order_pay_order_no_key`(`pay_order_no`),
    INDEX `idx_status_created`(`status`, `created_at`),
    INDEX `idx_channel_txn`(`channel`, `channel_txn_id`),
    INDEX `idx_paid_at`(`paid_at`),
    INDEX `idx_app_created`(`app_id`, `created_at`),
    UNIQUE INDEX `pay_order_app_id_merchant_order_no_key`(`app_id`, `merchant_order_no`),
    UNIQUE INDEX `uk_app_merchant_order`(`app_id`, `merchant_order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `refund_no` VARCHAR(32) NOT NULL,
    `pay_order_no` VARCHAR(32) NOT NULL,
    `app_id` VARCHAR(32) NOT NULL,
    `merchant_refund_no` VARCHAR(64) NOT NULL,
    `merchant_order_no` VARCHAR(64) NULL,
    `channel` VARCHAR(20) NOT NULL,
    `channel_mch_id` VARCHAR(64) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `pay_amount` DECIMAL(18, 2) NOT NULL,
    `reason` VARCHAR(256) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    `channel_refund_id` VARCHAR(64) NULL,
    `channel_refund_status` VARCHAR(32) NULL,
    `funds_account` VARCHAR(32) NULL,
    `refunded_at` DATETIME(3) NULL,
    `notify_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `notify_count` INTEGER NOT NULL DEFAULT 0,
    `fail_reason` VARCHAR(512) NULL,
    `channel_raw` JSON NULL,
    `extra` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refund_order_refund_no_key`(`refund_no`),
    INDEX `idx_pay_order_no`(`pay_order_no`),
    INDEX `idx_status_created`(`status`, `created_at`),
    UNIQUE INDEX `refund_order_app_id_merchant_refund_no_key`(`app_id`, `merchant_refund_no`),
    UNIQUE INDEX `uk_app_merchant_refund`(`app_id`, `merchant_refund_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_config` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `channel` VARCHAR(20) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `mch_id` VARCHAR(64) NOT NULL,
    `sub_mch_id` VARCHAR(64) NULL,
    `channel_app_id` VARCHAR(64) NULL,
    `scene` VARCHAR(32) NULL,
    `is_sandbox` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `private_key` TEXT NULL,
    `platform_cert` TEXT NULL,
    `cert_serial_no` VARCHAR(64) NULL,
    `api_v3_key` VARCHAR(128) NULL,
    `sign_type` VARCHAR(32) NULL,
    `notify_url` VARCHAR(256) NULL,
    `bill_params` JSON NULL,
    `extra` JSON NULL,
    `remark` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_channel_enabled`(`channel`, `enabled`),
    UNIQUE INDEX `channel_config_channel_mch_id_scene_key`(`channel`, `mch_id`, `scene`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_app` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `app_secret` VARCHAR(512) NOT NULL,
    `pay_notify_url` VARCHAR(256) NOT NULL,
    `refund_notify_url` VARCHAR(256) NULL,
    `ip_whitelist` VARCHAR(512) NULL,
    `verify_notify_sign` BOOLEAN NOT NULL DEFAULT true,
    `allow_channels` JSON NULL,
    `limit_per_order` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_app_app_id_key`(`app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_bill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `bill_date` DATE NOT NULL,
    `task_id` BIGINT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `mch_id` VARCHAR(64) NOT NULL,
    `bill_type` VARCHAR(16) NOT NULL DEFAULT 'TRADE',
    `trade_no` VARCHAR(64) NOT NULL,
    `out_trade_no` VARCHAR(64) NULL,
    `merchant_order_no` VARCHAR(64) NULL,
    `app_id` VARCHAR(32) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `refund_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `net_amount` DECIMAL(18, 2) NULL,
    `trade_status` VARCHAR(20) NOT NULL,
    `raw_status` VARCHAR(64) NULL,
    `trade_time` DATETIME(3) NULL,
    `payer_id` VARCHAR(64) NULL,
    `subject` VARCHAR(256) NULL,
    `trade_type` VARCHAR(32) NULL,
    `fee` DECIMAL(18, 2) NULL,
    `raw` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_bill_date_channel`(`bill_date`, `channel`),
    INDEX `idx_out_trade_no`(`out_trade_no`),
    INDEX `idx_trade_no`(`trade_no`),
    INDEX `idx_task_id`(`task_id`),
    UNIQUE INDEX `channel_bill_bill_date_channel_mch_id_trade_no_bill_type_key`(`bill_date`, `channel`, `mch_id`, `trade_no`, `bill_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconcile_task` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_no` VARCHAR(32) NOT NULL,
    `period_type` VARCHAR(16) NOT NULL DEFAULT 'DAILY',
    `bill_date` DATE NOT NULL,
    `start_time` DATETIME(3) NULL,
    `end_time` DATETIME(3) NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'ALL',
    `app_id` VARCHAR(32) NOT NULL DEFAULT 'ALL',
    `mch_id` VARCHAR(64) NOT NULL DEFAULT 'ALL',
    `status` VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    `channel_count` INTEGER NOT NULL DEFAULT 0,
    `channel_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `center_count` INTEGER NOT NULL DEFAULT 0,
    `center_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `matched_count` INTEGER NOT NULL DEFAULT 0,
    `matched_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `diff_count` INTEGER NOT NULL DEFAULT 0,
    `diff_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `match_rate` DECIMAL(10, 4) NULL,
    `bill_source` VARCHAR(16) NOT NULL DEFAULT 'AUTO',
    `triggered_by` VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    `trigger_type` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `duration_ms` INTEGER NULL,
    `error_message` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reconcile_task_task_no_key`(`task_no`),
    INDEX `idx_billdate_channel`(`bill_date`, `channel`),
    INDEX `idx_status_created`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconcile_diff` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `diff_type` VARCHAR(20) NOT NULL,
    `severity` VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    `bill_date` DATE NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `app_id` VARCHAR(32) NULL,
    `pay_order_no` VARCHAR(32) NULL,
    `merchant_order_no` VARCHAR(64) NULL,
    `channel_trade_no` VARCHAR(64) NULL,
    `center_amount` DECIMAL(18, 2) NULL,
    `channel_amount` DECIMAL(18, 2) NULL,
    `diff_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `center_status` VARCHAR(20) NULL,
    `channel_status` VARCHAR(20) NULL,
    `handle_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `handle_action` VARCHAR(64) NULL,
    `handler` VARCHAR(64) NULL,
    `handle_remark` VARCHAR(512) NULL,
    `handled_at` DATETIME(3) NULL,
    `refund_no` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_task_difftype`(`task_id`, `diff_type`),
    INDEX `idx_handle_billdate`(`handle_status`, `bill_date`),
    INDEX `idx_billdate_channel`(`bill_date`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operation_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `operator` VARCHAR(64) NOT NULL,
    `operator_type` VARCHAR(16) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_id` VARCHAR(64) NULL,
    `detail` VARCHAR(1024) NULL,
    `payload` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `result` VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_operator_created`(`operator`, `created_at`),
    INDEX `idx_module_created`(`module`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notify_task` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `biz_type` VARCHAR(16) NOT NULL,
    `biz_no` VARCHAR(32) NOT NULL,
    `app_id` VARCHAR(32) NOT NULL,
    `notify_url` VARCHAR(256) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `max_retry` INTEGER NOT NULL DEFAULT 8,
    `next_retry_at` DATETIME(3) NULL,
    `last_status_code` INTEGER NULL,
    `last_response` VARCHAR(1024) NULL,
    `last_error` VARCHAR(512) NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_status_next`(`status`, `next_retry_at`),
    INDEX `idx_biz`(`biz_type`, `biz_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_record` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(32) NOT NULL,
    `idem_key` VARCHAR(128) NOT NULL,
    `request_hash` VARCHAR(64) NOT NULL,
    `response_json` JSON NULL,
    `expire_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `idempotency_record_scope_idem_key_key`(`scope`, `idem_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `nickname` VARCHAR(64) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'OPERATOR',
    `email` VARCHAR(128) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `last_login_ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_user_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_notify_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `channel` VARCHAR(20) NOT NULL,
    `notify_type` VARCHAR(16) NOT NULL,
    `pay_order_no` VARCHAR(32) NULL,
    `trade_no` VARCHAR(64) NULL,
    `sign_ok` BOOLEAN NOT NULL DEFAULT false,
    `handle_result` VARCHAR(20) NULL,
    `raw` JSON NULL,
    `error_msg` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_pay_order_no`(`pay_order_no`),
    INDEX `idx_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refund_order` ADD CONSTRAINT `refund_order_pay_order_no_fkey` FOREIGN KEY (`pay_order_no`) REFERENCES `pay_order`(`pay_order_no`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_bill` ADD CONSTRAINT `channel_bill_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `reconcile_task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconcile_diff` ADD CONSTRAINT `reconcile_diff_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `reconcile_task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

